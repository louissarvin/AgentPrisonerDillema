'use client'

import { RainbowKitProvider, darkTheme } from '@rainbow-me/rainbowkit'
import { WagmiProvider } from 'wagmi'
import { wagmiConfig } from '@/lib/wagmi'
import '@rainbow-me/rainbowkit/styles.css'

interface Web3ProviderProps {
  children: React.ReactNode
}

const rainbowTheme = darkTheme({
  accentColor: '#00d992',
  accentColorForeground: '#000000',
  borderRadius: 'medium',
})

export default function Web3Provider({ children }: Web3ProviderProps) {
  return (
    <WagmiProvider config={wagmiConfig}>
      <RainbowKitProvider theme={rainbowTheme}>{children}</RainbowKitProvider>
    </WagmiProvider>
  )
}
