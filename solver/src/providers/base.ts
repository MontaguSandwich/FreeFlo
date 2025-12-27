import {
  RTPNProvider,
  RTPN,
  Currency,
  QuoteRequest,
  Quote,
  TransferRequest,
  TransferResult,
  TransferStatus,
  CURRENCY_NAMES,
  RTPN_NAMES,
} from "../types/index.js";
import { createLogger } from "../utils/logger.js";

/**
 * Abstract base class for RTPN providers.
 * Provides common utilities and enforces the provider interface.
 */
export abstract class BaseProvider implements RTPNProvider {
  abstract id: string;
  abstract name: string;
  abstract supportedRtpns: RTPN[];
  abstract supportedCurrencies: Currency[];

  protected log = createLogger("provider");

  // ============ Abstract Methods (must implement) ============

  abstract getQuote(request: QuoteRequest): Promise<Quote>;
  abstract executeTransfer(request: TransferRequest): Promise<TransferResult>;
  abstract getTransferStatus(transferId: string): Promise<TransferStatus>;
  abstract getBalance(currency: Currency): Promise<number>;
  abstract healthCheck(): Promise<boolean>;

  // ============ Shared Utilities ============

  /**
   * Check if this provider supports a given RTPN
   */
  supportsRtpn(rtpn: RTPN): boolean {
    return this.supportedRtpns.includes(rtpn);
  }

  /**
   * Check if this provider supports a given currency
   */
  supportsCurrency(currency: Currency): boolean {
    return this.supportedCurrencies.includes(currency);
  }

  /**
   * Get currency name for logging
   */
  protected getCurrencyName(currency: Currency): string {
    return CURRENCY_NAMES[currency] || `Currency(${currency})`;
  }

  /**
   * Get RTPN name for logging
   */
  protected getRtpnName(rtpn: RTPN): string {
    return RTPN_NAMES[rtpn] || `RTPN(${rtpn})`;
  }

  /**
   * Convert USDC amount (6 decimals) to human-readable
   */
  protected formatUsdc(amount: bigint): string {
    return (Number(amount) / 1_000_000).toFixed(2);
  }

  /**
   * Convert fiat amount (2 decimals/cents) to human-readable
   */
  protected formatFiat(amount: bigint, currency: Currency): string {
    const symbol = this.getCurrencySymbol(currency);
    return `${symbol}${(Number(amount) / 100).toFixed(2)}`;
  }

  /**
   * Get currency symbol
   */
  protected getCurrencySymbol(currency: Currency): string {
    const symbols: Record<Currency, string> = {
      [Currency.EUR]: "€",
      [Currency.GBP]: "£",
      [Currency.USD]: "$",
      [Currency.BRL]: "R$",
      [Currency.INR]: "₹",
    };
    return symbols[currency] || "";
  }

  /**
   * Validate IBAN format (basic validation)
   */
  protected validateIban(iban: string): boolean {
    // Remove spaces and convert to uppercase
    const cleaned = iban.replace(/\s/g, "").toUpperCase();
    
    // Basic format check: 2 letters, 2 digits, then alphanumeric (15-30 chars)
    const ibanRegex = /^[A-Z]{2}[0-9]{2}[A-Z0-9]{11,30}$/;
    if (!ibanRegex.test(cleaned)) {
      return false;
    }

    // IBAN checksum validation (ISO 7064 Mod 97-10)
    const rearranged = cleaned.slice(4) + cleaned.slice(0, 4);
    const numericIban = rearranged
      .split("")
      .map((char) => {
        const code = char.charCodeAt(0);
        return code >= 65 ? (code - 55).toString() : char;
      })
      .join("");

    // Calculate mod 97 using string division (handles large numbers)
    let remainder = 0;
    for (const digit of numericIban) {
      remainder = (remainder * 10 + parseInt(digit, 10)) % 97;
    }

    return remainder === 1;
  }

  /**
   * Validate PIX key format
   */
  protected validatePixKey(key: string): boolean {
    // CPF: 11 digits
    if (/^\d{11}$/.test(key)) return true;
    // CNPJ: 14 digits
    if (/^\d{14}$/.test(key)) return true;
    // Email
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(key)) return true;
    // Phone: +55 followed by 10-11 digits
    if (/^\+55\d{10,11}$/.test(key)) return true;
    // Random key (EVP): UUID format
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(key)) return true;
    
    return false;
  }

  /**
   * Validate UK sort code + account number
   */
  protected validateUkAccount(sortCode: string, accountNumber: string): boolean {
    // Sort code: 6 digits (with or without hyphens)
    const cleanSortCode = sortCode.replace(/-/g, "");
    if (!/^\d{6}$/.test(cleanSortCode)) return false;
    
    // Account number: 8 digits
    if (!/^\d{8}$/.test(accountNumber)) return false;
    
    return true;
  }

  /**
   * Validate receiving info based on RTPN
   */
  protected validateReceivingInfo(rtpn: RTPN, info: string): boolean {
    switch (rtpn) {
      case RTPN.SEPA_INSTANT:
      case RTPN.SEPA_STANDARD:
        return this.validateIban(info);
      
      case RTPN.FPS:
      case RTPN.BACS:
        // Expect format: "SORTCODE|ACCOUNTNUMBER"
        const [sortCode, accountNumber] = info.split("|");
        return this.validateUkAccount(sortCode || "", accountNumber || "");
      
      case RTPN.PIX:
      case RTPN.TED:
        return this.validatePixKey(info);
      
      case RTPN.UPI:
      case RTPN.IMPS:
        // UPI ID format: user@provider
        return /^[\w.-]+@[\w.-]+$/.test(info);
      
      case RTPN.FEDNOW:
      case RTPN.ACH:
        // Expect format: "ROUTING|ACCOUNT"
        const [routing, account] = info.split("|");
        return /^\d{9}$/.test(routing || "") && /^\d{4,17}$/.test(account || "");
      
      default:
        return info.length > 0;
    }
  }
}






