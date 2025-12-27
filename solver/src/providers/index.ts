// Provider exports
export { BaseProvider } from "./base.js";
export { ProviderRegistry, registry } from "./registry.js";

// Re-export types
export type { RTPNProvider } from "../types/index.js";

// ============ Registered Providers ============

// Qonto - SEPA Instant (EUR)
export { QontoProvider, createQontoProvider } from "./qonto.js";
export type { QontoEnvConfig } from "./qonto.js";

// =============================================================================
// ADDING NEW PROVIDERS
// =============================================================================
// 
// To add a new RTPN provider:
//
// 1. Create provider files in this directory:
//    - provider.ts       (main provider class)
//    - provider-client.ts (API client)
//    - provider-types.ts  (types)
//
// 2. Extend BaseProvider and implement all required methods
//
// 3. Export from this file:
//    export { NewProvider, createNewProvider } from "./new-provider.js";
//
// 4. Register in index.ts (main solver entry)
//
// See QontoProvider as a reference implementation.
// =============================================================================



