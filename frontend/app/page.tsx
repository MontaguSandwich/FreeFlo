"use client";

import { ConnectButton } from "@rainbow-me/rainbowkit";
import { OffRampV2 } from "@/components/OffRampForm";

export default function Home() {
  return (
    <main className="min-h-screen relative overflow-hidden">
      {/* Background */}
      <div className="fixed inset-0 bg-[#08080a]">
        {/* Gradient orbs */}
        <div className="absolute top-[-30%] left-[-15%] w-[800px] h-[800px] rounded-full bg-emerald-600/8 blur-[150px]" />
        <div className="absolute bottom-[-30%] right-[-15%] w-[700px] h-[700px] rounded-full bg-teal-600/8 blur-[130px]" />
        <div className="absolute top-[30%] right-[10%] w-[400px] h-[400px] rounded-full bg-cyan-600/5 blur-[100px]" />
        
        {/* Subtle grid */}
        <div 
          className="absolute inset-0 opacity-[0.03]"
          style={{
            backgroundImage: `
              linear-gradient(rgba(255,255,255,0.05) 1px, transparent 1px),
              linear-gradient(90deg, rgba(255,255,255,0.05) 1px, transparent 1px)
            `,
            backgroundSize: '60px 60px'
          }}
        />
      </div>

      {/* Content */}
      <div className="relative z-10 min-h-screen flex flex-col">
        {/* Header */}
        <header className="w-full px-8 py-5 border-b border-zinc-800/50">
          <div className="max-w-7xl mx-auto flex items-center justify-between">
            {/* Logo */}
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-500 flex items-center justify-center shadow-lg shadow-emerald-500/20">
                <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
              </div>
              <div>
                <h1 className="text-xl font-bold text-white tracking-tight">Ramp</h1>
              </div>
            </div>

            {/* Connect Button */}
            <ConnectButton.Custom>
              {({
                account,
                chain,
                openAccountModal,
                openChainModal,
                openConnectModal,
                mounted,
              }) => {
                const ready = mounted;
                const connected = ready && account && chain;

                return (
                  <div
                    {...(!ready && {
                      'aria-hidden': true,
                      style: {
                        opacity: 0,
                        pointerEvents: 'none',
                        userSelect: 'none',
                      },
                    })}
                  >
                    {(() => {
                      if (!connected) {
                        return (
                          <button
                            onClick={openConnectModal}
                            className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-500 text-white font-semibold text-sm hover:opacity-90 transition-opacity shadow-lg shadow-emerald-500/20"
                          >
                            Connect Wallet
                          </button>
                        );
                      }

                      if (chain.unsupported) {
                        return (
                          <button
                            onClick={openChainModal}
                            className="px-5 py-2.5 rounded-xl bg-red-500/20 border border-red-500/30 text-red-400 font-semibold text-sm hover:bg-red-500/30 transition-colors"
                          >
                            Wrong Network
                          </button>
                        );
                      }

                      return (
                        <div className="flex items-center gap-2">
                          <button
                            onClick={openChainModal}
                            className="flex items-center gap-2 px-3 py-2 rounded-xl bg-zinc-800/50 border border-zinc-700/50 hover:bg-zinc-800 transition-colors"
                          >
                            {chain.hasIcon && chain.iconUrl && (
                              <img
                                alt={chain.name ?? 'Chain'}
                                src={chain.iconUrl}
                                className="w-5 h-5 rounded-full"
                              />
                            )}
                            <span className="text-sm text-zinc-300">{chain.name}</span>
                          </button>

                          <button
                            onClick={openAccountModal}
                            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-zinc-800/50 border border-zinc-700/50 hover:bg-zinc-800 transition-colors"
                          >
                            <div className="w-5 h-5 rounded-full bg-gradient-to-br from-emerald-500 to-teal-500" />
                            <span className="text-sm font-medium text-white">
                              {account.displayName}
                            </span>
                          </button>
                        </div>
                      );
                    })()}
                  </div>
                );
              }}
            </ConnectButton.Custom>
          </div>
        </header>

        {/* Main Content */}
        <div className="flex-1 flex flex-col justify-center px-8 py-10">
          <div className="max-w-5xl mx-auto w-full">
            {/* Hero */}
            <div className="text-center mb-10">
              <h2 className="text-4xl md:text-5xl font-bold text-white mb-4 tracking-tight">
                USDC to Fiat, <span className="bg-gradient-to-r from-emerald-400 to-teal-400 bg-clip-text text-transparent">Instantly</span>
              </h2>
              <p className="text-zinc-400 text-lg max-w-xl mx-auto">
                Convert stablecoins to EUR, GBP, USD, BRL, or INR via real-time payment rails.
              </p>
            </div>

            {/* Main Card */}
            <OffRampV2 />
          </div>
        </div>

        {/* Footer */}
        <footer className="w-full px-8 py-6 border-t border-zinc-800/50">
          <div className="max-w-7xl mx-auto flex flex-col md:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-6 text-xs text-zinc-600">
              <span>Powered by crypto-native rails</span>
              <span className="hidden md:inline text-zinc-700">•</span>
              <span className="hidden md:inline">SEPA • FPS • PIX • UPI • FedNow</span>
            </div>
            <div className="flex items-center gap-6">
              <a href="#" className="text-xs text-zinc-600 hover:text-zinc-400 transition-colors">Docs</a>
              <a href="#" className="text-xs text-zinc-600 hover:text-zinc-400 transition-colors">GitHub</a>
              <a href="#" className="text-xs text-zinc-600 hover:text-zinc-400 transition-colors">Support</a>
            </div>
          </div>
        </footer>
      </div>
    </main>
  );
}
