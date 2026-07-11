import {
  pgEnum, pgTable, uuid, text, integer, bigint, boolean, timestamp, date, index, unique,
  uniqueIndex, smallint, jsonb, type AnyPgColumn,
} from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'

export const userRole = pgEnum('user_role', ['staff', 'system', 'viewer'])
export const requestOrg = pgEnum('request_org', ['배움', '배론', '허브', '공통'])
export const requestStatus = pgEnum('request_status', [
  '접수', '진행중', '보류', '완료', '반려', '철회',
])
export const urgencyLevel = pgEnum('urgency_level', ['높음', '보통', '낮음'])
export const priorityLevel = pgEnum('priority_level', ['P1', 'P2', 'P3', 'P4'])
export const requestSource = pgEnum('request_source', ['web', 'email'])
export const requestVisibility = pgEnum('request_visibility', [
  'private', 'dept', 'function', 'org', 'shared',
])
export const notificationType = pgEnum('notification_type', ['assigned', 'status', 'comment'])

// auth.users + profiles 통합
export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull().unique(),
  googleSub: text('google_sub').unique(),
  name: text('name'),
  dept: text('dept'),
  orgAffil: requestOrg('org_affil'),
  deptFunction: text('dept_function'),
  role: userRole('role').notNull().default('staff'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

// 서버측 세션 저장소 — 쿠키에는 랜덤 토큰만 저장(사용자 id 아님), 로그아웃/무효화 가능
export const sessions = pgTable('sessions', {
  id: text('id').primaryKey(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
}, (t) => ({
  userIdx: index('idx_sessions_user').on(t.userId),
}))

export const orgDirectory = pgTable('org_directory', {
  email: text('email').primaryKey(),
  name: text('name').notNull(),
  dept: text('dept').notNull(),
  orgAffil: requestOrg('org_affil').notNull(),
  deptFunction: text('dept_function'),
  role: userRole('role').notNull().default('staff'),
  synced: boolean('synced').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const requestTypes = pgTable('request_types', {
  code: text('code').primaryKey(),
  label: text('label').notNull(),
  sortOrder: integer('sort_order').default(0),
  active: boolean('active').default(true),
})

// SLA 정책 테이블 — requests 보다 먼저 정의 (FK)
export const slaPolicy = pgTable('sla_policy', {
  id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
  priorityLevel: priorityLevel('priority_level').notNull().unique(),
  responseMinutes: integer('response_minutes').notNull(),
  resolutionMinutes: integer('resolution_minutes'),
})

// 공휴일 테이블
export const holidays = pgTable('holidays', {
  holidayOn: date('holiday_on').primaryKey(),
  label: text('label'),
})

export const requests = pgTable('requests', {
  id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
  seq: text('seq').unique(),
  source: requestSource('source').notNull().default('web'),
  org: requestOrg('org').notNull(),
  typeCode: text('type_code').notNull().references(() => requestTypes.code),
  title: text('title').notNull(),
  body: text('body'),
  requesterId: uuid('requester_id').references(() => users.id),
  requesterName: text('requester_name'),
  requesterEmail: text('requester_email'),
  assigneeId: uuid('assignee_id').references(() => users.id),
  status: requestStatus('status').notNull().default('접수'),
  visibility: requestVisibility('visibility').notNull().default('dept'),
  requesterDept: text('requester_dept'),
  requesterOrg: requestOrg('requester_org'),
  requesterFunction: text('requester_function'),
  desiredDue: date('desired_due'),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  reworkCount: integer('rework_count').notNull().default(0),
  parentRequestId: bigint('parent_request_id', { mode: 'number' })
    .references((): AnyPgColumn => requests.id),
  sourceThreadId: text('source_thread_id'),
  isLocked: boolean('is_locked').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  // 신규 컬럼
  urgency: urgencyLevel('urgency').notNull().default('보통'),
  impact: urgencyLevel('impact'),
  priorityLevelCol: priorityLevel('priority_level'),
  intakeDetail: jsonb('intake_detail').notNull().default(sql`'{}'::jsonb`),
  csatRating: smallint('csat_rating'),
  csatComment: text('csat_comment'),
  holdReason: text('hold_reason'),
  rejectReason: text('reject_reason'),
  reworkReason: text('rework_reason'),
  assignedAt: timestamp('assigned_at', { withTimezone: true }),
  responseDueAt: timestamp('response_due_at', { withTimezone: true }),
  resolutionDueAt: timestamp('resolution_due_at', { withTimezone: true }),
  firstResponseAt: timestamp('first_response_at', { withTimezone: true }),
  firstResolvedAt: timestamp('first_resolved_at', { withTimezone: true }),
  finalResolvedAt: timestamp('final_resolved_at', { withTimezone: true }),
  slaResponseBreached: boolean('sla_response_breached').notNull().default(false),
  slaResolutionBreached: boolean('sla_resolution_breached').notNull().default(false),
  slaPolicyId: bigint('sla_policy_id', { mode: 'number' }).references(() => slaPolicy.id),
}, (t) => ({
  statusIdx: index('idx_requests_status').on(t.status),
  orgIdx: index('idx_requests_org').on(t.org),
  assigneeIdx: index('idx_requests_assignee').on(t.assigneeId),
  requesterIdx: index('idx_requests_requester').on(t.requesterId),
  createdIdx: index('idx_requests_created').on(t.createdAt),
  parentIdx: index('idx_requests_parent').on(t.parentRequestId),
  priorityIdx: index('idx_requests_priority').on(t.priorityLevelCol),
  // 메일 스레드 중복 접수 방지 (원본 schema.sql의 부분 UNIQUE 인덱스 이식)
  threadIdx: uniqueIndex('idx_requests_thread').on(t.sourceThreadId)
    .where(sql`source_thread_id is not null`),
}))

export const requestComments = pgTable('request_comments', {
  id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
  requestId: bigint('request_id', { mode: 'number' }).notNull().references(() => requests.id, { onDelete: 'cascade' }),
  authorId: uuid('author_id').references(() => users.id),
  body: text('body').notNull(),
  isInternal: boolean('is_internal').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  requestIdx: index('idx_comments_request').on(t.requestId),
}))

export const requestStatusHistory = pgTable('request_status_history', {
  id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
  requestId: bigint('request_id', { mode: 'number' }).notNull().references(() => requests.id, { onDelete: 'cascade' }),
  fromStatus: requestStatus('from_status'),
  toStatus: requestStatus('to_status').notNull(),
  changedBy: uuid('changed_by').references(() => users.id),
  changedAt: timestamp('changed_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  requestIdx: index('idx_history_request').on(t.requestId),
}))

export const requestAttachments = pgTable('request_attachments', {
  id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
  requestId: bigint('request_id', { mode: 'number' }).notNull().references(() => requests.id, { onDelete: 'cascade' }),
  commentId: bigint('comment_id', { mode: 'number' }).references(() => requestComments.id, { onDelete: 'set null' }),
  storagePath: text('storage_path').notNull(),
  fileName: text('file_name'),
  fileSize: bigint('file_size', { mode: 'number' }),
  mimeType: text('mime_type'),
  uploadedBy: uuid('uploaded_by').references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  requestIdx: index('idx_attach_request').on(t.requestId),
}))

export const notifications = pgTable('notifications', {
  id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  type: notificationType('type').notNull(),
  requestId: bigint('request_id', { mode: 'number' }).references(() => requests.id, { onDelete: 'cascade' }),
  message: text('message').notNull(),
  isRead: boolean('is_read').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  userReadIdx: index('idx_notifications_user_read').on(t.userId, t.isRead),
}))

export const requestSharedTargets = pgTable('request_shared_targets', {
  id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
  requestId: bigint('request_id', { mode: 'number' }).notNull().references(() => requests.id, { onDelete: 'cascade' }),
  targetType: text('target_type').notNull(),
  targetValue: text('target_value').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  uniq: unique('uq_shared_target').on(t.requestId, t.targetType, t.targetValue),
  requestIdx: index('idx_shared_targets_request').on(t.requestId),
}))
