// TIER-1 sign-once offramp — FreeFloCompactArbiter + Uniswap "The Compact" config.
//
// The on-chain flow: the user deposits USDC into a resource lock and signs ONE EIP-712 Compact
// naming the arbiter, with witness = hashMandate(Mandate{IBAN, recipientName, minEUR, currency,
// expiry}); a solver sends SEPA EUR, gets the witness-signed attestation, and calls fill() to
// withdraw the USDC. Verified end-to-end against the live Base Compact (contracts/test/
// CompactForkE2E.t.sol). See docs/design/COMPACT-DEPLOY-RUNBOOK.md.
import type { TypedDataDomain } from "viem";

// ---- Live Base mainnet infra (stable) ----
export const THE_COMPACT_ADDRESS = "0x00000000000000171ede64904551eeDF3C6C9788" as const;
export const USDC_BASE = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as const;

// ---- Deployed by script/DeployCompactArbiter.s.sol — Base mainnet, 2026-06-15 (tx 0x14f247e8…) ----
export const COMPACT_ARBITER_ADDRESS = "0x4fbc96CA129F9f2f109994b1Cb77dF58dD963001" as const;
export const FREEFLO_ALLOCATOR_ADDRESS = "0x2C870C28C9eE230689a778920875fb7c2AFC535b" as const;
// The ERC-6909 resource-lock id (lockTag<<160 | USDC) + its bytes12 lockTag, from the deploy logs.
// Allocator ID 202459989687892026490377051; ChainSpecific + OneDay reset period.
export const COMPACT_LOCK_ID =
  "0xd0a778920875fb7c2afc535b833589fcd6edb6e08f4c7c32d4f71b54bda02913" as const;
export const COMPACT_LOCK_TAG = "0xd0a778920875fb7c2afc535b" as const;

/** Whether the sign-once stack has been deployed + wired into this build. */
export function isCompactDeployed(): boolean {
  return (
    (COMPACT_ARBITER_ADDRESS as string) !== "0x0000000000000000000000000000000000000000" &&
    (COMPACT_LOCK_ID as string) !==
      "0x0000000000000000000000000000000000000000000000000000000000000000"
  );
}

/** The Mandate the user commits to (mirrors FreeFloCompactArbiter.Mandate). */
export interface Mandate {
  receivingInfo: string; // destination IBAN
  recipientName: string; // SEPA recipient name
  minEurAmount: bigint; // floor in cents
  currency: number; // 0 = EUR
  expiry: bigint; // unix seconds
}

// ---- Arbiter ABI (the off-chain pieces this frontend/solver actually call) ----
export const COMPACT_ARBITER_ABI = [
  {
    type: "function",
    name: "computeClaimHash",
    stateMutability: "view",
    inputs: [
      {
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
      },
      {
        name: "mandate",
        type: "tuple",
        components: [
          { name: "receivingInfo", type: "string" },
          { name: "recipientName", type: "string" },
          { name: "minEurAmount", type: "uint256" },
          { name: "currency", type: "uint8" },
          { name: "expiry", type: "uint256" },
        ],
      },
    ],
    outputs: [{ type: "bytes32" }],
  },
  {
    type: "function",
    name: "hashMandate",
    stateMutability: "pure",
    inputs: [
      {
        name: "m",
        type: "tuple",
        components: [
          { name: "receivingInfo", type: "string" },
          { name: "recipientName", type: "string" },
          { name: "minEurAmount", type: "uint256" },
          { name: "currency", type: "uint8" },
          { name: "expiry", type: "uint256" },
        ],
      },
    ],
    outputs: [{ type: "bytes32" }],
  },
  {
    type: "function",
    name: "MANDATE_WITNESS_TYPESTRING",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "string" }],
  },
] as const;

// ---- The Compact ABI (deposit + the sponsor's forced-withdrawal escape) ----
export const THE_COMPACT_ABI = [
  {
    type: "function",
    name: "depositERC20",
    stateMutability: "nonpayable",
    inputs: [
      { name: "token", type: "address" },
      { name: "lockTag", type: "bytes12" },
      { name: "amount", type: "uint256" },
      { name: "recipient", type: "address" },
    ],
    outputs: [{ name: "id", type: "uint256" }],
  },
  {
    type: "function",
    name: "enableForcedWithdrawal",
    stateMutability: "nonpayable",
    inputs: [{ name: "id", type: "uint256" }],
    outputs: [{ name: "withdrawableAt", type: "uint256" }],
  },
  {
    type: "function",
    name: "forcedWithdrawal",
    stateMutability: "nonpayable",
    inputs: [
      { name: "id", type: "uint256" },
      { name: "recipient", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ type: "bool" }],
  },
] as const;

// ---- EIP-712 for the sponsor's single Compact signature ----
// Domain confirmed to hash to The Compact's on-chain DOMAIN_SEPARATOR 0xf789cd45… on Base (8453).
// The Compact hardcodes the witness wrapper "Mandate mandate)Mandate(", so the witness sub-type is
// named `Mandate`; the witness VALUE is hashMandate(mandate).
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

export function compactDomain(chainId = 8453): TypedDataDomain {
  return {
    name: "The Compact",
    version: "1",
    chainId,
    verifyingContract: THE_COMPACT_ADDRESS,
  };
}

// ============ Gasless one-signature path (Permit2 deposit-and-register) ============
// The user signs ONE Permit2 "Activation" witness; a relayer submits depositERC20AndRegisterViaPermit2
// (pulls USDC + registers the compact) and the fill — the user pays NO gas. Verified byte-exact
// against the live Compact in contracts/test/CompactPermit2ForkE2E.t.sol. Needs a ONE-TIME-ever
// USDC->Permit2 approval per user.

export const PERMIT2_ADDRESS = "0x000000000022D473030F116dDEE9F6B43aC78BA3" as const;
/** The FreeFlo relayer/solver that submits the gasless deposit (the Activation `activator`). */
export const FREEFLO_RELAYER_ADDRESS = "0x2f92Dce3a6eA32d95Eaa166958EfDea441a640E3" as const;

export const ERC20_APPROVE_ABI = [
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ type: "bool" }],
  },
  {
    type: "function",
    name: "allowance",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "owner", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
] as const;

/** EIP-712 for the single gasless Permit2 Activation signature. The `compact` nests the same Compact
 *  + Mandate types as buildCompactSignRequest, so viem's nested hash equals the on-chain claim hash. */
export const PERMIT2_ACTIVATION_TYPES = {
  PermitWitnessTransferFrom: [
    { name: "permitted", type: "TokenPermissions" },
    { name: "spender", type: "address" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" },
    { name: "witness", type: "Activation" },
  ],
  TokenPermissions: [
    { name: "token", type: "address" },
    { name: "amount", type: "uint256" },
  ],
  Activation: [
    { name: "activator", type: "address" },
    { name: "id", type: "uint256" },
    { name: "compact", type: "Compact" },
  ],
  Compact: COMPACT_EIP712_TYPES.Compact,
  Mandate: COMPACT_EIP712_TYPES.Mandate,
} as const;

export function permit2Domain(chainId = 8453): TypedDataDomain {
  return { name: "Permit2", chainId, verifyingContract: PERMIT2_ADDRESS };
}

/** Build the `signTypedData` args for the ONE gasless Permit2 Activation signature. `nonce` is the
 *  Compact nonce; `permit2Nonce` is an unused Permit2 nonce; `deadline` is shared by both. */
export function buildPermit2ActivationSignRequest(params: {
  sponsor: `0x${string}`;
  nonce: bigint;
  permit2Nonce: bigint;
  deadline: bigint;
  amount: bigint;
  mandate: Mandate;
  chainId?: number;
}) {
  return {
    domain: permit2Domain(params.chainId),
    types: PERMIT2_ACTIVATION_TYPES,
    primaryType: "PermitWitnessTransferFrom" as const,
    message: {
      permitted: { token: USDC_BASE, amount: params.amount },
      spender: THE_COMPACT_ADDRESS,
      nonce: params.permit2Nonce,
      deadline: params.deadline,
      witness: {
        activator: FREEFLO_RELAYER_ADDRESS,
        id: BigInt(COMPACT_LOCK_ID),
        compact: {
          arbiter: COMPACT_ARBITER_ADDRESS,
          sponsor: params.sponsor,
          nonce: params.nonce,
          expires: params.deadline,
          lockTag: COMPACT_LOCK_TAG,
          token: USDC_BASE,
          amount: params.amount,
          mandate: params.mandate,
        },
      },
    },
  };
}

/** Build the `signTypedData` args for the user's single Compact signature. */
export function buildCompactSignRequest(params: {
  arbiter: `0x${string}`;
  sponsor: `0x${string}`;
  nonce: bigint;
  expires: bigint;
  amount: bigint;
  mandate: Mandate;
  lockTag?: `0x${string}`;
  token?: `0x${string}`;
  chainId?: number;
}) {
  return {
    domain: compactDomain(params.chainId),
    types: COMPACT_EIP712_TYPES,
    primaryType: "Compact" as const,
    message: {
      arbiter: params.arbiter,
      sponsor: params.sponsor,
      nonce: params.nonce,
      expires: params.expires,
      lockTag: params.lockTag ?? COMPACT_LOCK_TAG,
      token: params.token ?? USDC_BASE,
      amount: params.amount,
      mandate: params.mandate,
    },
  };
}
