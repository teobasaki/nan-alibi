/**
 * 인물 사진 — **에셋이 없어도 게임이 돌아간다.**
 *
 * 사진은 이름이 아니라 **배역**(cast tag)에 묶는다. 이름은 매 판 생성되지만
 * 배역은 슬롯 고정이라, 배역에 묶으면
 *   ① 이름과 얼굴이 어긋나는 일이 없고
 *   ② 판을 거듭할수록 "저 보안 팀장" 처럼 배역이 기억에 남는다
 *
 * ## 사진은 그리지 않는다 — **런타임 3D 모델에서 굽는다**
 * 카드월의 얼굴과 취조실에서 움직이는 3D 얼굴이 다르면 플레이어는 인물 추적을
 * 포기한다. 그래서 초상은 `public/characters/<tag>.idle.opt.glb` 를 그대로 렌더한
 * 결과다 — 원본이 하나라 어긋날 여지가 없다. 굽는 법은
 * `scripts/render-portraits.py` (Blender 헤드리스 · EEVEE · 다섯 명 동일 카메라/조명).
 *
 * 배역이 바뀌면 **파일 이름만 새 태그로 맞추면 된다** — 여기 코드는 안 건드린다.
 * 배역 교체 직후처럼 파일이 아직 없으면 `null` 을 돌려주고, 호출부는 놋쇠 명패로
 * 되돌아간다. 그래서 **에셋 0장 상태에서도 화면이 안 깨진다.**
 */

import { CAST } from './cast'

/**
 * 어떤 역할의 사진이 실제로 존재하는지 빌드 타임에 알아낸다.
 * `import.meta.glob` 은 Vite 가 번들 시점에 정적으로 해석한다 — 런타임 404 탐색이 없다.
 */
const FILES = import.meta.glob('/public/portraits/*.{webp,jpg,png}', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>

const BY_SLUG = new Map<string, string>()
for (const [path, url] of Object.entries(FILES)) {
  const name = path.split('/').pop()?.replace(/\.\w+$/, '')
  if (name) BY_SLUG.set(name, (url as string).replace(/^\/public/, ''))
}

/** 지금 배역표가 실제로 쓰는 사진만. 폴더에는 **옛 배역의 사진도 남아 있다** — 출처
 *  기록(CREDITS)이 걸려 있어 지우지 않는다. 그것들을 "사진이 있다"로 세면 안 된다. */
const CAST_SHOTS = new Map(
  CAST.map((c) => [c.tag, BY_SLUG.get(c.tag)]).filter(([, url]) => !!url) as [string, string][],
)

/**
 * 이 **배역**의 사진 URL. 없으면 null — 호출부는 명패로 되돌아간다.
 * 예전에는 직업(job)으로 찾았지만, 배우가 슬롯에 고정된 지금은 배역 태그가 열쇠다.
 */
export function portraitFor(tag: string): string | null {
  return BY_SLUG.get(tag) ?? null
}

/**
 * **지금 배역의** 사진이 한 장이라도 있는가 — 없으면 UI 가 사진 자리 자체를 만들지 않는다.
 * 폴더 전체를 세면 옛 배역 8장 때문에 항상 true 가 되어, 배역을 갈아엎고 사진을 안 구운
 * 상태를 못 잡아낸다. 실제로 그렇게 다섯 명 전원이 이니셜 명패로 떨어진 적이 있다.
 */
export const hasPortraits = (): boolean => CAST_SHOTS.size > 0

/** 아직 사진이 없는 배역. 생성 작업의 할 일 목록이 된다. */
export function missingRoles(): string[] {
  return CAST.filter((c) => !BY_SLUG.has(c.tag)).map((c) => c.tag)
}
