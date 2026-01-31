import { useChainId } from "wagmi";
import { getAddressesForChain, type NetworkAddresses } from "@/lib/network";

/**
 * Returns contract addresses matching the wallet's currently connected chain.
 * When the user switches networks in the wallet selector, all addresses update automatically.
 */
export function useNetworkAddresses(): NetworkAddresses {
  const chainId = useChainId();
  return getAddressesForChain(chainId);
}
