/**
 * 미리 검증된 사건 시드 풀 (완료기준 D4).
 *
 * `pool.json` 은 `npm run gen:pool` 이 굽는다 — 손으로 고치지 마라.
 * 여기 든 시드는 전부 `generateValidCase(seed)` 가 **첫 시도에** 통과한 것들이라,
 * 게임 시작 시 재생성 루프가 돌지 않는다 (최악 40회 재시도 → 0회).
 *
 * **시드 계약**: 저장된 값은 시드 그 자체다. 서버(`functions/api/interrogate.ts`)가
 * 같은 시드로 사건을 재생성해 심문 프롬프트를 만들기 때문에, 여기서 시드를 가공하면
 * 클라이언트가 보는 사건과 서버가 보는 사건이 갈라진다.
 */
import poolJson from './pool.json'

export const SEED_POOL: readonly number[] = poolJson

/**
 * 풀에서 시드 하나를 고른다.
 * @param rnd [0, 1) 난수. `Math.random()` 은 이 프로젝트에서 금지이므로
 *            호출부는 `crypto.getRandomValues` 나 `makeRng(...).next()` 를 쓴다.
 * @returns 검증 통과가 보장된 시드
 */
export function pickPoolSeed(rnd: number): number {
  const r = Number.isFinite(rnd) ? Math.min(Math.max(rnd, 0), 0.9999999999) : 0
  return SEED_POOL[Math.floor(r * SEED_POOL.length)]!
}
