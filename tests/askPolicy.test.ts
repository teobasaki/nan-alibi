/**
 * 질문 비용 정책 (명세 V0.2 §5 · AC-01·02·03).
 *
 * **되돌릴 수 없는 자원의 규칙이라 테스트가 지킨다.** 이 판정이 UI 안에 섞여 있으면
 * 다음 사람이 조건 하나를 고칠 때 플레이어에게서 무언가를 조용히 빼앗는다.
 */
import { describe, expect, it } from 'vitest'
import { chargesQuestion, costNote, RULE_ANSWERED_REASON, SYSTEM_FAILURE_REASONS } from '../src/engine/askPolicy'
import { TALK_CAP } from '../src/data/config'
import { createGame, interview, talksLeft } from '../src/engine/game'
import { gc001Case } from '../src/data/gc001'

describe('AC-02 — 잘못된 질문도 플레이어의 선택이다 (정상 응답이면 차감)', () => {
  it('정상 응답은 차감한다', () => {
    expect(chargesQuestion({ fallback: false })).toBe(true)
  })

  it('검증 실패 뒤 **규칙이 답했으면** 차감한다 — 정보를 받았기 때문이다 (AC-13)', () => {
    expect(chargesQuestion({ fallback: true, reason: RULE_ANSWERED_REASON })).toBe(true)
  })

  it('차감되는 응답에는 환불 안내를 붙이지 않는다', () => {
    expect(costNote({ fallback: false })).toBeNull()
    expect(costNote({ fallback: true, reason: RULE_ANSWERED_REASON })).toBeNull()
  })
})

describe('AC-03 — 시스템 실패는 플레이어 책임이 아니다 (차감하지 않음)', () => {
  for (const reason of SYSTEM_FAILURE_REASONS) {
    it(`${reason} 은 차감하지 않는다`, () => {
      expect(chargesQuestion({ fallback: true, reason })).toBe(false)
      expect(costNote({ fallback: true, reason })).toContain('횟수에 넣지 않는다')
    })
  }

  it('네트워크·타임아웃처럼 알 수 없는 실패도 차감하지 않는다', () => {
    expect(chargesQuestion({ fallback: true, reason: 'AbortError: timeout' })).toBe(false)
    expect(chargesQuestion({ fallback: true })).toBe(false)
  })
})

describe('AC-01 — 각 용의자는 최대 10회', () => {
  it('상한은 10이고 인물별로 따로 센다', () => {
    expect(TALK_CAP).toBe(10)
    let g = createGame(gc001Case())
    for (let i = 0; i < TALK_CAP; i++) g = interview(g, 'S1')
    expect(talksLeft(g, 'S1')).toBe(0)
    expect(talksLeft(g, 'S2')).toBe(TALK_CAP)
    expect(() => interview(g, 'S1')).toThrow()
  })
})
