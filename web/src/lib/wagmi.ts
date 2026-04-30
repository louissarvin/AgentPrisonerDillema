import { getDefaultConfig } from '@rainbow-me/rainbowkit'
import { unichainSepolia, zgTestnet } from './chains'

export const wagmiConfig = getDefaultConfig({
  appName: 'Agent Arena',
  projectId: import.meta.env.VITE_WALLETCONNECT_PROJECT_ID || 'YOUR_PROJECT_ID',
  chains: [unichainSepolia, zgTestnet],
  ssr: true,
})
