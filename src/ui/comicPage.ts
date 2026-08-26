/**
 * 만화 페이지 — **칸이 한 장의 종이 위에 쾅쾅 박힌다.**
 *
 * ## 왜 다시 만들었나
 * 예전 인트로는 "전체 화면 그림 한 장 + 자막 + 의성어 하나" 를 한 컷씩 넘겼다.
 * 그건 자막 슬라이드에 만화 양념을 친 것이지 만화가 아니다 — 실제로 그렇게 지적받았다.
 * 레퍼런스(60 Seconds! 계열의 코믹 컷신)의 문법은 반대다:
 * **종이 한 장** 위에 잉크 테두리 칸들이 **차례로 박히고, 먼저 나온 칸은 남는다.**
 * 페이지가 쌓여가는 것이 만화의 시간이다. 컷 전환은 만화의 시간이 아니다.
 *
 * ## 이 모듈이 하는 일
 * 종이(.cpage) 위에 칸(.cpanel)들을 grid 로 배치하고, 하나씩 드러낸다.
 * - 칸: 굵은 잉크 테두리 + 오프셋 그림자 + 살짝 기운 각도 + 망점(하프톤) 오버레이
 * - 서술 상자(.cnarr): 만화의 내레이션 박스 — 누런 종이에 검정 테두리, 칸 모서리에 붙는다
 * - 의성어(.cbam): 두꺼운 외곽선 활자가 칸과 함께 튀어나온다
 * 그림이 없으면 색면 + 큰 활자로 폴백한다 — 이 프로젝트의 모든 에셋과 같은 규칙이다.
 *
 * 인트로와 아웃트로가 같은 문법을 쓰도록 여기 한 곳에 있다 —
 * 다른 문법으로 끝나면 두 개의 게임처럼 읽힌다.
 */

export interface ComicPanel {
  /** grid-area 이름 (p0, p1, …) — 페이지 템플릿의 칸 자리 */
  area: string
  /** 배경 그림 URL. 없으면 색면 폴백 */
  img?: string
  /** 폴백 색면에 박을 강조어 */
  key: string
  /** 서술 상자 문장 */
  line: string
  /** 의성어 — 만화의 정체성 */
  bam?: string
  /** 칸 기울기(deg). 반듯한 칸은 삽화다 */
  tilt?: number
  /** 서술 상자가 붙는 모서리 */
  corner?: 'tl' | 'tr' | 'bl' | 'br'
  /** 이 칸이 드러날 때 낼 소리 */
  voice?: string
  /**
   * 칸 속 모션. 정지 그림은 삽화이고, **그림 안에서 무언가 움직여야 장면**이 된다.
   * 그림 자체는 못 움직이므로 **카메라와 공기**를 움직인다 —
   * 느린 줌·팬(카메라), 형광등 플리커·빗줄기·담배 연기·맥동(공기).
   * 배경을 6% 크게 깔아 팬 여백을 확보한다(.cbg).
   */
  fx?: ('kb-in' | 'kb-out' | 'kb-left' | 'kb-right' | 'flicker' | 'rain' | 'smoke' | 'pulse')[]
}

export interface ComicPageHandle {
  el: HTMLElement
  /** i 번째 칸을 드러낸다 (이미 드러난 칸은 그대로) */
  reveal(i: number): void
  /** i 번째 칸을 다시 덮는다 — 뒤로 넘기기용. 드러나지 않은 칸이면 아무 일도 없다 */
  hide(i: number): void
  count: number
}

/**
 * @param rows grid-template-areas 문자열들 (예: ['p0 p0', 'p1 p2'])
 * @param rowHeights grid-template-rows (예: '38% 34% 28%')
 */
export function buildComicPage(
  panels: ComicPanel[], rows: string[], rowHeights: string,
): ComicPageHandle {
  const page = document.createElement('div')
  page.className = 'cpage'
  page.style.gridTemplateAreas = rows.map((r) => `"${r}"`).join(' ')
  page.style.gridTemplateRows = rowHeights

  const els: HTMLElement[] = []
  for (const p of panels) {
    const cell = document.createElement('div')
    cell.className = 'cpanel'
    cell.style.gridArea = p.area
    cell.style.setProperty('--tilt', `${p.tilt ?? 0}deg`)
    if (p.img) {
      // 그림은 별도 레이어(.cbg)에 깐다 — transform 으로 카메라를 움직이기 위해서다.
      // 칸 자체를 움직이면 테두리·서술 상자까지 흔들린다.
      const bg = document.createElement('div')
      bg.className = 'cbg ' + (p.fx ?? []).filter((f) => f.startsWith('kb-')).join(' ')
      bg.style.backgroundImage = `url(${p.img})`
      cell.appendChild(bg)
      for (const f of p.fx ?? []) {
        if (f.startsWith('kb-')) continue
        const fx = document.createElement('div')
        fx.className = `cfx ${f}`
        cell.appendChild(fx)
      }
    } else {
      cell.classList.add('noimg')
      const big = document.createElement('span')
      big.className = 'ckey'
      big.textContent = p.key
      cell.appendChild(big)
    }

    const narr = document.createElement('div')
    narr.className = `cnarr ${p.corner ?? 'tl'}`
    narr.textContent = p.line
    cell.appendChild(narr)

    if (p.bam) {
      const bam = document.createElement('span')
      bam.className = 'cbam'
      bam.textContent = p.bam
      cell.appendChild(bam)
    }
    page.appendChild(cell)
    els.push(cell)
  }

  return {
    el: page,
    count: panels.length,
    reveal(i: number) {
      const c = els[i]
      if (c) c.classList.add('on')
    },
    hide(i: number) {
      const c = els[i]
      if (c) c.classList.remove('on')
    },
  }
}
