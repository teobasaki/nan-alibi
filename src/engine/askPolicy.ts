/**
 * 질문 비용 정책 — **누가 그 1회를 지불하는가** (명세 V0.2 §5, AC-02·AC-03).
 *
 * 정책은 한 줄이다:
 * ```
 * 잘못된 질문   = 플레이어의 선택 = 비용 발생
 * 시스템 실패   = 플레이어 책임 아님 = 비용 없음
 * ```
 *
 * ## 무엇이 바뀌었나
 * 예전 규칙은 "폴백이면 환불" 이었다 (`fallback: true` 하나로 판정). 그런데 V0.2 는
 * **규칙 기반 폴백**을 정상 응답으로 만든다 (AC-13) — AI 검증이 실패해도 인물은 사건 데이터의
 * 문장으로 답하고, 그 답에는 정보가 들어 있다. 정보를 받았는데 비용이 0 이면 심문의 자원
 * 구조가 사라진다.
 *
 * 그래서 판정 기준을 `fallback` 플래그에서 **실패의 종류**로 옮긴다.
 *
 * | 상황 | reason | 차감 |
 * |---|---|---|
 * | 정상 응답 | — | ○ |
 * | 도움 안 되는 질문·모호한 질문·이미 물어본 질문 | — | ○ (플레이어의 선택이다) |
 * | 인물이 "모릅니다" 로 답함 | — | ○ (정상적인 게임 결과다) |
 * | 검증 실패 뒤 규칙이 답함 | `verification_failed` | ○ (정상 응답이다) |
 * | 키 없음·레이트 제한·오리진 거부 | `no_key`·`rate_limited`·`bad_origin` | ✕ |
 * | 네트워크·타임아웃·malformed | 그 밖 전부 | ✕ |
 *
 * 이 파일이 따로 있는 이유: 이 판정이 UI 안에 섞여 있으면 다음 사람이 조건 하나를 고칠 때
 * **되돌릴 수 없는 자원**의 규칙을 조용히 바꾼다. 순수 함수로 떼어 테스트가 잠근다.
 */

/** 시스템 실패로 보는 사유 — 이 목록에 있으면 플레이어는 비용을 치르지 않는다 */
export const SYSTEM_FAILURE_REASONS: readonly string[] = [
  'no_key',
  'rate_limited',
  'bad_origin',
]

/** 검증은 실패했지만 **규칙이 답했다** — 정상 응답이므로 비용을 받는다 (AC-02·AC-13) */
export const RULE_ANSWERED_REASON = 'verification_failed'

export interface AskOutcome {
  fallback: boolean
  reason?: string
}

/**
 * 이 응답이 질문 1회를 소모하는가.
 *
 * @example
 * chargesQuestion({ fallback: false })                                  // true — 정상 응답
 * chargesQuestion({ fallback: true, reason: 'verification_failed' })    // true — 규칙이 답했다
 * chargesQuestion({ fallback: true, reason: 'no_key' })                 // false — 시스템 실패
 * chargesQuestion({ fallback: true, reason: 'AbortError: timeout' })    // false — 시스템 실패
 */
export function chargesQuestion(r: AskOutcome): boolean {
  if (!r.fallback) return true
  if (r.reason === RULE_ANSWERED_REASON) return true
  return false
}

/** 화면에 정직하게 적을 한 줄 — 왜 환불됐는지(또는 왜 안 됐는지) */
export function costNote(r: AskOutcome): string | null {
  if (chargesQuestion(r)) return null
  if (r.reason && SYSTEM_FAILURE_REASONS.includes(r.reason)) {
    return 'AI 연결이 막혀 답을 받지 못했다 — 이 질문은 횟수에 넣지 않는다.'
  }
  return '응답이 도착하지 않았다 — 이 질문은 횟수에 넣지 않는다.'
}
