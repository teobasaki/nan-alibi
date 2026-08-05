/**
 * 판 기록 — "한 번 더" 의 이유.
 *
 * 이 게임은 매 판 다른 사건이 생성된다. 그런데 끝나면 점수가 허공으로 사라져서,
 * 두 번째 판이 첫 판과 아무 관계가 없었다. 최고점과 해결률만 남겨도
 * 다음 판이 **이전 판에 대한 응답**이 된다.
 *
 * `localStorage` 는 실패할 수 있다(사파리 사생활 보호 모드, 용량 초과).
 * 실패하면 게임은 그대로 돌아가고 기록만 포기한다 — 기록 때문에 판이 멈추면 안 된다.
 */

const KEY = 'nan-alibi:records'

export interface Stats {
  plays: number
  solved: number
  best: number
  /** 최고점을 낸 사건 번호(시드) — 자랑거리이자 재현 경로 */
  bestSeed: number | null
}

const EMPTY: Stats = { plays: 0, solved: 0, best: 0, bestSeed: null }

export function stats(): Stats {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return EMPTY
    const v = JSON.parse(raw) as Partial<Stats>
    return {
      plays: Number(v.plays) || 0,
      solved: Number(v.solved) || 0,
      best: Number(v.best) || 0,
      bestSeed: typeof v.bestSeed === 'number' ? v.bestSeed : null,
    }
  } catch {
    return EMPTY
  }
}

/** 판이 끝났을 때 한 번 부른다. 갱신된 통계를 돌려준다. */
export function record(seed: number, total: number, solved: boolean): Stats {
  const s = stats()
  const next: Stats = {
    plays: s.plays + 1,
    solved: s.solved + (solved ? 1 : 0),
    best: Math.max(s.best, total),
    bestSeed: total > s.best ? seed : s.bestSeed,
  }
  try {
    localStorage.setItem(KEY, JSON.stringify(next))
  } catch {
    /* 기록을 못 남겨도 판은 끝난다 */
  }
  return next
}
