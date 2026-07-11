import { test, expect } from '@playwright/test'

/**
 * 로그인 화면 렌더링 + 미인증 접근 리다이렉트 검증.
 * 백엔드 없이 프론트(Vite dev)만으로 통과한다.
 */

test.describe('로그인 화면', () => {
  test('로그인 페이지가 렌더링된다', async ({ page }) => {
    await page.goto('/login')

    await expect(
      page.getByRole('heading', { name: '업무요청 접수·관리' }),
    ).toBeVisible()
    await expect(
      page.getByRole('button', { name: 'Google 계정으로 로그인' }),
    ).toBeVisible()
  })

  test('dev 빌드에서 임시 로그인 버튼이 노출된다', async ({ page }) => {
    await page.goto('/login')

    // import.meta.env.DEV=true 일 때만 노출되는 로컬 전용 버튼
    await expect(
      page.getByRole('button', { name: /임시 로그인/ }),
    ).toBeVisible()
  })

  test('미인증 상태로 보호 경로 접근 시 로그인으로 이동한다', async ({ page }) => {
    await page.goto('/requests/mine')

    await expect(page).toHaveURL(/\/login$/)
  })
})
