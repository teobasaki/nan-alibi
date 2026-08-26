/**
 * AI 파이프라인 대시보드 — **아키텍처를 화면에 드러낸다.**
 *
 * ## 왜 설정창이 아니라 대시보드인가
 * 고칠 수 있는 항목은 둘뿐이다(음성 공급자·연기 강도). 그것만이면 설정창이다.
 * 여기서 더 중요한 건 **무엇이 무엇을 하고 있는지 보이는 것**이다 —
 * 어떤 모델이 대사를 쓰고, 누가 그것을 검증하고, 어디서 시간이 갔는지.
 *
 * 이 게임의 설계 명제는 "AI 가 만들게 하되, AI 가 판정하게 두지 않는다" 이고,
 * 그 경계는 코드에는 있지만 화면에는 없었다. 이 판이 그걸 보이게 한다.
 *
 * ## 없는 것은 없다고 쓴다
 * `/api/health` 가 알려주는 키 보유 여부로 공급자 줄을 칠한다.
 * 키가 없는 공급자를 고를 수 있게 두면, 골랐는데 아무 일도 안 일어나는 화면이 된다.
 * **연결 안 된 것을 연결된 것처럼 그리지 않는다.**
 */

import { lastTimings, STAGE_LABEL, type Stage } from './pipeline'
import { settings, update, type VoiceMode } from './settings'
import { isDisabled as ttsDisabled } from './tts/supertone'

interface Providers {
  llm: boolean
  tts: boolean
  sfx: boolean
}

let providers: Providers | null = null

/** 브리핑에서 1회. 실패해도 게임은 그대로 간다 — 대시보드는 편의 기능이다. */
export async function probeProviders(): Promise<void> {
  try {
    const r = await fetch('/api/health')
    const j = await r.json()
    providers = j?.providers ?? null
  } catch {
    providers = null
  }
}

const h = (tag: string, cls?: string, text?: string): HTMLElement => {
  const el = document.createElement(tag)
  if (cls) el.className = cls
  if (text !== undefined) el.textContent = text
  return el
}

const ms = (n?: number): string => (n === undefined ? '—' : `${n}ms`)

/** 파이프라인 한 줄: 무엇이 · 무엇을 · 얼마나 */
function row(stage: Exclude<Stage, 'idle'>, who: string, live: boolean | null): HTMLElement {
  const t = lastTimings()
  const r = h('div', `dbrow${live === false ? ' off' : ''}`)
  r.appendChild(h('span', 'db-k', STAGE_LABEL[stage]))
  r.appendChild(h('span', 'db-who', who))
  r.appendChild(h('span', 'db-ms', ms(t[stage])))
  return r
}

export function dashboard(onChange: () => void): HTMLElement {
  const s = settings()
  const box = h('div', 'dash')

  box.appendChild(h('div', 'cap', 'AI 파이프라인'))
  box.appendChild(h('div', 'sub',
    '대사는 AI 가 쓰고, 규칙과 승패는 코드가 갖는다. ' +
    '아래는 지금 이 판에서 각 단계가 누구를 거쳤고 얼마나 걸렸는지다.'))

  const p = providers
  box.appendChild(row('thinking', p === null ? 'OpenAI' : p.llm ? 'OpenAI · gpt-5.6-terra' : 'AI 없음 — 폴백 대사', p?.llm ?? null))
  box.appendChild(row('verifying', '코드 · 화이트리스트 3중 검증', true))
  box.appendChild(row('synthesizing',
    s.voice === 'off' ? '꺼짐'
      : s.voice === 'local' ? '브라우저 내장'
      : p?.tts === false ? 'Supertone 미연결 — 내장으로'
      : ttsDisabled() ? 'Supertone 응답 없음 — 내장으로'
      : s.voice === 'key' ? 'Supertone · 중요한 대사만'
      : 'Supertone',
    s.voice === 'off' ? false : (p?.tts ?? null)))
  box.appendChild(row('speaking',
    s.voice === 'off' ? '무음' : s.voice === 'key' ? '흔들린 순간에만' : '재생',
    s.voice !== 'off'))

  // 판정은 AI 가 하지 않는다 — 그 사실 자체가 이 화면에서 가장 중요한 한 줄이다
  const owned = h('div', 'dbnote')
  owned.appendChild(h('strong', undefined, '판정은 AI 를 거치지 않는다. '))
  owned.appendChild(document.createTextNode(
    '자원·모순·채점은 전부 코드가 계산한다. AI 응답이 실패하면 조사 횟수를 돌려준다.'))
  box.appendChild(owned)

  // ── 조작 ──
  box.appendChild(h('div', 'cap', '음성'))
  const modes: [VoiceMode, string, string][] = [
    ['key', '중요한 대사만', '진술이 흔들리거나 기록을 들이민 순간에만 (기본)'],
    ['auto', '전부 읽기', '서버 음성을 1.5초까지 기다리고, 늦으면 내장으로'],
    ['local', '내장만', '브라우저 합성. 지연 없음'],
    ['off', '끄기', '자막만'],
  ]
  const group = h('div', 'dbmodes')
  for (const [m, label, why] of modes) {
    const b = h('button', `dbmode${s.voice === m ? ' on' : ''}`) as HTMLButtonElement
    b.appendChild(h('span', 'dbm-l', label))
    b.appendChild(h('span', 'dbm-w', why))
    b.setAttribute('aria-pressed', String(s.voice === m))
    b.onclick = () => { update({ voice: m }); onChange() }
    group.appendChild(b)
  }
  box.appendChild(group)

  const int = h('div', 'dbslider')
  const lab = h('label', undefined, `연기 강도 ${s.intensity.toFixed(1)}×`)
  const input = document.createElement('input')
  input.type = 'range'
  input.min = '0'
  input.max = '1.5'
  input.step = '0.1'
  input.value = String(s.intensity)
  input.setAttribute('aria-label', '연기 강도')
  input.oninput = () => { lab.textContent = `연기 강도 ${Number(input.value).toFixed(1)}×` }
  input.onchange = () => { update({ intensity: Number(input.value) }); onChange() }
  int.append(lab, input)
  box.appendChild(int)
  box.appendChild(h('div', 'hintline',
    '동요가 클수록 목소리가 흔들린다. 0이면 평이하게 읽는다.'))

  return box
}
