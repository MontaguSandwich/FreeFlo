// ============ Enums (matching contract) ============

export enum Currency {
  EUR = 0,
  GBP = 1,
  USD = 2,
  BRL = 3,
  INR = 4,
}

export enum RTPN {
  SEPA_INSTANT = 0,
  SEPA_STANDARD = 1,
  FPS = 2,
  BACS = 3,
  PIX = 4,
  TED = 5,
  UPI = 6,
  IMPS = 7,
  FEDNOW = 8,
  ACH = 9,
}

export enum IntentStatus {
  NONE = 0,
  PENDING_QUOTE = 1,
  COMMITTED = 2,
  FULFILLED = 3,
  CANCELLED = 4,
  EXPIRED = 5,
}

// ============ Currency/RTPN Helpers ============

export const CURRENCY_NAMES: Record<Currency, string> = {
  [Currency.EUR]: "EUR",
  [Currency.GBP]: "GBP",
  [Currency.USD]: "USD",
  [Currency.BRL]: "BRL",
  [Currency.INR]: "INR",
};

export const RTPN_NAMES: Record<RTPN, string> = {
  [RTPN.SEPA_INSTANT]: "SEPA_INSTANT",
  [RTPN.SEPA_STANDARD]: "SEPA_STANDARD",
  [RTPN.FPS]: "FPS",
  [RTPN.BACS]: "BACS",
  [RTPN.PIX]: "PIX",
  [RTPN.TED]: "TED",
  [RTPN.UPI]: "UPI",
  [RTPN.IMPS]: "IMPS",
  [RTPN.FEDNOW]: "FEDNOW",
  [RTPN.ACH]: "ACH",
};

export const RTPN_CURRENCIES: Record<RTPN, Currency> = {
  [RTPN.SEPA_INSTANT]: Currency.EUR,
  [RTPN.SEPA_STANDARD]: Currency.EUR,
  [RTPN.FPS]: Currency.GBP,
  [RTPN.BACS]: Currency.GBP,
  [RTPN.PIX]: Currency.BRL,
  [RTPN.TED]: Currency.BRL,
  [RTPN.UPI]: Currency.INR,
  [RTPN.IMPS]: Currency.INR,
  [RTPN.FEDNOW]: Currency.USD,
  [RTPN.ACH]: Currency.USD,
};

export function getRtpnsForCurrency(currency: Currency): RTPN[] {
  return Object.entries(RTPN_CURRENCIES)
    .filter(([_, c]) => c === currency)
    .map(([rtpn]) => Number(rtpn) as RTPN);
}

// ============ Provider Types ============

export interface QuoteRequest {
  intentId: string;
  usdcAmount: bigint;       // 6 decimals
  currency: Currency;
  rtpn: RTPN;
}

export interface Quote {
  intentId: string;
  solver: string;           // Solver address
  rtpn: RTPN;
  fiatAmount: bigint;       // 2 decimals (cents)
  fee: bigint;              // USDC fee, 6 decimals
  estimatedTime: number;    // seconds
  expiresAt: number;        // unix timestamp
}

export interface TransferRequest {
  intentId: string;
  usdcAmount: bigint;
  fiatAmount: bigint;       // 2 decimals
  currency: Currency;
  rtpn: RTPN;
  receivingInfo: string;    // IBAN, PIX key, etc.
  recipientName: string;
}

export interface TransferResult {
  success: boolean;
  transferId: string;       // Provider's transfer ID
  fiatSent: bigint;         // Actual amount sent (2 decimals)
  error?: string;
}

export type TransferStatus = 
  | "pending"
  | "processing"
  | "completed"
  | "failed"
  | "cancelled";

// ============ Provider Interface ============

export interface RTPNProvider {
  /** Unique provider identifier */
  id: string;
  
  /** Human-readable name */
  name: string;
  
  /** Which RTPNs this provider supports */
  supportedRtpns: RTPN[];
  
  /** Which currencies this provider can send */
  supportedCurrencies: Currency[];
  
  /**
   * Generate a quote for a transfer
   * @returns Quote with fiat amount, fee, and timing
   */
  getQuote(request: QuoteRequest): Promise<Quote>;
  
  /**
   * Execute a fiat transfer
   * @returns Transfer result with provider's transfer ID
   */
  executeTransfer(request: TransferRequest): Promise<TransferResult>;
  
  /**
   * Check status of a transfer
   */
  getTransferStatus(transferId: string): Promise<TransferStatus>;
  
  /**
   * Get available balance for a currency
   */
  getBalance(currency: Currency): Promise<number>;
  
  /**
   * Health check - is the provider operational?
   */
  healthCheck(): Promise<boolean>;
}

// ============ Intent Types ============

export interface OnChainIntent {
  intentId: string;
  depositor: string;
  usdcAmount: bigint;
  currency: Currency;
  status: IntentStatus;
  createdAt: number;
  committedAt: number;
  selectedSolver: string;
  selectedRtpn: RTPN;
  selectedFiatAmount: bigint;
  receivingInfo: string;
  recipientName: string;
  transferId: string;
}

export interface OnChainQuote {
  solver: string;
  rtpn: RTPN;
  fiatAmount: bigint;
  fee: bigint;
  estimatedTime: number;
  expiresAt: number;
  selected: boolean;
}

// ============ Database Types ============

export interface DbIntent {
  intentId: string;
  depositor: string;
  usdcAmount: string;       // bigint as string
  currency: number;
  status: string;
  createdAt: number;
  committedAt: number | null;
  selectedSolver: string | null;
  selectedRtpn: number | null;
  selectedFiatAmount: string | null;
  receivingInfo: string | null;
  recipientName: string | null;
  // Local tracking
  quotesSubmitted: boolean;
  fulfillmentTxHash: string | null;
  providerTransferId: string | null;
  error: string | null;
  updatedAt: number;
}

export interface DbQuote {
  id: string;
  intentId: string;
  rtpn: number;
  fiatAmount: string;
  fee: string;
  estimatedTime: number;
  expiresAt: number;
  submittedOnChain: boolean;
  txHash: string | null;
  createdAt: number;
}






