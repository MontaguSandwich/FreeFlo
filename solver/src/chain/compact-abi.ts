/**
 * FreeFloCompactArbiter (TIER-1 sign-once offramp) — ABI + types for the solver's filler path.
 *
 * The solver, after sending SEPA + getting the witness-signed attestation, calls
 * arbiter.fill(claim, mandate, attestation, signature) to withdraw the user's locked USDC to
 * itself. It first computes the Compact claim hash (arbiter.computeClaimHash) and signs an
 * allocator authorization over it (FreeFloAllocator EIP-712 domain). See
 * docs/design/COMPACT-DEPLOY-RUNBOOK.md + contracts/src/FreeFloCompactArbiter.sol.
 */
import type { Address } from "viem";

/** The Compact `Claim` the user signed (uint256 fields as bigint for viem). */
export interface CompactClaimInput {
  allocatorData: `0x${string}`; // filled by the solver (allocator sig); "0x" on input
  sponsorSignature: `0x${string}`;
  sponsor: Address;
  nonce: bigint;
  expires: bigint;
  witness: `0x${string}`;
  witnessTypestring: string;
  id: bigint;
  allocatedAmount: bigint;
  claimants: { claimant: bigint; amount: bigint }[]; // overridden by the arbiter; pass []
}

/** The FreeFlo Mandate (mirrors FreeFloCompactArbiter.Mandate). */
export interface CompactMandateInput {
  receivingInfo: string;
  recipientName: string;
  minEurAmount: bigint;
  currency: number;
  expiry: bigint;
}

const CLAIM_TUPLE = {
  name: "claimInput",
  type: "tuple",
  components: [
    { name: "allocatorData", type: "bytes" },
    { name: "sponsorSignature", type: "bytes" },
    { name: "sponsor", type: "address" },
    { name: "nonce", type: "uint256" },
    { name: "expires", type: "uint256" },
    { name: "witness", type: "bytes32" },
    { name: "witnessTypestring", type: "string" },
    { name: "id", type: "uint256" },
    { name: "allocatedAmount", type: "uint256" },
    {
      name: "claimants",
      type: "tuple[]",
      components: [
        { name: "claimant", type: "uint256" },
        { name: "amount", type: "uint256" },
      ],
    },
  ],
} as const;

const MANDATE_TUPLE = {
  name: "mandate",
  type: "tuple",
  components: [
    { name: "receivingInfo", type: "string" },
    { name: "recipientName", type: "string" },
    { name: "minEurAmount", type: "uint256" },
    { name: "currency", type: "uint8" },
    { name: "expiry", type: "uint256" },
  ],
} as const;

const ATTESTATION_TUPLE = {
  name: "attestation",
  type: "tuple",
  components: [
    { name: "intentHash", type: "bytes32" },
    { name: "amount", type: "uint256" },
    { name: "timestamp", type: "uint256" },
    { name: "paymentId", type: "string" },
    { name: "dataHash", type: "bytes32" },
  ],
} as const;

export const COMPACT_ARBITER_ABI = [
  {
    type: "function",
    name: "computeClaimHash",
    stateMutability: "view",
    inputs: [CLAIM_TUPLE, MANDATE_TUPLE],
    outputs: [{ type: "bytes32" }],
  },
  {
    type: "function",
    name: "fill",
    stateMutability: "nonpayable",
    inputs: [CLAIM_TUPLE, MANDATE_TUPLE, ATTESTATION_TUPLE, { name: "signature", type: "bytes" }],
    outputs: [{ type: "bytes32" }],
  },
] as const;

/** EIP-712 domain for FreeFloAllocator claim authorizations (matches the contract). */
export function freefloAllocatorDomain(allocator: Address, chainId: number) {
  return {
    name: "FreeFloAllocator",
    version: "1",
    chainId,
    verifyingContract: allocator,
  } as const;
}

export const FREEFLO_ALLOCATOR_AUTH_TYPES = {
  ClaimAuthorization: [{ name: "claimHash", type: "bytes32" }],
} as const;

// ---- Pre-fiat validation: the user must have signed AND funded the lock ----

/** Uniswap The Compact (Base mainnet) — same address across chains. */
export const THE_COMPACT_ADDRESS = "0x00000000000000171ede64904551eeDF3C6C9788" as const;

/**
 * The Mandate witness typestring The Compact appends after `Mandate mandate)` when hashing the
 * witnessed Compact. MUST match the on-chain construction exactly (VERIFIED against the live Compact
 * in contracts/test/CompactPermit2ForkE2E.t.sol) — used for `depositERC20AndRegisterViaPermit2`.
 */
export const MANDATE_WITNESS_TYPESTRING =
  "string receivingInfo,string recipientName,uint256 minEurAmount,uint8 currency,uint256 expiry";

/**
 * The Compact `depositERC20AndRegisterViaPermit2` — the user signs ONE Permit2 PermitTransferFrom
 * (witnessed by the claim hash); the relayer (solver = activator) submits it to fund AND register the
 * lock in a single call. Note the nested Permit2 PermitTransferFrom tuple. VERIFIED against the live
 * Compact in contracts/test/CompactPermit2ForkE2E.t.sol.
 */
export const DEPOSIT_VIA_PERMIT2_ABI = [
  {
    type: "function",
    name: "depositERC20AndRegisterViaPermit2",
    stateMutability: "nonpayable",
    inputs: [
      {
        name: "permit",
        type: "tuple",
        components: [
          {
            name: "permitted",
            type: "tuple",
            components: [
              { name: "token", type: "address" },
              { name: "amount", type: "uint256" },
            ],
          },
          { name: "nonce", type: "uint256" },
          { name: "deadline", type: "uint256" },
        ],
      },
      { name: "depositor", type: "address" },
      { name: "lockTag", type: "bytes12" },
      { name: "claimHash", type: "bytes32" },
      { name: "compactCategory", type: "uint8" },
      { name: "witness", type: "string" },
      { name: "signature", type: "bytes" },
    ],
    outputs: [{ name: "id", type: "uint256" }],
  },
] as const;

/** ERC-6909 balanceOf on The Compact — proves the sponsor actually deposited `allocatedAmount`. */
export const ERC6909_BALANCE_ABI = [
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "id", type: "uint256" },
    ],
    outputs: [{ type: "uint256" }],
  },
] as const;

/** The Compact's sponsor EIP-712 domain (verified to hash to DOMAIN_SEPARATOR 0xf789cd45… on Base). */
export function theCompactDomain(chainId: number) {
  return {
    name: "The Compact",
    version: "1",
    chainId,
    verifyingContract: THE_COMPACT_ADDRESS,
  } as const;
}

/** The witnessed Compact EIP-712 type — used to verify the sponsor signature before paying fiat. */
export const COMPACT_EIP712_TYPES = {
  Compact: [
    { name: "arbiter", type: "address" },
    { name: "sponsor", type: "address" },
    { name: "nonce", type: "uint256" },
    { name: "expires", type: "uint256" },
    { name: "lockTag", type: "bytes12" },
    { name: "token", type: "address" },
    { name: "amount", type: "uint256" },
    { name: "mandate", type: "Mandate" },
  ],
  Mandate: [
    { name: "receivingInfo", type: "string" },
    { name: "recipientName", type: "string" },
    { name: "minEurAmount", type: "uint256" },
    { name: "currency", type: "uint8" },
    { name: "expiry", type: "uint256" },
  ],
} as const;
