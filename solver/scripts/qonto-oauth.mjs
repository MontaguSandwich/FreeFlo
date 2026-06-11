#!/usr/bin/env node
/**
 * Qonto OAuth Flow Script
 *
 * Usage:
 *   QONTO_CLIENT_ID=xxx QONTO_CLIENT_SECRET=yyy node scripts/qonto-oauth.mjs
 *
 * Self-service (reads CLIENT_ID/SECRET from an env file and writes the minted
 * tokens straight back into it — nothing sensitive is printed to the terminal):
 *   QONTO_USE_SANDBOX=false QONTO_ENV_FILE=.env.production node scripts/qonto-oauth.mjs
 */

import http from "http";
import { exec } from "child_process";
import fs from "fs";

// --- Self-service env I/O: load creds from / write tokens to QONTO_ENV_FILE ---
function parseEnvFile(filePath) {
  try {
    const out = {};
    for (const line of fs.readFileSync(filePath, "utf8").split("\n")) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
      if (m) out[m[1]] = m[2];
    }
    return out;
  } catch {
    return {};
  }
}
function upsertEnvVar(filePath, key, value) {
  let content = fs.readFileSync(filePath, "utf8");
  const re = new RegExp(`^${key}=.*$`, "m");
  const line = `${key}=${value}`;
  content = re.test(content)
    ? content.replace(re, line)
    : content + (content.endsWith("\n") ? "" : "\n") + line + "\n";
  fs.writeFileSync(filePath, content);
}

// ============ CONFIGURATION ============
const ENV_FILE = process.env.QONTO_ENV_FILE || "";
const ENV_FROM_FILE = ENV_FILE ? parseEnvFile(ENV_FILE) : {};
const CLIENT_ID = process.env.QONTO_CLIENT_ID || ENV_FROM_FILE.QONTO_CLIENT_ID || "";
const CLIENT_SECRET = process.env.QONTO_CLIENT_SECRET || ENV_FROM_FILE.QONTO_CLIENT_SECRET || "";
const REDIRECT_URI = "http://localhost:3456/callback";

// Sandbox vs production endpoints (set QONTO_USE_SANDBOX=true for the staging env).
const USE_SANDBOX = process.env.QONTO_USE_SANDBOX === "true";
const STAGING_TOKEN = process.env.QONTO_STAGING_TOKEN || "";
const QONTO_AUTH_URL = USE_SANDBOX
  ? "https://oauth-sandbox.staging.qonto.co/oauth2/auth"
  : "https://oauth.qonto.com/oauth2/auth";
const QONTO_TOKEN_URL = USE_SANDBOX
  ? "https://oauth-sandbox.staging.qonto.co/oauth2/token"
  : "https://oauth.qonto.com/oauth2/token";
const QONTO_API_URL = USE_SANDBOX
  ? "https://thirdparty-sandbox.staging.qonto.co"
  : "https://thirdparty.qonto.com";

// Sandbox gates token + API calls on the staging token header.
function stagingHeaders(base = {}) {
  return STAGING_TOKEN ? { ...base, "X-Qonto-Staging-Token": STAGING_TOKEN } : base;
}

const SCOPES = ["offline_access", "organization.read", "payment.write"];

// Generate a random state for CSRF protection
const STATE = Math.random().toString(36).substring(2) + Math.random().toString(36).substring(2);

// =========================================

async function exchangeCodeForToken(code) {
  const response = await fetch(QONTO_TOKEN_URL, {
    method: "POST",
    headers: stagingHeaders({
      "Content-Type": "application/x-www-form-urlencoded",
    }),
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      code: code,
      redirect_uri: REDIRECT_URI,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Token exchange failed: ${response.status} - ${error}`);
  }

  return response.json();
}

async function getOrganization(accessToken) {
  const response = await fetch(`${QONTO_API_URL}/v2/organization`, {
    headers: stagingHeaders({
      Authorization: `Bearer ${accessToken}`,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to get organization: ${response.status} - ${error}`);
  }

  const data = await response.json();
  return data.organization;
}

function openBrowser(url) {
  const platform = process.platform;
  let cmd;

  if (platform === "darwin") {
    cmd = `open "${url}"`;
  } else if (platform === "win32") {
    cmd = `start "${url}"`;
  } else {
    cmd = `xdg-open "${url}"`;
  }

  exec(cmd, (err) => {
    if (err) {
      console.log("(Could not auto-open browser - please open the URL manually)\n");
    }
  });
}

async function main() {
  console.log("\n🏦 Qonto OAuth Setup\n");

  if (!CLIENT_ID || !CLIENT_SECRET) {
    console.log("❌ Missing CLIENT_ID or CLIENT_SECRET!");
    console.log("\nUsage:");
    console.log("  QONTO_CLIENT_ID=xxx QONTO_CLIENT_SECRET=yyy node scripts/qonto-oauth.mjs");
    console.log("  (or) QONTO_ENV_FILE=.env.production node scripts/qonto-oauth.mjs\n");
    process.exit(1);
  }

  console.log("Client ID:", CLIENT_ID);
  console.log("Redirect URI:", REDIRECT_URI);
  console.log("Environment:", USE_SANDBOX ? "SANDBOX" : "PRODUCTION");
  if (ENV_FILE) console.log("Token sink:", ENV_FILE, "(tokens written here, not printed)");
  console.log("\n⚠️  Make sure you've added this redirect URI to your Qonto app!\n");

  // Build authorization URL
  const authUrl = new URL(QONTO_AUTH_URL);
  authUrl.searchParams.set("client_id", CLIENT_ID);
  authUrl.searchParams.set("redirect_uri", REDIRECT_URI);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("scope", SCOPES.join(" "));
  authUrl.searchParams.set("state", STATE);

  console.log("📋 Step 1: Authorize the app\n");
  console.log("Opening browser to authorize...\n");
  console.log("If browser doesn't open, visit this URL manually:\n");
  console.log(authUrl.toString());
  console.log("\n");

  // Start local server to catch the callback
  return new Promise((resolve) => {
    const server = http.createServer(async (req, res) => {
      const url = new URL(req.url || "", `http://localhost:3456`);

      if (url.pathname === "/callback") {
        const code = url.searchParams.get("code");
        const error = url.searchParams.get("error");
        const returnedState = url.searchParams.get("state");

        // Validate state to prevent CSRF
        if (returnedState !== STATE) {
          console.log(`\n⚠️  State mismatch (expected: ${STATE}, got: ${returnedState})`);
          // Continue anyway for testing
        }

        if (error) {
          res.writeHead(400, { "Content-Type": "text/html" });
          res.end(`<h1>Error: ${error}</h1><p>${url.searchParams.get("error_description")}</p>`);
          console.log(`\n❌ Authorization failed: ${error} - ${url.searchParams.get("error_description")}`);
          server.close();
          resolve();
          return;
        }

        if (!code) {
          res.writeHead(400, { "Content-Type": "text/html" });
          res.end("<h1>Error: No code received</h1>");
          server.close();
          resolve();
          return;
        }

        console.log("✅ Authorization code received!");
        console.log("\n📋 Step 2: Exchanging code for access token...\n");

        try {
          const tokens = await exchangeCodeForToken(code);
          console.log("✅ Access token obtained!\n");

          console.log("📋 Step 3: Fetching organization info...\n");
          const org = await getOrganization(tokens.access_token);

          console.log("✅ Organization info retrieved!\n");
          console.log("=".repeat(60));

          if (ENV_FILE) {
            upsertEnvVar(ENV_FILE, "QONTO_ACCESS_TOKEN", tokens.access_token);
            upsertEnvVar(ENV_FILE, "QONTO_REFRESH_TOKEN", tokens.refresh_token);
            console.log(`🎉 SUCCESS! Wrote QONTO_ACCESS_TOKEN + QONTO_REFRESH_TOKEN to ${ENV_FILE}`);
            console.log("   (token values not printed — read the file if you need them).");
            console.log(`   Expires in ${tokens.expires_in}s; the solver auto-refreshes on 401 and persists rotations.`);
          } else {
            console.log("🎉 SUCCESS! Update your solver/.env file with these:");
            console.log("=".repeat(60));
            console.log("");
            console.log("# Change auth method to oauth");
            console.log("QONTO_AUTH_METHOD=oauth");
            console.log("");
            console.log("# OAuth tokens");
            console.log(`QONTO_ACCESS_TOKEN=${tokens.access_token}`);
            console.log(`QONTO_REFRESH_TOKEN=${tokens.refresh_token}`);
            console.log(`# Token expires in ${tokens.expires_in} seconds`);
          }

          if (org.bank_accounts && org.bank_accounts.length > 0) {
            console.log("");
            console.log("# Bank accounts (id = UUID for QONTO_BANK_ACCOUNT_ID):");
            org.bank_accounts.forEach((acc, i) => {
              console.log(`# ${i + 1}. ${acc.name} — ${acc.iban} — id=${acc.id} (balance: ${acc.balance} ${acc.currency})`);
            });
          }

          console.log("");
          console.log("=".repeat(60));

          res.writeHead(200, { "Content-Type": "text/html" });
          res.end(`
            <html>
              <body style="font-family: -apple-system, sans-serif; padding: 40px; text-align: center; background: #1a1a2e; color: #eee;">
                <h1 style="color: #4ade80;">✅ Authorization Successful!</h1>
                <p>Check your terminal for the credentials.</p>
                <p style="color: #888;">You can close this window.</p>
              </body>
            </html>
          `);

        } catch (err) {
          console.error("❌ Error:", err.message);
          res.writeHead(500, { "Content-Type": "text/html" });
          res.end(`<h1>Error</h1><pre>${err.message}</pre>`);
        }

        server.close();
        resolve();
        return;
      }

      res.writeHead(404);
      res.end("Not found");
    });

    server.listen(3456, () => {
      console.log("🌐 Waiting for callback on http://localhost:3456/callback\n");
      openBrowser(authUrl.toString());
    });
  });
}

main().catch(console.error);
