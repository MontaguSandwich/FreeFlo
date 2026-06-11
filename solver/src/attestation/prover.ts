/**
 * TLSNotary Prover Integration
 * 
 * Spawns the Rust TLSNotary prover as a subprocess to generate proofs
 * for completed Qonto transfers.
 */

import { spawn } from "child_process";
import { existsSync } from "fs";
import { readFile, mkdir } from "fs/promises";
import { join, dirname } from "path";
import { createLogger } from "../utils/logger.js";

const log = createLogger("tlsnotary-prover");

export interface ProverConfig {
  /** Path to the TLSNotary qonto crate directory (e.g., /opt/FreeFlo/providers/prover/adapters/qonto) */
  tlsnExamplesPath: string;
  /** Path to store generated proofs */
  proofStoragePath: string;
  /** Qonto API credentials (API key, not OAuth) */
  qontoApiKeyLogin: string;
  qontoApiKeySecret: string;
  /** Qonto bank account slug (e.g., "org-slug-bank-account-1") */
  qontoBankAccountSlug: string;
  /** Timeout for proof generation (ms) - default 180s for first compile */
  timeout?: number;
}

export interface ProofResult {
  success: boolean;
  /** Transfer-endpoint proof (status + amount + beneficiary_id). */
  transferPresentationBase64?: string;
  /** Beneficiary-endpoint proof (recipient IBAN). */
  beneficiaryPresentationBase64?: string;
  error?: string;
  duration?: number;
}

/**
 * Generate a TLSNotary proof for a Qonto transfer
 */
export async function generateQontoProof(
  transferId: string,
  config: ProverConfig
): Promise<ProofResult> {
  const startTime = Date.now();
  const timeout = config.timeout || 120000; // 2 minutes default

  log.info({ transferId }, "Starting TLSNotary proof generation");

  try {
    await mkdir(config.proofStoragePath, { recursive: true });

    const proveEnv = {
      QONTO_API_KEY_LOGIN: config.qontoApiKeyLogin,
      QONTO_API_KEY_SECRET: config.qontoApiKeySecret,
    };
    const presentationPath = join(config.tlsnExamplesPath, "qonto_transfer.presentation.tlsn");

    // Run prove + present for one QONTO_PROVE_PATH. Returns the presentation (base64)
    // and the prover stdout (carries BENEFICIARY_ID on a transfer proof). Qonto won't
    // serve transfer + beneficiary on one notarized connection, so we prove each.
    const proveOne = async (
      provePath: string,
      budgetMs: number
    ): Promise<{ base64: string; stdout: string }> => {
      const prove = await runCargoBinary(
        config.tlsnExamplesPath,
        "qonto_prove_transfer",
        { ...proveEnv, QONTO_PROVE_PATH: provePath },
        budgetMs * 0.6
      );
      if (!prove.success) throw new Error(`prove ${provePath} failed: ${prove.error}`);

      const present = await runCargoBinary(
        config.tlsnExamplesPath,
        "qonto_present_transfer",
        {},
        budgetMs * 0.4
      );
      if (!present.success) throw new Error(`present ${provePath} failed: ${present.error}`);

      const bytes = await readFile(presentationPath);
      return { base64: bytes.toString("base64"), stdout: prove.stdout };
    };

    // Proof 1: the transfer (status + amount). Also emits the beneficiary_id.
    log.info({ transferId }, "Proof 1/2: transfer");
    const transfer = await proveOne(`/v2/sepa/transfers/${transferId}`, timeout * 0.5);
    const match = transfer.stdout.match(/BENEFICIARY_ID=([0-9a-fA-F-]+)/);
    if (!match) {
      return {
        success: false,
        error: "prover did not emit BENEFICIARY_ID from the transfer response",
        duration: Date.now() - startTime,
      };
    }
    const beneficiaryId = match[1];

    // Proof 2: the beneficiary (recipient IBAN).
    log.info({ transferId, beneficiaryId }, "Proof 2/2: beneficiary");
    const beneficiary = await proveOne(`/v2/beneficiaries/${beneficiaryId}`, timeout * 0.5);

    const duration = Date.now() - startTime;
    log.info(
      {
        transferId,
        duration,
        transferSize: transfer.base64.length,
        beneficiarySize: beneficiary.base64.length,
      },
      "TLSNotary proofs (transfer + beneficiary) generated successfully"
    );

    return {
      success: true,
      transferPresentationBase64: transfer.base64,
      beneficiaryPresentationBase64: beneficiary.base64,
      duration,
    };

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    log.error({ transferId, error: errorMessage }, "Failed to generate TLSNotary proof");
    
    return {
      success: false,
      error: errorMessage,
      duration: Date.now() - startTime,
    };
  }
}

/**
 * Resolve a prebuilt release binary for `binaryName`, if one exists. Walks up from
 * `workingDir` checking `<dir>/target/release/<binaryName>` at each level, so it finds
 * the binary at the cargo WORKSPACE root (where `target/` lives) even when the adapter
 * is a member crate. Returns its absolute path, or null to fall back to `cargo run`.
 * Using the prebuilt binary avoids needing cargo on PATH and skips the recompile.
 */
export function findPrebuiltBinary(workingDir: string, binaryName: string): string | null {
  let dir = workingDir;
  for (let i = 0; i < 10; i++) {
    const bin = join(dir, "target", "release", binaryName);
    if (existsSync(bin)) return bin;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

/**
 * Run a prover binary and wait for completion. Prefers the prebuilt release binary
 * (no cargo/PATH dependency, no recompile) and falls back to `cargo run`.
 */
async function runCargoBinary(
  workingDir: string,
  binaryName: string,
  env: Record<string, string>,
  timeout: number
): Promise<{ success: boolean; stdout: string; stderr: string; error?: string }> {
  return new Promise((resolve) => {
    const prebuilt = findPrebuiltBinary(workingDir, binaryName);
    const command = prebuilt ?? "cargo";
    const args = prebuilt ? [] : ["run", "--release", "--bin", binaryName];
    log.debug(
      { binaryName, mode: prebuilt ? "prebuilt-binary" : "cargo-run", command },
      "Spawning prover process"
    );
    const child = spawn(command, args, {
      cwd: workingDir,
      env: { ...process.env, ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let killed = false;

    const timer = setTimeout(() => {
      killed = true;
      child.kill("SIGTERM");
    }, timeout);

    child.stdout.on("data", (data) => {
      stdout += data.toString();
    });

    child.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    child.on("close", (code) => {
      clearTimeout(timer);

      if (killed) {
        resolve({
          success: false,
          stdout,
          stderr,
          error: "Proof generation timed out",
        });
      } else if (code !== 0) {
        resolve({
          success: false,
          stdout,
          stderr,
          error: `Process exited with code ${code}: ${stderr.slice(-500)}`,
        });
      } else {
        resolve({
          success: true,
          stdout,
          stderr,
        });
      }
    });

    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({
        success: false,
        stdout,
        stderr,
        error: `Failed to spawn process: ${err.message}`,
      });
    });
  });
}

/**
 * Check if the TLSNotary toolchain is available
 */
export async function checkProverAvailable(tlsnExamplesPath: string): Promise<boolean> {
  // A prebuilt binary means we don't even need cargo on PATH.
  if (findPrebuiltBinary(tlsnExamplesPath, "qonto_prove_transfer")) {
    return true;
  }
  try {
    const result = await runCargoBinary(
      tlsnExamplesPath,
      "qonto_prove_transfer", // probe: did the toolchain spawn at all?
      { QONTO_REFERENCE: "__check__" }, // will error, but distinguishes "ran" from "couldn't spawn"
      5000
    );
    // A spawn failure (cargo missing / bad cwd) is the only hard "unavailable" signal.
    return !result.error?.startsWith("Failed to spawn process");
  } catch {
    return false;
  }
}

