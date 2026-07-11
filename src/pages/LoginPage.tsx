import { useEffect, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from '../auth/useAuth'
import { supabase } from '../lib/supabase'

/**
 * OAuth 리다이렉트로 돌아온 URL(쿼리 또는 해시)에서 에러를 읽는다.
 * 도메인 차단 등 가입 트리거 실패 시 Supabase가 error 파라미터를 붙여 되돌린다.
 */
function readAuthError(): string | null {
  const params = new URLSearchParams(window.location.search)
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''))
  const error = params.get('error') ?? hash.get('error')
  if (!error) return null

  const code = params.get('error_code') ?? hash.get('error_code') ?? ''
  const description = params.get('error_description') ?? hash.get('error_description') ?? ''

  // 트리거(handle_new_user)에서 도메인 거부 시 GoTrue는 대개
  // error_code=unexpected_failure / "Database error saving new user" 로 되돌린다.
  const isDbTriggerFailure =
    code === 'unexpected_failure' ||
    /database error/i.test(description) ||
    /도메인/.test(description)

  if (isDbTriggerFailure) {
    return '허용되지 않은 계정입니다. @baeoom.com 또는 @baeron.com 도메인 계정으로만 로그인할 수 있습니다.'
  }
  return description || '로그인 중 오류가 발생했습니다. 다시 시도해 주세요.'
}

export function LoginPage() {
  const { session, loading, signInWithGoogle } = useAuth()
  const [authError, setAuthError] = useState<string | null>(null)

  useEffect(() => {
    const message = readAuthError()
    if (message) {
      setAuthError(message)
      // 차단된 사용자의 잔여 세션 정리 + URL 에러 파라미터 제거
      void supabase.auth.signOut()
      window.history.replaceState({}, '', window.location.pathname)
    }
  }, [])

  if (loading) {
    return <div className="p-8 text-center text-gray-500">로딩 중…</div>
  }

  // 이미 로그인된 경우 홈으로
  if (session) {
    return <Navigate to="/" replace />
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-sm rounded-xl border border-gray-200 bg-white p-8 shadow-sm">
        <h1 className="text-center text-xl font-bold text-gray-900">업무요청 접수·관리</h1>
        <p className="mt-2 text-center text-sm text-gray-500">
          배움·배론·허브 임직원 전용
        </p>

        {authError && (
          <div
            role="alert"
            className="mt-6 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
          >
            {authError}
          </div>
        )}

        <button
          onClick={() => void signInWithGoogle()}
          className="mt-8 flex w-full items-center justify-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
        >
          Google 계정으로 로그인
        </button>

        <p className="mt-4 text-center text-xs text-gray-400">
          @baeoom.com · @baeron.com 도메인 계정만 접근할 수 있습니다.
        </p>
      </div>
    </div>
  )
}
