import { defineConfig } from 'vite'

export default defineConfig({
  base: './',                 // 절대 바꾸지 말 것. GitHub Pages 흰 화면 원인 1위
  build: { outDir: 'dist' },
  test: {
    environment: 'happy-dom',
    include: ['tests/**/*.test.ts'],
  },
})
