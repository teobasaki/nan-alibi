import { describe, it, expect } from 'vitest'
import { CAST, CAST_BY_SLOT, CAST_OVERRIDE, castOf, castTagFor } from '../src/ui/cast'
import { gc001Case } from '../src/data/gc001'
import { applyWorld, WORLD_PACKS, WORLD_ROTATION } from '../src/data/worlds'
import { generateValidCase, validateCase } from '../src/engine/validate'
import { SUSPECTS } from '../src/types'

/**
 * **배역 배정 잠금** — 예전에는 직업(job) → slug 표였고, 월드가 늘 때마다 직업 5종을
 * 손으로 추가해야 했다. 빠뜨리면 3D 가 조용히 죽었다(gc001 에서 실제로 밟았다).
 * 지금은 **슬롯(S1~S5) 고정 배정**이라 빠질 자리가 없다 — 그래도 "한 판에 다섯이
 * 서로 다른 몸" 과 "성별 대본이 있는 사건의 배역" 은 여기서 잠근다.
 */

describe('배역 배정 — 슬롯 고정 (Meshy 8종 → 신규 5종 교체)', () => {
  it('배우는 5명이고 태그가 겹치지 않는다', () => {
    expect(CAST).toHaveLength(5)
    expect(new Set(CAST.map((c) => c.tag)).size).toBe(5)
  })

  it('기본 배정은 다섯 슬롯 전부 채우고 서로 다르다 — 같은 모델이 두 번 앉지 않는다', () => {
    const tags = SUSPECTS.map((s) => CAST_BY_SLOT[s])
    expect(tags.filter(Boolean)).toHaveLength(5)
    expect(new Set(tags).size).toBe(5)
  })

  it('★ 어떤 사건이든 다섯이 서로 다른 몸을 입는다 — 시드·월드 3종·gc001', () => {
    for (const caseTag of [null, 'gc001', '없는사건']) {
      const tags = castOf(caseTag)
      expect(tags, String(caseTag)).toHaveLength(5)
      expect(new Set(tags).size, `${caseTag} 에서 배역이 겹친다`).toBe(5)
      for (const t of tags) {
        expect(CAST.some((c) => c.tag === t), `${t} 은 배우 명단에 없다`).toBe(true)
      }
    }
  })

  it('월드 팩은 배역에 영향을 주지 않는다 — 직업 라벨이 바뀌어도 몸은 슬롯이 정한다', () => {
    const base = castOf(null)
    for (const id of Object.keys(WORLD_PACKS)) {
      const c = applyWorld(generateValidCase(20007).case, id)
      expect(SUSPECTS.map((s) => castTagFor(s, null))).toEqual(base)
      expect(SUSPECTS.every((s) => c.suspects[s].job.length > 0)).toBe(true)
    }
  })

  it('gc001 은 대본 성별을 따른다 — 여/남/여/남/여', () => {
    const want = ['f', 'm', 'f', 'm', 'f']
    const tags = castOf('gc001')
    const genderOf = (t: string) => CAST.find((c) => c.tag === t)!.gender
    expect(tags.map(genderOf)).toEqual(want)
    expect(CAST_OVERRIDE.gc001).toBeTruthy()
  })

  it('배우 풀의 성별 구성이 gc001 배분(남2·여3)을 감당한다', () => {
    expect(CAST.filter((c) => c.gender === 'm')).toHaveLength(2)
    expect(CAST.filter((c) => c.gender === 'f')).toHaveLength(3)
  })

  /**
   * **배역표 ↔ 에셋 글롭 잠금.** 글롭을 배역 5종 정확 목록으로 좁혔으므로
   * (dist 복제 방지 — Meshy 8종·35MB급 예비 차단), cast.ts 에 배우를 더하고
   * 글롭을 잊으면 3D 가 조용히 사진 폴백으로 떨어진다. 그 어긋남은 여기서 잡는다.
   */
  it('★ 배우 5종 전부 취조실·경찰서 착석 에셋이 실려 있다', async () => {
    const { hasModel } = await import('../src/ui/stage3d')
    const { hasSeatModel, hasWalkModel } = await import('../src/ui/explore3d')
    for (const c of CAST) {
      expect(hasModel(c.tag), `${c.tag} 취조실 착석 글롭 누락`).toBe(true)
      expect(hasSeatModel(c.tag), `${c.tag} 경찰서 착석 글롭 누락`).toBe(true)
    }
    // 주인공(형사)의 걷는 몸 — 경찰서·현장 공용
    expect(hasWalkModel('joe'), '주인공 joe 걷기 에셋 누락').toBe(true)
  })
})

describe('월드 팩 — 스킨이지 사건이 아니다 (P1)', () => {
  const SEED = 20007

  it('같은 seed + 같은 world 는 항상 같은 사건이다 (결정론)', () => {
    const a = applyWorld(generateValidCase(SEED).case, 'auction')
    const b = applyWorld(generateValidCase(SEED).case, 'auction')
    expect(JSON.stringify(a)).toBe(JSON.stringify(b))
  })

  it('world 가 없거나 오타면 원본 그대로다 — 기존 ?seed= URL 은 바이트 하나 안 바뀐다', () => {
    const base = generateValidCase(SEED).case
    expect(applyWorld(base, null)).toBe(base)          // 같은 참조
    expect(applyWorld(base, undefined)).toBe(base)
    expect(applyWorld(base, 'oops-없는-월드')).toBe(base)
  })

  it('★ 스킨은 진실 구조를 건드리지 않는다 — 궤적·거짓말·증거·해금·채점 축 전부 동일', () => {
    const base = generateValidCase(SEED).case
    for (const id of Object.keys(WORLD_PACKS)) {
      const skinned = applyWorld(base, id)
      // 채점·해금 축
      expect(skinned.culprit).toBe(base.culprit)
      expect(skinned.motive).toBe(base.motive)
      expect(skinned.weapon).toBe(base.weapon)
      expect(skinned.method).toBe(base.method)
      expect(skinned.decisiveEvidenceId).toBe(base.decisiveEvidenceId)
      expect(JSON.stringify(skinned.evidence)).toBe(JSON.stringify(base.evidence))
      expect(JSON.stringify(skinned.testimonies)).toBe(JSON.stringify(base.testimonies))
      expect(JSON.stringify(skinned.presentUnlocks)).toBe(JSON.stringify(base.presentUnlocks))
      // 인물의 진실 — 이름·나이·페르소나·궤적·거짓말은 그대로, 직업·관계만 갈아입는다
      for (const s of SUSPECTS) {
        const b0 = base.suspects[s]
        const w = skinned.suspects[s]
        expect(w.name).toBe(b0.name)
        expect(w.age).toBe(b0.age)
        expect(w.personaId).toBe(b0.personaId)
        expect(w.motive).toBe(b0.motive)
        expect(JSON.stringify(w.truth)).toBe(JSON.stringify(b0.truth))
        expect(JSON.stringify(w.claim)).toBe(JSON.stringify(b0.claim))
        expect(JSON.stringify(w.lieSlots)).toBe(JSON.stringify(b0.lieSlots))
      }
      // 검증기도 같은 판정을 내린다 — 라벨은 유일해에 관여하지 않는다
      expect(validateCase(skinned).ok).toBe(true)
    }
  })

  it('placeLabels[2](현장) 와 venue.room 이 같다 — 브리핑과 격자가 같은 이름을 부른다', () => {
    for (const pack of Object.values(WORLD_PACKS)) {
      for (const v of pack.venues) expect(v.room, pack.id).toBe(pack.placeLabels[2])
    }
    // 실제 적용에서도
    for (const id of Object.keys(WORLD_PACKS)) {
      const c = applyWorld(generateValidCase(SEED).case, id)
      expect(c.venue.room).toBe(c.world!.placeLabels[2])
    }
  })

  it('직업 5종이 다섯 명에게 겹침 없이 배정되고, 시드마다 범인의 직업이 달라질 수 있다', () => {
    const jobsAt = (seed: number) => {
      const c = applyWorld(generateValidCase(seed).case, 'theater')
      const jobs = SUSPECTS.map((s) => c.suspects[s].job)
      expect(new Set(jobs).size).toBe(5)
      return c.suspects[c.culprit].job
    }
    const culpritJobs = new Set([20007, 20011, 20013, 20019, 20031].map(jobsAt))
    expect(culpritJobs.size).toBeGreaterThan(1)   // 범인 직업이 고정되면 직업이 스포일러가 된다
  })

  it('로테이션은 호텔을 포함해 네 무대를 순환한다', () => {
    expect(WORLD_ROTATION).toEqual([null, 'auction', 'studio', 'theater'])
    for (const id of WORLD_ROTATION) {
      if (id !== null) expect(WORLD_PACKS[id], id ?? '').toBeTruthy()
    }
  })
})
