import { useEffect, useRef } from 'react'
import { gsap } from 'gsap'

interface WordRevealProps {
  text: string
  className?: string
  wordClassName?: string
  delay?: number
  staggerMs?: number
  onScroll?: boolean
}

export default function WordReveal({
  text,
  className,
  wordClassName,
  delay = 0.2,
  staggerMs = 0.04,
  onScroll = false,
}: WordRevealProps) {
  const containerRef = useRef<HTMLSpanElement>(null)
  const hasAnimated = useRef(false)

  useEffect(() => {
    const el = containerRef.current
    if (!el || hasAnimated.current) return

    const words = el.querySelectorAll('.split-word')
    gsap.set(words, { opacity: 0, y: 8 })

    const animate = () => {
      if (hasAnimated.current) return
      hasAnimated.current = true
      gsap.to(words, {
        opacity: 1,
        y: 0,
        duration: 0.5,
        stagger: staggerMs,
        ease: 'power2.out',
        delay,
      })
    }

    if (onScroll) {
      const observer = new IntersectionObserver(
        ([entry]) => {
          if (entry.isIntersecting) {
            animate()
            observer.disconnect()
          }
        },
        { threshold: 0.3, rootMargin: '-10%' },
      )
      observer.observe(el)
      return () => observer.disconnect()
    } else {
      animate()
    }
  }, [delay, staggerMs, onScroll])

  const words = text.split(' ')

  return (
    <span ref={containerRef} className={className}>
      {words.map((word, i) => (
        <span
          key={i}
          className={`split-word inline-block ${wordClassName ?? ''}`}
          style={{ opacity: 0 }}
        >
          {word}
          {i < words.length - 1 ? '\u00A0' : ''}
        </span>
      ))}
    </span>
  )
}
