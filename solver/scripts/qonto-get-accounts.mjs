/**
 * Get Qonto Bank Account IDs using API Key
 * 
 * Usage:
 * QONTO_API_KEY_LOGIN="xxx" QONTO_API_KEY_SECRET="xxx" node scripts/qonto-get-accounts.mjs
 */

const API_KEY_LOGIN = process.env.QONTO_API_KEY_LOGIN;
const API_KEY_SECRET = process.env.QONTO_API_KEY_SECRET;
const BASE_URL = "https://thirdparty.qonto.com";

async function main() {
  console.log("\n🏦 Qonto Account Lookup\n");

  if (!API_KEY_LOGIN || !API_KEY_SECRET) {
    console.log("❌ Please set QONTO_API_KEY_LOGIN and QONTO_API_KEY_SECRET!");
    console.log("\nUsage:");
    console.log('  QONTO_API_KEY_LOGIN="xxx" QONTO_API_KEY_SECRET="xxx" node scripts/qonto-get-accounts.mjs\n');
    process.exit(1);
  }

  console.log("📋 Fetching organization info...\n");

  try {
    const response = await fetch(`${BASE_URL}/v2/organization`, {
      headers: {
        "Authorization": `${API_KEY_LOGIN}:${API_KEY_SECRET}`,
        "Accept": "application/json",
      },
    });

    if (!response.ok) {
      const error = await response.text();
      console.log(`❌ API Error: ${response.status}`);
      console.log(error);
      process.exit(1);
    }

    const data = await response.json();
    const org = data.organization;

    console.log("✅ Organization found!\n");
    console.log("=".repeat(60));
    console.log(`Organization: ${org.legal_name || org.slug}`);
    console.log("=".repeat(60));
    
    if (org.bank_accounts && org.bank_accounts.length > 0) {
      console.log("\n📋 Bank Accounts:\n");
      org.bank_accounts.forEach((acc, i) => {
        console.log(`  ${i + 1}. ${acc.name}`);
        console.log(`     IBAN: ${acc.iban}`);
        console.log(`     Balance: €${acc.balance}`);
        console.log(`     Status: ${acc.status}`);
        console.log(`     ID: ${acc.slug}`);
        console.log("");
      });

      console.log("=".repeat(60));
      console.log("🎉 Add these to your solver/.env file:");
      console.log("=".repeat(60));
      console.log(`\nQONTO_ENABLED=true`);
      console.log(`QONTO_API_KEY_LOGIN=${API_KEY_LOGIN}`);
      console.log(`QONTO_API_KEY_SECRET=${API_KEY_SECRET}`);
      console.log(`\n# Pick one of the bank account IDs above:`);
      console.log(`QONTO_BANK_ACCOUNT_ID=${org.bank_accounts[0].slug}`);
      console.log("\n" + "=".repeat(60));
    } else {
      console.log("\n⚠️  No bank accounts found!");
    }

  } catch (error) {
    console.error("❌ Error:", error.message);
    process.exit(1);
  }
}

main();

