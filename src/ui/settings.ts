/**
 * 플레이어가 바꿀 수 있는 것 — **게임 규칙은 여기 없다.**
 *
 * 음성 공급자·연기 강도처럼 **승패에 영향이 없는 것만** 둔다.
 * 조사 횟수나 난이도가 여기 들어오는 순간 클라이언트가 규칙을 소유하게 되고,
 * 그건 이 프로젝트가 처음부터 지켜 온 경계(규칙은 엔진, 화면은 그리기)를 무너뜨린다.
 *
 * 순수 함수로 두어 브라우저 없이 테스트한다. 저장소 접근은 주입받는다.
 */

/**
 * `auto`  서버 음성(Supertone)을 예산 안에서 시도하고 실패하면 내장
 * `key`   **중요한 대사만** 소리를 낸다 (기본값 — 팀 3-3-(4) 2단계). 평상시 대화는 자막만
 * `local` 내장 합성만. 지연 없음
 * `off`   무음
 */
export type VoiceMode = 'auto' | 'key' | 'local' | 'off'

export interface Settings {
  voice: VoiceMode
  /** 연기 강도 배율 0~1.5. 1이 기본 */
  intensity: number
}

/**
 * **기본값이 `key` 인 이유** (팀 3-3-(4)).
 *
 * 팀 지적: *"현재 TTS 의 발음과 억양이 자연스럽지 않은 부분이 있고, 오히려 캐릭터의
 * 몰입감을 떨어뜨릴 가능성이 있다 … TTS 는 기술이 적용되어 있다는 이유로 유지하기보다
 * 현재 품질이 게임의 몰입감을 실제로 높이는지를 기준으로 판단해야 한다."*
 *
 * 품질 판정은 사람이 들어야 하는 일이라 코드가 대신할 수 없다. 그래서 **끄지 않고
 * 줄였다** — 2단계의 "중요한 대사에만 제한적으로" 를 기본으로 삼는다. 근거 셋:
 *   ① 되돌릴 수 있다. 팀이 들어 보고 판단하면 `auto`(전량)·`off`(제거) 어느 쪽으로도 한 칸이다
 *   ② 비용이 대사 수에 비례해 줄어든다 — 한 판 대화 50회 중 소리가 나는 것은 흔들린 순간뿐이다
 *   ③ 부자연스러움이 가장 덜 드러나는 자리에만 남는다. 평상시 대화가 계속 어색한 것과,
 *      결정적인 순간에 목소리가 갈라지는 것은 몰입에 미치는 방향이 반대다
 */
export const DEFAULTS: Settings = { voice: 'key', intensity: 1 }

const KEY = 'nan-alibi:settings'
const VOICE_MODES: VoiceMode[] = ['auto', 'key', 'local', 'off']

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
