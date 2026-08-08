/**
 * 배선 확인용. **키 존재 여부만 보고하고 값은 절대 노출하지 않는다.**
 *
 * 대시보드가 "무엇을 쓸 수 있는가" 를 알아야 정직하게 그릴 수 있다.
 * 없는 공급자를 고를 수 있게 해 두면, 골랐는데 아무 일도 안 일어나는 화면이 된다.
 */
interface Env {
  OPENAI_API_KEY?: string
  SUPERTONE_API_KEY?: string
  VARCO_API_KEY?: string
}

export const onRequestGet: PagesFunction<Env> = ({ env }) =>
  Response.json({
    ok: true,
    // 기존 필드 — 이미 배포 검증 스크립트가 이 이름을 본다. 이름을 바꾸지 않는다.
    hasKey: Boolean(env.OPENAI_API_KEY),
    providers: {
      llm: Boolean(env.OPENAI_API_KEY),
      tts: Boolean(env.SUPERTONE_API_KEY),
      sfx: Boolean(env.VARCO_API_KEY),
    },
  })
