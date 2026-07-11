import { createContext, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { RequestOrg, UserRole } from '../types/database'
import { apiGet, apiSend, API_BASE } from '../lib/api'

export interface AuthUser {
  id: string
  email: string
  name: string | null
  org_affil: RequestOrg | null
  dept_function: string | null
  role: UserRole
}

export interface AuthContextValue {
  session: AuthUser | null
  profile: AuthUser | null
  role: UserRole | null
  loading: boolean
  signInWithGoogle: () => void
  signOut: () => Promise<void>
  devLogin: () => Promise<void>
}

export const AuthContext = createContext<AuthContextValue | undefined>(undefined)

// 허용 도메인 (요구사항: @baeoom.com / @baeron.com)
const ALLOWED_DOMAINS = ['baeoom.com', 'baeron.com']
export function isAllowedEmail(email: string | undefined | null): boolean {
  if (!email) return false
  const domain = email.split('@')[1]?.toLowerCase()
  return !!domain && ALLOWED_DOMAINS.includes(domain)
}

// 서버 /api/auth/me 응답(camelCase)을 프론트 AuthUser(snake_case) 로 매핑
interface MeUser {
  id: string
  email: string
  name: string | null
  orgAffil: RequestOrg | null
  deptFunction: string | null
  role: UserRole
}
function mapUser(u: MeUser | null): AuthUser | null {
  if (!u) return null
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    org_affil: u.orgAffil,
    dept_function: u.deptFunction,
    role: u.role,
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null)
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    try {
      const { user } = await apiGet<{ user: MeUser | null }>('/api/auth/me')
      setUser(mapUser(user))
    } catch {
      setUser(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const value = useMemo<AuthContextValue>(
    () => ({
      session: user,
      profile: user,
      role: user?.role ?? null,
      loading,
      signInWithGoogle() {
        window.location.href = `${API_BASE}/api/auth/google`
      },
      async signOut() {
        await apiSend('POST', '/api/auth/logout')
        setUser(null)
      },
      async devLogin() {
        const { user } = await apiSend<{ user: MeUser }>('POST', '/api/auth/dev-login')
        setUser(mapUser(user))
      },
    }),
    [user, loading],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
