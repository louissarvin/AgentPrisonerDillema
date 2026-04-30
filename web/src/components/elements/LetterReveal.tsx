import { useEffect, useRef } from 'react'
import { gsap } from 'gsap'

interface LetterRevealProps {
  text: string
  className?: string
  delay?: number
  staggerMs?: number
  fromY?: number
}

export default function LetterReveal({
  text,
  className,
  delay = 0.3,
  staggerMs = 0.03,
  fromY = 40,
}: LetterRevealProps) {
  const containerRef = useRef<HTMLSpanElement>(null)
  const hasAnimated = useRef(false)

  useEffect(() => {
    const el = containerRef.current
    if (!el || hasAnimated.current) return

    const letters = el.querySelectorAll('.split-letter')
    gsap.set(letters, { opacity: 0, y: fromY, rotateX: -40 })

    hasAnimated.current = true
    gsap.to(letters, {
      opacity: 1,
      y: 0,
      rotateX: 0,
      duration: 0.6,
      stagger: staggerMs,
      ease: 'power3.out',
      delay,
    })
  }, [delay, staggerMs, fromY])

  const chars = text.split('')

  return (
    <span
      ref={containerRef}
      className={className}
      style={{ perspective: '600px' }}
    >
      {chars.map((char, i) => (
        <span
          key={i}
          className="split-letter inline-block"
          style={{ opacity: 0, whiteSpace: char === ' ' ? 'pre' : undefined }}
        >
          {char === ' ' ? '\u00A0' : char}
        </span>
      ))}
    </span>
  )
}
