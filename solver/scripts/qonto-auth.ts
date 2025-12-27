/**
 * Qonto OAuth Helper Script
 * 
 * Usage:
 * 1. Set your CLIENT_ID and CLIENT_SECRET below
 * 2. Run: npx ts-node scripts/qonto-auth.ts
 * 3. Follow the instructions
 */

import http from "http";
import open from "open";

// ============ CONFIGURE THESE ============
const CLIENT_ID = process.env.QONTO_CLIENT_ID || "YOUR_CLIENT_ID";
const CLIENT_SECRET = process.env.QONTO_CLIENT_SECRET || "YOUR_CLIENT_SECRET";
const REDIRECT_URI = "http://localhost:3456/callback";
// ==========================================

const QONTO_AUTH_URL = "https://oauth.qonto.com/authorize";
const QONTO_TOKEN_URL = "https://oauth.qonto.com/token";
const QONTO_API_URL = "https://thirdparty.qonto.com";

const SCOPES = ["offline_access", "organization.read", "payment.write"];

async function exchangeCodeForToken(code: string): Promise<{
  access_token: string;
  refresh_token: string;
  expires_in: number;
}> {
  const response = await fetch(QONTO_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
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

async function getOrganization(accessToken: string): Promise<{
  slug: string;
  bank_accounts: Array<{ id: string; iban: string; name: string; balance: number }>;
}> {
  const response = await fetch(`${QONTO_API_URL}/v2/organization`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to get organization: ${response.status} - ${error}`);
  }

  const data = await response.json();
  return data.organization;
}

async function main() {
  console.log("\n🏦 Qonto OAuth Setup Helper\n");

  if (CLIENT_ID === "YOUR_CLIENT_ID" || CLIENT_SECRET === "YOUR_CLIENT_SECRET") {
    console.log("❌ Please set your CLIENT_ID and CLIENT_SECRET!");
    console.log("\nOption 1: Edit this file directly");
    console.log("Option 2: Set environment variables:");
    console.log("  export QONTO_CLIENT_ID=your_client_id");
    console.log("  export QONTO_CLIENT_SECRET=your_client_secret");
    console.log("  npx ts-node scripts/qonto-auth.ts\n");
    process.exit(1);
  }

  // Build authorization URL
  const authUrl = new URL(QONTO_AUTH_URL);
  authUrl.searchParams.set("client_id", CLIENT_ID);
  authUrl.searchParams.set("redirect_uri", REDIRECT_URI);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("scope", SCOPES.join(" "));

  console.log("📋 Step 1: Authorize the app\n");
  console.log("Opening browser to:", authUrl.toString());
  console.log("\nIf browser doesn't open, manually visit this URL:\n");
  console.log(authUrl.toString());
  console.log("\n");

  // Start local server to catch the callback
  return new Promise<void>((resolve) => {
    const server = http.createServer(async (req, res) => {
      const url = new URL(req.url || "", `http://localhost:3456`);

      if (url.pathname === "/callback") {
        const code = url.searchParams.get("code");
        const error = url.searchParams.get("error");

        if (error) {
          res.writeHead(400, { "Content-Type": "text/html" });
          res.end(`<h1>Error: ${error}</h1><p>${url.searchParams.get("error_description")}</p>`);
          console.log(`\n❌ Authorization failed: ${error}`);
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
          console.log("🎉 SUCCESS! Add these to your solver/.env file:");
          console.log("=".repeat(60));
          console.log(`\nQONTO_ACCESS_TOKEN=${tokens.access_token}`);
          console.log(`QONTO_REFRESH_TOKEN=${tokens.refresh_token}`);
          
          if (org.bank_accounts && org.bank_accounts.length > 0) {
            console.log(`\n# Available bank accounts:`);
            org.bank_accounts.forEach((acc, i) => {
              console.log(`# ${i + 1}. ${acc.name} - ${acc.iban} (Balance: €${acc.balance})`);
              console.log(`QONTO_BANK_ACCOUNT_ID=${acc.id}`);
            });
          }

          console.log("\n" + "=".repeat(60));

          res.writeHead(200, { "Content-Type": "text/html" });
          res.end(`
            <html>
              <body style="font-family: sans-serif; padding: 40px; text-align: center;">
                <h1>✅ Authorization Successful!</h1>
                <p>Check your terminal for the credentials.</p>
                <p>You can close this window.</p>
              </body>
            </html>
          `);

        } catch (err) {
          console.error("❌ Error:", err);
          res.writeHead(500, { "Content-Type": "text/html" });
          res.end(`<h1>Error</h1><pre>${err}</pre>`);
        }

        server.close();
        resolve();
        return;
      }

      res.writeHead(404);
      res.end("Not found");
    });

    server.listen(3456, () => {
      console.log("🌐 Waiting for authorization callback on http://localhost:3456/callback\n");
      
      // Try to open browser
      open(authUrl.toString()).catch(() => {
        console.log("(Could not auto-open browser - please open the URL manually)\n");
      });
    });
  });
}

main().catch(console.error);

