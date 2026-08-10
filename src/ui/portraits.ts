/**
 * 인물 사진 — **에셋이 없어도 게임이 돌아간다.**
 *
 * 사진은 이름이 아니라 **배역**(cast tag)에 묶는다. 이름은 매 판 생성되지만
 * 배역은 슬롯 고정이라, 배역에 묶으면
 *   ① 이름과 얼굴이 어긋나는 일이 없고
 *   ② 판을 거듭할수록 "저 보안 팀장" 처럼 배역이 기억에 남는다
 *
 * 파일이 없으면 `null` 을 돌려주고, 호출부는 기존 놋쇠 명패로 되돌아간다.
 * 그래서 **에셋 0장 상태에서도 화면이 깨지지 않는다** — 생성 경로가 정해지기 전에
 * 배선부터 끝내 두는 이유다.
 *
 * 파일을 넣는 법: `public/portraits/<tag>.webp` (예: `carla.webp`) 로 저장하면 끝.
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

/**
 * 이 **배역**의 사진 URL. 없으면 null — 호출부는 명패로 되돌아간다.
 * 예전에는 직업(job)으로 찾았지만, 배우가 슬롯에 고정된 지금은 배역 태그가 열쇠다.
 */
export function portraitFor(tag: string): string | null {
  return BY_SLUG.get(tag) ?? null
}

/** 사진이 한 장이라도 있는가 — 없으면 UI 가 사진 자리 자체를 만들지 않는다. */
export const hasPortraits = (): boolean => BY_SLUG.size > 0

/** 아직 사진이 없는 배역. 생성 작업의 할 일 목록이 된다. */
export function missingRoles(): string[] {
  return CAST.filter((c) => !BY_SLUG.has(c.tag)).map((c) => c.tag)
}
