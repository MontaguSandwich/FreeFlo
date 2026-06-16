import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { QontoClient } from "./qonto-client.js";
import type { QontoCreateTransferRequest, QontoProviderConfig } from "./qonto-types.js";

/**
 * Regression tests for the Qonto idempotency guarantee.
 *
 * The off-ramp moves real EUR. The only protection against a double fiat-send across a solver
 * crash/retry is the deterministic X-Qonto-Idempotency-Key derived from the intent id: Qonto
 * caches the first successful response per key and replays it for later requests with the same
 * key. These tests pin that the caller-supplied key actually reaches the wire and stays stable
 * across every retry path (internal 5xx backoff loop + SCA approval retry).
 */

const baseConfig: QontoProviderConfig = {
  authMethod: "api_key",
  apiKeyLogin: "test-login",
  apiKeySecret: "test-secret",
  bankAccountId: "bank-acc-1",
  useSandbox: false,
  feeBps: 50,
  quoteValiditySecs: 300,
  maxRetries: 3,
  statusPollIntervalMs: 1,
  maxTransferWaitMs: 1000,
};

const transferRequest: QontoCreateTransferRequest = {
  vop_proof_token: "vop-token",
  transfer: {
    bank_account_id: "bank-acc-1",
    beneficiary: { name: "Alice Example", iban: "DE89370400440532013000" },
    amount: "100.00",
    reference: "OFFRAMP-0xabc123",
  },
};

const successBody = { transfer: { id: "transfer-1", status: "settled", amount: 100 } };

function idempotencyKeyOf(call: unknown[]): string | undefined {
  const init = call[1] as { headers?: Record<string, string> } | undefined;
  return init?.headers?.["X-Qonto-Idempotency-Key"];
}

describe("QontoClient.createTransfer idempotency", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    // Skip the real exponential-backoff waits in the 5xx retry loop.
    vi.spyOn(QontoClient.prototype as unknown as { sleep: () => Promise<void> }, "sleep")
      .mockResolvedValue(undefined);
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("sends the caller-provided deterministic key as X-Qonto-Idempotency-Key", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify(successBody), { status: 200 }));
    const client = new QontoClient(baseConfig);

    await client.createTransfer(transferRequest, "offramp-0xINTENT");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(idempotencyKeyOf(fetchMock.mock.calls[0])).toBe("offramp-0xINTENT");
  });

  it("reuses the SAME key across the internal 5xx retry loop", async () => {
    fetchMock
      .mockResolvedValueOnce(new Response("upstream boom", { status: 500 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(successBody), { status: 200 }));
    const client = new QontoClient(baseConfig);

    await client.createTransfer(transferRequest, "offramp-0xRETRY");

    // A transient 500 retried under a NEW random key would double-send; both attempts must match.
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(idempotencyKeyOf(fetchMock.mock.calls[0])).toBe("offramp-0xRETRY");
    expect(idempotencyKeyOf(fetchMock.mock.calls[1])).toBe("offramp-0xRETRY");
  });

  it("reuses the SAME key on the sandbox SCA mock-approve retry path", async () => {
    const scaToken = "sca-session-token-xyz";
    // Sandbox (stagingToken set): a 428 is mock-approved, then the transfer is retried with
    // the session token. maxRetries=1 keeps the initial (SCA-triggering) POST at exactly one.
    const client = new QontoClient({ ...baseConfig, useSandbox: true, stagingToken: "stg-token", maxRetries: 1 });

    fetchMock.mockImplementation(async (url: string, init: { method?: string; headers?: Record<string, string> }) => {
      // Mock-approve the SCA session.
      if (typeof url === "string" && url.includes("/mocked_sca_sessions/")) {
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }
      // Transfer retry carrying the SCA session token -> success.
      if (init?.headers?.["X-Qonto-Sca-Session-Token"]) {
        return new Response(JSON.stringify(successBody), { status: 200 });
      }
      // Initial transfer attempt -> SCA required.
      return new Response(
        JSON.stringify({ sca_session_token: scaToken, sca_methods: ["paired_device"] }),
        { status: 428 }
      );
    });

    await client.createTransfer(transferRequest, "offramp-0xSCA");

    const transferPosts = fetchMock.mock.calls.filter(
      (c: unknown[]) =>
        (c[1] as { method?: string } | undefined)?.method === "POST" &&
        typeof c[0] === "string" &&
        (c[0] as string).includes("/sepa/transfers")
    );
    expect(transferPosts).toHaveLength(2);
    // Both the initial 428 attempt and the SCA-token retry must carry the same idempotency key.
    expect(idempotencyKeyOf(transferPosts[0])).toBe("offramp-0xSCA");
    expect(idempotencyKeyOf(transferPosts[1])).toBe("offramp-0xSCA");
  });

  it("fails fast (no device-approval poll) when SCA is required in production", async () => {
    // Prod (no stagingToken): the unattended solver can't device-approve and Qonto's status
    // poll 404s, so SCA must fail fast with a clear, non-retryable reason — never a 5-min hang.
    const client = new QontoClient({ ...baseConfig, maxRetries: 1 });
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({ sca_session_token: "tok", sca_methods: ["paired_device"] }),
        { status: 428 }
      )
    );

    await expect(client.createTransfer(transferRequest, "offramp-0xPRODSCA")).rejects.toThrow(
      /not a trusted Qonto beneficiary/
    );
    // No GET status poll, no mock-approve, no retry-with-token: only the single transfer POST.
    expect(
      fetchMock.mock.calls.every((c: unknown[]) => (c[1] as { method?: string } | undefined)?.method === "POST")
    ).toBe(true);
    const transferPosts = fetchMock.mock.calls.filter(
      (c: unknown[]) => typeof c[0] === "string" && (c[0] as string).includes("/sepa/transfers")
    );
    expect(transferPosts).toHaveLength(1);
  });

  it("refuses to send a transfer when no idempotency key is provided", async () => {
    const client = new QontoClient(baseConfig);

    await expect(client.createTransfer(transferRequest, "")).rejects.toThrow(/idempotencyKey/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
