/**
 * 막 전환 — **커튼이 닫혔다 열린다.**
 *
 * ## 왜 커튼인가 (연극 3막 구조)
 * 이 게임은 장면이 셋이다: 코믹 인트로(발단) · 30초의 현장(제1막) · 경찰서(제2막).
 * 지금까지 그 사이는 **페이드아웃**이 이었는데, 페이드는 "화면이 바뀐다"만 말하고
 * "장면이 바뀐다"는 말하지 않는다. 무엇보다 3D 씬이 서는 데 걸리는 2~4초 동안
 * 관객에게 **로딩 문구**를 보여주고 있었다 — 무대 전환을 객석에서 구경시킨 셈이다.
 *
 * 커튼은 그 시간을 **연출로 산다.** 닫히는 동안 무대가 바뀌고, 다 서면 열린다.
 * 같은 대기 시간이 "기다림"에서 "막간"으로 읽힌다.
 *
 * ## 규칙 세 가지
 * ① **무대는 커튼 뒤에서만 바뀐다** — `onClosed` 는 완전히 닫힌 뒤 한 번만 불린다.
 * ② **커튼은 반드시 열린다** — `onClosed` 가 던지든 늦든 `maxHold` 뒤에는 걷힌다.
 *    연출이 게임을 막으면 그건 연출이 아니라 장애물이다 (journal3d 와 같은 원칙).
 * ③ **모션을 끈 사람에게는 즉시** — `prefers-reduced-motion` 이면 스윕 없이 암전만 하고
 *    같은 순서로 진행한다. 순서가 같아야 호출부가 두 갈래로 갈리지 않는다.
 *
 * 그림은 CSS 가 그린다(에셋 0장). 소리는 호출부가 넘긴 `play('curtain')` 이 낸다 —
 * 이 모듈은 sound.ts 를 import 하지 않는다. 그래야 헤드리스에서도 세울 수 있다.
 */

export interface CurtainOpts {
  /** 막 이름 — 커튼이 닫힌 동안 가운데에 뜬다 (예: `제 1 막 — 현장`) */
  title?: string
  /** 막 이름 아래 한 줄 — 장소나 시각 */
  sub?: string
  /**
   * 커튼이 **완전히 닫힌 뒤** 한 번 불린다. 무대 교체는 전부 여기서.
   * Promise 를 돌려주면 그것이 resolve 될 때까지 커튼이 닫힌 채 기다린다.
   */
  onClosed?: () => void | Promise<void>
  /** `onClosed` 를 아무리 기다려도 이 시간(ms) 뒤에는 연다 — 기본 8초 */
  maxHold?: number
  /** 닫힌 채 최소한 머무는 시간(ms) — 막 이름을 읽을 시간이다 */
  minHold?: number
  /** 효과음 — 호출부가 `play` 를 넘긴다. 없으면 무음으로 돈다 */
  play?: (key: string) => void
}

const CLOSE_MS = 720
const OPEN_MS = 900

const reduced = (): boolean =>
  typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches

const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/**
 * 커튼을 닫고 → 무대를 바꾸고 → 연다.
 *
 * 호출부는 `await` 하지 않아도 된다 (`void curtainSwap({...})`). 기다리면 커튼이
 * 완전히 걷힌 시점을 받는다.
 */
export async function curtainSwap(opts: CurtainOpts = {}): Promise<void> {
  const soft = reduced()
  const root = document.createElement('div')
  root.className = `curtain${soft ? ' soft' : ''}`
  root.setAttribute('aria-hidden', 'true')

  const left = document.createElement('div')
  left.className = 'curtain-panel left'
  const right = document.createElement('div')
  right.className = 'curtain-panel right'
  root.append(left, right)

  if (opts.title) {
    const cap = document.createElement('div')
    cap.className = 'curtain-cap'
    const t = document.createElement('div')
    t.className = 'curtain-t'
    t.textContent = opts.title
    cap.appendChild(t)
    if (opts.sub) {
      const s = document.createElement('div')
      s.className = 'curtain-s'
      s.textContent = opts.sub
      cap.appendChild(s)
    }
    root.appendChild(cap)
  }

  document.body.appendChild(root)

  try {
    /* ① 닫힌다 */
    opts.play?.('curtain')
    // 첫 프레임에 클래스를 얹어야 전환이 돈다 — 붙이자마자 바꾸면 브라우저가 한 상태로 본다
    await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())))
    root.classList.add('closed')
    await wait(soft ? 220 : CLOSE_MS)

    /* ② 무대를 바꾼다 — 커튼 뒤에서 */
    const stage = (async () => { await opts.onClosed?.() })()
    // 늦어도 열린다 (규칙 ②). 던져도 마찬가지 — 여기서 삼키고 커튼은 제 일을 한다.
    await Promise.race([
      stage.catch((e) => { console.error('[커튼] 무대 전환 실패', e) }),
      wait(opts.maxHold ?? 8000),
    ])
    await wait(opts.minHold ?? (soft ? 120 : 420))

    /* ③ 열린다 */
    opts.play?.('curtain')
    root.classList.add('opening')
    await wait(soft ? 200 : OPEN_MS)
  } finally {
    root.remove()
  }
}
