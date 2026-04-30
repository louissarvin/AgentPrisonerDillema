import { useEffect, useRef, useState } from 'react'
import { cnm } from '@/utils/style'

interface Step {
  num: string
  title: string
  desc: string
  accentColor: string
}

interface ParallaxStepsProps {
  steps: Array<Step>
}

export default function ParallaxSteps({ steps }: ParallaxStepsProps) {
  const sectionRef = useRef<HTMLDivElement>(null)
  const [activeIndex, setActiveIndex] = useState(0)

  useEffect(() => {
    const section = sectionRef.current
    if (!section) return

    const onScroll = () => {
      const rect = section.getBoundingClientRect()
      const sectionHeight = section.offsetHeight
      const viewportH = window.innerHeight

      // How far we've scrolled into the section (0 at top, 1 at bottom)
      const scrolled = (viewportH - rect.top) / sectionHeight
      // Map to step index
      const idx = Math.min(
        steps.length - 1,
        Math.max(0, Math.floor(scrolled * steps.length)),
      )
      setActiveIndex(idx)
    }

    window.addEventListener('scroll', onScroll, { passive: true })
    onScroll()
    return () => window.removeEventListener('scroll', onScroll)
  }, [steps.length])

  const accentBorderMap: Record<string, string> = {
    'border-t-cooperate': 'border-l-cooperate',
    'border-t-tee': 'border-l-tee',
    'border-t-defect': 'border-l-defect',
  }

  return (
    <section
      ref={sectionRef}
      className="relative bg-canvas"
      style={{ height: `${steps.length * 100}vh` }}
    >
      <div className="sticky top-0 h-screen flex items-center overflow-hidden">
        <div className="max-w-5xl mx-auto px-6 w-full flex items-start gap-16">
          {/* Left: title + step indicators */}
          <div className="w-1/3 shrink-0">
            <p
              className="text-text-muted uppercase tracking-[0.5px] mb-3"
              style={{ fontSize: '11px' }}
            >
              Process
            </p>
            <h2
              className="font-black text-text-primary leading-[1.05]"
              style={{ fontSize: '40px', letterSpacing: '-1.5px' }}
            >
              How It
              <br />
              Works
            </h2>
            <div className="h-px bg-border mt-6 mb-4" />
            <div className="flex flex-col gap-2">
              {steps.map((step, i) => (
                <div
                  key={step.num}
                  className={cnm(
                    'flex items-center gap-3 transition-all duration-500 pl-3 border-l-2',
                    i === activeIndex
                      ? 'text-text-primary border-cooperate'
                      : 'text-text-muted border-transparent',
                  )}
                >
                  <span style={{ fontSize: '11px', letterSpacing: '0.5px' }}>
                    {step.num}
                  </span>
                  <span
                    className="uppercase"
                    style={{ fontSize: '11px', letterSpacing: '1px' }}
                  >
                    {step.title}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Right: card stack */}
          <div
            className="flex-1 relative"
            style={{ height: '360px', perspective: '800px' }}
          >
            {steps.map((step, i) => {
              const isActive = i === activeIndex
              const isPast = i < activeIndex
              const isFuture = i > activeIndex

              return (
                <div
                  key={step.num}
                  className={cnm(
                    'absolute inset-0 bg-panel border border-border border-l-2 p-8 rounded-2xl flex flex-col justify-between',
                    'transition-all duration-500 ease-out',
                    accentBorderMap[step.accentColor] ?? 'border-l-cooperate',
                  )}
                  style={{
                    transform: isActive
                      ? 'translateY(0) scale(1) rotateX(0deg)'
                      : isPast
                        ? 'translateY(-30%) scale(0.85) rotateX(8deg)'
                        : 'translateY(40%) scale(0.9) rotateX(-8deg)',
                    opacity: isActive ? 1 : 0,
                    visibility: isActive ? 'visible' : 'hidden',
                    transformStyle: 'preserve-3d',
                  }}
                >
                  <div>
                    <div className="flex items-center justify-between mb-6">
                      <span
                        className="text-text-muted"
                        style={{ fontSize: '11px', letterSpacing: '0.5px' }}
                      >
                        {step.num}
                      </span>
                      <span
                        className="text-text-muted"
                        style={{ fontSize: '11px' }}
                      >
                        {i + 1} / {steps.length}
                      </span>
                    </div>
                    <h3
                      className="font-bold text-text-primary uppercase mb-4"
                      style={{ fontSize: '28px', letterSpacing: '-0.5px' }}
                    >
                      {step.title}
                    </h3>
                    <p
                      className="text-text-muted leading-[1.7]"
                      style={{ fontSize: '14px' }}
                    >
                      {step.desc}
                    </p>
                  </div>
                  <div className="h-px bg-border mt-6" />
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </section>
  )
}
