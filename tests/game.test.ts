import { describe, it, expect } from 'vitest'
import { generateValidCase } from '../src/engine/validate'
import {
  createGame,
  fieldDone,
  lookupEvidence,
  interview,
  presentEvidence,
  presentReveal,
  connect,
  submit,
  claimCardId,
  availableEvidence,
  talksLeft,
  type GameState,
} from '../src/engine/game'
import { FIELD_BUDGET, TALK_CAP, WEAPONS, WEAPON_TRACE } from '../src/data/config'
import { CRIME_SLOT, SUSPECTS } from '../src/types'

const fresh = (seed = 5001): GameState => createGame(generateValidCase(seed).case)

/** 현장 챕터를 끝까지 민 상태 — 예산 소진 또는 조회할 기록 고갈 (fieldDone 의 두 조건) */
const fieldExhausted = (seed = 5001): GameState => {
  let g = fresh(seed)
  while (g.investigationsLeft > 0) {
    const ev = availableEvidence(g)[0]
    if (!ev) break   // 즉시 조회 가능한 기록이 4건뿐인 시드가 있다 — 그래도 챕터는 끝난다
    g = lookupEvidence(g, ev.id)
  }
  return g
}

describe('현장 조사 예산 (ADR 022 — 챕터 1장)', () => {
  it('시작 시 현장 조사 횟수는 FIELD_BUDGET(5)이다', () => {
    expect(fresh().investigationsLeft).toBe(FIELD_BUDGET)
  })

  it('기본 진술 카드는 시작부터 5장 보유한다 (무료 정보)', () => {
    const g = fresh()
    for (const s of SUSPECTS) expect(g.cards).toContain(claimCardId(s, CRIME_SLOT))
  })

  it('기록 조회는 현장 조사 1회를 소모하고 카드를 준다', () => {
    const g = fresh()
    const ev = availableEvidence(g)[0]!
    const g2 = lookupEvidence(g, ev.id)
    expect(g2.investigationsLeft).toBe(FIELD_BUDGET - 1)
    expect(g2.cards).toContain(ev.id)
    expect(g.investigationsLeft).toBe(FIELD_BUDGET) // 원본 불변
  })

  it('선행 조건이 안 열린 증거는 조회 목록에 안 나온다', () => {
    const g = fresh()
    const locked = g.case.evidence.filter((e) => e.requires.length > 0)
    const ids = availableEvidence(g).map((e) => e.id)
    for (const e of locked) expect(ids).not.toContain(e.id)
  })

  it('★ 현장 챕터를 끝까지 밀면 fieldDone 이다 (챕터 게이트 전이)', () => {
    const g = fieldExhausted()
    expect(fieldDone(g)).toBe(true)
    // phase 는 'investigate' 를 유지한다 — 챕터는 예산에서 파생되는 것이지 별도 상태가 아니다
    expect(g.phase).toBe('investigate')
    if (g.investigationsLeft <= 0) {
      const free = g.case.evidence.find((e) => !g.cards.includes(e.id) && e.requires.length === 0)
      if (free) expect(() => lookupEvidence(g, free.id)).toThrow()
    }
  })

  it('★ 조회할 기록이 바닥나면 예산이 남아도 챕터는 끝난다 — 게이트가 영영 안 열리는 시드 방지', () => {
    const base = fresh()
    // 즉시 조회 가능한 기록을 전부 손에 쥔 상태를 만든다 (예산은 그대로)
    const freeIds = base.case.evidence.filter((e) => e.requires.length === 0).map((e) => e.id)
    const g = { ...base, cards: [...base.cards, ...freeIds] }
    expect(g.investigationsLeft).toBeGreaterThan(0)
    expect(fieldDone(g)).toBe(true)
  })

  /**
   * ★ 통찰 보너스의 생존 조건. 잠긴 기록의 선행 조건(자백·증언)은 전부 심문 챕터에서
   * 모이는데, 심문 챕터는 정의상 현장 예산 0 에서 시작한다. 소진 후 해금 기록 조회가
   * 무료가 아니면 결정적 증거는 **구조적으로 영원히 못 연다.**
   */
  it('★ 예산 소진 후에도 해금 사슬로 열린 기록(requires>0)은 무료로 조회된다', () => {
    // 검사 대상이 "예산 0 에서의 무료 경로" 그 자체이므로 예산 0 을 강제한다
    let g: GameState = { ...fieldExhausted(5002), investigationsLeft: 0 }
    // 사슬을 끝까지 민다: 필요한 증언은 심문으로, 자백은 제시로 연다
    const unlock = g.case.presentUnlocks[0]!
    const anchor = g.case.evidence.find((e) => e.id === unlock.evidenceId)!
    const decisive = g.case.evidence.find((e) => e.decisive)!
    const need = (id: string) => {
      const owner = SUSPECTS.find((s) => g.case.suspects[s].testimonies.includes(id))
      if (owner && !g.cards.includes(id)) g = interview(g, owner)
    }
    for (const req of anchor.requires) need(req)
    if (!g.cards.includes(anchor.id)) {
      // 앵커가 잠겨 있던 사슬('gate')이면 여기서 무료 조회가 성립해야 한다
      if (anchor.requires.length > 0) {
        g = lookupEvidence(g, anchor.id)
        expect(g.investigationsLeft).toBe(0)   // 예산은 더 깎이지 않는다
      } else {
        // 앵커가 즉시 조회형('corrob'/'deep')인데 현장 챕터에서 놓쳤다면 다시 살 수 없다 —
        // 그건 의도된 손실이므로 이 시드에서는 검사를 접는다
        return
      }
    }
    g = presentEvidence(g, anchor.id, unlock.suspectId)
    for (const req of decisive.requires) need(req)
    expect(availableEvidence(g).map((e) => e.id)).toContain(decisive.id)
    g = lookupEvidence(g, decisive.id)
    expect(g.cards).toContain(decisive.id)
    expect(g.investigationsLeft).toBe(0)       // 무료 — 자물쇠를 여는 값은 대화로 이미 치렀다
  })

  it('카드 연결은 예산을 소모하지 않는다', () => {
    let g = fresh()
    const ids = g.cards
    for (let i = 0; i < 100; i++) {
      g = connect(g, ids[i % ids.length]!, ids[(i + 1) % ids.length]!).state
    }
    expect(g.investigationsLeft).toBe(FIELD_BUDGET)
  })

  it('같은 증거를 두 번 조회해도 예산이 두 번 깎이지 않는다', () => {
    const g = fresh()
    const ev = availableEvidence(g)[0]!
    const g2 = lookupEvidence(g, ev.id)
    expect(() => lookupEvidence(g2, ev.id)).toThrow()
  })
})

describe('대화 상한 (ADR 022 — 챕터 2장, 인당 TALK_CAP)', () => {
  it('심문은 현장 예산이 아니라 대화 횟수를 소모한다', () => {
    const g = fresh()
    const s = SUSPECTS.find((x) => !g.case.suspects[x].isCulprit)!
    const g2 = interview(g, s)
    expect(g2.investigationsLeft).toBe(FIELD_BUDGET)  // 현장 지갑은 그대로
    expect(g2.talks[s]).toBe(1)
    expect(talksLeft(g2, s)).toBe(TALK_CAP - 1)
    expect(g2.cards.filter((c) => c.startsWith(`C:${s}:`)).length).toBe(5)
    expect(g.talks[s]).toBe(0) // 원본 불변
  })

  it('증거 제시도 대화 1회를 소모한다', () => {
    let g = fresh(5003)
    const ev = availableEvidence(g)[0]!
    g = lookupEvidence(g, ev.id)
    const after = presentEvidence(g, ev.id, 'S1')
    expect(after.talks.S1).toBe(1)
    expect(after.investigationsLeft).toBe(g.investigationsLeft)
  })

  it('★ 대화 10회를 소진하면 그 사람과는 심문도 제시도 던진다 (상한)', () => {
    let g = fresh(5001)
    const s = 'S2'
    for (let i = 0; i < TALK_CAP; i++) g = interview(g, s)
    expect(g.talks[s]).toBe(TALK_CAP)
    expect(talksLeft(g, s)).toBe(0)
    expect(() => interview(g, s)).toThrow(/대화/)
    const ev = availableEvidence(g)[0]!
    g = lookupEvidence(g, ev.id)
    expect(() => presentEvidence(g, ev.id, s)).toThrow(/대화/)
  })

  it('★ 상한은 인당이다 — 한 사람을 소진해도 다른 사람과는 대화할 수 있다', () => {
    let g = fresh(5001)
    for (let i = 0; i < TALK_CAP; i++) g = interview(g, 'S3')
    expect(() => interview(g, 'S4')).not.toThrow()
  })

  it('현장 예산이 남아 있어도 엔진은 심문을 막지 않는다 — 게이트는 UI 의 것이다', () => {
    const g = fresh()
    expect(g.investigationsLeft).toBeGreaterThan(0)
    expect(() => interview(g, 'S1')).not.toThrow()
  })
})

describe('해금 사슬 (Task 6)', () => {
  it('★ 결정적 증거는 범인 혼자로 열리지 않는다 — 목격자 증언이 반드시 낀다 (ADR 008)', () => {
    for (const seed of [5002, 5030, 5031, 5032]) {
      const g0 = fresh(seed)
      const decisive = g0.case.evidence.find((e) => e.decisive)!
      const witnessReqs = decisive.requires.filter((r) => r !== 'T-SLIP')
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
    expect(after.talks[notCulprit]).toBe(g.talks[notCulprit] + 1)   // 대화는 소모된다
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

  it('검시 소견은 어떤 진술과도 모순이 성립하지 않는다 — 인물이 아니라 도구의 기록이다', () => {
    let g = fresh(5012)
    const autopsy = g.case.evidence.find((e) => e.kind === 'autopsy')!
    g = lookupEvidence(g, autopsy.id)
    for (const s of SUSPECTS) {
      const r = connect(g, autopsy.id, claimCardId(s, CRIME_SLOT))
      expect(r.contradiction, s).toBe(false)
      g = r.state
    }
  })
})

describe('최종 채점 — 3축: 범인·동기·도구 (ADR 022)', () => {
  it('★ 3축이 전부 정답이고 결정적 증거까지 열었으면 100점이다', () => {
    // 통찰 +10 은 결정적 증거 카드를 실제로 연 판의 보너스다. 현장 예산을 다 쓴
    // 정상 흐름(게이트 통과)에서는 efficiency 0 이므로 만점 구성은 60+15+15+10 = 100.
    // 예산 0 은 상태 수술로 만든다 — 시드에 따라 조회 가능한 기록이 5건 미만일 수 있어서다.
    const raw = fresh(5008)
    const base = { ...raw, investigationsLeft: 0 }
    const g = { ...base, cards: [...base.cards, base.case.decisiveEvidenceId] }
    const r = submit(g, {
      culprit: g.case.culprit,
      motive: g.case.motive,
      weapon: g.case.weapon,
    })
    expect(r.correct).toEqual({ culprit: true, motive: true, weapon: true })
    expect(r.breakdown.culprit).toBe(60)
    expect(r.breakdown.motive).toBe(15)
    expect(r.breakdown.weapon).toBe(15)
    expect(r.breakdown.insight).toBe(10)
    expect(r.breakdown.efficiency).toBe(0)
    expect(r.total).toBe(100)
  })

  it('범인만 맞히면 부분 점수다', () => {
    const g = { ...fresh(5009), investigationsLeft: 0 }
    const r = submit(g, { culprit: g.case.culprit, motive: '틀린 동기', weapon: '틀린 도구' })
    expect(r.breakdown.culprit).toBe(60)
    expect(r.breakdown.motive).toBe(0)
    expect(r.breakdown.weapon).toBe(0)
    expect(r.total).toBe(60)
  })

  it('동기·도구만 맞히면 범인 없이도 그 몫은 받는다 — 축이 독립이다', () => {
    const g = fresh(5013)
    const wrong = SUSPECTS.find((s) => s !== g.case.culprit)!
    const r = submit(g, { culprit: wrong, motive: g.case.motive, weapon: g.case.weapon })
    expect(r.breakdown.culprit).toBe(0)
    expect(r.breakdown.motive).toBe(15)
    expect(r.breakdown.weapon).toBe(15)
  })

  it('★ 통찰 보너스는 잠긴 카드키 기록(결정적 증거)을 연 사람만 받는다', () => {
    const base = fresh(5008)
    const without = submit(base, { culprit: base.case.culprit, motive: 'x', weapon: 'y' })
    expect(without.breakdown.insight).toBe(0)
    const withCard = submit(
      { ...base, cards: [...base.cards, base.case.decisiveEvidenceId] },
      { culprit: base.case.culprit, motive: 'x', weapon: 'y' },
    )
    expect(withCard.breakdown.insight).toBe(10)
  })

  it('남은 현장 조사 1회당 +2점이 반영된다 — 조사를 아끼고 확신으로 제출한 판의 웃돈', () => {
    const g = fresh(5010)
    const full = submit(g, { culprit: g.case.culprit, motive: g.case.motive, weapon: g.case.weapon })
    const spent = submit(lookupEvidence(g, availableEvidence(g)[0]!.id), {
      culprit: g.case.culprit, motive: g.case.motive, weapon: g.case.weapon,
    })
    expect(full.breakdown.efficiency).toBe(FIELD_BUDGET * 2)
    expect(full.total - spent.total).toBe(2)
  })

  it('제출 후에는 상태가 결과 단계로 잠긴다', () => {
    const g = fresh(5011)
    const r = submit(g, { culprit: 'S1', motive: 'x', weapon: 'y' })
    expect(r.state.phase).toBe('result')
    expect(() => submit(r.state, { culprit: 'S2', motive: 'x', weapon: 'y' })).toThrow()
    expect(() => interview(r.state, 'S1')).toThrow()
    expect(() => lookupEvidence(r.state, r.state.case.evidence[0]!.id)).toThrow()
  })

  it('정답 제출이면 실제 범인과 일치한다 — 사건 진실과 채점이 어긋나지 않는다', () => {
    for (const seed of [5020, 5021, 5022]) {
      const g = fresh(seed)
      for (const s of SUSPECTS) {
        const r = submit(g, { culprit: s, motive: g.case.motive, weapon: g.case.weapon })
        expect(r.correct.culprit).toBe(s === g.case.culprit)
      }
    }
  })

  it('동기 정답은 범인의 사정과 같다 — 두 진실이 어긋나면 채점이 거짓말이 된다', () => {
    for (const seed of [5020, 5021, 5022]) {
      const c = generateValidCase(seed).case
      expect(c.motive).toBe(c.suspects[c.culprit].motive)
    }
  })

  it('도구 정답은 WEAPONS 목록과 검시 흔적 표 안에 있다', () => {
    for (const seed of [5020, 5021, 5022]) {
      const c = generateValidCase(seed).case
      expect(WEAPONS).toContain(c.weapon)
      expect(WEAPON_TRACE[c.weapon]).toBeTruthy()
    }
  })
})

describe('한국어 조사 (UX 폴리시)', () => {
  it('받침 유무로 조사를 고른다', async () => {
    const { josa } = await import('../src/josa')
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
    const receipt = g.case.evidence.find((e) => !e.exhaustive && !e.decisive && e.kind !== 'autopsy')
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
      // 검시 소견은 알리바이 기록이 아니다 — 인물을 담지 않으므로 부재 추리 대상이 아니다
      for (const e of c.evidence.filter((x) => x.slot === CRIME_SLOT && !x.decisive && x.kind !== 'autopsy')) {
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

describe('폴백은 범인을 알려주지 않는다 (정답 유출 회귀)', () => {
  const C = generateValidCase(4242).case
  const unlock = C.presentUnlocks[0]!

  it('해금 쌍은 사건당 하나뿐이고 그 대상은 범인이다 — 그래서 해금 여부가 곧 정답이다', () => {
    expect(C.presentUnlocks).toHaveLength(1)
    expect(unlock.suspectId).toBe(C.culprit)
  })

  it('정상 응답이면 열렸는지 알려준다', () => {
    const g = lookupEvidence(createGame(C, 99), unlock.evidenceId)
    const after = presentEvidence(g, unlock.evidenceId, unlock.suspectId)
    expect(presentReveal(g, after, false)).toBe('opened')
  })

  it('무관한 조합이면 열리지 않았다고 알려준다', () => {
    const other = SUSPECTS.find((s) => s !== C.culprit)!
    const g = lookupEvidence(createGame(C, 99), unlock.evidenceId)
    const after = presentEvidence(g, unlock.evidenceId, other)
    expect(presentReveal(g, after, false)).toBe('nothing')
  })

  /**
   * 핵심. 폴백이면 대화를 환불하는데, 해금 여부까지 알려주면
   * **대화 0회로 범인을 특정할 수 있다.** 로컬 dev 는 Function 이 없어 항상 이 경로다.
   */
  it('폴백이면 범인에게 제시해도 열렸다고 말하지 않는다', () => {
    const g = lookupEvidence(createGame(C, 99), unlock.evidenceId)
    const after = presentEvidence(g, unlock.evidenceId, unlock.suspectId)
    expect(presentReveal(g, after, true)).toBe('void')
  })

  it('폴백 결과는 범인이든 아니든 구별되지 않는다 — 구별되면 그게 유출이다', () => {
    const g = lookupEvidence(createGame(C, 99), unlock.evidenceId)
    const seen = new Set(
      SUSPECTS.map((s) => presentReveal(g, presentEvidence(g, unlock.evidenceId, s), true)),
    )
    expect([...seen]).toEqual(['void'])
  })
})
