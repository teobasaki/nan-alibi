/**
 * 조사 계층 계약 — **판정하지 않는다는 것을 기계로 잠근다** (명세 V0.2, ADR 031).
 *
 * 이 파일이 지키는 것은 대부분 *일어나지 않아야 하는 일*이다:
 *   · 시스템이 거짓말을 선언하지 않는다 (AC-12)
 *   · 플레이어가 움직이지 않으면 QUESTIONABLE 에서 CHALLENGED 로 가지 않는다 (명세 §14)
 *   · 말이 바뀌어도 원래 진술이 사라지지 않는다 (명세 §15)
 *   · 상태가 뒤로 가지 않는다 (플레이어가 한 일이 지워지지 않는다)
 */
import { describe, expect, it } from 'vitest'
import {
  challenge, claimStateOf, confirm, createInquiry, discover, disprove, evidenceStateOf,
  heldClueIds, hear, learnFact, link, question, revise, setSuspect, shakyClaims, understand,
  upsertHypothesis,
} from '../src/engine/inquiry'
import {
  GC001_CLAIMS, GC001_FACTS, GC001_INVESTIGATION_QUESTIONS,
  gc001Claim, gc001Fact, gc001OpeningClaims,
} from '../src/data/gc001-inquiry'
import { SUSPECTS } from '../src/types'

describe('Evidence 상태 — 세계에 있는 것을 발견하고 이해한다 (명세 §8)', () => {
  it('아무것도 안 한 상태의 기록은 AVAILABLE — 없는 게 아니라 아직 못 본 것이다', () => {
    expect(evidenceStateOf(createInquiry(), 'E3')).toBe('AVAILABLE')
  })

  it('AVAILABLE → DISCOVERED → UNDERSTOOD 순서로만 오른다', () => {
    const a = discover(createInquiry(), 'E3')
    expect(evidenceStateOf(a, 'E3')).toBe('DISCOVERED')
    const b = understand(a, 'E3')
    expect(evidenceStateOf(b, 'E3')).toBe('UNDERSTOOD')
  })

  it('발견하지 않은 기록은 이해할 수 없다 — 순서를 건너뛰면 아무 일도 없다', () => {
    const s = understand(createInquiry(), 'E9')
    expect(evidenceStateOf(s, 'E9')).toBe('AVAILABLE')
  })

  it('이미 이해한 기록은 다시 발견해도 내려가지 않는다', () => {
    const s = discover(understand(discover(createInquiry(), 'E8'), 'E8'), 'E8')
    expect(evidenceStateOf(s, 'E8')).toBe('UNDERSTOOD')
  })
})

describe('Claim 상태 — 시스템은 거짓말을 선언하지 않는다 (AC-12)', () => {
  it('듣지 않은 진술은 상태가 없다', () => {
    expect(claimStateOf(createInquiry(), 'CLM-GC001-RYU-LEFT')).toBeNull()
  })

  it('들으면 KNOWN — Truth 여부는 알 수 없다', () => {
    const s = hear(createInquiry(), 'CLM-GC001-RYU-LEFT')
    expect(claimStateOf(s, 'CLM-GC001-RYU-LEFT')).toBe('KNOWN')
  })

  it('충돌 가능 정보가 나타나면 QUESTIONABLE 까지만 오른다 — DISPROVED 로 뛰지 않는다', () => {
    const s = question(hear(createInquiry(), 'CLM-GC001-RYU-LEFT'), 'CLM-GC001-RYU-LEFT',
      ['F-GC001-DOOR-OPEN-NOT-PASSAGE'])
    expect(claimStateOf(s, 'CLM-GC001-RYU-LEFT')).toBe('QUESTIONABLE')
    expect(s.claims['CLM-GC001-RYU-LEFT']!.because).toContain('F-GC001-DOOR-OPEN-NOT-PASSAGE')
  })

  it('듣지 않은 진술은 흔들리지도 않는다 — 안 들은 말이 의심될 수는 없다', () => {
    const s = question(createInquiry(), 'CLM-GC001-MUN-NO-MOVE', ['E3'])
    expect(claimStateOf(s, 'CLM-GC001-MUN-NO-MOVE')).toBeNull()
  })

  it('QUESTIONABLE → CHALLENGED 는 **플레이어의 행동**이다 (명세 §14)', () => {
    const heard = hear(createInquiry(), 'CLM-GC001-MUN-NO-MOVE')
    const shaky = question(heard, 'CLM-GC001-MUN-NO-MOVE', ['E3'])
    // 같은 근거를 몇 번 더 봐도 스스로 추궁이 되지는 않는다
    const again = question(question(shaky, 'CLM-GC001-MUN-NO-MOVE', ['E3']), 'CLM-GC001-MUN-NO-MOVE', ['E3'])
    expect(claimStateOf(again, 'CLM-GC001-MUN-NO-MOVE')).toBe('QUESTIONABLE')
    expect(claimStateOf(challenge(again, 'CLM-GC001-MUN-NO-MOVE'), 'CLM-GC001-MUN-NO-MOVE'))
      .toBe('CHALLENGED')
  })

  it('상태는 뒤로 가지 않는다 — 추궁한 뒤의 QUESTIONABLE 은 무시된다', () => {
    const s = question(challenge(hear(createInquiry(), 'CLM-GC001-GIM-BLOCKED'), 'CLM-GC001-GIM-BLOCKED'),
      'CLM-GC001-GIM-BLOCKED', ['E8'])
    expect(claimStateOf(s, 'CLM-GC001-GIM-BLOCKED')).toBe('CHALLENGED')
  })
})

describe('말이 바뀌어도 원래 진술은 남는다 (명세 §15·§18)', () => {
  it('원본은 DISPROVED, 수정 진술은 REVISED 로 **둘 다** 있다', () => {
    const heard = hear(createInquiry(), 'CLM-GC001-MUN-NO-MOVE')
    const r = revise(challenge(heard, 'CLM-GC001-MUN-NO-MOVE'), 'CLM-GC001-MUN-NO-MOVE', 'CLM-GC001-MUN-MOVED')
    expect(r.revised).toBe('CLM-GC001-MUN-MOVED')
    expect(claimStateOf(r.state, 'CLM-GC001-MUN-NO-MOVE')).toBe('DISPROVED')
    expect(claimStateOf(r.state, 'CLM-GC001-MUN-MOVED')).toBe('REVISED')
    // 수사일지가 둘을 나란히 보여줄 수 있어야 한다
    expect(Object.keys(r.state.claims)).toContain('CLM-GC001-MUN-NO-MOVE')
    expect(Object.keys(r.state.claims)).toContain('CLM-GC001-MUN-MOVED')
  })

  it('두 진술은 서로를 근거로 가리킨다 — 무엇이 무엇으로 바뀌었는지 읽을 수 있다', () => {
    const r = revise(hear(createInquiry(), 'CLM-GC001-GIM-BLOCKED'),
      'CLM-GC001-GIM-BLOCKED', 'CLM-GC001-GIM-MISSED-FRAME')
    expect(r.state.claims['CLM-GC001-GIM-BLOCKED']!.because).toContain('CLM-GC001-GIM-MISSED-FRAME')
    expect(r.state.claims['CLM-GC001-GIM-MISSED-FRAME']!.because).toContain('CLM-GC001-GIM-BLOCKED')
  })

  it('듣지 않은 진술은 고쳐지지 않는다', () => {
    const r = revise(createInquiry(), 'CLM-GC001-BAE-CATALOG', 'CLM-GC001-BAE-CALL')
    expect(r.revised).toBeNull()
    expect(claimStateOf(r.state, 'CLM-GC001-BAE-CALL')).toBeNull()
  })

  it('객관 정보와 일치하면 CONFIRMED — 수정 없이도 종착점이다', () => {
    const s = confirm(hear(createInquiry(), 'CLM-GC001-MUN-LOADING'), 'CLM-GC001-MUN-LOADING',
      ['F-GC001-MUN-AT-LOADING-2118'])
    expect(claimStateOf(s, 'CLM-GC001-MUN-LOADING')).toBe('CONFIRMED')
  })

  it('수정 진술 없이 DISPROVED 도 가능하다', () => {
    const s = disprove(hear(createInquiry(), 'CLM-GC001-RYU-NO-LABEL'), 'CLM-GC001-RYU-NO-LABEL', ['E9'])
    expect(claimStateOf(s, 'CLM-GC001-RYU-NO-LABEL')).toBe('DISPROVED')
  })
})

describe('조사 상태 — 손에 든 것과 다음 질문거리', () => {
  it('heldClueIds 는 발견한 기록·들은 진술·확인한 사실을 한 목록으로 준다', () => {
    let s = createInquiry()
    s = discover(s, 'E3')
    s = hear(s, 'CLM-GC001-MUN-NO-MOVE')
    s = learnFact(s, 'F-GC001-MAIN-LOADING-TRAVEL-TIME')
    const held = heldClueIds(s)
    expect(held).toEqual(expect.arrayContaining(['E3', 'CLM-GC001-MUN-NO-MOVE', 'F-GC001-MAIN-LOADING-TRAVEL-TIME']))
    // 아직 발견하지 않은 기록은 손에 없다
    expect(held).not.toContain('E9')
  })

  it('shakyClaims 가 다음 질문거리를 준다 — 흔들리는 것과 추궁 중인 것', () => {
    let s = hear(createInquiry(), 'CLM-GC001-RYU-LEFT')
    s = hear(s, 'CLM-GC001-MUN-LOADING')
    s = question(s, 'CLM-GC001-RYU-LEFT', ['F-GC001-DOOR-OPEN-NOT-PASSAGE'])
    expect(shakyClaims(s)).toEqual(['CLM-GC001-RYU-LEFT'])
  })

  it('링크는 순서와 무관하고 중복되지 않는다', () => {
    const s = link(link(createInquiry(), 'E8', 'E9'), 'E9', 'E8')
    expect(s.links).toHaveLength(1)
  })

  it('의심 인물은 언제든 바뀌고, 아무 자원도 쓰지 않는다 (명세 §22)', () => {
    const a = setSuspect(createInquiry(), 'S3')
    const b = setSuspect(a, 'S1')
    const c = setSuspect(b, null)
    expect([a.suspect, b.suspect, c.suspect]).toEqual(['S3', 'S1', null])
  })

  it('가설은 같은 id 면 덮어쓴다 — 강화·수정이 새 항목을 만들지 않는다', () => {
    const h = {
      id: 'HYP-GC001-RYU-STAYED', subjectId: 'S1' as const,
      proposition: '류나린은 21:04 실제로 퇴장하지 않았을 수 있다.',
      supportClueIds: ['CLM-GC001-RYU-LEFT'], counterClueIds: [], proofPropositionIds: [],
      status: 'DRAFT' as const,
    }
    const s = upsertHypothesis(upsertHypothesis(createInquiry(), h),
      { ...h, status: 'SUPPORTED', supportClueIds: [...h.supportClueIds, 'F-GC001-DOOR-OPEN-NOT-PASSAGE'] })
    expect(s.hypotheses).toHaveLength(1)
    expect(s.hypotheses[0]!.status).toBe('SUPPORTED')
  })
})

describe('GC-001 조사 데이터 — 정본과 어긋나지 않는다', () => {
  it('명세 §23 이 요구한 두 Fact 가 있다 — 없으면 Proof Path B 가 성립하지 않는다', () => {
    expect(gc001Fact('F-GC001-REVISION-OPERATOR-SCOPE')).toBeDefined()
    expect(gc001Fact('F-GC001-MAIN-LOADING-TRAVEL-TIME')).toBeDefined()
  })

  it('id 는 전부 고유하다', () => {
    const ids = [...GC001_FACTS.map((f) => f.id), ...GC001_CLAIMS.map((c) => c.id)]
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('다섯 명 모두 초기 공개 진술을 갖는다 — 아무도 처음부터 침묵하지 않는다', () => {
    for (const s of SUSPECTS) expect(gc001OpeningClaims(s).length).toBeGreaterThan(0)
  })

  it('수정 진술은 반드시 원본을 가리키고, 원본도 그 수정 진술을 가리킨다', () => {
    for (const c of GC001_CLAIMS) {
      if (!c.revises) continue
      const origin = gc001Claim(c.revises)
      expect(origin, `${c.id} 의 원본 ${c.revises}`).toBeDefined()
      expect(origin!.revisedTo).toBe(c.id)
      // 같은 사람이 자기 말을 고친다
      expect(origin!.speaker).toBe(c.speaker)
    }
  })

  it('revisedTo 가 가리키는 진술은 실제로 존재한다', () => {
    for (const c of GC001_CLAIMS) {
      if (!c.revisedTo) continue
      expect(gc001Claim(c.revisedTo), `${c.id} → ${c.revisedTo}`).toBeDefined()
    }
  })

  it('tension 이 가리키는 Clue 는 Fact 이거나 기록(E*)이다 — 없는 것을 가리키지 않는다', () => {
    for (const c of GC001_CLAIMS) {
      for (const t of c.tension ?? []) {
        const ok = /^E\d+$/.test(t) || !!gc001Fact(t)
        expect(ok, `${c.id} 의 tension ${t}`).toBe(true)
      }
    }
  })

  it('여덟 개의 Investigation Question 은 전부 존재하는 Clue 로 답된다', () => {
    expect(GC001_INVESTIGATION_QUESTIONS).toHaveLength(8)
    for (const q of GC001_INVESTIGATION_QUESTIONS) {
      expect(q.answeredBy.length).toBeGreaterThan(0)
      for (const id of q.answeredBy) {
        const ok = /^E\d+$/.test(id) || !!gc001Fact(id) || !!gc001Claim(id)
        expect(ok, `${q.id} 의 근거 ${id}`).toBe(true)
      }
    }
  })

  /** 정본 §4 — 수단·신체·유혈 어휘 금지. 진술문·사실문에도 같은 규칙이 걸린다 */
  it('금칙어가 없다 — 수단·신체·유혈 어휘', () => {
    const banned = ['칼', '흉기', '피가', '혈흔', '목을', '찔', '둔기', '망치', '독극물', '시신', '사체']
    const text = [...GC001_FACTS.map((f) => `${f.text} ${f.source}`), ...GC001_CLAIMS.map((c) => c.text)].join('\n')
    for (const w of banned) expect(text, `금칙어: ${w}`).not.toContain(w)
  })
})

describe('W7 · 플레이어 가설과 연결 편집', () => {
  it('연결을 추가하고 어느 방향에서든 끊을 수 있다', async () => {
    const { link, unlink } = await import('../src/engine/inquiry')
    const linked = link(createInquiry(), 'A', 'B')
    expect(linked.links).toEqual([['A', 'B']])
    expect(unlink(linked, 'B', 'A').links).toEqual([])
  })

  it('가설 삭제는 단서와 연결을 지우지 않는다', async () => {
    const { link, removeHypothesis, upsertHypothesis } = await import('../src/engine/inquiry')
    let s = link(createInquiry(), 'A', 'B')
    s = upsertHypothesis(s, { id: 'H-1', proposition: '가설', supportClueIds: ['A'], counterClueIds: [], proofPropositionIds: [], status: 'DRAFT' })
    s = removeHypothesis(s, 'H-1')
    expect(s.hypotheses).toEqual([])
    expect(s.links).toEqual([['A', 'B']])
  })
})
