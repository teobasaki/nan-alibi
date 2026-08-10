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
import { buildComicPage, type ComicPageHandle, type ComicPanel } from './comicPage'
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
 * 시드 사건 발단 — 3페이지. gc001 과 같은 감정 문법을 탄다:
 * 평온→위화감 / 충격 / 호기심. 한 페이지에 다 넣었을 때
 * "너무 몰아넣었다"는 지적을 받았고, 페이지가 곧 감정 단락이 되도록 갈랐다.
 *
 * 그림 다섯 장은 **호텔을 그린 것**이다. 월드 스킨(경매장·방송국·극장)이 입혀진
 * 사건에서 이 그림을 그대로 쓰면 인트로가 첫 화면부터 거짓말을 한다 —
 * 그래서 월드 사건은 그림 없이 색면+활자 폴백으로 간다 (전 에셋 공통 규칙).
 * 월드별 카툰이 생기면 여기서 갈아 끼우면 된다.
 */
function hotelPages(c: CaseFile): ComicPageDef[] {
  const five = SUSPECTS.map((s) => c.suspects[s].job).join(' · ')
  const themed = !c.world           // 호텔(기본 세계)일 때만 호텔 그림을 쓴다
  const img = (n: string): string | undefined => (themed ? PANEL_URL.get(n) : undefined)
  return [
    { // 1면 — 평온함이 식어 간다 (종이는 2열 그리드 — 전폭 칸은 두 토큰으로 스팬)
      rows: ['p0 p0', 'p1 p1'], heights: '54% 46%',
      panels: [
        { area: 'p0', img: img('0'), key: '어젯밤', corner: 'tl', tilt: -0.8,
          line: `어젯밤, ${c.venue.name}. 비가 막 그친 밤이었다.`, fx: ['kb-in', 'rain'] },
        { area: 'p1', img: img('1'), key: SLOT_LABEL[CRIME_SLOT], corner: 'bl', tilt: 0.9, bam: '치지직',
          line: `${SLOT_LABEL[CRIME_SLOT]}. ${themed ? '12층 복도' : '복도'}의 불이 반쯤 나가 있었다.`, fx: ['kb-in', 'flicker'] },
      ] },
    { // 2면 — 충격. 스플래시 한 칸이 페이지 전체를 먹는다.
      rows: ['p2 p2'], heights: '100%',
      panels: [
        { area: 'p2', img: img('2'), key: c.venue.room, corner: 'bl', tilt: -1.2, bam: '쿵—',
          line: `${c.venue.room}. ${c.victim.title} ${josa(c.victim.name, '이/가')} 숨진 채 발견됐다.`, fx: ['kb-in', 'pulse'] },
      ] },
    { // 3면 — 호기심. 다섯 그림자와 사건 파일.
      rows: ['p3 p3', 'p4 p4'], heights: '50% 50%',
      panels: [
        { area: 'p3', img: img('3'), key: '다섯', corner: 'tr', tilt: 0.7,
          line: `${c.venue.name}에 남아 있던 사람은 다섯 — ${five}.`, fx: ['kb-left', 'smoke'] },
        { area: 'p4', img: img('4'), key: '한 명', corner: 'br', tilt: -0.6, bam: '?!',
          line: '다섯 모두 그 시간엔 다른 곳에 있었다고 말한다. 그중 한 명이 범인이다.', fx: ['kb-out'] },
      ] },
  ]
}

/**
 * ## 골든 케이스 001 — 「옮겨진 상자의 사각」 (`?case=gc001`)
 * 팀의 고정 시나리오(라음 사립 갤러리)는 시드 생성 사건이 아니라 **작성된 사건**이다.
 * 그 발단 카툰은 감정선이 계약이다: 평온함 → 위화감 → 충격 → 호기심 (팀 UX 문서).
 * 한 페이지에 다 넣으면 감정이 섞이므로 **페이지 셋으로 갈라** 페이지가 넘어갈 때
 * 감정도 넘어가게 한다. 그림 10장은 `public/intro/gc001/`, 프롬프트 정본은
 * `docs/content/GC001-발단카툰-프롬프트.md`.
 */
const GC_FILES = import.meta.glob('/public/intro/gc001/*.webp', {
  eager: true, query: '?url', import: 'default',
}) as Record<string, string>
const GC_URL = new Map<string, string>()
for (const [path, url] of Object.entries(GC_FILES)) {
  const name = path.split('/').pop()?.replace(/\.\w+$/, '')
  if (name) GC_URL.set(name, (url as string).replace(/^\/public/, ''))
}

interface ComicPageDef { rows: string[]; heights: string; panels: ComicPanel[] }

/** 골든 케이스 발단 — 페이지가 곧 감정 단락이다 */
function gc001Pages(): ComicPageDef[] {
  const g = (n: number): string | undefined => GC_URL.get(String(n))
  return [
    { // 1면 — 평온함. 따뜻한 광량, 기울기 거의 0.
      rows: ['p0 p0', 'p1 p2'], heights: '52% 48%',
      panels: [
        { area: 'p0', img: g(0), key: '저녁', corner: 'tl', tilt: -0.4, fx: ['kb-in'],
          line: '라음 사립 갤러리. 폐관을 앞둔 저녁이었다.' },
        { area: 'p1', img: g(1), key: '전시홀', corner: 'bl', tilt: 0.4, fx: ['kb-left'],
          line: '메인 전시홀은 여느 날과 같았다. 모든 것이 제자리에 있었다.' },
        { area: 'p2', img: g(2), key: '이상 없음', corner: 'br', tilt: -0.5, fx: ['kb-in'],
          line: '20:40 — 폐관 전 점검. 전시 받침대, 이상 없음.' },
      ] },
    { // 2면 — 위화감. 조명이 식고 칸이 기운다.
      rows: ['p3 p4', 'p5 p5'], heights: '48% 52%',
      panels: [
        { area: 'p3', img: g(3), key: '파티션', corner: 'tl', tilt: 1.1, fx: ['kb-right'], bam: '끼익',
          line: '21:03. 파티션이 움직였다. 아무도 이유를 말하지 않았다.' },
        { area: 'p4', img: g(4), key: '반입문', corner: 'tr', tilt: -0.9, fx: ['kb-in', 'flicker'],
          line: '21:04. 반입문이 열렸다 — 열렸다는 기록뿐, 누가 지나갔는지는 남지 않았다.' },
        { area: 'p5', img: g(5), key: '상자', corner: 'bl', tilt: 0.8, fx: ['kb-left'], bam: '드르륵',
          line: '21:09. 예정에 없던 상자가 움직였고, 카메라에 좁은 시야가 열렸다.' },
      ] },
    { // 3면 — 충격, 그리고 호기심. 단일 광원 → 램프 아래 클로즈업.
      rows: ['p6 p6', 'p7 p8', 'p9 p9'], heights: '42% 29% 29%',
      panels: [
        { area: 'p6', img: g(6), key: '21:21', corner: 'tl', tilt: -1.2, fx: ['kb-in', 'pulse'], bam: '……!',
          line: '21:21. 관장 한라온이 전시 받침대 옆에서 발견됐다.' },
        { area: 'p7', img: g(7), key: '지직', corner: 'bl', tilt: 0.9, fx: ['flicker'], bam: '지직',
          line: '21:15까지 그의 목소리가 확인됐다. 21:18, 카메라에는 얼굴 없는 누군가가 찍혔다.' },
        { area: 'p8', img: g(8), key: '다섯', corner: 'br', tilt: -0.6, fx: ['kb-left', 'smoke'],
          line: '폐관 뒤 접근할 수 있었던 사람은 다섯 — 운영·큐레이터·운송·보존·보안.' },
        { area: 'p9', img: g(9), key: '?', corner: 'br', tilt: 0.5, fx: ['kb-in'], bam: '?!',
          line: '받침대는 사고처럼 보였다. 그러나 라벨은 새것이었다 — 수사가 시작된다.' },
      ] },
  ]
}

/**
 * **인트로는 손으로 넘긴다** (2026-08-10 사용자 지시).
 *
 * 예전엔 1.5~2.4초마다 자동으로 넘어갔다. 읽는 속도는 사람마다 다른데 화면이 먼저
 * 가버리니, 문장을 놓친 채 다음 컷을 보게 된다 — 만화는 읽는 매체이지 재생되는
 * 매체가 아니다. 이제 클릭·스페이스·엔터로만 넘어간다.
 * `?introauto=1` 은 옛 자동 진행 — 시연 영상 녹화용으로만 남긴다.
 */
const HOLD_MANUAL = !new URLSearchParams(location.search).has('introauto')

/**
 * 인트로를 재생한다. 끝나거나 건너뛰면 resolve.
 * 마지막 칸 뒤에는 페이지 전체가 잠깐 남는다 — 완성된 페이지를 보는 한 박자.
 * 그 뒤 흰빛으로 타올라 브리핑으로 넘어간다.
 */
export function playIntro(c: CaseFile): Promise<void> {
  // 골든 케이스 경로 — 시드 사건이 아니라 작성된 사건의 발단이다
  if (new URLSearchParams(location.search).get('case') === 'gc001') {
    return playComicBook(gc001Pages(), '옮겨진 상자의 사각')
  }
  return playComicBook(hotelPages(c), c.title)
}


/**
 * 만화책 재생 — **페이지 여러 장을 넘긴다.**
 * 한 페이지 안에서는 칸이 쌓이고(만화의 시간), 페이지가 다 차면
 * 종이가 넘어간다(단락의 시간). 감정 단락 하나 = 페이지 하나.
 */
function playComicBook(pages: ComicPageDef[], title: string): Promise<void> {
  return new Promise((resolve) => {
    const still = matchMedia('(prefers-reduced-motion: reduce)').matches
    const total = pages.reduce((n, p) => n + p.panels.length, 0)

    const ov = document.createElement('div')
    ov.className = 'intro comic'

    const bar = document.createElement('div')
    bar.className = 'intro-bar'
    for (let i = 0; i < total; i++) bar.appendChild(document.createElement('i'))

    const skip = document.createElement('button')
    skip.className = 'intro-skip'
    skip.textContent = '건너뛰기 (Esc)'

    // 손으로 넘기는 만큼, 넘기는 법을 화면이 말한다 — 안 그러면 멈춘 줄 안다
    const advHint = document.createElement('div')
    advHint.className = 'intro-adv'
    advHint.textContent = '클릭 · 스페이스로 다음 칸'

    const cap = document.createElement('div')
    cap.className = 'intro-title'
    cap.textContent = title

    let handle: ComicPageHandle | null = null
    let pageIdx = -1
    let panelIdx = -1     // 현재 페이지 안에서의 칸 번호
    let shown = 0         // 전체 진행 (점 표시용)
    let timer = 0
    let done = false

    const finish = (): void => {
      if (done) return
      done = true
      clearTimeout(timer)
      removeEventListener('keydown', onKey)
      ov.classList.add('out')
      setTimeout(() => { ov.remove(); resolve() }, 700)
    }

    const nextPage = (): void => {
      pageIdx += 1
      if (pageIdx >= pages.length) {
        if (!HOLD_MANUAL) timer = window.setTimeout(finish, still ? 400 : 1600)
        return
      }
      const def = pages[pageIdx]!
      const fresh = buildComicPage(def.panels, def.rows, def.heights)
      if (handle) {
        // 종이가 넘어간다 — 이전 페이지는 왼쪽으로 젖혀지며 사라진다
        const old = handle.el
        old.classList.add('page-out')
        setTimeout(() => old.remove(), still ? 0 : 650)
        fresh.el.classList.add('page-in')
        play('page')          // 칸의 'paper' 보다 크고 무거운 종이 — 단락이 넘어간다
      }
      handle = fresh
      panelIdx = -1
      ov.insertBefore(fresh.el, cap)
      step()
    }

    const step = (): void => {
      if (!handle) return
      panelIdx += 1
      if (panelIdx >= handle.count) {
        // 페이지가 찼다 — 한 박자 보여주고 넘긴다
        // 수동 모드(introhold)에서는 클릭이 nextPage 를 부른다
        if (!HOLD_MANUAL) timer = window.setTimeout(nextPage, still ? 500 : 1500)
        return
      }
      handle.reveal(panelIdx)
      shown += 1
      Array.from(bar.children).forEach((d, k) => d.classList.toggle('on', k < shown))
      play('paper')
      if (!HOLD_MANUAL) timer = window.setTimeout(step, still ? 850 : 2400)
    }

    const next = (): void => {
      clearTimeout(timer)
      if (handle && panelIdx >= handle.count - 1 && panelIdx !== -1) nextPage()
      else step()
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') finish()
      else if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); next() }
    }
    addEventListener('keydown', onKey)
    ov.onclick = (e) => { if (e.target !== skip) next() }
    skip.onclick = (e) => { e.stopPropagation(); finish() }

    ov.append(cap, bar, skip, advHint)
    document.body.appendChild(ov)
    nextPage()
  })
}
