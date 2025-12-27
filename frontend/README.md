# ZKP2P Off-Ramp Frontend

Next.js web application for the ZKP2P off-ramp.

## Features

- Wallet connection via RainbowKit (MetaMask, WalletConnect, etc.)
- Real-time quote fetching from solver API
- Intent creation and status tracking
- IBAN validation
- Multi-currency support (EUR, GBP, USD, BRL, INR)

## Tech Stack

- **Framework**: Next.js 14 (App Router)
- **Styling**: Tailwind CSS
- **Wallet**: RainbowKit + wagmi + viem
- **Chain**: Base Sepolia (testnet)

## Prerequisites

- Node.js 20+
- WalletConnect Project ID (get one at https://cloud.walletconnect.com)

## Setup

```bash
# Install dependencies
npm install

# Copy environment file
cp env.example .env.local

# Edit with your values
vim .env.local
```

## Development

```bash
# Start development server
npm run dev

# Build for production
npm run build

# Start production server
npm start
```

Open http://localhost:3000

## Environment Variables

| Variable | Description |
|----------|-------------|
| `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` | WalletConnect Cloud project ID |
| `NEXT_PUBLIC_SOLVER_API_URL` | Solver quote API URL (default: http://127.0.0.1:8081) |

## User Flow

1. **Connect Wallet** - Click "Connect Wallet" button
2. **Enter Amount** - Type USDC amount to off-ramp
3. **Select Currency** - Choose target currency (EUR default)
4. **View Quotes** - Real-time quotes appear automatically
5. **Select Quote** - Click on preferred quote (SEPA Instant, etc.)
6. **Enter Details** - Input IBAN and recipient name
7. **Confirm** - Click "Confirm & Send"
8. **Sign Transactions**:
   - Create intent transaction
   - Approve USDC (if needed)
   - Commit to quote
9. **Wait** - Solver executes transfer and fulfills on-chain
10. **Done** - Receive fiat to your bank account!

## Project Structure

```
frontend/
├── app/
│   ├── globals.css      # Tailwind styles
│   ├── layout.tsx       # Root layout with providers
│   ├── page.tsx         # Home page
│   └── providers.tsx    # RainbowKit + wagmi providers
├── components/
│   ├── OffRampForm.tsx  # Main off-ramp form
│   └── QuoteCard.tsx    # Quote display card
├── lib/
│   ├── contracts.ts     # Contract ABIs and addresses
│   ├── quotes.ts        # Quote fetching and validation
│   └── wagmi.ts         # wagmi configuration
└── env.example          # Example environment file
```

## Customization

### Adding New Currencies

Edit `lib/quotes.ts`:

```typescript
export const CURRENCIES: Record<Currency, CurrencyInfo> = {
  EUR: { id: 'EUR', name: 'Euro', symbol: '€', flag: '🇪🇺' },
  // Add new currency here
};
```

### Updating Contract Addresses

Edit `lib/contracts.ts`:

```typescript
export const OFFRAMP_V2_ADDRESS = "0x..." as const;
```

## Styling

The app uses a dark theme with emerald/teal accent colors. Main styles:

- Background: `zinc-950`
- Cards: `zinc-900` with `zinc-800` borders
- Accent: `emerald-500` → `teal-500` gradient
- Text: `white` / `zinc-400`

## Known Issues

1. Quote expiration not auto-refreshed (manual refresh needed)
2. No transaction history view
3. Mobile layout could be improved

## License

MIT

