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

  it('물증 개수가 기획서 범위(5~7 + 잡음)에 있다', () => {
    for (const seed of [23, 230, 2300]) {
      const c = generateCase(seed)
      expect(c.evidence.length).toBeGreaterThanOrEqual(5)
      expect(c.evidence.length).toBeLessThanOrEqual(9)
    }
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
