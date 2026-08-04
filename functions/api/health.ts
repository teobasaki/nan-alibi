/** 배선 확인용. 키 존재 여부만 보고하고 값은 절대 노출하지 않는다. */
interface Env { ANTHROPIC_API_KEY?: string }

export const onRequestGet: PagesFunction<Env> = ({ env }) =>
  Response.json({ ok: true, hasKey: Boolean(env.ANTHROPIC_API_KEY) })
