import { Outlet } from 'react-router-dom'
import { TopNav } from './TopNav'

export function Layout() {
  return (
    <div className="flex min-h-screen flex-col bg-gray-50">
      <TopNav />
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6">
        <Outlet />
      </main>
    </div>
  )
}
