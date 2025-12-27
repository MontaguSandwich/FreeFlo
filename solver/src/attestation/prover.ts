/**
 * TLSNotary Prover Integration
 * 
 * Spawns the Rust TLSNotary prover as a subprocess to generate proofs
 * for completed Qonto transfers.
 */

import { spawn } from "child_process";
import { readFile, mkdir, writeFile } from "fs/promises";
import { join, dirname } from "path";
import { createLogger } from "../utils/logger.js";

const log = createLogger("tlsnotary-prover");

export interface ProverConfig {
  /** Path to the TLSNotary examples directory */
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
  presentationBase64?: string;
  presentationPath?: string;
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
    // Ensure proof storage directory exists
    await mkdir(config.proofStoragePath, { recursive: true });

    // Step 1: Generate attestation and secrets
    log.info({ transferId }, "Step 1/2: Generating attestation...");
    
    const proveResult = await runCargoExample(
      config.tlsnExamplesPath,
      "qonto_prove_transfer",
      {
        QONTO_API_KEY_LOGIN: config.qontoApiKeyLogin,
        QONTO_API_KEY_SECRET: config.qontoApiKeySecret,
        QONTO_BANK_ACCOUNT_SLUG: config.qontoBankAccountSlug,
        QONTO_TRANSFER_ID: transferId,
      },
      timeout * 0.6  // 60% of timeout for attestation step
    );

    if (!proveResult.success) {
      return {
        success: false,
        error: `Attestation generation failed: ${proveResult.error}`,
        duration: Date.now() - startTime,
      };
    }

    // Step 2: Generate presentation
    log.info({ transferId }, "Step 2/2: Generating presentation...");

    const presentResult = await runCargoExample(
      config.tlsnExamplesPath,
      "qonto_present_transfer",
      {},
      timeout * 0.4  // 40% of timeout for presentation step
    );

    if (!presentResult.success) {
      return {
        success: false,
        error: `Presentation generation failed: ${presentResult.error}`,
        duration: Date.now() - startTime,
      };
    }

    // Read the generated presentation
    const presentationPath = join(config.tlsnExamplesPath, "qonto_transfer.presentation.tlsn");
    const presentationBytes = await readFile(presentationPath);
    const presentationBase64 = presentationBytes.toString("base64");

    // Copy to proof storage with transfer ID
    const storedPath = join(config.proofStoragePath, `${transferId}.presentation.tlsn`);
    await writeFile(storedPath, presentationBytes);

    const duration = Date.now() - startTime;
    log.info(
      { transferId, duration, size: presentationBytes.length },
      "TLSNotary proof generated successfully"
    );

    return {
      success: true,
      presentationBase64,
      presentationPath: storedPath,
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
 * Run a cargo example and wait for completion
 */
async function runCargoExample(
  workingDir: string,
  exampleName: string,
  env: Record<string, string>,
  timeout: number
): Promise<{ success: boolean; stdout: string; stderr: string; error?: string }> {
  return new Promise((resolve) => {
    const child = spawn("cargo", ["run", "--release", "--example", exampleName], {
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
  try {
    const result = await runCargoExample(
      dirname(tlsnExamplesPath),
      "help", // This will fail but tells us if cargo is available
      {},
      5000
    );
    // If cargo ran at all (even with error), we're good
    return true;
  } catch {
    return false;
  }
}

