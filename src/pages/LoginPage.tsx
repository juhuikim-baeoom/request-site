import { Navigate } from 'react-router-dom'
import { useAuth } from '../auth/useAuth'

export function LoginPage() {
  const { session, loading, signInWithGoogle } = useAuth()

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
