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
  /**
   * 서버는 시드로 사건을 재생성한다 — 그래서 **옷도 같이 알려줘야 한다.**
   * world/caseId 없이 시드만 보내면 서버 프롬프트는 호텔 어휘로 만들어지고,
   * 갤러리·경매장 화면과 페르소나의 말이 어긋난다 (gc001 에서 실제로 그랬다).
   */
  world?: string
  caseId?: 'gc001'
  suspectId: SuspectId
  personaId: string
  question: string
  presentedEvidence?: string
  pressure: number
  history: { q: string; a: string }[]
  /**
   * ── 조사 계층 (V0.2) ── **플레이어의 지식**을 보낸다. 진실은 여기에 없다.
   * 서버가 이것으로 규칙 엔진을 돌려 이 턴에 말해도 되는 범위를 정한다 (명세 §35).
   */
  heldClueIds?: string[]
  claimStates?: Record<string, string>
  presentedClueIds?: string[]
}

/** 서버가 돌린 규칙 엔진의 결과 — 클라이언트가 Claim 상태기계를 돌리는 재료 */
export interface AskInquiry {
  intent: string
  confidence: number
  time?: string
  subjectId?: SuspectId
  mode: 'ANSWER' | 'DEFLECT' | 'REVISE' | 'UNSURE' | 'CLARIFY'
  claimIds: string[]
  factIds: string[]
  reaction: string
  /** [원본, 수정] — 있으면 이번 턴에 말이 바뀌었다 */
  revisionOf?: [string, string]
}

export interface AskResult {
  reply: PersonaReply
  fallback: boolean
  reason?: string
  ms: number
  inquiry?: AskInquiry
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
    const data = (await res.json()) as {
      reply?: PersonaReply; fallback?: boolean; reason?: string; inquiry?: AskInquiry
    }
    if (!data.reply) throw new Error(data.reason ?? 'bad response')
    return {
      reply: data.reply,
      fallback: Boolean(data.fallback),
      reason: data.reason,
      ms: performance.now() - t0,
      inquiry: data.inquiry,
    }
  } catch (e) {
    // 폴백 3층: 네트워크·타임아웃. 게임은 멈추지 않는다.
    return {
      reply: {
        speech: '(대답이 없다)', revealedFactIds: [], pressureDelta: 0, tell: 'pause',
        statement: { time: '', place: '', action: '', certainty: '기억없음', newInfo: false },
      },
      fallback: true,
      reason: String(e),
      ms: performance.now() - t0,
    }
  } finally {
    clearTimeout(timer)
  }
}
