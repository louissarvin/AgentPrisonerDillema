import { useEffect, useRef } from 'react'

interface TextRevealProps {
  children: React.ReactNode
  className?: string
  delay?: number
}

export default function TextReveal({
  children,
  className,
  delay = 0,
}: TextRevealProps) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setTimeout(() => el.classList.add('is-visible'), delay)
          observer.disconnect()
        }
      },
      { threshold: 0.3 },
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [delay])

  return (
    <div ref={ref} className={`text-reveal ${className ?? ''}`}>
      {children}
    </div>
  )
}
