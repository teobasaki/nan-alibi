/**
 * FIVE ALIBIS — 심문 프록시 (Cloudflare Pages Function)
 *
 * 존재 이유: API 키는 정적 자산에 절대 못 넣는다.
 * 키는 Pages Secret 에만 있고, 클라이언트는 이 엔드포인트만 본다.
 *
 * 게임과 **같은 오리진**이므로 CORS 헤더가 필요 없다 (이것이 Cloudflare Pages 를 고른 이유).
 *
 * Task 1 단계: 배선만 확인하는 에코. Anthropic 실호출·SSE 중계는 Task 9.
 */
interface Env { ANTHROPIC_API_KEY?: string }

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const body = await request.json().catch(() => null)
  if (!body) {
    return Response.json({ error: 'invalid json' }, { status: 400 })
  }
  if (!env.ANTHROPIC_API_KEY) {
    // 폴백 3층 중 3층: 키 없음 → 게임은 사전 생성 콘텐츠로 계속 진행해야 한다
    return Response.json({ error: 'no_key', fallback: true }, { status: 503 })
  }
  return Response.json({ echo: body, note: 'stub — wired, not yet calling Anthropic' })
}
