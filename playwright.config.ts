import { defineConfig, devices } from '@playwright/test'

/**
 * Playwright E2E 설정.
 * - 프론트(Vite dev)만 자동 기동한다. dev 임시 로그인·API 흐름을 검증하려면
 *   백엔드(server, :4000)를 별도로 띄워야 한다. (README 실행법 참조)
 * - baseURL 은 Vite dev 서버(:5173) 기준. import.meta.env.DEV=true 이므로
 *   로그인 화면의 '임시 로그인' 버튼이 노출된다.
 */
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5173',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
})
