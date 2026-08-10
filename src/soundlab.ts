/**
 * 사운드 시청실 — **같은 프롬프트의 두 생성본을 나란히 듣는다.**
 *
 * dev 전용이다 (soundlab.html — 빌드 인풋에 없음). 비교 축:
 *   VARCO  — public/sfx/<키>.opus (배포에 실린 그 소리, 트림·페이드 후)
 *   ComfyUI — ~/AI/comfy-vs-varco/comfy-<키>.wav (/@fs/, Stable Audio 3 로컬 생성 원본)
 *
 * 명세(sfxSpec.ts)가 유일한 입력이다 — 키·프롬프트·순간이 전부 저기서 온다.
 * ComfyUI 파일은 생성이 끝나는 대로 떨어지므로 10초마다 존재를 다시 확인한다.
 */
import { SFX } from './ui/sfxSpec'

const VARCO = (k: string): string => `/sfx/${k}.opus`
const COMFY = (k: string): string => `/@fs/Users/teo/AI/comfy-vs-varco/comfy-${k}.wav`

const rows = document.getElementById('rows')!
let playing: HTMLAudioElement | null = null
let playingBtn: HTMLButtonElement | null = null

function stop(): void {
  playing?.pause()
  playingBtn?.classList.remove('playing')
  playing = null; playingBtn = null
}

function playUrl(url: string, btn: HTMLButtonElement, vol = 1): Promise<void> {
  return new Promise((res) => {
    stop()
    const a = new Audio(url)
    a.volume = vol
    playing = a; playingBtn = btn
    btn.classList.add('playing')
    a.onended = () => { if (playing === a) stop(); res() }
    a.onerror = () => { if (playing === a) stop(); res() }
    void a.play().catch(() => res())
  })
}

interface Row { key: string; varcoBtn: HTMLButtonElement; comfyBtn: HTMLButtonElement; abBtn: HTMLButtonElement; miss: HTMLElement }
const table: Row[] = []

for (const s of SFX) {
  const row = document.createElement('div')
  row.className = 'row'
  row.innerHTML = `
    <div class="key">${s.key}</div>
    <div class="moment">${s.moment} — <i>${s.meaning}</i></div>
    <div class="prompt">${s.prompt}</div>`
  const btns = document.createElement('div')
  btns.className = 'btns'

  const v = document.createElement('button')
  v.textContent = '▶ VARCO'
  v.onclick = () => void playUrl(VARCO(s.key), v)

  const c = document.createElement('button')
  c.textContent = '▶ ComfyUI'
  c.disabled = true
  c.onclick = () => void playUrl(COMFY(s.key), c, 0.8)   // 원본 라우드니스가 제각각이라 살짝 눌러 시작

  const ab = document.createElement('button')
  ab.className = 'ab'
  ab.textContent = 'A/B'
  ab.disabled = true
  ab.onclick = async () => {
    await playUrl(VARCO(s.key), v)
    await new Promise((r) => setTimeout(r, 600))
    await playUrl(COMFY(s.key), c, 0.8)
  }

  const miss = document.createElement('span')
  miss.className = 'miss'
  miss.textContent = 'ComfyUI 생성 대기 중'

  btns.append(v, c, miss, ab)
  row.appendChild(btns)
  rows.appendChild(row)
  table.push({ key: s.key, varcoBtn: v, comfyBtn: c, abBtn: ab, miss })

  // VARCO 쪽도 없으면(생성 실패분) 표시
  void fetch(VARCO(s.key), { method: 'HEAD' }).then((r) => {
    if (!r.ok) { v.disabled = true; v.textContent = '✕ VARCO(합성 폴백만)' }
  })
}

/** ComfyUI 생성물은 에이전트가 떨구는 대로 나타난다 — 10초마다 존재 확인 */
async function refresh(): Promise<void> {
  await Promise.all(table.map(async (r) => {
    try {
      // vite 는 없는 경로에 index.html 폴백(200)을 준다 — content-type 으로 진짜 오디오만 인정
      const res = await fetch(COMFY(r.key), { method: 'HEAD' })
      const ok = res.ok && !(res.headers.get('content-type') ?? '').includes('html')
      r.comfyBtn.disabled = !ok
      r.abBtn.disabled = !ok
      r.miss.textContent = ok ? '' : 'ComfyUI 생성 대기 중'
    } catch { /* 대기 유지 */ }
  }))
}
void refresh()
setInterval(() => void refresh(), 10_000)
