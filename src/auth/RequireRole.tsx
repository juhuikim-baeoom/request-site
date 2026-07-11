import type { ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from './useAuth'
import type { UserRole } from '../types/database'

interface RequireRoleProps {
  /** 접근 허용 역할. 비우면 로그인만 확인 (staff 이상 전체 허용) */
  allow?: UserRole[]
  children: ReactNode
}

/**
 * 로그인 + 역할 기반 라우트 가드.
 * - 미로그인: /login 으로
 * - 역할 불일치: 접근 불가 안내
 */
export function RequireRole({ allow, children }: RequireRoleProps) {
  const { session, role, loading } = useAuth()
  const location = useLocation()

  if (loading) {
    return <div className="p-8 text-center text-gray-500">로딩 중…</div>
  }

  if (!session) {
    return <Navigate to="/login" replace state={{ from: location }} />
  }

  if (allow && (!role || !allow.includes(role))) {
    return (
      <div className="p-8 text-center">
        <h2 className="text-lg font-semibold text-gray-800">접근 권한이 없습니다</h2>
        <p className="mt-2 text-sm text-gray-500">
          이 페이지는 {allow.join(', ')} 역할만 접근할 수 있습니다.
        </p>
      </div>
    )
  }

  return <>{children}</>
}
