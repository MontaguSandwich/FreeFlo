// Quote types and mock quote provider
// In production, this would call solver APIs or read from on-chain events

export type Currency = 'EUR' | 'GBP' | 'USD' | 'BRL' | 'INR';
export type RTPN = 
  | 'SEPA_INSTANT' | 'SEPA_STANDARD'  // EUR
  | 'FPS' | 'BACS'                     // GBP
  | 'FEDNOW' | 'ACH'                   // USD
  | 'PIX' | 'TED'                      // BRL
  | 'UPI' | 'IMPS';                    // INR

export interface CurrencyInfo {
  id: Currency;
  name: string;
  symbol: string;
  flag: string;
}

export interface RTPNInfo {
  id: RTPN;
  name: string;
  currency: Currency;
  speed: 'instant' | 'fast' | 'standard';
  avgTime: string;
  avgSeconds: number;
  description: string;
}

export const CURRENCIES: Record<Currency, CurrencyInfo> = {
  EUR: { id: 'EUR', name: 'Euro', symbol: '€', flag: '🇪🇺' },
  GBP: { id: 'GBP', name: 'British Pound', symbol: '£', flag: '🇬🇧' },
  USD: { id: 'USD', name: 'US Dollar', symbol: '$', flag: '🇺🇸' },
  BRL: { id: 'BRL', name: 'Brazilian Real', symbol: 'R$', flag: '🇧🇷' },
  INR: { id: 'INR', name: 'Indian Rupee', symbol: '₹', flag: '🇮🇳' },
};

export const RTPN_CONFIG: Record<RTPN, RTPNInfo> = {
  // EUR
  SEPA_INSTANT: {
    id: 'SEPA_INSTANT',
    name: 'SEPA Instant',
    currency: 'EUR',
    speed: 'instant',
    avgTime: '~10 sec',
    avgSeconds: 10,
    description: 'Instant transfers across Europe',
  },
  SEPA_STANDARD: {
    id: 'SEPA_STANDARD',
    name: 'SEPA Standard',
    currency: 'EUR',
    speed: 'standard',
    avgTime: '~1 day',
    avgSeconds: 86400,
    description: 'Standard European transfers',
  },
  // GBP
  FPS: {
    id: 'FPS',
    name: 'Faster Payments',
    currency: 'GBP',
    speed: 'instant',
    avgTime: '~2 min',
    avgSeconds: 120,
    description: 'UK instant payments',
  },
  BACS: {
    id: 'BACS',
    name: 'BACS',
    currency: 'GBP',
    speed: 'standard',
    avgTime: '~3 days',
    avgSeconds: 259200,
    description: 'UK standard transfers',
  },
  // USD
  FEDNOW: {
    id: 'FEDNOW',
    name: 'FedNow',
    currency: 'USD',
    speed: 'instant',
    avgTime: '~20 sec',
    avgSeconds: 20,
    description: 'US instant payments',
  },
  ACH: {
    id: 'ACH',
    name: 'ACH',
    currency: 'USD',
    speed: 'standard',
    avgTime: '~1-3 days',
    avgSeconds: 172800,
    description: 'US standard transfers',
  },
  // BRL
  PIX: {
    id: 'PIX',
    name: 'PIX',
    currency: 'BRL',
    speed: 'instant',
    avgTime: '~10 sec',
    avgSeconds: 10,
    description: 'Brazilian instant payments',
  },
  TED: {
    id: 'TED',
    name: 'TED',
    currency: 'BRL',
    speed: 'fast',
    avgTime: '~same day',
    avgSeconds: 14400,
    description: 'Brazilian same-day transfers',
  },
  // INR
  UPI: {
    id: 'UPI',
    name: 'UPI',
    currency: 'INR',
    speed: 'instant',
    avgTime: '~30 sec',
    avgSeconds: 30,
    description: 'Indian instant payments',
  },
  IMPS: {
    id: 'IMPS',
    name: 'IMPS',
    currency: 'INR',
    speed: 'instant',
    avgTime: '~1 min',
    avgSeconds: 60,
    description: 'Indian mobile payments',
  },
};

// Get RTPNs that support a currency
export function getRtpnsForCurrency(currency: Currency): RTPN[] {
  return Object.values(RTPN_CONFIG)
    .filter(r => r.currency === currency)
    .map(r => r.id);
}

// Contract enum values (must match OffRampV2.sol)
export type ContractCurrency = 0 | 1 | 2 | 3 | 4;
export type ContractRTPN = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;

export const CURRENCY_TO_CONTRACT: Record<Currency, ContractCurrency> = {
  EUR: 0,
  GBP: 1,
  USD: 2,
  BRL: 3,
  INR: 4,
};

export const STRING_RTPN_TO_CONTRACT: Record<RTPN, ContractRTPN> = {
  SEPA_INSTANT: 0,
  SEPA_STANDARD: 1,
  FPS: 2,
  BACS: 3,
  PIX: 4,
  TED: 5,
  UPI: 6,
  IMPS: 7,
  FEDNOW: 8,
  ACH: 9,
};

export const CONTRACT_RTPN_TO_STRING: Record<ContractRTPN, RTPN> = {
  0: 'SEPA_INSTANT',
  1: 'SEPA_STANDARD',
  2: 'FPS',
  3: 'BACS',
  4: 'PIX',
  5: 'TED',
  6: 'UPI',
  7: 'IMPS',
  8: 'FEDNOW',
  9: 'ACH',
};

export interface SolverInfo {
  address: string;
  name: string;
  avatar: string;
  rating: number;
  totalFulfilled: number;
}

export interface RTPNQuote {
  rtpn: RTPN;
  rtpnInfo: RTPNInfo;
  solver: SolverInfo;
  inputAmount: number;      // USDC
  outputAmount: number;     // Fiat
  fee: number;              // USDC
  feePercent: number;
  exchangeRate: number;     // 1 USDC = X fiat
  estimatedSeconds: number;
  expiresAt: number;
}

// Mock exchange rates
const MOCK_RATES: Record<Currency, number> = {
  EUR: 0.92,
  GBP: 0.79,
  USD: 1.00,
  BRL: 5.05,
  INR: 83.12,
};

// Mock solvers with their supported RTPNs
const MOCK_SOLVERS: Array<SolverInfo & { supportedRtpns: RTPN[]; feeMultiplier: number }> = [
  {
    address: '0x1234567890abcdef1234567890abcdef12345678',
    name: 'SwiftSolver',
    avatar: '⚡',
    rating: 4.9,
    totalFulfilled: 1247,
    supportedRtpns: ['SEPA_INSTANT', 'FPS', 'FEDNOW', 'PIX', 'UPI'],
    feeMultiplier: 1.0,
  },
  {
    address: '0xabcdef1234567890abcdef1234567890abcdef12',
    name: 'EuroRails',
    avatar: '🚄',
    rating: 4.7,
    totalFulfilled: 892,
    supportedRtpns: ['SEPA_INSTANT', 'SEPA_STANDARD', 'FPS', 'BACS'],
    feeMultiplier: 0.8,
  },
  {
    address: '0x9876543210fedcba9876543210fedcba98765432',
    name: 'GlobalPay',
    avatar: '🌍',
    rating: 4.8,
    totalFulfilled: 2103,
    supportedRtpns: ['SEPA_INSTANT', 'FPS', 'FEDNOW', 'ACH', 'PIX', 'UPI', 'IMPS'],
    feeMultiplier: 1.1,
  },
  {
    address: '0xfedcba9876543210fedcba9876543210fedcba98',
    name: 'ValueMax',
    avatar: '💰',
    rating: 4.5,
    totalFulfilled: 456,
    supportedRtpns: ['SEPA_STANDARD', 'BACS', 'ACH', 'TED'],
    feeMultiplier: 0.5,
  },
];

// Fetch real quotes from solver API (via Next.js proxy to avoid CORS/mixed-content)
export async function fetchQuotesByRtpn(
  usdcAmount: number,
  currency: Currency
): Promise<RTPNQuote[]> {
  try {
    // Fetch via our API proxy route (handles CORS and HTTP->HTTPS)
    const response = await fetch(
      `/api/quote?amount=${usdcAmount}&currency=${currency}`,
      {
        headers: { 'Accept': 'application/json' },
        signal: AbortSignal.timeout(10000), // 10 second timeout
      }
    );

    if (response.ok) {
      const data = await response.json() as {
        quotes: Array<{
          rtpn: number;
          rtpnName: string;
          fiatAmount: number;
          fee: number;
          feeBps: number;
          exchangeRate: number;
          estimatedTime: number;
          solver: { address: string; name: string };
          expiresAt: number;
        }>;
      };

      if (data.quotes && data.quotes.length > 0) {
        console.log(`Fetched ${data.quotes.length} real quote(s) from solver API`);
        
        return data.quotes.map(q => {
          const rtpnString = CONTRACT_RTPN_TO_STRING[q.rtpn as ContractRTPN] || 'SEPA_INSTANT';
          const rtpnInfo = RTPN_CONFIG[rtpnString];
          
          return {
            rtpn: rtpnString,
            rtpnInfo,
            solver: {
              address: q.solver.address,
              name: q.solver.name,
              avatar: '⚡', // Default avatar for real solvers
              rating: 5,
              totalFulfilled: 0,
            },
            inputAmount: usdcAmount,
            outputAmount: q.fiatAmount,
            fee: q.fee,
            feePercent: q.feeBps / 100,
            exchangeRate: q.exchangeRate,
            estimatedSeconds: q.estimatedTime,
            expiresAt: q.expiresAt,
          };
        });
      }
    }
  } catch (err) {
    console.warn('Failed to fetch from solver API, using mock quotes:', err);
  }

  // Fallback to mock quotes if solver API is unavailable
  return fetchMockQuotes(usdcAmount, currency);
}

// Mock quote generation (fallback)
async function fetchMockQuotes(
  usdcAmount: number,
  currency: Currency
): Promise<RTPNQuote[]> {
  // Simulate network delay
  await new Promise((resolve) => setTimeout(resolve, 300));

  const rtpns = getRtpnsForCurrency(currency);
  const baseRate = MOCK_RATES[currency];
  const quotes: RTPNQuote[] = [];

  for (const rtpn of rtpns) {
    const rtpnInfo = RTPN_CONFIG[rtpn];
    
    // Find solvers that support this RTPN
    const supportingSolvers = MOCK_SOLVERS.filter(s => s.supportedRtpns.includes(rtpn));
    
    if (supportingSolvers.length === 0) continue;

    // Generate quotes from each solver and pick the best
    const solverQuotes = supportingSolvers.map(solver => {
      const rateVariation = 0.995 + Math.random() * 0.01;
      const baseFeePercent = rtpnInfo.speed === 'instant' 
        ? 0.5 + solver.feeMultiplier * 0.3 
        : 0.2 + solver.feeMultiplier * 0.15;
      
      const fee = usdcAmount * (baseFeePercent / 100);
      const effectiveAmount = usdcAmount - fee;
      const exchangeRate = baseRate * rateVariation;
      const outputAmount = effectiveAmount * exchangeRate;

      const timeVariation = 0.8 + Math.random() * 0.4;
      const estimatedSeconds = Math.round(rtpnInfo.avgSeconds * timeVariation);

      return {
        rtpn,
        rtpnInfo,
        solver: {
          address: solver.address,
          name: solver.name,
          avatar: solver.avatar,
          rating: solver.rating,
          totalFulfilled: solver.totalFulfilled,
        },
        inputAmount: usdcAmount,
        outputAmount: Math.round(outputAmount * 100) / 100,
        fee: Math.round(fee * 100) / 100,
        feePercent: Math.round(baseFeePercent * 100) / 100,
        exchangeRate: Math.round(exchangeRate * 10000) / 10000,
        estimatedSeconds,
        expiresAt: Date.now() + 5 * 60 * 1000,
      };
    });

    // Pick the best quote (highest output amount)
    const bestQuote = solverQuotes.sort((a, b) => b.outputAmount - a.outputAmount)[0];
    quotes.push(bestQuote);
  }

  // Sort by speed (instant first), then by output amount
  return quotes.sort((a, b) => {
    const speedOrder = { instant: 0, fast: 1, standard: 2 };
    const speedDiff = speedOrder[a.rtpnInfo.speed] - speedOrder[b.rtpnInfo.speed];
    if (speedDiff !== 0) return speedDiff;
    return b.outputAmount - a.outputAmount;
  });
}

/**
 * Validates an IBAN using the ISO 13616 mod-97 checksum algorithm.
 *
 * Algorithm:
 * 1. Check length is 15-34 characters
 * 2. Verify format: 2 letters (country) + 2 digits (check) + alphanumeric (BBAN)
 * 3. Move first 4 characters to end
 * 4. Replace letters with digits (A=10, B=11, ..., Z=35)
 * 5. Calculate modulo 97 - must equal 1
 */
export function validateIBAN(iban: string): { valid: boolean; error?: string } {
  // Remove spaces and convert to uppercase
  const formatted = iban.replace(/\s/g, '').toUpperCase();

  // Check length (15-34 characters per ISO 13616)
  if (formatted.length < 15 || formatted.length > 34) {
    return { valid: false, error: 'IBAN must be 15-34 characters' };
  }

  // Check basic format: 2 letters + 2 digits + alphanumeric
  if (!/^[A-Z]{2}[0-9]{2}[A-Z0-9]+$/.test(formatted)) {
    return { valid: false, error: 'Invalid IBAN format (expected: country code + check digits + account)' };
  }

  // Move first 4 characters (country code + check digits) to the end
  const rearranged = formatted.slice(4) + formatted.slice(0, 4);

  // Replace letters with numbers (A=10, B=11, ..., Z=35)
  let numericString = '';
  for (const char of rearranged) {
    if (/[A-Z]/.test(char)) {
      numericString += (char.charCodeAt(0) - 55).toString(); // A=65, so 65-55=10
    } else {
      numericString += char;
    }
  }

  // Calculate mod 97 using chunked arithmetic (handles large numbers)
  // Process in chunks of 9 digits to stay within safe integer range
  let remainder = 0;
  for (let i = 0; i < numericString.length; i += 9) {
    const chunk = numericString.slice(i, i + 9);
    remainder = parseInt(remainder.toString() + chunk, 10) % 97;
  }

  if (remainder !== 1) {
    return { valid: false, error: 'Invalid IBAN checksum' };
  }

  return { valid: true };
}

// Validate receiving info based on RTPN
export function validateReceivingInfo(rtpn: RTPN, info: string): { valid: boolean; error?: string } {
  const rtpnInfo = RTPN_CONFIG[rtpn];

  switch (rtpnInfo.currency) {
    case 'EUR': {
      // Use proper IBAN validation with checksum
      return validateIBAN(info);
    }
    case 'GBP': {
      if (info.length < 10) {
        return { valid: false, error: 'Enter sort code and account number' };
      }
      return { valid: true };
    }
    case 'USD': {
      if (info.length < 10) {
        return { valid: false, error: 'Enter routing and account number' };
      }
      return { valid: true };
    }
    case 'BRL': {
      if (info.length < 5) {
        return { valid: false, error: 'Invalid PIX key' };
      }
      return { valid: true };
    }
    case 'INR': {
      if (!info.includes('@')) {
        return { valid: false, error: 'Invalid UPI ID (should be name@bank)' };
      }
      return { valid: true };
    }
    default:
      return { valid: false, error: 'Unknown currency' };
  }
}

export function getReceivingInfoPlaceholder(rtpn: RTPN): string {
  const currency = RTPN_CONFIG[rtpn].currency;
  switch (currency) {
    case 'EUR': return 'FR76 3000 6000 0112 3456 7890 189';
    case 'GBP': return '12-34-56 12345678';
    case 'USD': return '021000021 1234567890';
    case 'BRL': return 'email@example.com or CPF';
    case 'INR': return 'yourname@upi';
    default: return '';
  }
}

export function getReceivingInfoLabel(rtpn: RTPN): string {
  const currency = RTPN_CONFIG[rtpn].currency;
  switch (currency) {
    case 'EUR': return 'IBAN';
    case 'GBP': return 'Sort Code & Account Number';
    case 'USD': return 'Routing & Account Number';
    case 'BRL': return 'PIX Key';
    case 'INR': return 'UPI ID';
    default: return 'Receiving Info';
  }
}

// ============ ON-CHAIN QUOTE FETCHING ============

import { createPublicClient, http, type Address, type Hex } from 'viem';
import { baseSepolia } from 'viem/chains';
import { OFFRAMP_V2_ADDRESS, OFFRAMP_V2_ABI } from './contracts';

// Create a public client for reading from chain
const publicClient = createPublicClient({
  chain: baseSepolia,
  transport: http('https://base-sepolia-rpc.publicnode.com'),
});

// Note: CONTRACT_RTPN_TO_STRING is already exported above

interface OnChainQuoteRef {
  solver: Address;
  rtpn: number;
}

interface OnChainQuote {
  solver: Address;
  rtpn: number;
  fiatAmount: bigint;
  fee: bigint;
  estimatedTime: bigint;
  expiresAt: bigint;
  selected: boolean;
}

/**
 * Fetch real quotes from the blockchain for a given intent
 */
export async function fetchOnChainQuotes(
  intentId: Hex,
  usdcAmount: number
): Promise<RTPNQuote[]> {
  try {
    // Step 1: Get list of all quotes for this intent
    const quoteRefs = await publicClient.readContract({
      address: OFFRAMP_V2_ADDRESS,
      abi: OFFRAMP_V2_ABI,
      functionName: 'getIntentQuotes',
      args: [intentId],
    }) as OnChainQuoteRef[];

    if (!quoteRefs || quoteRefs.length === 0) {
      console.log('No quotes found on-chain for intent:', intentId);
      return [];
    }

    console.log(`Found ${quoteRefs.length} quote(s) on-chain`);

    // Step 2: Fetch full details for each quote
    const quotes: RTPNQuote[] = [];
    
    for (const ref of quoteRefs) {
      try {
        const quote = await publicClient.readContract({
          address: OFFRAMP_V2_ADDRESS,
          abi: OFFRAMP_V2_ABI,
          functionName: 'getQuote',
          args: [intentId, ref.solver, ref.rtpn],
        }) as OnChainQuote;

        // Skip if quote has no fiat amount (empty/invalid)
        if (!quote.fiatAmount || quote.fiatAmount === BigInt(0)) {
          continue;
        }

        // Check if quote is expired
        const expiresAtMs = Number(quote.expiresAt) * 1000;
        if (expiresAtMs < Date.now()) {
          console.log('Quote expired, skipping');
          continue;
        }

        const rtpnString = CONTRACT_RTPN_TO_STRING[ref.rtpn as ContractRTPN];
        if (!rtpnString) {
          console.warn('Unknown RTPN:', ref.rtpn);
          continue;
        }

        const rtpnInfo = RTPN_CONFIG[rtpnString];
        
        // Convert from cents (2 decimals) to full amount
        const outputAmount = Number(quote.fiatAmount) / 100;
        const feeUsdc = Number(quote.fee) / 1_000_000; // fee is in USDC 6 decimals
        const estimatedSeconds = Number(quote.estimatedTime);

        // Calculate effective exchange rate
        const effectiveRate = outputAmount / (usdcAmount - feeUsdc);

        // Get solver info (optional, for display)
        let solverName = `Solver ${ref.solver.slice(0, 6)}...${ref.solver.slice(-4)}`;
        try {
          const solverInfo = await publicClient.readContract({
            address: OFFRAMP_V2_ADDRESS,
            abi: OFFRAMP_V2_ABI,
            functionName: 'solverInfo',
            args: [ref.solver],
          }) as [string, bigint, bigint, bigint, boolean];
          
          if (solverInfo[0]) {
            solverName = solverInfo[0];
          }
        } catch {
          // Ignore solver info errors
        }

        const feePercent = usdcAmount > 0 ? (feeUsdc / usdcAmount) * 100 : 0;

        quotes.push({
          rtpn: rtpnString,
          rtpnInfo,
          solver: {
            address: ref.solver,
            name: solverName,
            avatar: '', // Not used for on-chain quotes
            rating: 5, // Default rating
            totalFulfilled: 0, // Could be fetched from solverInfo if needed
          },
          inputAmount: usdcAmount,
          outputAmount,
          fee: feeUsdc,
          feePercent,
          exchangeRate: effectiveRate,
          estimatedSeconds,
          expiresAt: expiresAtMs,
        });
      } catch (err) {
        console.error('Error fetching quote details:', err);
      }
    }

    // Sort by output amount (best first)
    return quotes.sort((a, b) => b.outputAmount - a.outputAmount);
  } catch (err) {
    console.error('Error fetching on-chain quotes:', err);
    return [];
  }
}
