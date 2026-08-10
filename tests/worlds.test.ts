import { describe, it, expect } from 'vitest'
import { SLUG_BY_JOB } from '../src/ui/roleSlug'
import { gc001Case } from '../src/data/gc001'
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
})
