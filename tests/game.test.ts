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
    expect(g2.investigationsLeft).toBe(INVESTIGATION_BUDGET - 1)
    expect(g2.cards).toContain(ev.id)
    expect(g.investigationsLeft).toBe(INVESTIGATION_BUDGET) // 원본 불변
  })

  it('심문은 조사 1회를 소모하고 그 인물의 진술 궤적을 연다', () => {
    const g = fresh()
    const s = SUSPECTS.find((x) => !g.case.suspects[x].isCulprit)!
    const g2 = interview(g, s)
    expect(g2.investigationsLeft).toBe(INVESTIGATION_BUDGET - 1)
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
  it('★ 결정적 증거는 범인 혼자로 열리지 않는다 — 목격자 증언이 반드시 낀다 (ADR 008)', () => {
    for (const seed of [5002, 5030, 5031, 5032]) {
      const g0 = fresh(seed)
      const decisive = g0.case.evidence.find((e) => e.decisive)!
      const witnessReqs = decisive.requires.filter((r) => r !== 'T-SLIP')
      // 결정적 증거의 선행 조건에 **범인의 자백(T-SLIP) 외의 증언**이 최소 1개 있거나,
      // 앵커 물증 자체가 목격자 증언 뒤에 잠겨 있어야 한다
      const anchor = g0.case.evidence.find((e) => e.id === g0.case.presentUnlocks[0]!.evidenceId)!
      expect(witnessReqs.length + anchor.requires.length, `seed ${seed}`).toBeGreaterThan(0)
    }
  })

  it('선행 조건을 모두 채우면 결정적 증거가 열린다', () => {
    const g0 = fresh(5002)
    const unlock = g0.case.presentUnlocks[0]!
    const anchor = g0.case.evidence.find((e) => e.id === unlock.evidenceId)!
    const decisive = g0.case.evidence.find((e) => e.decisive)!

    let g = g0
    const need = (id: string) => {
      const owner = SUSPECTS.find((s) => g.case.suspects[s].testimonies.includes(id))
      if (owner && !g.cards.includes(id)) g = interview(g, owner)
    }
    for (const req of anchor.requires) need(req)
    g = lookupEvidence(g, anchor.id)
    expect(availableEvidence(g).map((e) => e.id)).not.toContain(decisive.id)

    g = presentEvidence(g, anchor.id, unlock.suspectId)
    expect(g.cards).toContain(unlock.yieldsTestimonyId)
    for (const req of decisive.requires) need(req)
    expect(availableEvidence(g).map((e) => e.id)).toContain(decisive.id)
  })

  it('★ 해금 관계가 없어도 제시할 수 있다 — 막으면 버튼 활성화가 정답을 유출한다', () => {
    let g = fresh(5003)
    const ev = availableEvidence(g)[0]!
    g = lookupEvidence(g, ev.id)
    const notCulprit = SUSPECTS.find((s) => !g.case.presentUnlocks.some((u) => u.suspectId === s))!
    const after = presentEvidence(g, ev.id, notCulprit)   // 던지지 않는다
    expect(after.investigationsLeft).toBe(g.investigationsLeft - 1)   // 예산은 소모된다
    expect(after.cards.length).toBe(g.cards.length)                  // 얻는 것은 없다
    expect(after.pressure[notCulprit]).toBeGreaterThan(g.pressure[notCulprit])
  })

  it('보유하지 않은 증거는 제시할 수 없다', () => {
    const g = fresh(5003)
    expect(() => presentEvidence(g, 'E-없음', 'S1')).toThrow()
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
    // 수단 20점은 **결정적 증거 카드를 쥔 사람만** 받는다 (ADR 014).
    // 만점 제출은 그 카드를 확보한 플레이어를 뜻하므로, 여기서도 손에 쥐여 준다.
    const base = fresh(5008)
    const g = { ...base, cards: [...base.cards, base.case.decisiveEvidenceId] }
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
    // 조사 0회 시점이므로 기록으로 좁혀진 게 없다 → 찍어서 맞힌 것이다
    expect(r.candidatesLeft).toBeGreaterThan(1)
    expect(r.breakdown.culprit).toBe(40)
    expect(r.breakdown.method).toBe(0)
    expect(r.breakdown.decisive).toBe(0)
    expect(r.total).toBeLessThan(100 + INVESTIGATION_BUDGET * 5)
  })

  /**
   * ★ 찍어 맞힌 것과 좁혀서 맞힌 것은 점수가 다르다.
   * 수단에는 "근거 없이 맞히면 0점" 을 적용해 놓고 범인에는 적용하지 않아
   * 스스로와 모순이었다 (자동 리뷰가 세 판 연속 지적).
   */
  it('★ 기록으로 한 사람까지 좁혀야 범인 60점이다', () => {
    const base = fresh(5008)
    const guessed = submit(base, {
      culprit: base.case.culprit, method: '틀린 수단', decisiveEvidenceId: 'E-없음',
    })
    expect(guessed.breakdown.culprit).toBe(40)

    // 결정적 증거는 범행 시각 현장에 범인을 못박는다 → 후보가 1명으로 확정된다
    const narrowed = submit(
      { ...base, cards: [...base.cards, base.case.decisiveEvidenceId] },
      { culprit: base.case.culprit, method: '틀린 수단', decisiveEvidenceId: 'E-없음' },
    )
    expect(narrowed.candidatesLeft).toBe(1)
    expect(narrowed.breakdown.culprit).toBe(60)
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

describe('한국어 조사 (UX 폴리시)', () => {
  it('받침 유무로 조사를 고른다', async () => {
    const { josa } = await import('../src/ui/josa')
    expect(josa('남기훈', '이/가')).toBe('남기훈이')   // ㄴ 받침
    expect(josa('고은채', '이/가')).toBe('고은채가')   // 받침 없음
    expect(josa('정민호', '은/는')).toBe('정민호는')
    expect(josa('한도윤', '을/를')).toBe('한도윤을')
  })
})

describe('부재 모순 — "그 구역 기록에 저 사람이 없다" (플레이 테스트 지적)', () => {
  it('CCTV(구역 촬영)에 없는데 그 장소를 주장하면 모순이다', () => {
    let g = fresh(6001)
    const cctv = g.case.evidence.find(
      (e) => e.exhaustive && e.slot === CRIME_SLOT && !e.subjects.includes(g.case.culprit),
    )
    if (!cctv) return
    const liar = SUSPECTS.find(
      (s) => !cctv.subjects.includes(s) && g.case.suspects[s].claim[CRIME_SLOT] === cctv.place,
    )
    if (!liar) return
    g = { ...g, cards: [...g.cards, cctv.id] }
    const r = connect(g, cctv.id, claimCardId(liar, CRIME_SLOT))
    expect(r.contradiction).toBe(true)
    expect(r.message).toContain('구역 기록에 이 사람이 없다')
  })

  it('영수증·카드키에 없는 것은 모순이 아니다 — 결제/출입을 안 했을 뿐일 수 있다', () => {
    let g = fresh(6002)
    const receipt = g.case.evidence.find((e) => !e.exhaustive && !e.decisive)
    if (!receipt) return
    const other = SUSPECTS.find((s) => !receipt.subjects.includes(s))!
    g = { ...g, cards: [...g.cards, receipt.id], case: {
      ...g.case,
      suspects: { ...g.case.suspects, [other]: {
        ...g.case.suspects[other],
        claim: g.case.suspects[other].claim.map((_, i) => i === receipt.slot ? receipt.place : g.case.suspects[other].claim[i]!),
      } },
    } }
    g = { ...g, cards: [...g.cards, claimCardId(other, receipt.slot)] }
    const r = connect(g, receipt.id, claimCardId(other, receipt.slot))
    expect(r.contradiction).toBe(false)
    expect(r.message).toContain('반박할 수 없다')
  })

  it('범행 시각 알리바이 기록은 전부 구역 촬영이다 (부재 추리가 성립하도록)', () => {
    for (const seed of [6010, 6011, 6012]) {
      const c = generateValidCase(seed).case
      for (const e of c.evidence.filter((x) => x.slot === CRIME_SLOT && !x.decisive)) {
        expect(e.exhaustive, `${seed}/${e.id}`).toBe(true)
      }
    }
  })

  it('잡음이 한 인물에게 몰리지 않는다 (인물당 최대 1건)', () => {
    for (const seed of [6020, 6021, 6022, 6023]) {
      const c = generateValidCase(seed).case
      const noise = c.evidence.filter((e) => e.slot !== CRIME_SLOT && !e.decisive && e.requires.length === 0 && !e.exhaustive)
      const per = new Map<string, number>()
      for (const e of noise) for (const s of e.subjects) per.set(s, (per.get(s) ?? 0) + 1)
      for (const [, n] of per) expect(n).toBeLessThanOrEqual(1)
    }
  })
})
