// One-shot helper: resolve the Telegram chat id from getUpdates and write it into
// sentinel/.env (TELEGRAM_CHAT_ID). Run after you've messaged @freefreeflobot.
//   node scripts/resolve-chatid.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const envPath = resolve(dirname(fileURLToPath(import.meta.url)), "../.env");
const env = readFileSync(envPath, "utf8");
const token = env.match(/^TELEGRAM_BOT_TOKEN=(.+)$/m)?.[1]?.trim();
if (!token) {
  console.error("No TELEGRAM_BOT_TOKEN in sentinel/.env");
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
  console.error("No updates yet — send a message to @freefreeflobot, then re-run.");
  process.exit(2);
}
for (const [id, who] of chats) console.error(`  found chat ${id} (${who})`);
if (chats.size !== 1) {
  console.error("Multiple chats — set TELEGRAM_CHAT_ID in sentinel/.env manually.");
  process.exit(3);
}

const chatId = [...chats.keys()][0];
const next = /^TELEGRAM_CHAT_ID=/m.test(env)
  ? env.replace(/^TELEGRAM_CHAT_ID=.*$/m, `TELEGRAM_CHAT_ID=${chatId}`)
  : env.replace(/\n*$/, `\nTELEGRAM_CHAT_ID=${chatId}\n`);
writeFileSync(envPath, next);
console.log(`✓ chat id ${chatId} written to sentinel/.env`);
