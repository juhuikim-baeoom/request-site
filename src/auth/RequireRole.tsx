import type { ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from './useAuth'
import type { UserRole } from '../types/database'
import { ROLE_LABEL } from '../lib/constants'

type Role = UserRole | null | undefined

interface RequireRoleProps {
  /**
   * 접근 허용 여부를 판단하는 능력 술어 (src/lib/permissions.ts의 함수를 전달).
   * 비우면 로그인만 확인 (staff 이상 전체 허용).
   * 역할 배열을 직접 나열하지 않는다 — 능력→역할 매핑의 단일 소스는 permissions.ts.
   */
  can?: (role: Role) => boolean
  children: ReactNode
}

/**
 * 로그인 + 능력 기반 라우트 가드.
 * - 미로그인: /login 으로
 * - 능력 불충족: 접근 불가 안내
 */
export function RequireRole({ can, children }: RequireRoleProps) {
  const { session, role, loading } = useAuth()
  const location = useLocation()

  if (loading) {
    return <div className="p-8 text-center text-gray-500">로딩 중…</div>
  }

  if (!session) {
    return <Navigate to="/login" replace state={{ from: location }} />
  }

  if (can && !can(role)) {
    return (
      <div className="p-8 text-center">
        <h2 className="text-lg font-semibold text-gray-800">접근 권한이 없습니다</h2>
        <p className="mt-2 text-sm text-gray-500">
          현재 역할({role ? ROLE_LABEL[role] ?? role : '없음'})로는 이 페이지에 접근할 수 없습니다.
        </p>
      </div>
    )
  }

  return <>{children}</>
}
