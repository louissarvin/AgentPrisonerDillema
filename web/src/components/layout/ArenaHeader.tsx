import { useEffect, useState } from 'react'
import { Link, useLocation } from '@tanstack/react-router'
import { ConnectButton } from '@rainbow-me/rainbowkit'
import { cnm } from '@/utils/style'

const navLinks = [
  { label: 'Home', to: '/' },
  { label: 'Arena', to: '/arena' },
  { label: 'Agents', to: '/agents' },
  { label: 'Rankings', to: '/tournament' },
] as const

export default function ArenaHeader() {
  const location = useLocation()
  const [scrolled, setScrolled] = useState(false)
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  useEffect(() => {
    const handleScroll = () => {
      setScrolled(window.scrollY > 100)
    }
    window.addEventListener('scroll', handleScroll, { passive: true })
    return () => window.removeEventListener('scroll', handleScroll)
  }, [])

  return (
    <header
      className="fixed top-5 left-1/2 -translate-x-1/2 z-50 flex items-center gap-1 rounded-full px-2 py-1.5 overflow-visible"
      style={{
        background: scrolled ? 'rgba(17,17,17,0.92)' : 'rgba(17,17,17,0.6)',
        backdropFilter: scrolled
          ? 'blur(16px) saturate(1.2)'
          : 'blur(8px) saturate(1)',
        border: '1px solid rgba(255,255,255,0.06)',
        transition: 'background 300ms ease, backdrop-filter 300ms ease',
      }}
    >
      {/* Logo */}
      <Link
        to="/"
        className="flex items-center px-3 py-1.5 overflow-visible"
        style={{ height: '20px' }}
      >
        <img
          src="/assets/logo-index.svg"
          alt="Agent Prisoner's Dilemma"
          className="w-auto pointer-events-auto"
          style={{ height: '40px', marginTop: '-30px', marginBottom: '-30px' }}
        />
      </Link>

      {/* Divider */}
      <div className="w-px h-5 bg-border" />

      {/* Nav Links */}
      <nav className="flex items-center gap-0.5 px-1">
        {navLinks.map((link) => {
          const isActive =
            link.to === '/'
              ? location.pathname === '/'
              : location.pathname.startsWith(link.to)
          return (
            <Link
              key={link.to}
              to={link.to}
              className={cnm(
                'text-xs tracking-wide px-3 py-1.5 relative group transition-colors duration-150',
                isActive
                  ? 'text-text-primary'
                  : 'text-text-secondary hover:text-text-primary',
              )}
            >
              {link.label}
              <span
                className={cnm(
                  'absolute bottom-0 left-3 right-3 h-px transition-all duration-200',
                  isActive
                    ? 'bg-text-primary'
                    : 'bg-border-strong scale-x-0 group-hover:scale-x-100',
                )}
                style={{ transformOrigin: 'left' }}
              />
            </Link>
          )
        })}
      </nav>

      {/* Divider */}
      <div className="w-px h-5 bg-border" />

      {/* Wallet */}
      {!mounted ? (
        <button className="text-xs font-medium px-4 py-1.5 ml-1 border border-cooperate text-cooperate bg-transparent rounded-full shadow-[0px_0px_14px_rgba(0,217,146,0.12)] opacity-0 pointer-events-none">
          Connect Wallet
        </button>
      ) : (
        <ConnectButton.Custom>
          {({
            account,
            chain,
            openConnectModal,
            openAccountModal,
            openChainModal,
            mounted: rkMounted,
          }) => {
            const connected = rkMounted && account && chain
            return (
              <div className="ml-1 flex items-center gap-1">
                {connected ? (
                  <>
                    <button
                      type="button"
                      onClick={openChainModal}
                      className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 text-text-secondary hover:text-text-primary transition-colors duration-150 rounded-full"
                    >
                      <span className="w-1.5 h-1.5 rounded-full bg-cooperate shrink-0" />
                      {chain.name ?? 'Unknown'}
                    </button>
                    <button
                      type="button"
                      onClick={openAccountModal}
                      className="flex items-center gap-2 text-xs font-medium px-3 py-1.5 border border-border-hover text-text-primary bg-transparent hover:bg-white/5 transition-all duration-200 rounded-full cursor-pointer"
                    >
                      {account.displayName}
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    onClick={openConnectModal}
                    className="text-xs font-medium px-4 py-1.5 border border-cooperate text-cooperate bg-transparent hover:bg-cooperate/8 transition-all duration-200 rounded-full shadow-[0px_0px_14px_rgba(0,217,146,0.12)] hover:shadow-[0px_0px_24px_rgba(0,217,146,0.25)] cursor-pointer"
                  >
                    Connect Wallet
                  </button>
                )}
              </div>
            )
          }}
        </ConnectButton.Custom>
      )}
    </header>
  )
}
