/**
 * Qonto API Types
 * Based on https://docs.qonto.com/api-reference/business-api/
 */

// ============ Common Types ============

export interface QontoError {
  errors: Array<{
    code: string;
    detail: string;
    source?: {
      pointer?: string;
      parameter?: string;
    };
  }>;
}

// ============ Organization & Bank Accounts ============

export interface QontoOrganization {
  organization: {
    slug: string;
    legal_name: string;
    bank_accounts: QontoBankAccount[];
  };
}

export interface QontoBankAccount {
  slug: string;
  id: string;
  iban: string;
  bic: string;
  currency: string;
  balance: number;
  balance_cents: number;
  authorized_balance: number;
  authorized_balance_cents: number;
  name: string;
  status: "active" | "closed";
  updated_at: string;
}

export interface QontoBankAccountResponse {
  bank_account: QontoBankAccount;
}

// ============ Beneficiaries ============

export interface QontoBeneficiary {
  id: string;
  name: string;
  iban: string;
  bic?: string;
  email?: string;
  trusted: boolean;
  activity_tag?: string;
  created_at: string;
  updated_at: string;
}

export interface QontoBeneficiaryResponse {
  beneficiary: QontoBeneficiary;
}

export interface QontoBeneficiariesResponse {
  beneficiaries: QontoBeneficiary[];
  meta: {
    current_page: number;
    next_page: number | null;
    prev_page: number | null;
    total_pages: number;
    total_count: number;
    per_page: number;
  };
}

// ============ Verification of Payee ============

export type VopMatchResult =
  | "MATCH_RESULT_MATCH"
  | "MATCH_RESULT_CLOSE_MATCH"
  | "MATCH_RESULT_NO_MATCH"
  | "MATCH_RESULT_NOT_POSSIBLE";

export interface QontoVerifyPayeeRequest {
  iban: string;
  beneficiary_name: string;
}

export interface QontoVerifyPayeeResponse {
  match_result: VopMatchResult;
  matched_name?: string; // Present for CLOSE_MATCH
  proof_token: {
    token: string;
  };
}

// ============ SEPA Transfers ============

export type QontoTransferStatus =
  | "pending"
  | "processing"
  | "canceled"
  | "declined"
  | "settled";

export type QontoDeclinedReason =
  | "beneficiary_bic_invalid"
  | "beneficiary_iban_invalid"
  | "beneficiary_status"
  | "beneficiary_network_rules_error"
  | "organisation_compliance_reasons"
  | "debit_account_insufficient_funds"
  | "qonto_processing_failed";

export interface QontoCreateTransferRequest {
  vop_proof_token: string;
  transfer: {
    bank_account_id: string;
    beneficiary_id?: string;
    beneficiary?: {
      name: string;
      iban: string;
      bic?: string;
      email?: string;
    };
    amount: string; // Decimal string e.g. "100.50"
    reference: string;
    note?: string;
    scheduled_date?: string; // YYYY-MM-DD
    attachment_ids?: string[];
  };
}

export interface QontoTransfer {
  id: string;
  initiator_id: string;
  bank_account_id: string;
  amount: number;
  amount_cents: number;
  amount_currency: "EUR";
  status: QontoTransferStatus;
  beneficiary_id: string;
  reference: string;
  note: string | null;
  declined_reason: QontoDeclinedReason | null;
  scheduled_date: string;
  created_at: string;
  updated_at: string;
  processed_at: string | null;
  completed_at: string | null;
  transaction_id: string | null;
  recurring_transfer_id: string | null;
}

export interface QontoTransferResponse {
  transfer: QontoTransfer;
}

export interface QontoTransfersResponse {
  transfers: QontoTransfer[];
  meta: {
    current_page: number;
    next_page: number | null;
    prev_page: number | null;
    total_pages: number;
    total_count: number;
    per_page: number;
  };
}

// ============ SCA (Strong Customer Authentication) ============

export interface QontoScaResponse {
  sca_session_token: string;
  sca_methods: string[]; // e.g., ["paired_device", "passkey", "sms_otp"]
}

export interface QontoScaSessionStatus {
  status: "waiting" | "allow" | "deny";
}

// ============ Config ============

export interface QontoProviderConfig {
  /** Authentication method: 'api_key' or 'oauth' */
  authMethod: 'api_key' | 'oauth';
  
  /** For API Key auth: Login (slug) */
  apiKeyLogin?: string;
  
  /** For API Key auth: Secret key */
  apiKeySecret?: string;
  
  /** For OAuth auth: Access token */
  accessToken?: string;
  
  /** For OAuth auth: Refresh token (for automatic token refresh) */
  refreshToken?: string;
  
  /** For OAuth auth: Client ID (for automatic token refresh) */
  clientId?: string;
  
  /** For OAuth auth: Client Secret (for automatic token refresh) */
  clientSecret?: string;
  
  /** Callback when token is refreshed (to persist new tokens) */
  onTokenRefresh?: (accessToken: string, refreshToken: string) => void;
  
  /** Bank account ID to send from */
  bankAccountId: string;
  
  /** Use sandbox environment */
  useSandbox: boolean;
  
  /** Staging token (required for sandbox) */
  stagingToken?: string;
  
  /** Fee in basis points (e.g., 50 = 0.5%) */
  feeBps: number;
  
  /** USDC/EUR exchange rate (default: fetch from oracle) */
  usdcEurRate?: number;
  
  /** Quote validity in seconds (default: 300 = 5 min) */
  quoteValiditySecs: number;
  
  /** Max retries for API calls */
  maxRetries: number;
  
  /** Polling interval for transfer status (ms) */
  statusPollIntervalMs: number;
  
  /** Max wait time for transfer completion (ms) */
  maxTransferWaitMs: number;
}

export const DEFAULT_QONTO_CONFIG: Partial<QontoProviderConfig> = {
  authMethod: 'api_key',
  useSandbox: false,
  feeBps: 50, // 0.5%
  quoteValiditySecs: 300, // 5 minutes
  maxRetries: 3,
  statusPollIntervalMs: 1000, // 1 second - poll frequently for instant
  maxTransferWaitMs: 30000, // 30 seconds max - SEPA Instant should complete in ~10s
};
