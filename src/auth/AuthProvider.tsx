import { createContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import type { Profile, UserRole } from '../types/database'

export interface AuthContextValue {
  session: Session | null
  profile: Profile | null
  role: UserRole | null
  loading: boolean
  signInWithGoogle: () => Promise<void>
  signOut: () => Promise<void>
}

export const AuthContext = createContext<AuthContextValue | undefined>(undefined)

// 허용 도메인 (요구사항: @baeoom.com / @baeron.com)
const ALLOWED_DOMAINS = ['baeoom.com', 'baeron.com']

export function isAllowedEmail(email: string | undefined | null): boolean {
  if (!email) return false
  const domain = email.split('@')[1]?.toLowerCase()
  return !!domain && ALLOWED_DOMAINS.includes(domain)
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true

    supabase.auth.getSession().then(({ data }) => {
      if (!active) return
      setSession(data.session)
      setLoading(false)
    })

    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next)
    })

    return () => {
      active = false
      sub.subscription.unsubscribe()
    }
  }, [])

  // 세션이 바뀌면 profiles 에서 역할/부서 정보를 로드
  useEffect(() => {
    if (!session?.user) {
      setProfile(null)
      return
    }
    let active = true
    supabase
      .from('profiles')
      .select('*')
      .eq('id', session.user.id)
      .single()
      .then(({ data }) => {
        if (active) setProfile(data ?? null)
      })
    return () => {
      active = false
    }
  }, [session])

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      profile,
      role: profile?.role ?? null,
      loading,
      async signInWithGoogle() {
        await supabase.auth.signInWithOAuth({
          provider: 'google',
          options: {
            redirectTo: window.location.origin,
            // 허용 도메인 힌트 (실제 차단은 Supabase Auth 설정/트리거에서 처리)
            queryParams: { hd: ALLOWED_DOMAINS.join(',') },
          },
        })
      },
      async signOut() {
        await supabase.auth.signOut()
      },
    }),
    [session, profile, loading],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
