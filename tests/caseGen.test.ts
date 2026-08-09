import { describe, it, expect } from 'vitest'
import { generateCase } from '../src/engine/caseGen'
import { SUSPECTS, CRIME_SLOT, CRIME_PLACE } from '../src/types'

describe('사건 생성기 (Task 3)', () => {
  it('같은 시드는 완전히 같은 사건을 만든다 (A7)', () => {
    expect(JSON.stringify(generateCase(777))).toEqual(JSON.stringify(generateCase(777)))
  })

  it('다른 시드는 다른 사건을 만든다', () => {
    expect(JSON.stringify(generateCase(1))).not.toEqual(JSON.stringify(generateCase(2)))
  })

  it('범인은 정확히 1명이다 (V1 / A2)', () => {
    for (const seed of [3, 31, 314, 3141]) {
      const c = generateCase(seed)
      const culprits = SUSPECTS.filter((s) => c.suspects[s].isCulprit)
      expect(culprits).toHaveLength(1)
      expect(culprits[0]).toBe(c.culprit)
    }
  })

  it('범인만 범행 시각에 현장에 있다', () => {
    for (const seed of [5, 55, 555]) {
      const c = generateCase(seed)
      for (const s of SUSPECTS) {
        const atScene = c.suspects[s].truth[CRIME_SLOT] === CRIME_PLACE
        expect(atScene).toBe(s === c.culprit)
      }
    }
  })

  it('범인은 범행 시각을 반드시 거짓말한다', () => {
    for (const seed of [8, 88, 888]) {
      const c = generateCase(seed)
      const k = c.suspects[c.culprit]
      expect(k.lieSlots).toContain(CRIME_SLOT)
      expect(k.claim[CRIME_SLOT]).not.toBe(CRIME_PLACE)
    }
  })

  it('무고한 사람 중 2명 이상이 거짓말을 한다 (V6 / A6)', () => {
    for (const seed of [11, 111, 1111]) {
      const c = generateCase(seed)
      const liars = SUSPECTS.filter((s) => !c.suspects[s].isCulprit && c.suspects[s].lieSlots.length > 0)
      expect(liars.length).toBeGreaterThanOrEqual(2)
    }
  })

  it('궤적 길이는 5이고 진술은 거짓 슬롯에서만 진실과 다르다', () => {
    const c = generateCase(2024)
    for (const s of SUSPECTS) {
      const { truth, claim, lieSlots } = c.suspects[s]
      expect(truth).toHaveLength(5)
      expect(claim).toHaveLength(5)
      for (let t = 0; t < 5; t++) {
        if (lieSlots.includes(t as 0 | 1 | 2 | 3 | 4)) expect(claim[t]).not.toBe(truth[t])
        else expect(claim[t]).toBe(truth[t])
      }
    }
  })

  it('물증은 항상 진실과 일치한다 (물증은 거짓일 수 없다)', () => {
    for (const seed of [13, 130, 1300]) {
      const c = generateCase(seed)
      for (const e of c.evidence) {
        for (const s of e.subjects) {
          expect(c.suspects[s].truth[e.slot]).toBe(e.place)
        }
      }
    }
  })

  it('결정적 증거가 정확히 1개 존재하고 범인을 가리킨다 (V3)', () => {
    for (const seed of [17, 170, 1700]) {
      const c = generateCase(seed)
      const dec = c.evidence.filter((e) => e.decisive)
      expect(dec).toHaveLength(1)
      expect(dec[0]!.id).toBe(c.decisiveEvidenceId)
      expect(dec[0]!.subjects).toEqual([c.culprit])
      expect(dec[0]!.place).toBe(CRIME_PLACE)
    }
  })

  it('결정적 증거는 선행 조건이 있어 즉시 조회할 수 없다 (V5 하한 보장)', () => {
    for (const seed of [19, 190, 1900]) {
      const c = generateCase(seed)
      const dec = c.evidence.find((e) => e.decisive)!
      expect(dec.requires.length).toBeGreaterThan(0)
    }
  })

  it('물증 개수가 기획서 범위(5~7 + 잡음 + 검시)에 있다', () => {
    for (const seed of [23, 230, 2300]) {
      const c = generateCase(seed)
      // 상한 9 → 10 (2026-08-10): ADR 022 가 검시 소견 1건을 고정 추가했다
      expect(c.evidence.length).toBeGreaterThanOrEqual(6)
      expect(c.evidence.length).toBeLessThanOrEqual(10)
    }
  })
})

describe('3축 추론 재료 — 도구·동기·나이 (ADR 022)', () => {
  it('검시 소견이 정확히 1건, 범행 시각·현장에, 즉시 조회 가능하게 존재한다', async () => {
    const { CRIME_SLOT: SLOT, CRIME_PLACE: PLACE } = await import('../src/types')
    for (const seed of [7001, 7002, 7003]) {
      const c = generateCase(seed)
      const autopsy = c.evidence.filter((e) => e.kind === 'autopsy')
      expect(autopsy).toHaveLength(1)
      const a = autopsy[0]!
      expect(a.slot).toBe(SLOT)
      expect(a.place).toBe(PLACE)
      expect(a.subjects).toEqual([])      // 인물이 아니라 도구의 기록이다
      expect(a.exhaustive).toBe(false)    // 부재 모순의 근거가 되면 안 된다
      expect(a.decisive).toBe(false)
      expect(a.requires).toEqual([])
    }
  })

  it('도구는 WEAPONS 5종 중 하나이고 검시 흔적 표가 1:1 로 덮는다', async () => {
    const { WEAPONS, WEAPON_TRACE } = await import('../src/data/config')
    for (const seed of [7010, 7011, 7012, 7013]) {
      const c = generateCase(seed)
      expect(WEAPONS).toContain(c.weapon)
    }
    // 1:1 — 표가 도구를 전부 덮고, 서술이 겹치면 판독이 갈라지지 않는다
    const traces = WEAPONS.map((w) => WEAPON_TRACE[w])
    expect(traces.every(Boolean)).toBe(true)
    expect(new Set(traces).size).toBe(WEAPONS.length)
  })

  it('용의자 다섯 명 전부 나이(28~62)와 서로 다른 사정을 갖고, 범인의 사정이 사건의 동기다', () => {
    for (const seed of [7020, 7021, 7022]) {
      const c = generateCase(seed)
      const motives = SUSPECTS.map((s) => c.suspects[s].motive)
      expect(new Set(motives).size).toBe(5)           // 동기 지목이 성립하려면 겹치면 안 된다
      expect(c.motive).toBe(c.suspects[c.culprit].motive)
      for (const s of SUSPECTS) {
        expect(c.suspects[s].age).toBeGreaterThanOrEqual(28)
        expect(c.suspects[s].age).toBeLessThanOrEqual(62)
      }
    }
  })

  /**
   * ★ 결정론 회귀 감시 — 새 축(도구·나이·동기)은 전부 파생 스트림에서 뽑는다.
   * 주 스트림을 건드리면 사전 검증 시드 풀 400개가 통째로 무효가 된다 (caseGen 주석).
   * 이 검사는 그 사고가 나면 "같은 시드 = 같은 사건" 이 깨지는 것으로 드러나게 한다.
   */
  it('★ 새 축이 추가돼도 같은 시드는 같은 사건이다', () => {
    expect(JSON.stringify(generateCase(9101))).toEqual(JSON.stringify(generateCase(9101)))
  })
})

describe('표면 데이터 (Task 10 준비)', () => {
  it('용의자 5명 모두 이름·직업·관계·페르소나를 갖는다', () => {
    const c = generateCase(4001)
    for (const s of SUSPECTS) {
      const x = c.suspects[s]
      expect(x.name.length).toBeGreaterThanOrEqual(2)
      expect(x.job.length).toBeGreaterThan(1)
      expect(x.relation.length).toBeGreaterThan(1)
      expect(x.personaId.length).toBeGreaterThan(1)
    }
  })

  it('이름과 직업이 서로 겹치지 않는다', () => {
    const c = generateCase(4002)
    expect(new Set(SUSPECTS.map((s) => c.suspects[s].name)).size).toBe(5)
    expect(new Set(SUSPECTS.map((s) => c.suspects[s].job)).size).toBe(5)
  })

  it('페르소나 5종이 서로 다르고 충돌 조합이 함께 나오지 않는다', async () => {
    const { PERSONA_CONFLICTS } = await import('../src/data/personas')
    for (const seed of [4010, 4011, 4012, 4013, 4014]) {
      const c = generateCase(seed)
      const ids = SUSPECTS.map((s) => c.suspects[s].personaId)
      expect(new Set(ids).size).toBe(5)
      for (const [a, b] of PERSONA_CONFLICTS) {
        expect(ids.includes(a) && ids.includes(b)).toBe(false)
      }
    }
  })

  it('사건 제목·피해자·장소가 채워진다', () => {
    const c = generateCase(4003)
    expect(c.title.length).toBeGreaterThan(2)
    expect(c.victim.name.length).toBeGreaterThan(1)
    expect(c.venue.room).toBe('1204호')
  })
})
