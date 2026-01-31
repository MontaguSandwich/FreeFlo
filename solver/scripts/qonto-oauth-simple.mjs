#!/usr/bin/env node
/**
 * Qonto OAuth Flow - Simple Version
 * 
 * This script guides you through the OAuth flow manually.
 * 
 * Usage:
 *   QONTO_CLIENT_ID=xxx QONTO_CLIENT_SECRET=yyy node scripts/qonto-oauth-simple.mjs
 */

import http from "http";
import readline from "readline";

// ============ CONFIGURATION ============
const CLIENT_ID = process.env.QONTO_CLIENT_ID || "";
const CLIENT_SECRET = process.env.QONTO_CLIENT_SECRET || "";
const REDIRECT_URI = process.env.QONTO_REDIRECT_URI || "http://localhost:3000/callback";
const CALLBACK_PORT = parseInt(new URL(REDIRECT_URI).port || "3000");
const USE_SANDBOX = process.env.QONTO_SANDBOX === "true";

const QONTO_AUTH_URL = USE_SANDBOX
  ? "https://oauth-sandbox.staging.qonto.co/oauth2/auth"
  : "https://oauth.qonto.com/oauth2/auth";
const QONTO_TOKEN_URL = USE_SANDBOX
  ? "https://oauth-sandbox.staging.qonto.co/oauth2/token"
  : "https://oauth.qonto.com/oauth2/token";
const QONTO_API_URL = USE_SANDBOX
  ? "https://thirdparty-sandbox.staging.qonto.co"
  : "https://thirdparty.qonto.com";
const STAGING_TOKEN = process.env.QONTO_STAGING_TOKEN || "";

const SCOPES = ["offline_access", "organization.read", "payment.write"];
const STATE = "solver_oauth_" + Math.random().toString(36).substring(2, 15);

// =========================================

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

function ask(question) {
  return new Promise((resolve) => {
    rl.question(question, resolve);
  });
}

async function exchangeCodeForToken(code) {
  console.log("\n📤 Exchanging code for token...\n");
  
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    code: code,
    redirect_uri: REDIRECT_URI,
  });

  console.log("Request body:", body.toString().replace(CLIENT_SECRET, "***"));

  const response = await fetch(QONTO_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: body,
  });

  const text = await response.text();
  
  if (!response.ok) {
    throw new Error(`Token exchange failed: ${response.status} - ${text}`);
  }

  return JSON.parse(text);
}

async function getOrganization(accessToken) {
  const headers = {
    Authorization: `Bearer ${accessToken}`,
  };
  if (STAGING_TOKEN) {
    headers["X-Qonto-Staging-Token"] = STAGING_TOKEN;
  }
  const response = await fetch(`${QONTO_API_URL}/v2/organization`, {
    headers,
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to get organization: ${response.status} - ${error}`);
  }

  const data = await response.json();
  return data.organization;
}

async function startCallbackServer() {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url || "", `http://localhost:${CALLBACK_PORT}`);
      
      if (url.pathname === "/callback") {
        const code = url.searchParams.get("code");
        const error = url.searchParams.get("error");
        
        if (error) {
          res.writeHead(400, { "Content-Type": "text/html" });
          res.end(`<h1>Error: ${error}</h1><p>${url.searchParams.get("error_description")}</p>`);
          server.close();
          reject(new Error(error));
          return;
        }
        
        if (code) {
          res.writeHead(200, { "Content-Type": "text/html" });
          res.end(`
            <html>
              <body style="font-family: -apple-system, sans-serif; padding: 40px; text-align: center; background: #1a1a2e; color: #eee;">
                <h1 style="color: #4ade80;">✅ Authorization Code Received!</h1>
                <p>Check your terminal - processing...</p>
              </body>
            </html>
          `);
          server.close();
          resolve(code);
          return;
        }
      }
      
      res.writeHead(404);
      res.end("Not found");
    });
    
    server.listen(CALLBACK_PORT, () => {
      console.log(`🌐 Callback server listening on ${REDIRECT_URI}\n`);
    });
    
    // Timeout after 5 minutes
    setTimeout(() => {
      server.close();
      reject(new Error("Timeout waiting for callback"));
    }, 300000);
  });
}

async function main() {
  console.log(`\n🏦 Qonto OAuth Setup (${USE_SANDBOX ? "SANDBOX" : "PRODUCTION"})\n`);
  console.log("=".repeat(60));

  if (!CLIENT_ID || !CLIENT_SECRET) {
    console.log("❌ Missing CLIENT_ID or CLIENT_SECRET!");
    console.log("\nUsage:");
    console.log("  QONTO_CLIENT_ID=xxx QONTO_CLIENT_SECRET=yyy node scripts/qonto-oauth-simple.mjs\n");
    process.exit(1);
  }

  // Build authorization URL
  const authUrl = new URL(QONTO_AUTH_URL);
  authUrl.searchParams.set("client_id", CLIENT_ID);
  authUrl.searchParams.set("redirect_uri", REDIRECT_URI);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("scope", SCOPES.join(" "));
  authUrl.searchParams.set("state", STATE);

  console.log("\n📋 STEP 1: Open this URL in your browser:\n");
  console.log(authUrl.toString());
  console.log("\n");
  console.log("📋 STEP 2: Log in to Qonto and authorize the app");
  console.log("📋 STEP 3: After clicking Continue, you'll be redirected");
  console.log("           The callback server is waiting...\n");
  console.log("=".repeat(60));

  try {
    // Start server and wait for callback
    const code = await startCallbackServer();
    
    console.log("\n✅ Authorization code received!");
    console.log("Code:", code.substring(0, 20) + "...");

    // Exchange for token
    const tokens = await exchangeCodeForToken(code);
    console.log("✅ Access token obtained!\n");

    // Get organization info
    console.log("📋 Fetching organization info...\n");
    const org = await getOrganization(tokens.access_token);

    console.log("=".repeat(60));
    console.log("🎉 SUCCESS! Add these to your solver/.env file:");
    console.log("=".repeat(60));
    console.log("");
    console.log("# Qonto OAuth credentials");
    console.log("QONTO_ENABLED=true");
    console.log("QONTO_AUTH_METHOD=oauth");
    console.log(`QONTO_ACCESS_TOKEN=${tokens.access_token}`);
    if (tokens.refresh_token) {
      console.log(`QONTO_REFRESH_TOKEN=${tokens.refresh_token}`);
    }
    
    if (org.bank_accounts && org.bank_accounts.length > 0) {
      console.log("");
      console.log("# Available bank accounts:");
      org.bank_accounts.forEach((acc, i) => {
        const balance = typeof acc.balance === 'number' ? (acc.balance / 100).toFixed(2) : acc.balance;
        console.log(`# ${i + 1}. ${acc.name || 'Account'} - ${acc.iban} (Balance: €${balance})`);
      });
      console.log(`QONTO_BANK_ACCOUNT_ID=${org.bank_accounts[0].slug || org.bank_accounts[0].id}`);
    }

    console.log("");
    console.log("=".repeat(60));

  } catch (err) {
    console.error("\n❌ Error:", err.message);
  }

  rl.close();
}

main();

