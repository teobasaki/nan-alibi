import { describe, it, expect } from 'vitest'
import { generateValidCase } from '../src/engine/validate'
import { claimCardId, connect, createGame, interview, lookupEvidence } from '../src/engine/game'
import { placeMatrix, pendingPairs } from '../src/engine/crossref'
import { CRIME_SLOT, PLACES, SLOTS, SUSPECTS, type SuspectId } from '../src/types'

const CASE = generateValidCase(4242).case

describe('교차 대조 — 장소 × 시각 (QA 5.4)', () => {
  /** 시작 상태는 "범행 시각 진술만 무료" 다 (`createGame`). 표도 딱 그만큼만 채워져야 한다. */
  it('시작 상태에서는 범행 시각 열만 차 있고 기록은 하나도 없다', () => {
    const m = placeMatrix(createGame(CASE))
    let crimeCol = 0
    for (const p of PLACES) {
      for (const t of SLOTS) {
        const cell = m[p]![t]!
        expect(cell.pinned).toHaveLength(0)
        expect(cell.records).toHaveLength(0)
        if (t === CRIME_SLOT) crimeCol += cell.claimants.length
        else expect(cell.claimants).toHaveLength(0)
      }
    }
    expect(crimeCol).toBe(SUSPECTS.length)
  })

  it('표 크기는 장소 × 시각이다', () => {
    const m = placeMatrix(createGame(CASE))
    expect(m).toHaveLength(PLACES.length)
    for (const row of m) expect(row).toHaveLength(SLOTS.length)
  })

  it('심문하지 않은 사람의 범행 시각 밖 궤적은 안 보인다 — 표가 정보를 앞질러 가면 안 된다', () => {
    const m = placeMatrix(interview(createGame(CASE), 'S1'))
    const shown = new Set<SuspectId>()
    for (const p of PLACES) {
      for (const t of SLOTS) {
        if (t === CRIME_SLOT) continue      // 이 열은 원래 무료 공개다
        for (const s of m[p]![t]!.claimants) shown.add(s)
      }
    }
    expect([...shown]).toEqual(['S1'])
  })

  it('심문한 사람은 시각마다 정확히 한 칸에만 나온다 — 한 사람은 한 곳에만 있다', () => {
    const g = interview(createGame(CASE), 'S3')
    const m = placeMatrix(g)
    for (const t of SLOTS) {
      const hits = PLACES.filter((p) => m[p]![t]!.claimants.includes('S3'))
      expect(hits).toHaveLength(1)
      expect(hits[0]).toBe(CASE.suspects.S3.claim[t])
    }
  })

  it('기록을 조회하면 그 칸이 확정 인물로 채워진다', () => {
    const ev = CASE.evidence.find((e) => e.requires.length === 0)!
    const g = lookupEvidence(createGame(CASE), ev.id)
    const cell = placeMatrix(g)[ev.place]![ev.slot]!
    expect(cell.records).toContain(ev.id)
    expect(cell.pinned.sort()).toEqual([...ev.subjects].sort())
    expect(cell.exhaustive).toBe(ev.exhaustive)
  })

  /**
   * 이 표의 존재 이유. 거짓말한 사람은 **한 세로줄에 두 번** 나온다 —
   * 본인이 말한 자리에 한 번(진술), 기록이 찍어놓은 자리에 한 번(확정).
   * 시스템이 판정하지 않아도 눈이 본다.
   */
  it('진술과 기록이 어긋나면 같은 세로줄에 이름이 두 번 나온다', () => {
    const liar = SUSPECTS.find((s) => CASE.suspects[s].lieSlots.length > 0)!
    const slot = CASE.suspects[liar].lieSlots[0]!
    const ev = CASE.evidence.find((e) => e.slot === slot && e.subjects.includes(liar))
    if (!ev) return                       // 그 거짓말을 덮는 기록이 없는 시드면 검사할 것이 없다

    let g = interview(createGame(CASE), liar)
    g = lookupEvidence(g, ev.id)
    const m = placeMatrix(g)
    const appearances = PLACES.filter(
      (p) => m[p]![slot]!.claimants.includes(liar) || m[p]![slot]!.pinned.includes(liar),
    )
    expect(appearances.length).toBe(2)
  })
})

describe('미대조 조합 — 판정이 아니라 장부다', () => {
  it('한쪽만 있으면 조합이 생기지 않는다', () => {
    const ev = CASE.evidence.find((e) => e.requires.length === 0)!
    expect(pendingPairs(lookupEvidence(createGame(CASE), ev.id))).toHaveLength(0)
    expect(pendingPairs(interview(createGame(CASE), 'S1'))).toHaveLength(0)
  })

  it('같은 시각의 기록과 진술을 둘 다 쥐면 조합이 뜬다', () => {
    const ev = CASE.evidence.find((e) => e.requires.length === 0)!
    let g = lookupEvidence(createGame(CASE), ev.id)
    g = interview(g, 'S2')
    const pend = pendingPairs(g)
    expect(pend).toEqual([
      { evidenceId: ev.id, claimCardId: claimCardId('S2', ev.slot), suspect: 'S2', slot: ev.slot },
    ])
  })

  it('맞춰본 조합은 목록에서 사라진다 — 모순이 아니었어도 사라진다', () => {
    const ev = CASE.evidence.find((e) => e.requires.length === 0)!
    let g = lookupEvidence(createGame(CASE), ev.id)
    g = interview(g, 'S2')
    const cid = claimCardId('S2', ev.slot)
    g = connect(g, ev.id, cid).state
    expect(pendingPairs(g)).toHaveLength(0)
  })

  it('범행 시각 조합이 맨 위에 온다 — 사람을 지우는 것은 그 시각뿐이다', () => {
    // 조사 예산(9회)으로는 전수 조사가 안 된다. 이 검사의 관심사는 예산이 아니므로 넉넉히 준다.
    let g = createGame(CASE, 99)
    for (const e of CASE.evidence.filter((x) => x.requires.length === 0)) g = lookupEvidence(g, e.id)
    for (const s of SUSPECTS) g = interview(g, s)
    const pend = pendingPairs(g)
    const firstOther = pend.findIndex((p) => p.slot !== CRIME_SLOT)
    const lastCrime = pend.map((p) => p.slot).lastIndexOf(CRIME_SLOT)
    if (firstOther >= 0 && lastCrime >= 0) expect(lastCrime).toBeLessThan(firstOther)
  })

  it('조합은 실제로 연결 가능한 카드만 가리킨다', () => {
    // 조사 예산(9회)으로는 전수 조사가 안 된다. 이 검사의 관심사는 예산이 아니므로 넉넉히 준다.
    let g = createGame(CASE, 99)
    for (const e of CASE.evidence.filter((x) => x.requires.length === 0)) g = lookupEvidence(g, e.id)
    for (const s of SUSPECTS) g = interview(g, s)
    for (const p of pendingPairs(g)) {
      expect(g.cards).toContain(p.evidenceId)
      expect(g.cards).toContain(p.claimCardId)
      expect(() => connect(g, p.evidenceId, p.claimCardId)).not.toThrow()
    }
  })
})
