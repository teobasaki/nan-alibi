/**
 * 인물 사진 — **에셋이 없어도 게임이 돌아간다.**
 *
 * 사진은 이름이 아니라 **역할**에 묶는다. 이름은 매 판 무작위로 생성되지만
 * 역할(호텔 지배인·보안 팀장·비서…)은 8종으로 고정이라, 역할에 묶으면
 *   ① 이름과 얼굴이 어긋나는 일이 없고
 *   ② 판을 거듭할수록 "저 보안 팀장" 처럼 배역이 기억에 남는다
 *
 * 파일이 없으면 `null` 을 돌려주고, 호출부는 기존 놋쇠 명패로 되돌아간다.
 * 그래서 **에셋 0장 상태에서도 화면이 깨지지 않는다** — 생성 경로가 정해지기 전에
 * 배선부터 끝내 두는 이유다.
 *
 * 파일을 넣는 법: `public/portraits/<slug>.webp` 로 저장하면 끝. 코드 수정 불필요.
 */

import { SLUG_BY_JOB as SLUG } from './roleSlug'

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

/** 이 역할의 사진 URL. 없으면 null — 호출부는 명패로 되돌아간다. */
export function portraitFor(job: string): string | null {
  const slug = SLUG[job]
  if (!slug) return null
  return BY_SLUG.get(slug) ?? null
}

/** 사진이 한 장이라도 있는가 — 없으면 UI 가 사진 자리 자체를 만들지 않는다. */
export const hasPortraits = (): boolean => BY_SLUG.size > 0

/** 아직 없는 역할 목록. 생성 작업의 할 일 목록이 된다. */
export function missingRoles(): string[] {
  return Object.keys(SLUG).filter((job) => !BY_SLUG.has(SLUG[job]!))
}
