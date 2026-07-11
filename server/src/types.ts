import type { FastifyRequest } from 'fastify'

export interface CurrentUser {
  id: string
  email: string
  name: string | null
  orgAffil: string | null
  deptFunction: string | null
  role: 'staff' | 'system' | 'viewer'
}

declare module 'fastify' {
  interface FastifyRequest {
    currentUser: CurrentUser | null
  }
}

export type Req = FastifyRequest
