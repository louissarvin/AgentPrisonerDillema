import ArenaHeader from './ArenaHeader'

export default function ArenaLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className="min-h-screen bg-canvas">
      <div className="dot-grid" />
      <ArenaHeader />
      <main className="relative z-10 pt-24">{children}</main>
    </div>
  )
}

