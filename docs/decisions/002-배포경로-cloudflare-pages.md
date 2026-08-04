# 002 — 배포는 Cloudflare Pages (GitHub Pages 아님)

- 날짜: 2026-08-05
- 상태: 채택

## 맥락 (어떤 문제·제약이 있었나)

심사위원이 URL만 열어 플레이해야 하는 과제다. 최초 설계는 GitHub Pages(정적) + Cloudflare Workers(LLM 프록시)
2원 구성이었다. 그런데 레포를 private으로 만든 뒤 막혔다:

- **무료 플랜은 private repo에 Pages를 못 붙인다.** 토큰에 `user` 스코프가 없어 플랜 확인도 불가.
- 2원 구성은 게임(github.io)과 API(workers.dev)의 **오리진이 달라 CORS 처리가 필수**였다.
  프리플라이트·헤더 관리가 코드에 계속 남고, 시연 중 오리진 설정 실수가 곧 전면 장애다.

## 결정

**Cloudflare Pages + Pages Functions 단일 오리진.**
- 게임: `dist/` → Cloudflare Pages
- API: `functions/api/*.ts` → 같은 배포에 포함, `/api/interrogate` 로 **같은 오리진** 서빙
- `workers/` 디렉토리와 별도 wrangler 배포는 제거
- GitHub Actions는 배포에서 손 뗀다 → `ci.yml`(테스트+타입체크+빌드)로 축소

## 근거 (왜)

1. **CORS가 통째로 사라진다.** 같은 오리진이므로 `Access-Control-*` 헤더도, 프리플라이트도 없다.
   스모크 테스트로 CORS 헤더 부재를 회귀 고정했다 — 다시 기어들어오면 테스트가 잡는다.
2. **레포 가시성과 무관하다.** private을 유지하면서 공개 URL을 낼 수 있다. 제출 전 소스 공개 압박이 없다.
3. **무료.** GitHub Pro 구독 불필요.
4. **배포 대상이 하나다.** 2일 마감에서 "게임은 새 버전인데 API는 옛 버전" 같은 불일치 사고가 원천 차단된다.
5. 이미 Cloudflare 계정이 필요했다(Workers 예정) — 새 벤더가 늘어나는 게 아니라 오히려 하나 줄었다.

## 버린 대안 (그리고 왜 버렸나) — 필수

- **A. 레포를 public 전환 + GitHub Pages**: 무료·즉시 되지만 제출 전까지 소스가 공개된다.
  경진대회 제출물이라 제출 시점 전 공개는 피하고 싶다. CORS 문제도 그대로 남는다.
- **B. GitHub Pro 구독**: 유료인데, 정작 **Pages 사이트 URL은 어차피 공개**다
  (접근 제어는 Enterprise 기능). 돈을 내고도 원하던 "비공개"를 못 얻는다.
- **C-1. Cloudflare Pages + 별도 Workers**: 오리진이 갈려 CORS가 남는다. Pages Functions면 한 배포로 끝난다.
- **D. Vercel/Netlify**: 서버리스 함수로 같은 구조가 가능하나, Cloudflare 계정이 이미 전제였으므로
  벤더를 하나 더 늘릴 이유가 없다.

## 영향 (이 결정으로 바뀌는 것)

- `workers/` 삭제 → `functions/api/{health,interrogate}.ts`. 프록시 코드에서 CORS 블록 제거.
- 배포 명령: `npm run deploy` (= build + `wrangler pages deploy dist`). 로컬 확인은 `npm run cf:dev`.
- 키 등록: `npx wrangler pages secret put ANTHROPIC_API_KEY` (Secret 외 경로 없음).
- `.github/workflows/deploy.yml` 삭제 → `ci.yml` 로 대체. CI에 시크릿이 필요 없어졌다.
- **미해결:** Cloudflare 계정 인증(`wrangler login`)은 브라우저 로그인이 필요해 에이전트가 대신할 수 없다.
  최초 1회는 사람이 실행해야 한다.

## 후기 (2026-08-05, 실배포 후 추가)

- `wrangler login` 이 브라우저에 "application authorisation fail" 을 표시했지만 **콜백은 성공**했고
  토큰은 정상 발급됐다. 실제 원인은 인증이 아니라 **Pages 프로젝트 미생성**이었다
  (`wrangler pages project create nan-alibi --production-branch main` 이 선행돼야 한다).
  교훈: OAuth 화면의 실패 표시를 믿지 말고 `wrangler whoami` + 권한이 필요한 실제 명령으로 검증할 것.
- 종단 검증 통과: 게임 200 · `/api/health` 200 · `/api/interrogate` 503 `{fallback:true}` · **CORS 헤더 없음**.
- wrangler 4.118 이 신규 프로젝트에 **Workers(static assets)** 를 권고한다 (Pages 의 후속 경로).
  같은 단일 오리진 이점을 Workers 로도 얻을 수 있으나, **Pages 가 정상 동작하고 마감이 2일**이므로
  전환하지 않는다. 마감 후 재검토 대상.
