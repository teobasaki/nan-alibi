/**
 * 여정 저장 — **브라우저 전용.** 계산은 `engine/journey.ts` 가 갖는다.
 *
 * 이 분리는 취향이 아니라 강제다. `src/engine/` 은 Cloudflare Worker 에서도
 * 컴파일되므로 `localStorage` 같은 DOM API 를 쓸 수 없다.
 * 처음엔 engine 에 넣었다가 커밋 게이트(`npm run typecheck:functions`)가 잡았다 —
 * 게이트가 없었으면 배포에서 터졌을 것이다.
 *
 * 저장은 **로컬에만** 한다. 서버로 보내지 않고, 계정도 사용자 id 도 없다.
 */

import type { Trace } from '../engine/journey'

const KEY = 'nan-alibi:traces'
/** 최근 몇 판까지 남기나. 무한히 쌓으면 그건 기록이 아니라 누수다 */
const KEEP = 10

export function saveTrace(tr: Trace, store?: Pick<Storage, 'getItem' | 'setItem'>): void {
  const s = store ?? (typeof localStorage !== 'undefined' ? localStorage : undefined)
  if (!s) return
  try {
    const prev = JSON.parse(s.getItem(KEY) ?? '[]')
    const list = Array.isArray(prev) ? prev : []
    s.setItem(KEY, JSON.stringify([...list, tr].slice(-KEEP)))
  } catch {
    // 저장 실패는 게임을 막지 않는다 — 이건 기능이지 규칙이 아니다
  }
}

export function loadTraces(store?: Pick<Storage, 'getItem'>): Trace[] {
  const s = store ?? (typeof localStorage !== 'undefined' ? localStorage : undefined)
  if (!s) return []
  try {
    const v = JSON.parse(s.getItem(KEY) ?? '[]')
    // 손으로 고쳐진 값이 올 수 있다. 모양이 다른 항목은 조용히 버린다.
    return Array.isArray(v)
      ? v.filter((t) => t && typeof t.seed === 'number' && Array.isArray(t.events))
      : []
  } catch {
    return []
  }
}
