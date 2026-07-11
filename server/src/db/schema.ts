import {
  pgEnum, pgTable, uuid, text, integer, bigint, boolean, timestamp, date, index, unique,
  uniqueIndex, type AnyPgColumn,
} from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'

export const userRole = pgEnum('user_role', ['staff', 'system', 'viewer'])
export const requestOrg = pgEnum('request_org', ['배움', '배론', '허브', '공통'])
export const requestStatus = pgEnum('request_status', [
  '접수', '확인', '진행중', '검수대기', '재작업', '완료', '보류', '반려', '이관', '철회',
])
export const requestPriority = pgEnum('request_priority', ['긴급', '보통', '낮음'])
export const requestSource = pgEnum('request_source', ['web', 'email'])
export const requestVisibility = pgEnum('request_visibility', [
  'private', 'dept', 'function', 'org', 'shared',
])

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

export const requests = pgTable('requests', {
  id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
  seq: text('seq').unique(),
  source: requestSource('source').notNull().default('web'),
  org: requestOrg('org').notNull(),
  typeCode: text('type_code').notNull().references(() => requestTypes.code),
  priority: requestPriority('priority').notNull().default('보통'),
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
  firstCompletedAt: timestamp('first_completed_at', { withTimezone: true }),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  reworkCount: integer('rework_count').notNull().default(0),
  parentRequestId: bigint('parent_request_id', { mode: 'number' })
    .references((): AnyPgColumn => requests.id),
  sourceThreadId: text('source_thread_id'),
  isLocked: boolean('is_locked').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  statusIdx: index('idx_requests_status').on(t.status),
  orgIdx: index('idx_requests_org').on(t.org),
  assigneeIdx: index('idx_requests_assignee').on(t.assigneeId),
  requesterIdx: index('idx_requests_requester').on(t.requesterId),
  createdIdx: index('idx_requests_created').on(t.createdAt),
  parentIdx: index('idx_requests_parent').on(t.parentRequestId),
  // 메일 스레드 중복 접수 방지 (원본 schema.sql의 부분 UNIQUE 인덱스 이식)
  threadIdx: uniqueIndex('idx_requests_thread').on(t.sourceThreadId)
    .where(sql`source_thread_id is not null`),
}))

export const requestComments = pgTable('request_comments', {
  id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
  requestId: bigint('request_id', { mode: 'number' }).notNull().references(() => requests.id, { onDelete: 'cascade' }),
  authorId: uuid('author_id').references(() => users.id),
  body: text('body').notNull(),
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
  storagePath: text('storage_path').notNull(),
  fileName: text('file_name'),
  fileSize: bigint('file_size', { mode: 'number' }),
  mimeType: text('mime_type'),
  uploadedBy: uuid('uploaded_by').references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  requestIdx: index('idx_attach_request').on(t.requestId),
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
