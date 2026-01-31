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
  QontoScaSessionStatus,
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

  private generateIdempotencyKey(): string {
    return `${Date.now()}-${Math.random().toString(36).substring(2, 15)}`;
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
   * Find a trusted beneficiary by IBAN
   */
  async findTrustedBeneficiary(iban: string): Promise<string | null> {
    try {
      const response = await this.listBeneficiaries({ 
        iban: iban.replace(/\s/g, "").toUpperCase(),
        trusted: true,
      });
      
      if (response.beneficiaries.length > 0) {
        return response.beneficiaries[0].id;
      }
      return null;
    } catch (error) {
      log.warn({ iban, error }, "Failed to find beneficiary");
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
   * Poll SCA session status
   */
  async getScaSessionStatus(scaSessionToken: string): Promise<QontoScaSessionStatus> {
    const response = await fetch(`${this.baseUrl}/v2/sca/sessions/${scaSessionToken}`, {
      method: "GET",
      headers: this.getHeaders(),
    });
    
    if (!response.ok) {
      const text = await response.text();
      throw new QontoApiError(`SCA session check failed: ${response.status}`, response.status, undefined, text);
    }
    
    return response.json() as Promise<QontoScaSessionStatus>;
  }

  /**
   * Wait for SCA approval with polling
   * @param scaSessionToken The SCA session token from 428 response
   * @param timeoutMs Maximum time to wait (default 5 minutes)
   * @param pollIntervalMs Polling interval (default 2 seconds)
   */
  async waitForScaApproval(
    scaSessionToken: string,
    timeoutMs: number = 300000,
    pollIntervalMs: number = 2000
  ): Promise<boolean> {
    const startTime = Date.now();
    
    log.info({ scaSessionToken: scaSessionToken.substring(0, 20) + "..." }, "Waiting for SCA approval...");
    
    while (Date.now() - startTime < timeoutMs) {
      try {
        const status = await this.getScaSessionStatus(scaSessionToken);
        
        log.debug({ status: status.status }, "SCA session status");
        
        if (status.status === "allow") {
          log.info("SCA approved by user");
          return true;
        } else if (status.status === "deny") {
          log.warn("SCA denied by user");
          return false;
        }
        
        // Still waiting
        await this.sleep(pollIntervalMs);
      } catch (error) {
        log.warn({ error }, "Error polling SCA status");
        await this.sleep(pollIntervalMs);
      }
    }
    
    log.warn("SCA approval timeout");
    return false;
  }

  // ============ SEPA Transfers ============

  /**
   * Create a SEPA transfer
   * If SCA is required, will wait for user approval and retry
   */
  async createTransfer(request: QontoCreateTransferRequest): Promise<QontoTransferResponse> {
    const idempotencyKey = this.generateIdempotencyKey();
    
    try {
      return await this.request<QontoTransferResponse>(
        "POST",
        "/v2/sepa/transfers",
        request,
        idempotencyKey
      );
    } catch (error) {
      // Handle SCA required
      if (error instanceof QontoScaRequiredError) {
        log.info(
          { scaMethods: error.scaMethods },
          "SCA required - please approve on your Qonto app"
        );
        
        // Wait for user approval
        const approved = await this.waitForScaApproval(error.scaSessionToken);
        
        if (!approved) {
          throw new QontoApiError("SCA approval denied or timed out", 428, "sca_denied");
        }
        
        // Retry with SCA token
        log.info("Retrying transfer with SCA token");
        return await this.requestWithScaToken<QontoTransferResponse>(
          "POST",
          "/v2/sepa/transfers",
          request,
          error.scaSessionToken,
          idempotencyKey
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
