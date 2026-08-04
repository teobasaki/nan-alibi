/**
 * FIVE ALIBIS — LLM 프록시 (Cloudflare Workers)
 *
 * 존재 이유: API 키는 정적 페이지(GitHub Pages)에 절대 못 넣는다.
 * 키는 Workers Secret 에만 있고, 클라이언트는 이 엔드포인트만 본다.
 *
 * Task 1 단계: 배선만 확인하는 에코. 실제 Anthropic 호출은 Task 9.
 */

export interface Env {
  ANTHROPIC_API_KEY: string
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: CORS })
    }

    if (url.pathname === '/api/health') {
      return Response.json(
        { ok: true, hasKey: Boolean(env.ANTHROPIC_API_KEY) },
        { headers: CORS },
      )
    }

    if (url.pathname === '/api/interrogate' && request.method === 'POST') {
      const body = await request.json().catch(() => null)
      if (!body) {
        return Response.json({ error: 'invalid json' }, { status: 400, headers: CORS })
      }
      // Task 9 에서 Anthropic Messages API 로 교체 (SSE 스트리밍 중계)
      return Response.json(
        { echo: body, note: 'stub — wired, not yet calling Anthropic' },
        { headers: CORS },
      )
    }

    return new Response('not found', { status: 404, headers: CORS })
  },
}
