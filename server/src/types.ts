import type { FastifyRequest } from 'fastify'

export type UserRoleValue =
  | 'staff'
  | 'dept_monitor'
  | 'org_monitor'
  | 'system'
  | 'exec'
  | 'system_admin'
  | 'viewer' // 폐기값 — 최소 권한으로 동작한다

export interface CurrentUser {
  id: string
  email: string
  name: string | null
  orgAffil: string | null
  deptFunction: string | null
  role: UserRoleValue
}

declare module 'fastify' {
  interface FastifyRequest {
    currentUser: CurrentUser | null
  }
}

export type Req = FastifyRequest
