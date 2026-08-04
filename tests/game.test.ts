import { describe, it, expect } from 'vitest'
import { generateValidCase } from '../src/engine/validate'
import {
  createGame,
  lookupEvidence,
  interview,
  presentEvidence,
  connect,
  submit,
  claimCardId,
  availableEvidence,
  type GameState,
} from '../src/engine/game'
import { INVESTIGATION_BUDGET } from '../src/data/config'
import { CRIME_SLOT, SUSPECTS } from '../src/types'

const fresh = (seed = 5001): GameState => createGame(generateValidCase(seed).case)

describe('조사 예산 (Task 6 — 완료기준 B1·B2)', () => {
  it('시작 시 조사 횟수는 6이다', () => {
    expect(fresh().investigationsLeft).toBe(INVESTIGATION_BUDGET)
  })

  it('기본 진술 카드는 시작부터 5장 보유한다 (무료 정보)', () => {
    const g = fresh()
    for (const s of SUSPECTS) expect(g.cards).toContain(claimCardId(s, CRIME_SLOT))
  })

  it('기록 조회는 조사 1회를 소모하고 카드를 준다', () => {
    const g = fresh()
    const ev = availableEvidence(g)[0]!
    const g2 = lookupEvidence(g, ev.id)
    expect(g2.investigationsLeft).toBe(5)
    expect(g2.cards).toContain(ev.id)
    expect(g.investigationsLeft).toBe(6) // 원본 불변
  })

  it('심문은 조사 1회를 소모하고 그 인물의 진술 궤적을 연다', () => {
    const g = fresh()
    const s = SUSPECTS.find((x) => !g.case.suspects[x].isCulprit)!
    const g2 = interview(g, s)
    expect(g2.investigationsLeft).toBe(5)
    expect(g2.cards.filter((c) => c.startsWith(`C:${s}:`)).length).toBe(5)
  })

  it('선행 조건이 안 열린 증거는 조회 목록에 안 나온다', () => {
    const g = fresh()
    const locked = g.case.evidence.filter((e) => e.requires.length > 0)
    const ids = availableEvidence(g).map((e) => e.id)
    for (const e of locked) expect(ids).not.toContain(e.id)
  })

  it('예산을 다 쓰면 더 이상 조사할 수 없다 (B1)', () => {
    let g = fresh()
    for (let i = 0; i < INVESTIGATION_BUDGET; i++) {
      const ev = availableEvidence(g)[0]
      g = ev ? lookupEvidence(g, ev.id) : interview(g, SUSPECTS[i % 5]!)
    }
    expect(g.investigationsLeft).toBe(0)
    expect(g.phase).toBe('submit')
    expect(() => lookupEvidence(g, g.case.evidence[0]!.id)).toThrow()
    expect(() => interview(g, 'S1')).toThrow()
  })

  it('카드 연결은 조사 횟수를 소모하지 않는다 (B2)', () => {
    let g = fresh()
    const ids = g.cards
    for (let i = 0; i < 100; i++) {
      g = connect(g, ids[i % ids.length]!, ids[(i + 1) % ids.length]!).state
    }
    expect(g.investigationsLeft).toBe(INVESTIGATION_BUDGET)
  })

  it('같은 증거를 두 번 조회해도 예산이 두 번 깎이지 않는다', () => {
    const g = fresh()
    const ev = availableEvidence(g)[0]!
    const g2 = lookupEvidence(g, ev.id)
    expect(() => lookupEvidence(g2, ev.id)).toThrow()
  })
})

describe('해금 사슬 (Task 6)', () => {
  it('증거 제시로 자백성 진술이 열리고 결정적 증거 조회가 가능해진다', () => {
    const g0 = fresh(5002)
    const unlock = g0.case.presentUnlocks[0]!
    const anchor = g0.case.evidence.find((e) => e.id === unlock.evidenceId)!
    // 앵커에 선행 조건이 있으면 먼저 푼다
    let g = g0
    for (const req of anchor.requires) {
      const owner = SUSPECTS.find((s) => g.case.suspects[s].testimonies.includes(req))!
      g = interview(g, owner)
    }
    g = lookupEvidence(g, anchor.id)
    expect(availableEvidence(g).map((e) => e.id)).not.toContain(g.case.decisiveEvidenceId)

    g = presentEvidence(g, anchor.id, unlock.suspectId)
    expect(g.cards).toContain(unlock.yieldsTestimonyId)
    expect(availableEvidence(g).map((e) => e.id)).toContain(g.case.decisiveEvidenceId)
  })

  it('해금 관계가 아닌 증거를 제시하면 거부된다 (예산 낭비 방지)', () => {
    const g = fresh(5003)
    const ev = availableEvidence(g)[0]!
    const wrong = SUSPECTS.find((s) => !g.case.presentUnlocks.some((u) => u.suspectId === s))
    if (wrong) expect(() => presentEvidence(g, ev.id, wrong)).toThrow()
  })
})

describe('모순 판정 (Task 7 — 완료기준 B3)', () => {
  it('물증과 어긋나는 진술을 연결하면 모순이 잡힌다', () => {
    let g = fresh(5004)
    // 범인의 범행시각 진술 카드는 시작부터 보유. 결정적 증거를 손에 넣어 충돌시킨다.
    g = { ...g, cards: [...g.cards, g.case.decisiveEvidenceId] }
    const r = connect(g, g.case.decisiveEvidenceId, claimCardId(g.case.culprit, CRIME_SLOT))
    expect(r.contradiction).toBe(true)
    expect(r.state.foundContradictions.length).toBe(1)
  })

  it('진술과 일치하는 물증을 연결하면 모순이 아니다', () => {
    let g = fresh(5005)
    const innocent = SUSPECTS.find((s) => s !== g.case.culprit)!
    const ev = g.case.evidence.find(
      (e) => e.subjects.includes(innocent) && e.slot === CRIME_SLOT,
    )!
    g = interview(g, innocent)                       // 진술 궤적 확보
    g = { ...g, cards: [...g.cards, ev.id] }
    const truthful = g.case.suspects[innocent].claim[CRIME_SLOT] === ev.place
    const r = connect(g, ev.id, claimCardId(innocent, CRIME_SLOT))
    expect(r.contradiction).toBe(!truthful)
  })

  it('같은 모순을 두 번 연결해도 한 번만 집계된다', () => {
    let g = fresh(5006)
    g = { ...g, cards: [...g.cards, g.case.decisiveEvidenceId] }
    const a = g.case.decisiveEvidenceId
    const b = claimCardId(g.case.culprit, CRIME_SLOT)
    g = connect(g, a, b).state
    g = connect(g, b, a).state // 순서를 바꿔도 같은 모순
    expect(g.foundContradictions.length).toBe(1)
  })

  it('보유하지 않은 카드는 연결할 수 없다', () => {
    const g = fresh(5007)
    expect(() => connect(g, 'E-없음', claimCardId('S1', CRIME_SLOT))).toThrow()
  })
})

describe('최종 채점 (Task 7 — 완료기준 B4·B5)', () => {
  it('전부 정답이면 만점 구성이다 (B4)', () => {
    const g = fresh(5008)
    const r = submit(g, {
      culprit: g.case.culprit,
      method: g.case.method,
      decisiveEvidenceId: g.case.decisiveEvidenceId,
    })
    expect(r.correct.culprit).toBe(true)
    expect(r.correct.method).toBe(true)
    expect(r.correct.decisive).toBe(true)
    expect(r.breakdown.culprit).toBe(60)
    expect(r.breakdown.method).toBe(20)
    expect(r.breakdown.decisive).toBe(20)
  })

  it('범인만 맞히면 부분 점수다 (B4)', () => {
    const g = fresh(5009)
    const r = submit(g, { culprit: g.case.culprit, method: '틀린 수단', decisiveEvidenceId: 'E-없음' })
    expect(r.breakdown.culprit).toBe(60)
    expect(r.breakdown.method).toBe(0)
    expect(r.breakdown.decisive).toBe(0)
    expect(r.total).toBeLessThan(100 + INVESTIGATION_BUDGET * 5)
  })

  it('남은 조사 1회당 +5점이 반영된다 (B5)', () => {
    const g = fresh(5010)
    const full = submit(g, { culprit: g.case.culprit, method: g.case.method, decisiveEvidenceId: g.case.decisiveEvidenceId })
    const spent = submit(lookupEvidence(g, availableEvidence(g)[0]!.id), {
      culprit: g.case.culprit, method: g.case.method, decisiveEvidenceId: g.case.decisiveEvidenceId,
    })
    expect(full.breakdown.efficiency).toBe(INVESTIGATION_BUDGET * 5)
    expect(full.total - spent.total).toBe(5)
  })

  it('제출 후에는 상태가 결과 단계로 잠긴다', () => {
    const g = fresh(5011)
    const r = submit(g, { culprit: 'S1', method: 'x', decisiveEvidenceId: 'y' })
    expect(r.state.phase).toBe('result')
    expect(() => submit(r.state, { culprit: 'S2', method: 'x', decisiveEvidenceId: 'y' })).toThrow()
  })

  it('정답 제출이면 실제 범인과 일치한다 — 사건 진실과 채점이 어긋나지 않는다', () => {
    for (const seed of [5020, 5021, 5022]) {
      const g = fresh(seed)
      for (const s of SUSPECTS) {
        const r = submit(g, { culprit: s, method: g.case.method, decisiveEvidenceId: g.case.decisiveEvidenceId })
        expect(r.correct.culprit).toBe(s === g.case.culprit)
      }
    }
  })
})
