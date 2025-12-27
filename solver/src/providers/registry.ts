import { RTPNProvider, RTPN, Currency, RTPN_NAMES, CURRENCY_NAMES } from "../types/index.js";
import { createLogger } from "../utils/logger.js";

const log = createLogger("registry");

/**
 * Provider Registry
 * Manages all registered RTPN providers and routes requests to the appropriate one.
 */
export class ProviderRegistry {
  private providers: Map<string, RTPNProvider> = new Map();

  /**
   * Register a provider
   */
  register(provider: RTPNProvider): void {
    if (this.providers.has(provider.id)) {
      log.warn({ providerId: provider.id }, "Provider already registered, replacing");
    }
    
    this.providers.set(provider.id, provider);
    
    log.info(
      {
        providerId: provider.id,
        name: provider.name,
        rtpns: provider.supportedRtpns.map(r => RTPN_NAMES[r]),
        currencies: provider.supportedCurrencies.map(c => CURRENCY_NAMES[c]),
      },
      "Provider registered"
    );
  }

  /**
   * Unregister a provider
   */
  unregister(providerId: string): void {
    if (this.providers.delete(providerId)) {
      log.info({ providerId }, "Provider unregistered");
    }
  }

  /**
   * Get a specific provider by ID
   */
  getProvider(providerId: string): RTPNProvider | undefined {
    return this.providers.get(providerId);
  }

  /**
   * Get all registered providers
   */
  getAllProviders(): RTPNProvider[] {
    return [...this.providers.values()];
  }

  /**
   * Get providers that support a specific RTPN
   */
  getProvidersForRtpn(rtpn: RTPN): RTPNProvider[] {
    return [...this.providers.values()].filter(p => p.supportedRtpns.includes(rtpn));
  }

  /**
   * Get providers that support a specific currency
   */
  getProvidersForCurrency(currency: Currency): RTPNProvider[] {
    return [...this.providers.values()].filter(p => p.supportedCurrencies.includes(currency));
  }

  /**
   * Get providers that support both a specific RTPN and currency
   */
  getProvidersForRtpnAndCurrency(rtpn: RTPN, currency: Currency): RTPNProvider[] {
    return [...this.providers.values()].filter(
      p => p.supportedRtpns.includes(rtpn) && p.supportedCurrencies.includes(currency)
    );
  }

  /**
   * Check if any provider supports a given RTPN
   */
  hasProviderForRtpn(rtpn: RTPN): boolean {
    return this.getProvidersForRtpn(rtpn).length > 0;
  }

  /**
   * Check if any provider supports a given currency
   */
  hasProviderForCurrency(currency: Currency): boolean {
    return this.getProvidersForCurrency(currency).length > 0;
  }

  /**
   * Get all supported RTPNs across all providers
   */
  getSupportedRtpns(): RTPN[] {
    const rtpns = new Set<RTPN>();
    for (const provider of this.providers.values()) {
      for (const rtpn of provider.supportedRtpns) {
        rtpns.add(rtpn);
      }
    }
    return [...rtpns];
  }

  /**
   * Get all supported currencies across all providers
   */
  getSupportedCurrencies(): Currency[] {
    const currencies = new Set<Currency>();
    for (const provider of this.providers.values()) {
      for (const currency of provider.supportedCurrencies) {
        currencies.add(currency);
      }
    }
    return [...currencies];
  }

  /**
   * Run health checks on all providers
   */
  async healthCheckAll(): Promise<Map<string, boolean>> {
    const results = new Map<string, boolean>();
    
    await Promise.all(
      [...this.providers.entries()].map(async ([id, provider]) => {
        try {
          const healthy = await provider.healthCheck();
          results.set(id, healthy);
          if (!healthy) {
            log.warn({ providerId: id }, "Provider health check failed");
          }
        } catch (error) {
          results.set(id, false);
          log.error({ providerId: id, error }, "Provider health check threw error");
        }
      })
    );
    
    return results;
  }

  /**
   * Get registry stats
   */
  getStats(): {
    totalProviders: number;
    supportedRtpns: string[];
    supportedCurrencies: string[];
    providerDetails: Array<{
      id: string;
      name: string;
      rtpns: string[];
      currencies: string[];
    }>;
  } {
    return {
      totalProviders: this.providers.size,
      supportedRtpns: this.getSupportedRtpns().map(r => RTPN_NAMES[r]),
      supportedCurrencies: this.getSupportedCurrencies().map(c => CURRENCY_NAMES[c]),
      providerDetails: [...this.providers.values()].map(p => ({
        id: p.id,
        name: p.name,
        rtpns: p.supportedRtpns.map(r => RTPN_NAMES[r]),
        currencies: p.supportedCurrencies.map(c => CURRENCY_NAMES[c]),
      })),
    };
  }
}

// Singleton instance
export const registry = new ProviderRegistry();






