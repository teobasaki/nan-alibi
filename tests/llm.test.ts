import { describe, it, expect } from 'vitest'
import { generateValidCase } from '../src/engine/validate'
import { buildPersonaPrefix, buildTurn, allowedFactIds, factId, RESPONSE_SCHEMA } from '../src/engine/prompt'
import { verifyReply, fallbackReply, extractTimes } from '../src/engine/verify'
import { PERSONAS, PERSONA_CONFLICTS } from '../src/data/personas'
import { SUSPECTS, SLOT_LABEL, PLACE_LABEL } from '../src/types'

const C = generateValidCase(7001).case
const S = SUSPECTS[0]!
const ok = (over: Partial<Record<string, unknown>> = {}) => ({
  speech: '사건 시간에는 로비에 있었습니다.',
  revealedFactIds: [factId(S, 2)],
  pressureDelta: 5,
  tell: 'none',
  ...over,
})

describe('프롬프트 조립 (Task 8) — 유출 방지', () => {
  const prefix = buildPersonaPrefix(C, S, 'calculating')

  it('프리픽스에 정답(범인)이 들어가지 않는다', () => {
    expect(prefix).not.toContain('범인은')
    expect(prefix.includes(`${C.culprit} 가 범인`)).toBe(false)
  })

  it('다른 인물의 지식 시트가 섞이지 않는다', () => {
    for (const other of SUSPECTS.filter((x) => x !== S)) {
      expect(prefix).not.toContain(`F:${other}:`)
    }
  })

  it('진실(truth)이 아니라 진술(claim)만 들어간다', () => {
    const sus = C.suspects[S]
    for (const t of sus.lieSlots) {
      // 거짓말한 슬롯에서는 진짜 위치가 프롬프트에 없어야 한다
      const truthLabel = PLACE_LABEL[sus.truth[t]!]
      const claimLabel = PLACE_LABEL[sus.claim[t]!]
      expect(claimLabel).not.toBe(truthLabel)
      expect(prefix).toContain(`${SLOT_LABEL[t]}에 ${claimLabel}에 있었다`)
    }
  })

  it('프리픽스는 같은 입력에 대해 바이트 단위로 동일하다 (캐시 전제)', () => {
    expect(buildPersonaPrefix(C, S, 'calculating')).toBe(prefix)
    expect(prefix).not.toMatch(/\d{4}-\d{2}-\d{2}T/)   // 타임스탬프 금지
  })

  it('캐시 최소 길이(1,024토큰) 확보를 위해 프리픽스가 충분히 길다', () => {
    // 한국어는 대략 1자 ≈ 1토큰 이하. 800자면 1k 토큰에 근접한다.
    expect(prefix.length).toBeGreaterThan(400)
  })

  it('가변부(turn)는 프리픽스와 분리되어 있다', () => {
    const turn = buildTurn({ question: '어디 있었습니까', pressure: 0, history: [] })
    expect(turn).not.toContain('[규칙]')
    expect(turn).toContain('어디 있었습니까')
  })

  it('출력 스키마가 OpenAI strict 모드 요구를 만족한다', () => {
    expect(RESPONSE_SCHEMA.additionalProperties).toBe(false)
    expect([...RESPONSE_SCHEMA.required].sort()).toEqual(
      Object.keys(RESPONSE_SCHEMA.properties).sort(),
    )
  })
})

describe('페르소나 카드 — 목소리 4요소 (llm-persona-game §4)', () => {
  it('8종 전부 4요소가 비어 있지 않다', () => {
    for (const p of PERSONAS) {
      for (const k of ['sentence', 'tic', 'avoidance', 'pressureResponse'] as const) {
        expect(p[k].length, `${p.id}.${k}`).toBeGreaterThan(5)
      }
    }
  })

  it('압박 반응이 서로 다르다 — 같으면 전략이 하나로 수렴한다', () => {
    const set = new Set(PERSONAS.map((p) => p.pressureResponse))
    expect(set.size).toBe(PERSONAS.length)
  })

  it('접근법이 겹치는 조합이 명시돼 있다', () => {
    expect(PERSONA_CONFLICTS.length).toBeGreaterThan(0)
  })
})

describe('★ 응답 검증기 3중 방어 (Task 8 — 완료기준 C1·C2)', () => {
  it('정상 응답은 통과한다', () => {
    const r = verifyReply(ok(), C, S)
    expect(r.ok).toBe(true)
  })

  it('① 지식 시트 밖 factId 를 반환하면 폐기한다 (C1)', () => {
    const r = verifyReply(ok({ revealedFactIds: ['F:S9:2'] }), C, S)
    expect(r.ok).toBe(false)
    expect(r.ok === false && r.reason).toBe('unknown-fact')
  })

  it('① 다른 인물의 사실 id 도 폐기한다', () => {
    const other = SUSPECTS.find((x) => x !== S)!
    const r = verifyReply(ok({ revealedFactIds: [factId(other, 2)] }), C, S)
    expect(r.ok === false && r.reason).toBe('unknown-fact')
  })

  it('② 사건에 없는 시각을 본문에 흘리면 폐기한다 (C2)', () => {
    const r = verifyReply(ok({ speech: '아, 23시 47분쯤이었나요. 잘 모르겠네요.' }), C, S)
    expect(r.ok).toBe(false)
    expect(r.ok === false && r.reason).toBe('phantom-time')
  })

  it('② 사건에 있는 시각은 통과한다 — 12시간 표기도 인정', () => {
    expect(verifyReply(ok({ speech: '22:20에는 로비였습니다.' }), C, S).ok).toBe(true)
    expect(verifyReply(ok({ speech: '10시 20분에는 로비였습니다.' }), C, S).ok).toBe(true)
  })

  it('②b 사건에 없는 방 번호를 지어내면 폐기한다', () => {
    const r = verifyReply(ok({ speech: '저는 1501호 근처에 있었습니다.' }), C, S)
    expect(r.ok === false && r.reason).toBe('phantom-place')
  })

  it('③ pressureDelta 가 범위를 넘으면 폐기가 아니라 클램프한다', () => {
    const r = verifyReply(ok({ pressureDelta: 999 }), C, S)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.reply.pressureDelta).toBe(40)
      expect(r.clamped).toBe(true)
    }
  })

  it('④ 깨진 JSON / 빈 응답 / 잘못된 tell 을 전부 폐기한다', () => {
    expect(verifyReply(null, C, S).ok).toBe(false)
    expect(verifyReply('문자열', C, S).ok).toBe(false)
    expect(verifyReply({}, C, S).ok).toBe(false)
    expect(verifyReply(ok({ speech: '' }), C, S).ok).toBe(false)
    expect(verifyReply(ok({ tell: '웃음' }), C, S).ok).toBe(false)
    expect(verifyReply(ok({ revealedFactIds: 'F:S1:2' }), C, S).ok).toBe(false)
  })

  it('길이 상한을 넘으면 폐기한다 (3~5분 세션 보호)', () => {
    const r = verifyReply(ok({ speech: '가'.repeat(200) }), C, S)
    expect(r.ok === false && r.reason).toBe('too-long')
  })

  it('시각 추출기가 여러 표기를 잡는다', () => {
    expect(extractTimes('22:20과 10시 5분')).toEqual(['22:20', '10:05'])
  })
})

describe('폴백 2층 (완료기준 C3)', () => {
  it('페르소나마다 다른 회피 대사를 준다', () => {
    const lines = PERSONAS.map((p) => fallbackReply(p.id).speech)
    expect(new Set(lines).size).toBe(PERSONAS.length)
  })

  it('폴백 응답도 검증기를 통과한다 — 폴백이 또 터지면 안 된다', () => {
    for (const p of PERSONAS) {
      expect(verifyReply(fallbackReply(p.id), C, S).ok, p.id).toBe(true)
    }
  })

  it('폴백은 사실을 공개하지 않는다', () => {
    for (const p of PERSONAS) expect(fallbackReply(p.id).revealedFactIds).toEqual([])
  })
})

describe('화이트리스트 원본', () => {
  it('허용 id 는 자기 진술 5개 + 자기 증언뿐이다', () => {
    for (const s of SUSPECTS) {
      const ids = allowedFactIds(C, s)
      expect(ids.filter((i) => i.startsWith('F:')).length).toBe(5)
      for (const i of ids) expect(i.includes(s) || i.startsWith('T-')).toBe(true)
    }
  })
})

describe('구간 표현 차단 (플레이 테스트에서 발견)', () => {
  it('"22:00부터 22:30까지" 같은 구간 주장을 폐기한다', () => {
    const r = verifyReply(ok({ speech: '저는 22:00부터 22:30까지 로비에 있었습니다.' }), C, S)
    expect(r.ok).toBe(false)
    expect(r.ok === false && r.reason).toBe('time-range')
  })

  it('"22시부터 22시 30분 사이" 도 잡는다', () => {
    const r = verifyReply(ok({ speech: '22시 00분부터 22시 30분 사이에 로비였습니다.' }), C, S)
    expect(r.ok === false && r.reason).toBe('time-range')
  })

  it('단일 시각은 통과한다', () => {
    expect(verifyReply(ok({ speech: '22:20에는 로비에 있었습니다.' }), C, S).ok).toBe(true)
  })
})
