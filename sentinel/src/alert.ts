import type { Config } from "./config.js";
import type { Incident } from "./types.js";
import type { StoredIncident } from "./store.js";

const SEV: Record<Incident["severity"], string> = { info: "ℹ️", warning: "⚠️", critical: "🚨" };

/** Low-level: post a plain-text message to a Telegram chat with the given bot token. */
export async function postTelegram(token: string, chatId: string, text: string): Promise<boolean> {
  if (!token || !chatId) {
    console.warn("  (telegram: token/chatId missing — skipping send)");
    return false;
  }
  try {
    const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      // Plain text (no parse_mode) — robust against special chars in addresses/details.
      body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
    });
    const j = (await r.json()) as { ok: boolean; description?: string };
    if (!j.ok) {
      console.warn("  telegram send failed:", j.description);
      return false;
    }
    return true;
  } catch (err) {
    console.warn("  telegram send error:", (err as Error).message);
    return false;
  }
}

/** Send to the Sentinel's configured alert chat. No-op (warns) if unconfigured. */
export async function sendTelegram(cfg: Config, text: string): Promise<boolean> {
  return postTelegram(cfg.telegram.token, cfg.telegram.chatId, text);
}

function fmt(inc: Incident): string {
  const tag = inc.autonomous ? "[auto-heal]" : "[alert/approve]";
  return (
    `${SEV[inc.severity]} ${inc.severity.toUpperCase()} ${tag}\n` +
    `class: ${inc.class}\n` +
    `subject: ${inc.subject}\n` +
    `${inc.detail}\n` +
    `recovery: ${inc.recovery}`
  );
}

export async function alertNew(cfg: Config, newly: Incident[]): Promise<void> {
  for (const inc of newly) {
    await sendTelegram(cfg, `FreeFlo Sentinel\n\n${fmt(inc)}`);
  }
}

export async function alertResolved(cfg: Config, resolved: StoredIncident[]): Promise<void> {
  for (const inc of resolved) {
    await sendTelegram(cfg, `✅ Resolved — ${inc.class}\nsubject: ${inc.subject}`);
  }
}
