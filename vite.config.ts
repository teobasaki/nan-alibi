import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { defineConfig, type Plugin, type ViteDevServer } from 'vite'

/**
 * **개발 서버에서도 Pages Functions 가 돈다.**
 *
 * `npm run dev`(vite)에는 Cloudflare Pages Functions 런타임이 없어서
 * `/api/interrogate` 와 `/api/tts` 가 **404** 였다 — 그래서 로컬에서는 모든 심문이
 * "(대답이 없다)" 폴백으로, 음성은 브라우저 내장 합성으로만 나왔다.
 * 배포에서만 되는 기능은 개발 중에 아무도 확인하지 못한다.
 *
 * `functions/api/*.ts` 는 표준 Request/Response 를 쓰는 평범한 TS 라, vite 의
 * ssrLoadModule 로 **프로덕션과 같은 코드를 그대로** 불러 실행할 수 있다.
 * 별도 서버·프록시·중복 구현이 없다 — 같은 파일이 두 곳에서 돈다.
 *
 * 키는 `.dev.vars` 에서 읽는다 (wrangler 와 같은 파일, gitignore 됨).
 */
function pagesFunctions(): Plugin {
  const readVars = (): Record<string, string> => {
    const f = resolve(__dirname, '.dev.vars')
    if (!existsSync(f)) return {}
    const env: Record<string, string> = {}
    for (const line of readFileSync(f, 'utf8').split('\n')) {
      const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim())
      if (m) env[m[1]!] = m[2]!
    }
    return env
  }
  return {
    name: 'pages-functions-dev',
    configureServer(server: ViteDevServer) {
      server.middlewares.use(async (req, res, next) => {
        const m = /^\/api\/([a-z]+)/.exec(req.url ?? '')
        if (!m) return next()
        try {
          const mod = await server.ssrLoadModule(`/functions/api/${m[1]}.ts`)
          const handler = mod[req.method === 'GET' ? 'onRequestGet' : 'onRequestPost']
          if (!handler) { res.statusCode = 405; return res.end() }

          const chunks: Buffer[] = []
          for await (const c of req) chunks.push(c as Buffer)
          const body = Buffer.concat(chunks)
          const request = new Request(`http://localhost${req.url}`, {
            method: req.method,
            headers: { 'Content-Type': 'application/json' },
            body: body.length ? body : undefined,
          })
          const response: Response = await handler({ request, env: readVars() })
          res.statusCode = response.status
          response.headers.forEach((v, k) => res.setHeader(k, v))
          res.end(Buffer.from(await response.arrayBuffer()))
        } catch (e) {
          // 브리지 자체가 죽어도 게임은 폴백으로 계속 간다 — 500 이 404 보다 정직하다
          console.error('[pages-functions-dev]', e)
          res.statusCode = 500
          res.end(JSON.stringify({ error: String(e) }))
        }
      })
    },
  }
}

export default defineConfig({
  base: './',                 // 절대 바꾸지 말 것. GitHub Pages 흰 화면 원인 1위
  plugins: [pagesFunctions()],
  build: { outDir: 'dist' },
  test: {
    environment: 'happy-dom',
    include: ['tests/**/*.test.ts'],
  },
})
