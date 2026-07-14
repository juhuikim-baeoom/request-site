import { createBrowserRouter, Navigate } from 'react-router-dom'
import { Layout } from './components/Layout'
import { RequireRole } from './auth/RequireRole'
import { canProcess, canSeeDashboard, canManageAccounts } from './lib/permissions'
import { LoginPage } from './pages/LoginPage'
import { RequestForm } from './features/requests/RequestForm'
import { MyRequests } from './features/requests/MyRequests'
import { RequestDetail } from './features/requests/RequestDetail'
import { ManageBoard } from './features/board/ManageBoard'
import { Dashboard } from './features/dashboard/Dashboard'
import { Accounts } from './features/accounts/Accounts'

export const router = createBrowserRouter([
  {
    path: '/login',
    element: <LoginPage />,
  },
  {
    path: '/',
    element: (
      // 로그인만 확인 (staff 이상 전체). 개별 화면은 아래에서 역할 제한.
      <RequireRole>
        <Layout />
      </RequireRole>
    ),
    children: [
      { index: true, element: <Navigate to="/requests/new" replace /> },

      // staff 이상
      { path: 'requests/new', element: <RequestForm /> },
      { path: 'requests/mine', element: <MyRequests /> },
      { path: 'requests/:id', element: <RequestDetail /> },

      // canProcess: system·system_admin
      {
        path: 'board',
        element: (
          <RequireRole can={canProcess}>
            <ManageBoard />
          </RequireRole>
        ),
      },
      // canSeeDashboard: system·system_admin·exec
      {
        path: 'dashboard',
        element: (
          <RequireRole can={canSeeDashboard}>
            <Dashboard />
          </RequireRole>
        ),
      },
      // canManageAccounts: system_admin 전용
      {
        path: 'accounts',
        element: (
          <RequireRole can={canManageAccounts}>
            <Accounts />
          </RequireRole>
        ),
      },
    ],
  },
  {
    path: '*',
    element: <Navigate to="/" replace />,
  },
])
