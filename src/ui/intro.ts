/**
 * 오프닝 — **만화 페이지에 사건이 박힌다.**
 *
 * ## 왜 그림은 범용이고 글은 구체적인가
 * 사건은 매 판 시드로 생성된다 — 제목·호텔·피해자·다섯 사람의 이름과 직업이 전부 달라진다.
 * 그림을 사건별로 만들 수는 없다. 그래서 **그림은 어느 사건에도 맞는 다섯 장**(밤의 호텔,
 * 복도, 열린 문, 다섯 그림자, 사건 파일)으로 고정하고, **구체적인 것은 전부 서술 상자가 진다.**
 * 이러면 시드가 바뀌어도 인트로가 거짓말을 하지 않는다.
 *
 * ## 왜 페이지인가 (컷 전환이 아니라)
 * 예전엔 전체 화면 그림을 한 장씩 넘겼다 — 자막 슬라이드지 만화가 아니라고 지적받았고,
 * 맞는 말이었다. 만화의 시간은 **칸이 종이 위에 쌓이는 것**이다. 먼저 나온 칸이 남아
 * 있어야 다음 칸이 "다음" 이 된다. 페이지 문법은 `comicPage.ts` 가 소유한다.
 *
 * ## 그림이 없어도 돈다
 * `public/intro/0.webp` … `4.webp` 가 없으면 각 칸은 색면+큰 활자로 폴백한다.
 */

import { CRIME_SLOT, SLOT_LABEL, SUSPECTS, type CaseFile } from '../types'
import { buildComicPage, type ComicPanel } from './comicPage'
import { play } from './sound'
import { josa } from '../josa'

const FILES = import.meta.glob('/public/intro/*.{webp,png,jpg}', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>

const PANEL_URL = new Map<string, string>()
for (const [path, url] of Object.entries(FILES)) {
  const name = path.split('/').pop()?.replace(/\.\w+$/, '')
  if (name) PANEL_URL.set(name, (url as string).replace(/^\/public/, ''))
}

/**
 * 페이지 배치 — 다섯 칸이 한 페이지에 쌓인다.
 * 0(호텔)은 상단 전폭, 2(발견)는 이 페이지의 **머니샷**이라 크게,
 * 4(다섯 중 하나)는 마지막이라 넓게 깔린다.
 */
function panels(c: CaseFile): ComicPanel[] {
  const five = SUSPECTS.map((s) => c.suspects[s].job).join(' · ')
  return [
    { area: 'p0', img: PANEL_URL.get('0'), key: '어젯밤', corner: 'tl', tilt: -0.8,
      line: `어젯밤, ${c.venue.name}.` },
    { area: 'p1', img: PANEL_URL.get('1'), key: SLOT_LABEL[CRIME_SLOT], corner: 'tl', tilt: 0.9, bam: '치지직',
      line: `${SLOT_LABEL[CRIME_SLOT]}. 12층 복도의 불이 반쯤 나가 있었다.` },
    { area: 'p2', img: PANEL_URL.get('2'), key: c.venue.room, corner: 'bl', tilt: -1.2, bam: '쿵—',
      line: `${c.venue.room}에서 ${c.victim.title} ${josa(c.victim.name, '이/가')} 숨진 채 발견됐다.` },
    { area: 'p3', img: PANEL_URL.get('3'), key: '다섯', corner: 'tr', tilt: 0.7,
      line: `호텔에 남아 있던 다섯 사람 — ${five}.` },
    { area: 'p4', img: PANEL_URL.get('4'), key: '한 명', corner: 'br', tilt: -0.6, bam: '?!',
      line: '다섯 모두 그 시간엔 다른 곳에 있었다고 말한다. 그중 한 명이 범인이다.' },
  ]
}

/** 칸 사이 호흡. 첫 칸만 조금 길다 — 제목을 읽는 시간이다. */
const HOLD_FIRST = 2900
const HOLD = 2500

/**
 * `?introhold=1` — 자동 진행을 끄고 클릭으로만 넘긴다.
 * 제출 영상을 찍을 때 내레이션에 맞춰 손으로 페이지를 넘기기 위한 스위치다.
 * (검증 스크린샷에도 쓴다 — 자동 진행은 셔터보다 빠르다.)
 */
const HOLD_MANUAL = new URLSearchParams(location.search).has('introhold')

/**
 * 인트로를 재생한다. 끝나거나 건너뛰면 resolve.
 * 마지막 칸 뒤에는 페이지 전체가 잠깐 남는다 — 완성된 페이지를 보는 한 박자.
 * 그 뒤 흰빛으로 타올라 브리핑으로 넘어간다.
 */
export function playIntro(c: CaseFile): Promise<void> {
  return new Promise((resolve) => {
    const still = matchMedia('(prefers-reduced-motion: reduce)').matches
    const ov = document.createElement('div')
    ov.className = 'intro comic'

    const page = buildComicPage(panels(c), ['p0 p0', 'p1 p2', 'p3 p4'], '36% 36% 28%')

    const bar = document.createElement('div')
    bar.className = 'intro-bar'
    for (let i = 0; i < page.count; i++) bar.appendChild(document.createElement('i'))

    const skip = document.createElement('button')
    skip.className = 'intro-skip'
    skip.textContent = '건너뛰기 (Esc)'

    const title = document.createElement('div')
    title.className = 'intro-title'
    title.textContent = c.title

    ov.append(page.el, title, bar, skip)
    document.body.appendChild(ov)

    let idx = -1
    let timer = 0
    let done = false

    const finish = (): void => {
      if (done) return
      done = true
      clearTimeout(timer)
      removeEventListener('keydown', onKey)
      ov.classList.add('out')     // 흰빛으로 타오르며 브리핑으로 넘어간다
      setTimeout(() => { ov.remove(); resolve() }, 700)
    }

    const show = (i: number): void => {
      if (i >= page.count) {
        // 완성된 페이지를 한 박자 보여 주고 나간다
        if (!HOLD_MANUAL) timer = window.setTimeout(finish, still ? 400 : 1500)
        return
      }
      idx = i
      page.reveal(i)
      Array.from(bar.children).forEach((d, k) => d.classList.toggle('on', k <= i))
      play('paper')
      if (!HOLD_MANUAL) timer = window.setTimeout(() => show(i + 1), still ? 900 : (i === 0 ? HOLD_FIRST : HOLD))
    }

    const next = (): void => {
      clearTimeout(timer)
      show(idx + 1)
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') finish()
      else if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); next() }
    }
    addEventListener('keydown', onKey)
    ov.onclick = (e) => { if (e.target !== skip) next() }
    skip.onclick = (e) => { e.stopPropagation(); finish() }

    show(0)
  })
}
