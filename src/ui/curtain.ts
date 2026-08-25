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
 * ## 규칙 네 가지
 * ① **무대는 커튼 뒤에서만 바뀐다** — `onClosed` 는 완전히 닫힌 뒤 한 번만 불린다.
 * ② **커튼은 반드시 열린다** — `onClosed` 가 던지든 늦든 `hardHold` 뒤에는 걷힌다.
 *    연출이 게임을 막으면 그건 연출이 아니라 장애물이다 (journal3d 와 같은 원칙).
 *    단 `maxHold`(8초)만으로 여는 것은 **틀린 열기였다**: 그 시점에 무대가 아직
 *    안 섰으면 커튼 뒤에 있는 것은 새 막이 아니라 **직전 막의 잔해**(제1막에서는
 *    2D 수사 화면)라, 관객은 "3D 현장 대신 대조표가 떴다"를 본다. 그래서 지금은
 *    `maxHold` 를 넘기면 **열지 않고 「무대를 준비하는 중」을 켠 채 기다린다.**
 *    연출이 게임을 막아서는 안 되지만, 연출이 사고를 감추는 것은 더 나쁘다.
 * ③ **모션을 끈 사람에게는 즉시** — `prefers-reduced-motion` 이면 스윕 없이 암전만 하고
 *    같은 순서로 진행한다. 순서가 같아야 호출부가 두 갈래로 갈리지 않는다.
 * ④ **프레임이 없어도 진행한다** — 첫 프레임 대기(rAF)는 **타이머와 경주시킨다.**
 *    숨겨진 탭·최소화·가려진 창에서는 브라우저가 rAF 를 한 번도 부르지 않아
 *    그 `await` 에서 영구히 멈췄다 (실측 재현: `document.hidden === true` 인 창에서
 *    커튼이 닫히지도 열리지도 않고 화면만 덮은 채 뒤의 2D 화면이 드러났다).
 *    연출용 대기는 게임 진행의 필수 경로에 놓으면 안 된다.
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
  /**
   * 여기까지는 **말없이** 기다린다 (ms, 기본 8초). 이 시간을 넘겨도 무대가 안 섰으면
   * 커튼을 열지 않고 「무대를 준비하는 중」 표시를 켠다 (규칙 ②).
   */
  maxHold?: number
  /** 무대가 어떻게 되든 이 시간(ms) 뒤에는 연다 — 기본 30초 */
  hardHold?: number
  /** 닫힌 채 최소한 머무는 시간(ms) — 막 이름을 읽을 시간이다 */
  minHold?: number
  /** 효과음 — 호출부가 `play` 를 넘긴다. 없으면 무음으로 돈다 */
  play?: (key: string) => void
}

const CLOSE_MS = 720
const OPEN_MS = 900
/** 첫 프레임을 이만큼만 기다린다 — rAF 가 굶는 창에서도 진행하기 위한 상한 (규칙 ④) */
const FRAME_GATE_MS = 150

const reduced = (): boolean =>
  typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches

const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/**
 * 「무대를 준비하는 중」 — `maxHold` 를 넘겨도 무대가 안 섰을 때만 켠다.
 *
 * 그림은 인라인으로 그린다. style.css 는 이 세션에서 다른 손이 만지고 있고,
 * 이 표시는 **사고 상황에서만 뜨는 한 줄**이라 전용 클래스를 심을 값을 못 한다.
 * 색·서체는 `.curtain-s` 와 같은 값을 쓴다 — 같은 커튼 위의 글씨는 같아 보여야 한다.
 */
const waitingNote = (): HTMLElement => {
  const el = document.createElement('div')
  el.className = 'curtain-wait'
  el.textContent = '무대를 준비하는 중…'
  el.style.cssText = [
    'position:absolute', 'left:0', 'right:0', 'bottom:12%',
    'text-align:center', 'font-family:var(--serif)', 'font-size:12.5px',
    'letter-spacing:2px', 'color:#d8b48c',
    'text-shadow:0 2px 18px rgba(0,0,0,.8)',
    'opacity:0', 'transition:opacity .6s ease-out',
  ].join(';')
  return el
}

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
    /**
     * 첫 프레임에 클래스를 얹어야 전환이 돈다 — 붙이자마자 바꾸면 브라우저가 한 상태로 본다.
     * 그러나 **rAF 만 기다리면 안 된다** (규칙 ④): 창이 숨겨져 있으면 rAF 가 영원히 안 온다.
     * 포그라운드에서는 rAF 가 ~32ms 에 이기므로 연출은 그대로고, 굶는 창에서만 타이머가 구한다.
     */
    await Promise.race([
      new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))),
      wait(FRAME_GATE_MS),
    ])
    root.classList.add('closed')
    await wait(soft ? 220 : CLOSE_MS)

    /* ② 무대를 바꾼다 — 커튼 뒤에서 */
    // 던져도 커튼은 제 일을 한다 — 여기서 삼키고 아래는 "끝났다" 로만 읽는다.
    const stage = (async () => { await opts.onClosed?.() })()
      .catch((e: unknown) => { console.error('[커튼] 무대 전환 실패', e) })
      .then(() => 'staged' as const)

    const soften = opts.maxHold ?? 8000
    const hard = Math.max(soften, opts.hardHold ?? 30000)
    const first = await Promise.race([stage, wait(soften).then(() => 'slow' as const)])
    if (first === 'slow') {
      /**
       * 무대가 아직 안 섰다 — **여기서 열면 직전 막의 잔해가 드러난다** (규칙 ②).
       * 열지 않고, 기다리고 있다는 사실을 관객에게 적어 준다. 침묵한 채 8초를
       * 더 세우면 그건 멈춘 게임과 구분되지 않는다.
       */
      const note = waitingNote()
      root.appendChild(note)
      setTimeout(() => { note.style.opacity = '1' }, 30)
      await Promise.race([stage, wait(hard - soften)])
      note.remove()
    }
    await wait(opts.minHold ?? (soft ? 120 : 420))

    /* ③ 열린다 */
    opts.play?.('curtain')
    root.classList.add('opening')
    await wait(soft ? 200 : OPEN_MS)
  } finally {
    root.remove()
  }
}
