import { NavLink } from 'react-router-dom'
import { useAuth } from '../auth/useAuth'
import type { UserRole } from '../types/database'
import { NotificationBell } from './NotificationBell'
import { ROLE_LABEL } from '../lib/constants'

interface NavItem {
  to: string
  label: string
  roles: UserRole[] // 이 메뉴를 볼 수 있는 역할
}

const NAV_ITEMS: NavItem[] = [
  { to: '/requests/new', label: '요청 접수', roles: ['staff', 'dept_monitor', 'org_monitor', 'system', 'exec', 'system_admin'] },
  { to: '/requests/mine', label: '내 요청', roles: ['staff', 'dept_monitor', 'org_monitor', 'system', 'exec', 'system_admin'] },
  { to: '/board', label: '관리 보드', roles: ['system', 'system_admin'] },
  { to: '/dashboard', label: '통계', roles: ['system', 'system_admin', 'exec'] },
  { to: '/accounts', label: '계정 관리', roles: ['system_admin'] },
]

export function TopNav() {
  const { profile, role, signOut } = useAuth()

  const visibleItems = NAV_ITEMS.filter((item) => role && item.roles.includes(role))

  return (
    <header className="flex-none border-b border-gray-200 bg-white">
      <div className="flex h-14 w-full items-center gap-6 px-4 sm:px-6">
        <span className="text-base font-bold text-brand">업무요청</span>

        <nav className="flex flex-1 items-center gap-1 overflow-x-auto">
          {visibleItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                `whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-1 ${
                  isActive
                    ? 'bg-brand text-white'
                    : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
                }`
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className="flex items-center gap-3 text-sm">
          {profile && (
            <span className="hidden text-gray-600 sm:inline">
              {profile.name ?? profile.email}
              {role && (
                <span className="ml-1 rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-500">
                  {ROLE_LABEL[role]}
                </span>
              )}
            </span>
          )}
          <NotificationBell />
          <button
            onClick={() => void signOut()}
            className="rounded-md border border-gray-300 px-3 py-1.5 text-gray-600 hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-1"
          >
            로그아웃
          </button>
        </div>
      </div>
    </header>
  )
}
