import { test, expect } from '@playwright/test'

/**
 * dev 임시 로그인 → 보호 경로 진입 흐름.
 * 백엔드(server, :4000)가 필요하다. 서버 미기동 시 자동 skip 한다.
 * 실행 전 준비: colima 기동 → docker compose up -d → server dev 기동.
 */

test.describe('dev 임시 로그인 흐름', () => {
  test.beforeEach(async ({ request }) => {
    // Vite proxy(/api → :4000) 경유로 백엔드 헬스 확인
    let up = false
    try {
      const res = await request.get('http://localhost:4000/health')
      up = res.ok()
    } catch {
      up = false
    }
    test.skip(!up, '백엔드(:4000) 미기동 — dev 로그인 흐름 skip')
  })

  test('임시 로그인 후 요청 작성 화면으로 진입한다', async ({ page }) => {
    await page.goto('/login')

    await page.getByRole('button', { name: /임시 로그인/ }).click()

    // 로그인 성공 시 홈('/')으로 이동 → index 는 /requests/new 로 리다이렉트
    await expect(page).toHaveURL(/\/requests\/new$/)
  })
})
