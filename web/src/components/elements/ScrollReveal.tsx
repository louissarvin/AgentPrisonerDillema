import { useEffect, useRef } from 'react'
import { gsap } from 'gsap'

interface ScrollRevealProps {
  children: React.ReactNode
  className?: string
  delay?: number
  stagger?: boolean
  /** Animation distance in px (default 8) */
  distance?: number
}

export default function ScrollReveal({
  children,
  className,
  delay = 0,
  stagger = false,
  distance = 8,
}: ScrollRevealProps) {
  const ref = useRef<HTMLDivElement>(null)
  const hasAnimated = useRef(false)

  useEffect(() => {
    const el = ref.current
    if (!el) return

    if (stagger) {
      gsap.set(el.children, { opacity: 0, y: distance })
    } else {
      gsap.set(el, { opacity: 0, y: distance })
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && !hasAnimated.current) {
          hasAnimated.current = true
          if (stagger) {
            gsap.to(el.children, {
              opacity: 1,
              y: 0,
              duration: 0.6,
              stagger: 0.08,
              ease: 'power2.out',
              delay,
            })
          } else {
            gsap.to(el, {
              opacity: 1,
              y: 0,
              duration: 0.6,
              ease: 'power2.out',
              delay,
            })
          }
          observer.disconnect()
        }
      },
      { threshold: 0.15, rootMargin: '-5%' },
    )

    observer.observe(el)
    return () => observer.disconnect()
  }, [delay, stagger, distance])

  return (
    <div ref={ref} className={className}>
      {children}
    </div>
  )
}
