// One-shot helper: resolve a Telegram chat id from getUpdates and write it into
// sentinel/.env. Defaults to the Sentinel bot; pass var names for a different bot:
//   node scripts/resolve-chatid.mjs                              # TELEGRAM_BOT_TOKEN  -> TELEGRAM_CHAT_ID
//   node scripts/resolve-chatid.mjs TRACKER_BOT_TOKEN TRACKER_CHAT_ID
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const TOKEN_VAR = process.argv[2] || "TELEGRAM_BOT_TOKEN";
const CHAT_VAR = process.argv[3] || "TELEGRAM_CHAT_ID";

const envPath = resolve(dirname(fileURLToPath(import.meta.url)), "../.env");
const env = readFileSync(envPath, "utf8");
const token = env.match(new RegExp(`^${TOKEN_VAR}=(.+)$`, "m"))?.[1]?.trim();
if (!token) {
  console.error(`No ${TOKEN_VAR} in sentinel/.env`);
  process.exit(1);
}

const r = await fetch(`https://api.telegram.org/bot${token}/getUpdates`);
const j = await r.json();
if (!j.ok) {
  console.error("Telegram API error:", j.description);
  process.exit(1);
}

const chats = new Map();
for (const u of j.result) {
  const m = u.message || u.edited_message || u.channel_post;
  if (m?.chat) chats.set(String(m.chat.id), `${m.chat.first_name || m.chat.title || "?"} @${m.chat.username || "?"}`);
}
if (chats.size === 0) {
  console.error(`No updates yet — send a message to the bot for ${TOKEN_VAR}, then re-run.`);
  process.exit(2);
}
for (const [id, who] of chats) console.error(`  found chat ${id} (${who})`);
if (chats.size !== 1) {
  console.error(`Multiple chats — set ${CHAT_VAR} in sentinel/.env manually.`);
  process.exit(3);
}

const chatId = [...chats.keys()][0];
const next = new RegExp(`^${CHAT_VAR}=`, "m").test(env)
  ? env.replace(new RegExp(`^${CHAT_VAR}=.*$`, "m"), `${CHAT_VAR}=${chatId}`)
  : env.replace(/\n*$/, `\n${CHAT_VAR}=${chatId}\n`);
writeFileSync(envPath, next);
console.log(`✓ chat id ${chatId} written to sentinel/.env as ${CHAT_VAR}`);
