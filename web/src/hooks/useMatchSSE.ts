import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '@/lib/api'

export interface SSEEvent {
  type: string
  data: Record<string, unknown>
  timestamp: string
}

export function useMatchSSE(matchId: string | null) {
  const [events, setEvents] = useState<Array<SSEEvent>>([])
  const [connected, setConnected] = useState(false)
  const sourceRef = useRef<EventSource | null>(null)

  const connect = useCallback(() => {
    if (!matchId) return

    const url = api.sseMatchUrl(matchId)
    const source = new EventSource(url)
    sourceRef.current = source

    source.onopen = () => setConnected(true)
    source.onerror = () => {
      setConnected(false)
      source.close()
      setTimeout(connect, 3000)
    }

    // Named SSE event types emitted by the backend
    const eventTypes = [
      'connected',
      'match_started',
      'round_started',
      'phase_change',
      'negotiation',
      'moves_committed',
      'moves_revealed',
      'round_resolved',
      'match_ended',
      'commitment_bond',
      'onchain_tx',
      'agent_bet',
    ]

    for (const eventType of eventTypes) {
      source.addEventListener(eventType, (e: MessageEvent) => {
        try {
          const data = JSON.parse(e.data) as Record<string, unknown>
          setEvents((prev) => [
            ...prev,
            { type: eventType, data, timestamp: new Date().toISOString() },
          ])
        } catch {
          // ignore malformed SSE frames
        }
      })
    }
  }, [matchId])

  useEffect(() => {
    connect()
    return () => {
      sourceRef.current?.close()
      sourceRef.current = null
    }
  }, [connect])

  const clear = useCallback(() => setEvents([]), [])

  return { events, connected, clear }
}

export function useLiveSSE() {
  const [events, setEvents] = useState<Array<SSEEvent>>([])
  const [connected, setConnected] = useState(false)
  const sourceRef = useRef<EventSource | null>(null)

  useEffect(() => {
    const url = api.sseLiveUrl()
    const source = new EventSource(url)
    sourceRef.current = source

    source.onopen = () => setConnected(true)
    source.onerror = () => {
      setConnected(false)
    }

    const eventTypes = [
      'connected',
      'match_started',
      'round_started',
      'phase_change',
      'negotiation',
      'moves_committed',
      'moves_revealed',
      'round_resolved',
      'match_ended',
      'commitment_bond',
      'onchain_tx',
      'agent_bet',
    ]

    for (const eventType of eventTypes) {
      source.addEventListener(eventType, (e: MessageEvent) => {
        try {
          const data = JSON.parse(e.data) as Record<string, unknown>
          setEvents((prev) => {
            const next = [
              ...prev,
              { type: eventType, data, timestamp: new Date().toISOString() },
            ]
            return next.slice(-100)
          })
        } catch {
          // ignore malformed SSE frames
        }
      })
    }

    return () => {
      source.close()
      sourceRef.current = null
    }
  }, [])

  return { events, connected }
}

