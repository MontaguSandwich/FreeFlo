import "dotenv/config";

const addr = (k: string, fallback: string) =>
  (process.env[k] ?? fallback).toLowerCase() as `0x${string}`;

export const config = {
  rpcUrl: process.env.RPC_URL ?? "https://mainnet.base.org",
  router: addr("FIAT_TO_FIAT_ROUTER", "0xF8010c7B323ABa20d37cAaD32D97C1967e4C1380"),
  offramp: addr("OFFRAMP_V3", "0x57c621994616110a50bD820388e4E8a41F00b4D7"),

  lookbackBlocks: BigInt(process.env.SENTINEL_LOOKBACK_BLOCKS ?? "40000"),
  chunkBlocks: BigInt(process.env.SENTINEL_CHUNK_BLOCKS ?? "5000"),
  watchUsers: (process.env.SENTINEL_WATCH_USERS ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter((s) => /^0x[0-9a-f]{40}$/.test(s)) as `0x${string}`[],

  solverHealthUrl: process.env.SOLVER_HEALTH_URL ?? "http://127.0.0.1:8080",

  telegram: {
    token: process.env.TELEGRAM_BOT_TOKEN ?? "",
    chatId: process.env.TELEGRAM_CHAT_ID ?? "",
  },

  // Non-refund self-heal (restart / token-refresh). OFF by default — flip on once stable.
  autoheal: (process.env.SENTINEL_AUTOHEAL ?? "false").toLowerCase() === "true",
  composeFile: process.env.SENTINEL_COMPOSE_FILE ?? "/home/ec2-user/freeflo/docker-compose.yml",

  // Contract windows (seconds) — mirror the Solidity constants.
  COMMIT_TIMEOUT: 15 * 60, // FiatToFiatRouter: PENDING slot rescuable after this
  FULFILLMENT_WINDOW: 30 * 60, // OffRampV3: COMMITTED intent cancellable after this
} as const;

export type Config = typeof config;
