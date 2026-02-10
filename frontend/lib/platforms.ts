/**
 * Payment platform and currency configurations for ZKP2P integration
 */

export interface Currency {
  code: string;
  name: string;
  symbol: string;
  flag: string;
}

export interface Platform {
  id: string;
  name: string;
  icon: string; // emoji fallback, can be replaced with SVG paths
  currencies: string[]; // currency codes supported by this platform
}

// Supported fiat currencies
export const CURRENCIES: Record<string, Currency> = {
  USD: { code: 'USD', name: 'US Dollar', symbol: '$', flag: '🇺🇸' },
  EUR: { code: 'EUR', name: 'Euro', symbol: '€', flag: '🇪🇺' },
  GBP: { code: 'GBP', name: 'British Pound', symbol: '£', flag: '🇬🇧' },
  SGD: { code: 'SGD', name: 'Singapore Dollar', symbol: 'S$', flag: '🇸🇬' },
  AUD: { code: 'AUD', name: 'Australian Dollar', symbol: 'A$', flag: '🇦🇺' },
  CAD: { code: 'CAD', name: 'Canadian Dollar', symbol: 'C$', flag: '🇨🇦' },
  INR: { code: 'INR', name: 'Indian Rupee', symbol: '₹', flag: '🇮🇳' },
  BRL: { code: 'BRL', name: 'Brazilian Real', symbol: 'R$', flag: '🇧🇷' },
  MXN: { code: 'MXN', name: 'Mexican Peso', symbol: '$', flag: '🇲🇽' },
};

// Payment platforms with their supported currencies
export const PLATFORMS: Record<string, Platform> = {
  venmo: {
    id: 'venmo',
    name: 'Venmo',
    icon: '💜', // Purple V
    currencies: ['USD'],
  },
  cashapp: {
    id: 'cashapp',
    name: 'Cash App',
    icon: '💵',
    currencies: ['USD'],
  },
  zelle: {
    id: 'zelle',
    name: 'Zelle',
    icon: '💸',
    currencies: ['USD'],
  },
  revolut: {
    id: 'revolut',
    name: 'Revolut',
    icon: '🔄',
    currencies: ['USD', 'EUR', 'GBP', 'SGD', 'AUD', 'CAD'],
  },
  wise: {
    id: 'wise',
    name: 'Wise',
    icon: '🌍',
    currencies: ['USD', 'EUR', 'GBP', 'SGD', 'AUD', 'CAD', 'INR', 'BRL'],
  },
  paypal: {
    id: 'paypal',
    name: 'PayPal',
    icon: '🅿️',
    currencies: ['USD', 'EUR', 'GBP', 'AUD', 'CAD'],
  },
  mercadopago: {
    id: 'mercadopago',
    name: 'Mercado Pago',
    icon: '🛒',
    currencies: ['BRL', 'MXN'],
  },
};

// Quick amount presets
export const QUICK_AMOUNTS = [25, 50, 100, 250, 500];

// Helper to get currencies for a platform
export function getPlatformCurrencies(platformId: string): Currency[] {
  const platform = PLATFORMS[platformId];
  if (!platform) return [];
  return platform.currencies
    .map(code => CURRENCIES[code])
    .filter((c): c is Currency => c !== undefined);
}

// Helper to get default currency for a platform
export function getDefaultCurrency(platformId: string): Currency | undefined {
  const currencies = getPlatformCurrencies(platformId);
  return currencies[0];
}

// Get all platforms as array
export function getAllPlatforms(): Platform[] {
  return Object.values(PLATFORMS);
}

// Get all currencies as array
export function getAllCurrencies(): Currency[] {
  return Object.values(CURRENCIES);
}
