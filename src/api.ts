/**
 * 심문 API 클라이언트.
 *
 * 서버에 **시드만** 보낸다 — 사건 전체를 보내면 진실이 네트워크에 실리고
 * 개발자도구를 연 사람에게 정답이 노출된다.
 *
 * `fallback: true` 면 조사 횟수를 소모하지 않는다 (llm-persona-game §3):
 *   AI 가 실패했는데 플레이어가 대가를 치르면 그건 버그가 아니라 배신이다.
 */

import type { PersonaReply } from './engine/prompt'
import type { SuspectId } from './types'

export interface AskInput {
  seed: number
  suspectId: SuspectId
  personaId: string
  question: string
  presentedEvidence?: string
  pressure: number
  history: { q: string; a: string }[]
}

export interface AskResult {
  reply: PersonaReply
  fallback: boolean
  reason?: string
  ms: number
}

const TIMEOUT_MS = 12_000

export async function ask(input: AskInput): Promise<AskResult> {
  const t0 = performance.now()
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS)

  try {
    const res = await fetch('/api/interrogate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
      signal: ctl.signal,
    })
    const data = (await res.json()) as { reply?: PersonaReply; fallback?: boolean; reason?: string }
    if (!data.reply) throw new Error(data.reason ?? 'bad response')
    return { reply: data.reply, fallback: Boolean(data.fallback), reason: data.reason, ms: performance.now() - t0 }
  } catch (e) {
    // 폴백 3층: 네트워크·타임아웃. 게임은 멈추지 않는다.
    return {
      reply: { speech: '(대답이 없다)', revealedFactIds: [], pressureDelta: 0, tell: 'pause' },
      fallback: true,
      reason: String(e),
      ms: performance.now() - t0,
    }
  } finally {
    clearTimeout(timer)
  }
}
