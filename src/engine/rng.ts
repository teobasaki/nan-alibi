/**
 * 시드 고정 RNG — 이 프로젝트의 유일한 난수원.
 *
 * `Math.random()` 직접 호출은 전면 금지다 (tests/rng.test.ts 가 회귀 감시).
 * 이유: 같은 시드가 같은 사건을 만들어야 검증기·BFS·밸런스 실측이 재현 가능하다.
 * 재현이 안 되면 "6회 안에 풀린다"를 증명할 방법이 없다.
 *
 * 알고리즘: mulberry32 — 32비트 상태, 통계 품질이 게임 용도로 충분하고 구현이 짧다.
 */

export interface Rng {
  /** [0, 1) */
  next(): number
}

export function makeRng(seed: number): Rng {
  // 0 시드에서 수열이 죽는 것을 막는다
  let a = (seed >>> 0) || 0x9e3779b9
  return {
    next(): number {
      a = (a + 0x6d2b79f5) >>> 0
      let t = a
      t = Math.imul(t ^ (t >>> 15), t | 1)
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    },
  }
}

/** [min, max] 양끝 포함 정수 */
export function randInt(rng: Rng, min: number, max: number): number {
  return min + Math.floor(rng.next() * (max - min + 1))
}

export function pick<T>(rng: Rng, arr: readonly T[]): T {
  if (arr.length === 0) throw new Error('pick: 빈 배열')
  return arr[randInt(rng, 0, arr.length - 1)]!
}

/** Fisher-Yates. 원본을 훼손하지 않는다 (사건 생성기가 같은 배열을 여러 번 쓴다). */
export function shuffle<T>(rng: Rng, arr: readonly T[]): T[] {
  const out = [...arr]
  for (let i = out.length - 1; i > 0; i--) {
    const j = randInt(rng, 0, i)
    ;[out[i], out[j]] = [out[j]!, out[i]!]
  }
  return out
}

/** 배열에서 n개를 중복 없이 뽑는다 */
export function sample<T>(rng: Rng, arr: readonly T[], n: number): T[] {
  return shuffle(rng, arr).slice(0, n)
}
