/**
 * Qonto API Client
 * Handles HTTP communication with Qonto's Business API
 */

import { createLogger } from "../utils/logger.js";
import {
  QontoProviderConfig,
  QontoOrganization,
  QontoBankAccountResponse,
  QontoVerifyPayeeRequest,
  QontoVerifyPayeeResponse,
  QontoCreateTransferRequest,
  QontoTransferResponse,
  QontoBeneficiariesResponse,
  QontoError,
  QontoScaResponse,
} from "./qonto-types.js";

const log = createLogger("qonto-client");

const PRODUCTION_BASE_URL = "https://thirdparty.qonto.com";
const SANDBOX_BASE_URL = "https://thirdparty-sandbox.staging.qonto.co";

export class QontoApiError extends Error {
  constructor(
    message: string,
    public statusCode: number,
    public errorCode?: string,
    public details?: string
  ) {
    super(message);
    this.name = "QontoApiError";
  }
}

export class QontoScaRequiredError extends Error {
  constructor(
    public scaSessionToken: string,
    public scaMethods: string[]
  ) {
    super("SCA required - waiting for user approval");
    this.name = "QontoScaRequiredError";
  }
}

const PRODUCTION_OAUTH_TOKEN_URL = "https://oauth.qonto.com/oauth2/token";
const SANDBOX_OAUTH_TOKEN_URL = "https://oauth-sandbox.staging.qonto.co/oauth2/token";

export class QontoClient {
  private baseUrl: string;
  private oauthTokenUrl: string;
  private authMethod: 'api_key' | 'oauth';
  private apiKeyLogin?: string;
  private apiKeySecret?: string;
  private accessToken?: string;
  private refreshToken?: string;
  private clientId?: string;
  private clientSecret?: string;
  private stagingToken?: string;
  private maxRetries: number;
  private tokenExpiresAt?: number;
  private isRefreshing: boolean = false;
  private onTokenRefresh?: (accessToken: string, refreshToken: string) => void;

  constructor(config: QontoProviderConfig) {
    this.baseUrl = config.useSandbox ? SANDBOX_BASE_URL : PRODUCTION_BASE_URL;
    this.oauthTokenUrl = config.useSandbox ? SANDBOX_OAUTH_TOKEN_URL : PRODUCTION_OAUTH_TOKEN_URL;
    this.authMethod = config.authMethod;
    this.apiKeyLogin = config.apiKeyLogin;
    this.apiKeySecret = config.apiKeySecret;
    this.accessToken = config.accessToken;
    this.refreshToken = config.refreshToken;
    this.clientId = config.clientId;
    this.clientSecret = config.clientSecret;
    this.stagingToken = config.stagingToken;
    this.maxRetries = config.maxRetries;
    this.onTokenRefresh = config.onTokenRefresh;

    log.info(
      { 
        baseUrl: this.baseUrl, 
        sandbox: config.useSandbox,
        authMethod: this.authMethod,
        bankAccountId: config.bankAccountId,
        hasRefreshToken: !!this.refreshToken,
        hasClientCredentials: !!(this.clientId && this.clientSecret),
      },
      "Qonto client initialized"
    );
  }

  /**
   * Check if we can auto-refresh the token
   */
  canAutoRefresh(): boolean {
    return !!(this.refreshToken && this.clientId && this.clientSecret);
  }

  /**
   * Refresh the OAuth access token using the refresh token
   * Returns true if refresh was successful
   */
  private async refreshAccessToken(): Promise<boolean> {
    if (!this.refreshToken || !this.clientId || !this.clientSecret) {
      log.warn("Cannot refresh token: missing refresh_token or client credentials");
      return false;
    }

    if (this.isRefreshing) {
      // Wait for ongoing refresh
      await this.sleep(1000);
      return !!this.accessToken;
    }

    this.isRefreshing = true;

    try {
      log.info("Refreshing OAuth access token...");

      const body = new URLSearchParams({
        grant_type: "refresh_token",
        client_id: this.clientId,
        client_secret: this.clientSecret,
        refresh_token: this.refreshToken,
      });

      const headers: Record<string, string> = {
        "Content-Type": "application/x-www-form-urlencoded",
      };
      if (this.stagingToken) {
        headers["X-Qonto-Staging-Token"] = this.stagingToken;
      }

      const response = await fetch(this.oauthTokenUrl, {
        method: "POST",
        headers,
        body: body,
      });

      if (!response.ok) {
        const errorText = await response.text();
        log.error({ status: response.status, body: errorText }, "Failed to refresh token");
        return false;
      }

      const data = await response.json() as {
        access_token: string;
        refresh_token?: string;
        expires_in?: number;
        token_type: string;
      };

      this.accessToken = data.access_token;
      
      // Qonto uses rotating refresh tokens
      if (data.refresh_token) {
        this.refreshToken = data.refresh_token;
      }

      // Set expiry (default to 1 hour if not provided, minus 5 min buffer)
      const expiresIn = data.expires_in || 3600;
      this.tokenExpiresAt = Date.now() + (expiresIn - 300) * 1000;

      log.info({ expiresIn }, "✅ OAuth token refreshed successfully");

      // Notify callback so tokens can be persisted
      if (this.onTokenRefresh && data.refresh_token) {
        this.onTokenRefresh(data.access_token, data.refresh_token);
      }

      return true;
    } catch (error) {
      log.error({ error }, "Error refreshing OAuth token");
      return false;
    } finally {
      this.isRefreshing = false;
    }
  }

  // ============ Private Helpers ============

  private getHeaders(idempotencyKey?: string): Record<string, string> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "Accept": "application/json",
    };

    // API Key authentication uses login:secret_key format
    if (this.authMethod === 'api_key' && this.apiKeyLogin && this.apiKeySecret) {
      headers["Authorization"] = `${this.apiKeyLogin}:${this.apiKeySecret}`;
    } 
    // OAuth uses Bearer token
    else if (this.authMethod === 'oauth' && this.accessToken) {
      headers["Authorization"] = `Bearer ${this.accessToken}`;
    }

    if (this.stagingToken) {
      headers["X-Qonto-Staging-Token"] = this.stagingToken;
    }

    if (idempotencyKey) {
      headers["X-Qonto-Idempotency-Key"] = idempotencyKey;
    }

    // For trusted beneficiaries, we can use mock SCA in sandbox
    // In production with trusted beneficiaries, no SCA is required
    if (this.stagingToken) {
      headers["X-Qonto-2fa-Preference"] = "mock";
    }

    return headers;
  }

  private async request<T>(
    method: "GET" | "POST" | "PUT" | "DELETE",
    path: string,
    body?: unknown,
    idempotencyKey?: string
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        const response = await fetch(url, {
          method,
          headers: this.getHeaders(idempotencyKey),
          body: body ? JSON.stringify(body) : undefined,
        });

        // Log request/response for debugging
        log.debug(
          {
            method,
            path,
            status: response.status,
            attempt,
          },
          "API request"
        );

        // Handle rate limiting
        if (response.status === 429) {
          const retryAfter = response.headers.get("Retry-After");
          const waitMs = retryAfter ? parseInt(retryAfter, 10) * 1000 : 5000;
          log.warn({ waitMs, attempt }, "Rate limited, waiting...");
          await this.sleep(waitMs);
          continue;
        }

        // Handle server errors with retry
        if (response.status >= 500) {
          const text = await response.text();
          log.warn(
            { status: response.status, body: text, attempt },
            "Server error, retrying..."
          );
          await this.sleep(1000 * attempt); // Exponential backoff
          continue;
        }

        // Handle SCA required (428 Precondition Required)
        if (response.status === 428) {
          const scaBody = await response.text();
          log.info({ path, body: scaBody }, "SCA required (428)");
          
          try {
            const scaData = JSON.parse(scaBody) as QontoScaResponse;
            throw new QontoScaRequiredError(
              scaData.sca_session_token,
              scaData.sca_methods || []
            );
          } catch (e) {
            if (e instanceof QontoScaRequiredError) throw e;
            throw new QontoApiError("SCA required but could not parse response", 428, "sca_required", scaBody);
          }
        }

        // Handle 401 Unauthorized - try to refresh token
        if (response.status === 401 && this.authMethod === 'oauth' && this.canAutoRefresh() && attempt === 1) {
          log.info("Received 401, attempting token refresh...");
          const refreshed = await this.refreshAccessToken();
          if (refreshed) {
            log.info("Token refreshed, retrying request...");
            continue; // Retry with new token
          }
          // If refresh failed, fall through to error handling
        }

        // Parse response
        if (!response.ok) {
          const errorBody = await response.text();
          let errorMessage = `Qonto API error: ${response.status}`;
          let errorCode: string | undefined;
          let details: string | undefined;

          // Log full error response for debugging
          log.error(
            { 
              status: response.status, 
              body: errorBody,
              headers: Object.fromEntries(response.headers.entries()),
              path,
            },
            "API error response"
          );

          try {
            const parsed = JSON.parse(errorBody) as QontoError;
            if (parsed.errors && parsed.errors.length > 0) {
              errorCode = parsed.errors[0].code;
              details = parsed.errors[0].detail;
              errorMessage = `${errorCode}: ${details}`;
            }
          } catch {
            details = errorBody;
          }

          throw new QontoApiError(errorMessage, response.status, errorCode, details);
        }

        // Success - parse JSON
        const data = await response.json();
        return data as T;

      } catch (error) {
        lastError = error as Error;

        // SCA-required is terminal for this retry loop — propagate immediately to
        // createTransfer. Retrying here only burns attempts and makes Qonto mint a
        // fresh throwaway sca_session_token each time (observed as duplicate 428s).
        if (error instanceof QontoScaRequiredError) {
          throw error;
        }

        // Don't retry client errors (4xx) except rate limiting
        if (error instanceof QontoApiError && error.statusCode < 500 && error.statusCode !== 429) {
          throw error;
        }

        // Don't retry on last attempt
        if (attempt === this.maxRetries) {
          break;
        }

        log.warn(
          { error: lastError.message, attempt },
          "Request failed, retrying..."
        );
        await this.sleep(1000 * attempt);
      }
    }

    throw lastError || new Error("Request failed after retries");
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // ============ Organization & Accounts ============

  /**
   * Get organization details including bank accounts
   */
  async getOrganization(): Promise<QontoOrganization> {
    return this.request<QontoOrganization>("GET", "/v2/organization");
  }

  /**
   * Get a specific bank account by ID
   */
  async getBankAccount(accountId: string): Promise<QontoBankAccountResponse> {
    return this.request<QontoBankAccountResponse>("GET", `/v2/bank_accounts/${accountId}`);
  }

  // ============ Beneficiaries ============

  /**
   * List beneficiaries with optional filters
   */
  async listBeneficiaries(params?: {
    trusted?: boolean;
    iban?: string;
    page?: number;
    per_page?: number;
  }): Promise<QontoBeneficiariesResponse> {
    const queryParams = new URLSearchParams();
    if (params?.trusted !== undefined) {
      queryParams.set("trusted", String(params.trusted));
    }
    if (params?.iban) {
      queryParams.set("iban", params.iban);
    }
    if (params?.page) {
      queryParams.set("page", String(params.page));
    }
    if (params?.per_page) {
      queryParams.set("per_page", String(params.per_page));
    }

    const query = queryParams.toString();
    const path = `/v2/sepa/beneficiaries${query ? `?${query}` : ""}`;
    return this.request<QontoBeneficiariesResponse>("GET", path);
  }

  /**
   * Whether a TRUSTED beneficiary with this IBAN exists in the Qonto org.
   * Returns true (a trusted match exists), false (lookup succeeded, none found), or
   * null (the lookup itself failed). Distinguishing "not trusted" from "couldn't
   * check" matters: an unattended payout must FAIL FAST on the former, but must NOT
   * be blocked by a transient API error on the latter (fail open).
   */
  async checkBeneficiaryTrusted(iban: string): Promise<boolean | null> {
    try {
      const response = await this.listBeneficiaries({
        iban: iban.replace(/\s/g, "").toUpperCase(),
        trusted: true,
      });
      return response.beneficiaries.length > 0;
    } catch (error) {
      log.warn({ iban, error }, "Trusted-beneficiary lookup failed (treating as unknown)");
      return null;
    }
  }

  // ============ Verification of Payee ============

  /**
   * Verify payee (VoP) - required before creating transfers
   */
  async verifyPayee(request: QontoVerifyPayeeRequest): Promise<QontoVerifyPayeeResponse> {
    return this.request<QontoVerifyPayeeResponse>(
      "POST",
      "/v2/sepa/verify_payee",
      request
    );
  }

  // ============ SCA (Strong Customer Authentication) ============

  /**
   * Approve a mocked SCA session in the sandbox. Real device/SMS approval isn't
   * available there and GET /v2/sca/sessions/{token} 404s; paired with the
   * X-Qonto-2fa-Preference: mock header, the 428 session is cleared via this
   * endpoint. Returns true on success so the caller's retry path is unchanged.
   */
  async approveMockScaSession(scaSessionToken: string): Promise<boolean> {
    const url = `${this.baseUrl}/v2/mocked_sca_sessions/${scaSessionToken}/allow`;
    log.info("Sandbox: approving mocked SCA session");
    const response = await fetch(url, { method: "POST", headers: this.getHeaders() });
    if (!response.ok) {
      const text = await response.text();
      log.warn({ status: response.status, body: text }, "Mock SCA approval failed");
      return false;
    }
    log.info("Mocked SCA session approved");
    return true;
  }

  // ============ SEPA Transfers ============

  /**
   * Create a SEPA transfer
   * If SCA is required, will wait for user approval and retry
   *
   * @param request Transfer payload (VoP proof token + transfer details).
   * @param idempotencyKey Value sent as the (required) X-Qonto-Idempotency-Key header. This MUST be
   *   derived deterministically from the off-ramp intent (see QontoProvider.executeTransfer) and stay
   *   stable across every retry of the same logical transfer. Qonto caches the first successful
   *   response per key (~24h window) and replays it for any later request with the same key, so a
   *   re-send after a solver crash/timeout returns the original transfer instead of moving real EUR
   *   twice. Never pass a random or per-call value here — that would defeat the dedup guarantee.
   */
  async createTransfer(
    request: QontoCreateTransferRequest,
    idempotencyKey: string
  ): Promise<QontoTransferResponse> {
    if (!idempotencyKey) {
      // Fail loudly rather than send money with no dedup protection.
      throw new Error("createTransfer requires a deterministic idempotencyKey");
    }

    try {
      return await this.request<QontoTransferResponse>(
        "POST",
        "/v2/sepa/transfers",
        request,
        idempotencyKey
      );
    } catch (error) {
      // Handle SCA required (428)
      if (error instanceof QontoScaRequiredError) {
        // SANDBOX: device/SMS SCA isn't available and GET /v2/sca/sessions/{token}
        // 404s, so approve the mocked session directly (pairs with the
        // X-Qonto-2fa-Preference: mock header), then retry with the session token.
        if (this.stagingToken) {
          log.info({ scaMethods: error.scaMethods }, "SCA required - approving mocked sandbox session");
          const approved = await this.approveMockScaSession(error.scaSessionToken);
          if (!approved) {
            throw new QontoApiError("SCA approval failed (sandbox mock)", 428, "sca_denied");
          }
          log.info("Retrying transfer with SCA token");
          return await this.requestWithScaToken<QontoTransferResponse>(
            "POST",
            "/v2/sepa/transfers",
            request,
            error.scaSessionToken,
            idempotencyKey
          );
        }

        // PRODUCTION: an unattended solver cannot complete device SCA, and Qonto's
        // GET /v2/sca/sessions/{token} status poll returns 404 in prod — so the old
        // "wait up to 5 minutes for approval" path could NEVER succeed and just
        // stranded the intent (no transfer created, USDC stuck). SCA only fires for
        // NON-trusted beneficiaries, so fail FAST with an actionable reason instead.
        // (QontoProvider.executeTransfer pre-checks trust and normally catches this
        // first; this is the backstop.) Fix: a trusted beneficiary or a Qonto SCA
        // exemption — see docs/agent/debugging.md "Qonto 428 sca_required".
        log.error(
          { scaMethods: error.scaMethods },
          "SCA required in production (recipient not a trusted beneficiary) — failing fast; unattended solver cannot device-approve"
        );
        throw new QontoApiError(
          "SCA required: the recipient is not a trusted Qonto beneficiary, and an unattended solver " +
            "cannot complete device approval. Mark the beneficiary as trusted in Qonto (Settings → " +
            "Beneficiaries), or obtain a Qonto SCA exemption for the API integration.",
          428,
          "sca_required_untrusted"
        );
      }
      throw error;
    }
  }

  /**
   * Make request with SCA session token header
   */
  private async requestWithScaToken<T>(
    method: "GET" | "POST" | "PUT" | "DELETE",
    path: string,
    body: unknown,
    scaSessionToken: string,
    idempotencyKey?: string
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const headers = this.getHeaders(idempotencyKey);
    headers["X-Qonto-Sca-Session-Token"] = scaSessionToken;
    
    const response = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
    
    if (!response.ok) {
      const errorBody = await response.text();
      throw new QontoApiError(`Request failed: ${response.status}`, response.status, undefined, errorBody);
    }
    
    return response.json() as Promise<T>;
  }

  /**
   * Get a transfer by ID
   */
  async getTransfer(transferId: string): Promise<QontoTransferResponse> {
    return this.request<QontoTransferResponse>("GET", `/v2/sepa/transfers/${transferId}`);
  }

  /**
   * Cancel a pending transfer
   */
  async cancelTransfer(transferId: string): Promise<void> {
    await this.request<void>("POST", `/v2/sepa/transfers/${transferId}/cancel`);
  }

  // ============ Health Check ============

  /**
   * Check if the API is accessible and credentials are valid
   */
  async healthCheck(): Promise<boolean> {
    try {
      await this.getOrganization();
      return true;
    } catch (error) {
      log.error({ error }, "Health check failed");
      return false;
    }
  }
}
