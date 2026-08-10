import { describe, it, expect } from 'vitest'
import { SLUG_BY_JOB } from '../src/ui/roleSlug'
import { gc001Case } from '../src/data/gc001'
import { applyWorld, WORLD_PACKS, WORLD_ROTATION } from '../src/data/worlds'
import { generateValidCase, validateCase } from '../src/engine/validate'
import { SUSPECTS } from '../src/types'

/**
 * 월드 직업 → 3D/사진 slug 매핑 잠금.
 *
 * 이 함정은 새 월드마다 재발한다: gc001 에서 갤러리 직업 5종이 SLUG_BY_JOB 에 없어
 * **경찰서 탭이 조용히 사라지고 취조실이 사진 폴백으로만 떴다** — 에러도 로그도 없이.
 * 매핑 누락은 화면이 아니라 여기서 빨간불이 켜져야 한다.
 */

describe('직업 → 에셋 slug 매핑 (P0 — gc001 3D 복구)', () => {
  it('gc001 갤러리 직업 5종 전부 매핑이 있다', () => {
    const c = gc001Case()
    for (const s of SUSPECTS) {
      const job = c.suspects[s].job
      expect(SLUG_BY_JOB[job], `${job} 의 slug 매핑이 없다 — 3D 가 조용히 죽는다`).toBeTruthy()
    }
  })

  it('gc001 다섯 명의 slug 가 서로 다르다 — 같은 모델이 두 번 앉으면 안 된다', () => {
    const c = gc001Case()
    const slugs = SUSPECTS.map((s) => SLUG_BY_JOB[c.suspects[s].job])
    expect(new Set(slugs).size).toBe(5)
  })

  it('월드 팩 3종의 직업도 전부 매핑이 있고, 팩 안에서 slug 5종이 겹치지 않는다', () => {
    for (const pack of Object.values(WORLD_PACKS)) {
      expect(pack.jobs, pack.id).toHaveLength(5)
      const slugs = pack.jobs.map((j) => {
        expect(SLUG_BY_JOB[j.job], `${pack.id}/${j.job} 의 slug 매핑이 없다`).toBeTruthy()
        return SLUG_BY_JOB[j.job]
      })
      expect(new Set(slugs).size, `${pack.id} 안에서 slug 가 겹친다`).toBe(5)
    }
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
