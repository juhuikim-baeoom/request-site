import { Outlet } from 'react-router-dom'
import { TopNav } from './TopNav'

export function Layout() {
  return (
    // 앱 셸: 전체 화면 높이(모바일 동적 툴바 대응 dvh), 상단바 고정, 메인 바디에서만 스크롤
    <div className="flex h-[100dvh] flex-col overflow-hidden bg-gray-50">
      <TopNav />
      <main className="min-h-0 flex-1 overflow-y-auto">
        <div className="w-full px-4 py-6 sm:px-6">
          <Outlet />
        </div>
      </main>
    </div>
  )
}
