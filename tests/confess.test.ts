import { describe, it, expect } from 'vitest'
import { CONFESSION_PERSONA_IDS, confessionFor, type ConfessionFacts } from '../src/data/confessions'
import { PERSONAS } from '../src/data/personas'

/**
 * 자백은 LLM 이 아니라 결정론 템플릿이다 (ADR 022 버린 대안).
 * 이 테스트가 못박는 것: ① 페르소나 8종 전부 자기 문형이 있다
 * ② 사건 사실 4종(시각·방·동기·도구)이 문장에 전부 실린다 ③ 같은 입력 = 같은 문장.
 */

const FACTS: ConfessionFacts = {
  name: '한도윤',
  victim: '남기훈',
  time: '22:20',
  room: '1204호',
  motive: '거액의 빚',
  weapon: '놋쇠 촛대',
}

describe('자백 템플릿 — 페르소나별 결정론 (ADR 022)', () => {
  it('페르소나 8종 전부 전용 문형이 있다 — 하나라도 빠지면 그 인물의 엔딩은 남의 목소리다', () => {
    for (const p of PERSONAS) {
      expect(CONFESSION_PERSONA_IDS, p.id).toContain(p.id)
    }
    expect(CONFESSION_PERSONA_IDS.length).toBeGreaterThanOrEqual(8)
  })

  it('모든 문형에 사건 사실 4종(시각·방·동기·도구)이 실린다 — 자백이 곧 정답 재확인이다', () => {
    for (const p of PERSONAS) {
      const t = confessionFor(p.id, FACTS)
      expect(t, `${p.id}/시각`).toContain(FACTS.time)
      expect(t, `${p.id}/방`).toContain(FACTS.room)
      expect(t, `${p.id}/동기`).toContain(FACTS.motive)
      expect(t, `${p.id}/도구`).toContain(FACTS.weapon)
      // 2~3문장 규모 — 한 줄 요약도, 연설도 아니어야 한다
      expect(t.length, `${p.id}/길이`).toBeGreaterThan(40)
      expect(t.length, `${p.id}/길이`).toBeLessThan(220)
    }
  })

  it('문형이 페르소나마다 서로 다르다 — 같으면 페르소나가 장식이 된다', () => {
    const outs = PERSONAS.map((p) => confessionFor(p.id, FACTS))
    expect(new Set(outs).size).toBe(PERSONAS.length)
  })

  it('같은 입력은 항상 같은 문장이다 (결정론)', () => {
    expect(confessionFor('cynical', FACTS)).toBe(confessionFor('cynical', FACTS))
  })

  it('표 밖의 페르소나 id 도 비지 않는다 — 엔딩은 절대 빈 화면이 될 수 없다', () => {
    const t = confessionFor('없는-페르소나', FACTS)
    expect(t).toContain(FACTS.weapon)
    expect(t.length).toBeGreaterThan(20)
  })
})
