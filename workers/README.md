# nan-alibi-api

게임(정적)과 분리된 LLM 프록시.

```bash
cd workers
npx wrangler dev                       # 로컬
npx wrangler secret put ANTHROPIC_API_KEY   # 키 등록 (최초 1회)
npx wrangler deploy                    # 배포
```

**키는 Secret 에만 둔다.** `wrangler.toml` 이나 소스에 절대 쓰지 않는다 —
`tests/smoke.test.ts` 가 `sk-ant-` 리터럴을 회귀 테스트로 막는다.
