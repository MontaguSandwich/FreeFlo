// OffRampV3 ABI (with zkTLS verification)
export const OFFRAMP_V3_ABI = [
  // Events
  {
    type: "event",
    name: "IntentCreated",
    inputs: [
      { name: "intentId", type: "bytes32", indexed: true },
      { name: "depositor", type: "address", indexed: true },
      { name: "usdcAmount", type: "uint256", indexed: false },
      { name: "currency", type: "uint8", indexed: false },
    ],
  },
  {
    type: "event",
    name: "QuoteSubmitted",
    inputs: [
      { name: "intentId", type: "bytes32", indexed: true },
      { name: "solver", type: "address", indexed: true },
      { name: "rtpn", type: "uint8", indexed: false },
      { name: "fiatAmount", type: "uint256", indexed: false },
      { name: "fee", type: "uint256", indexed: false },
      { name: "estimatedTime", type: "uint64", indexed: false },
      { name: "expiresAt", type: "uint64", indexed: false },
    ],
  },
  {
    type: "event",
    name: "QuoteSelected",
    inputs: [
      { name: "intentId", type: "bytes32", indexed: true },
      { name: "solver", type: "address", indexed: true },
      { name: "rtpn", type: "uint8", indexed: false },
      { name: "fiatAmount", type: "uint256", indexed: false },
      { name: "receivingInfo", type: "string", indexed: false },
      { name: "recipientName", type: "string", indexed: false },
    ],
  },
  {
    type: "event",
    name: "IntentFulfilled",
    inputs: [
      { name: "intentId", type: "bytes32", indexed: true },
      { name: "solver", type: "address", indexed: true },
      { name: "transferId", type: "bytes32", indexed: false },
      { name: "fiatSent", type: "uint256", indexed: false },
      { name: "verifiedByZkTLS", type: "bool", indexed: false },
    ],
  },
  {
    type: "event",
    name: "IntentCancelled",
    inputs: [
      { name: "intentId", type: "bytes32", indexed: true },
    ],
  },

  // Read functions
  {
    type: "function",
    name: "authorizedSolvers",
    inputs: [{ name: "solver", type: "address" }],
    outputs: [{ type: "bool" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "solverSupportsRtpn",
    inputs: [
      { name: "solver", type: "address" },
      { name: "rtpn", type: "uint8" },
    ],
    outputs: [{ type: "bool" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "getIntent",
    inputs: [{ name: "intentId", type: "bytes32" }],
    outputs: [
      {
        type: "tuple",
        components: [
          { name: "depositor", type: "address" },
          { name: "usdcAmount", type: "uint256" },
          { name: "currency", type: "uint8" },
          { name: "status", type: "uint8" },
          { name: "createdAt", type: "uint64" },
          { name: "committedAt", type: "uint64" },
          { name: "selectedSolver", type: "address" },
          { name: "selectedRtpn", type: "uint8" },
          { name: "selectedFiatAmount", type: "uint256" },
          { name: "receivingInfo", type: "string" },
          { name: "recipientName", type: "string" },
          { name: "transferId", type: "bytes32" },
        ],
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "getQuote",
    inputs: [
      { name: "intentId", type: "bytes32" },
      { name: "solver", type: "address" },
      { name: "rtpn", type: "uint8" },
    ],
    outputs: [
      {
        type: "tuple",
        components: [
          { name: "solver", type: "address" },
          { name: "rtpn", type: "uint8" },
          { name: "fiatAmount", type: "uint256" },
          { name: "fee", type: "uint256" },
          { name: "estimatedTime", type: "uint64" },
          { name: "expiresAt", type: "uint64" },
          { name: "selected", type: "bool" },
        ],
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "canFulfill",
    inputs: [{ name: "intentId", type: "bytes32" }],
    outputs: [{ type: "bool" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "verifier",
    inputs: [],
    outputs: [{ type: "address" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "QUOTE_WINDOW",
    inputs: [],
    outputs: [{ type: "uint64" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "SELECTION_WINDOW",
    inputs: [],
    outputs: [{ type: "uint64" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "FULFILLMENT_WINDOW",
    inputs: [],
    outputs: [{ type: "uint64" }],
    stateMutability: "view",
  },

  // Write functions
  {
    type: "function",
    name: "submitQuote",
    inputs: [
      { name: "intentId", type: "bytes32" },
      { name: "rtpn", type: "uint8" },
      { name: "fiatAmount", type: "uint256" },
      { name: "fee", type: "uint256" },
      { name: "estimatedTime", type: "uint64" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "fulfillIntentWithProof",
    inputs: [
      { name: "intentId", type: "bytes32" },
      {
        name: "attestation",
        type: "tuple",
        components: [
          { name: "intentHash", type: "bytes32" },
          { name: "amount", type: "uint256" },
          { name: "timestamp", type: "uint256" },
          { name: "paymentId", type: "string" },
          { name: "dataHash", type: "bytes32" },
        ],
      },
      { name: "signature", type: "bytes" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
] as const;

// PaymentVerifier ABI
export const PAYMENT_VERIFIER_ABI = [
  {
    type: "function",
    name: "verifyPayment",
    inputs: [
      {
        name: "attestation",
        type: "tuple",
        components: [
          { name: "intentHash", type: "bytes32" },
          { name: "amount", type: "uint256" },
          { name: "timestamp", type: "uint256" },
          { name: "paymentId", type: "string" },
          { name: "dataHash", type: "bytes32" },
        ],
      },
      { name: "signature", type: "bytes" },
    ],
    outputs: [
      { name: "valid", type: "bool" },
      { name: "nullifier", type: "bytes32" },
    ],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "authorizedWitnesses",
    inputs: [{ name: "witness", type: "address" }],
    outputs: [{ type: "bool" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "usedNullifiers",
    inputs: [{ name: "nullifier", type: "bytes32" }],
    outputs: [{ type: "bool" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "DOMAIN_SEPARATOR",
    inputs: [],
    outputs: [{ type: "bytes32" }],
    stateMutability: "view",
  },
] as const;

// PaymentAttestation struct type for TypeScript
export interface PaymentAttestationStruct {
  intentHash: `0x${string}`;
  amount: bigint;
  timestamp: bigint;
  paymentId: string;
  dataHash: `0x${string}`;
}

