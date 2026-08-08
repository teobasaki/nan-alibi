/**
 * 플레이어가 바꿀 수 있는 것 — **게임 규칙은 여기 없다.**
 *
 * 음성 공급자·연기 강도처럼 **승패에 영향이 없는 것만** 둔다.
 * 조사 횟수나 난이도가 여기 들어오는 순간 클라이언트가 규칙을 소유하게 되고,
 * 그건 이 프로젝트가 처음부터 지켜 온 경계(규칙은 엔진, 화면은 그리기)를 무너뜨린다.
 *
 * 순수 함수로 두어 브라우저 없이 테스트한다. 저장소 접근은 주입받는다.
 */

export type VoiceMode = 'auto' | 'local' | 'off'

export interface Settings {
  /** auto = 서버 음성을 예산 안에서 시도하고 실패하면 내장. local = 내장만. off = 무음 */
  voice: VoiceMode
  /** 연기 강도 배율 0~1.5. 1이 기본 */
  intensity: number
}

export const DEFAULTS: Settings = { voice: 'auto', intensity: 1 }

const KEY = 'nan-alibi:settings'
const VOICE_MODES: VoiceMode[] = ['auto', 'local', 'off']

/**
 * 저장된 값을 **신뢰하지 않고** 정규화한다.
 * localStorage 는 사용자가 직접 고칠 수 있고, 옛 버전이 남긴 값도 온다.
 * 이상한 값이 들어오면 기본값으로 떨어뜨린다 — 설정 하나 때문에 게임이 안 뜨면 안 된다.
 */
export function normalize(raw: unknown): Settings {
  if (typeof raw !== 'object' || raw === null) return { ...DEFAULTS }
  const o = raw as Record<string, unknown>
  const voice = VOICE_MODES.includes(o.voice as VoiceMode) ? (o.voice as VoiceMode) : DEFAULTS.voice
  const n = typeof o.intensity === 'number' && Number.isFinite(o.intensity) ? o.intensity : DEFAULTS.intensity
  return { voice, intensity: Math.min(1.5, Math.max(0, n)) }
}

export function load(store?: Pick<Storage, 'getItem'>): Settings {
  const s = store ?? (typeof localStorage !== 'undefined' ? localStorage : undefined)
  if (!s) return { ...DEFAULTS }
  try {
    return normalize(JSON.parse(s.getItem(KEY) ?? 'null'))
  } catch {
    return { ...DEFAULTS }
  }
}

export function save(next: Settings, store?: Pick<Storage, 'setItem'>): void {
  const s = store ?? (typeof localStorage !== 'undefined' ? localStorage : undefined)
  try {
    s?.setItem(KEY, JSON.stringify(normalize(next)))
  } catch {
    // 사파리 프라이빗 모드 등에서 쓰기가 막힌다. 설정이 안 남는 건 불편이지 고장이 아니다.
  }
}

let current: Settings | null = null

export function settings(): Settings {
  current ??= load()
  return current
}

export function update(patch: Partial<Settings>): Settings {
  current = normalize({ ...settings(), ...patch })
  save(current)
  return current
}
