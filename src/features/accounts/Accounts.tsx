import { useRef, useState } from 'react'
import { useUsers, useUpdateUser, useImportOrgDirectory } from './api'
import type { UserRow, UpdateUserInput, OrgDirectoryRow } from './api'
import type { UserRole, RequestOrg } from '../../types/database'
import { ORG_OPTIONS, ROLE_LABEL, ASSIGNABLE_ROLES } from '../../lib/constants'
import { useAuth } from '../../auth/useAuth'
import { canManageAccounts } from '../../lib/permissions'

const ORG_LABEL: Record<RequestOrg, string> = {
  배움: '배움',
  배론: '배론',
  허브: '허브',
  공통: '공통',
}

// ---------- 인라인 편집 행 ----------
function UserRow({
  user,
  onSaved,
}: {
  user: UserRow
  onSaved: () => void
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState<UpdateUserInput>({
    role: user.role,
    dept: user.dept ?? '',
    org_affil: user.org_affil,
    dept_function: user.dept_function ?? '',
  })
  const updateUser = useUpdateUser(user.id)

  function handleSave() {
    const patch: UpdateUserInput = {
      role: draft.role,
      dept: draft.dept ?? null,
      org_affil: draft.org_affil ?? null,
      dept_function: draft.dept_function ?? null,
    }
    updateUser.mutate(patch, {
      onSuccess: () => {
        setEditing(false)
        onSaved()
      },
    })
  }

  if (!editing) {
    return (
      <tr className="hover:bg-gray-50">
        <td className="whitespace-nowrap px-3 py-2.5 text-sm text-gray-900">
          {user.name ?? '-'}
        </td>
        <td className="px-3 py-2.5 text-sm text-gray-600">{user.email}</td>
        <td className="px-3 py-2.5 text-sm text-gray-600">{user.dept ?? '-'}</td>
        <td className="px-3 py-2.5 text-sm text-gray-600">
          {user.org_affil ? ORG_LABEL[user.org_affil] : '-'}
        </td>
        <td className="px-3 py-2.5 text-sm text-gray-600">{user.dept_function ?? '-'}</td>
        <td className="px-3 py-2.5 text-sm">
          <span
            className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
              user.role === 'system' || user.role === 'system_admin'
                ? 'bg-indigo-100 text-indigo-700'
                : user.role === 'viewer'
                  ? 'bg-amber-100 text-amber-700'
                  : 'bg-gray-100 text-gray-600'
            }`}
          >
            {ROLE_LABEL[user.role] ?? user.role}
          </span>
        </td>
        <td className="px-3 py-2.5 text-sm">
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="rounded px-2 py-1 text-xs text-brand hover:bg-brand/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-1"
            aria-label={`${user.name ?? user.email} 수정`}
          >
            수정
          </button>
        </td>
      </tr>
    )
  }

  return (
    <tr className="bg-blue-50">
      <td className="whitespace-nowrap px-3 py-2 text-sm text-gray-900">
        {user.name ?? '-'}
      </td>
      <td className="px-3 py-2 text-sm text-gray-600">{user.email}</td>
      <td className="px-3 py-2">
        <input
          type="text"
          value={draft.dept ?? ''}
          onChange={(e) => setDraft((d) => ({ ...d, dept: e.target.value }))}
          className="w-full rounded border border-gray-300 px-2 py-1 text-sm focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
          aria-label="부서"
          placeholder="부서명"
        />
      </td>
      <td className="px-3 py-2">
        <select
          value={draft.org_affil ?? ''}
          onChange={(e) =>
            setDraft((d) => ({
              ...d,
              org_affil: (e.target.value as RequestOrg) || null,
            }))
          }
          className="w-full rounded border border-gray-300 px-2 py-1 text-sm focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
          aria-label="소속기관"
        >
          <option value="">미설정</option>
          {ORG_OPTIONS.map((o) => (
            <option key={o} value={o}>
              {ORG_LABEL[o]}
            </option>
          ))}
        </select>
      </td>
      <td className="px-3 py-2">
        <input
          type="text"
          value={draft.dept_function ?? ''}
          onChange={(e) => setDraft((d) => ({ ...d, dept_function: e.target.value }))}
          className="w-full rounded border border-gray-300 px-2 py-1 text-sm focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
          aria-label="직무"
          placeholder="직무명"
        />
      </td>
      <td className="px-3 py-2">
        <select
          value={draft.role ?? 'staff'}
          onChange={(e) => setDraft((d) => ({ ...d, role: e.target.value as UserRole }))}
          className="w-full rounded border border-gray-300 px-2 py-1 text-sm focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
          aria-label="역할"
        >
          {ASSIGNABLE_ROLES.map((r) => (
            <option key={r} value={r}>
              {ROLE_LABEL[r]}
            </option>
          ))}
        </select>
      </td>
      <td className="px-3 py-2">
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={handleSave}
            disabled={updateUser.isPending}
            className="rounded bg-brand px-2 py-1 text-xs font-medium text-white hover:bg-brand/90 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-1"
            aria-label="저장"
          >
            {updateUser.isPending ? '저장중…' : '저장'}
          </button>
          <button
            type="button"
            onClick={() => setEditing(false)}
            className="rounded px-2 py-1 text-xs text-gray-500 hover:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-400 focus-visible:ring-offset-1"
            aria-label="취소"
          >
            취소
          </button>
        </div>
        {updateUser.isError && (
          <p className="mt-1 text-xs text-red-600" role="alert">
            저장 실패: {updateUser.error instanceof Error ? updateUser.error.message : '오류'}
          </p>
        )}
      </td>
    </tr>
  )
}

// ---------- CSV 파서 ----------
function parseCsv(text: string): OrgDirectoryRow[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim())
  if (lines.length < 2) return []

  const headers = lines[0].split(',').map((h) => h.trim().toLowerCase())
  const rows: OrgDirectoryRow[] = []

  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',').map((c) => c.trim())
    const obj: Record<string, string> = {}
    headers.forEach((h, idx) => {
      obj[h] = cols[idx] ?? ''
    })
    if (obj.email) {
      rows.push({
        email: obj.email,
        name: obj.name ?? '',
        dept: obj.dept ?? '',
        org_affil: obj.org_affil ?? '',
        dept_function: obj.dept_function || undefined,
        role: obj.role || undefined,
      })
    }
  }
  return rows
}

// ---------- CSV 업로드 패널 ----------
function CsvImportPanel() {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [preview, setPreview] = useState<OrgDirectoryRow[] | null>(null)
  const [parseError, setParseError] = useState<string | null>(null)
  const importMutation = useImportOrgDirectory()

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setParseError(null)
    setPreview(null)
    importMutation.reset()

    const reader = new FileReader()
    reader.onload = (ev) => {
      const text = ev.target?.result as string
      const rows = parseCsv(text)
      if (rows.length === 0) {
        setParseError('유효한 행이 없습니다. 헤더(email,name,dept,org_affil,dept_function,role)를 확인하세요.')
        return
      }
      setPreview(rows)
    }
    reader.readAsText(file, 'UTF-8')
  }

  function handleImport() {
    if (!preview) return
    importMutation.mutate(preview)
  }

  function handleReset() {
    setPreview(null)
    setParseError(null)
    importMutation.reset()
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  return (
    <section aria-labelledby="csv-import-heading" className="rounded-lg border border-gray-200 bg-white p-4">
      <h2 id="csv-import-heading" className="mb-3 text-sm font-semibold text-gray-900">
        CSV 일괄 가져오기
      </h2>
      <p className="mb-3 text-xs text-gray-500">
        헤더: <code className="rounded bg-gray-100 px-1">email,name,dept,org_affil,dept_function,role</code>
        &nbsp;(dept_function·role 은 선택). org_affil: 배움/배론/허브/공통, role:
        staff/dept_monitor/org_monitor/system/exec/system_admin (viewer는 폐기값 — 신규 부여 불가).
      </p>

      <div className="flex flex-wrap items-center gap-2">
        <label
          htmlFor="csv-file-input"
          className="cursor-pointer rounded border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 focus-within:ring-2 focus-within:ring-brand focus-within:ring-offset-1"
        >
          파일 선택
          <input
            id="csv-file-input"
            ref={fileInputRef}
            type="file"
            accept=".csv,text/csv"
            onChange={handleFileChange}
            className="sr-only"
            aria-label="CSV 파일 선택"
          />
        </label>

        {preview && !importMutation.isSuccess && (
          <button
            type="button"
            onClick={handleImport}
            disabled={importMutation.isPending}
            className="rounded bg-brand px-3 py-1.5 text-xs font-medium text-white hover:bg-brand/90 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-1"
          >
            {importMutation.isPending ? '가져오는 중…' : `${preview.length}행 가져오기`}
          </button>
        )}

        {(preview || importMutation.isSuccess || parseError) && (
          <button
            type="button"
            onClick={handleReset}
            className="rounded px-3 py-1.5 text-xs text-gray-500 hover:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-400 focus-visible:ring-offset-1"
          >
            초기화
          </button>
        )}
      </div>

      {/* 파서 오류 */}
      {parseError && (
        <p className="mt-2 text-xs text-red-600" role="alert">
          {parseError}
        </p>
      )}

      {/* 미리보기 */}
      {preview && !importMutation.isSuccess && (
        <p className="mt-2 text-xs text-gray-500">
          {preview.length}행 파싱됨. 가져오기 버튼을 눌러 적용하세요.
        </p>
      )}

      {/* 가져오기 결과 */}
      {importMutation.isSuccess && importMutation.data && (
        <div className="mt-3 rounded-md bg-green-50 p-3 text-xs" role="status" aria-live="polite">
          <p className="font-medium text-green-700">
            완료: {importMutation.data.upserted}행 반영, {importMutation.data.skipped}행 건너뜀
          </p>
          {importMutation.data.errors.length > 0 && (
            <ul className="mt-1.5 list-disc pl-4 text-red-600">
              {importMutation.data.errors.slice(0, 10).map((e, i) => (
                <li key={i}>
                  {e.email}: {e.reason}
                </li>
              ))}
              {importMutation.data.errors.length > 10 && (
                <li>외 {importMutation.data.errors.length - 10}건…</li>
              )}
            </ul>
          )}
        </div>
      )}

      {importMutation.isError && (
        <p className="mt-2 text-xs text-red-600" role="alert">
          가져오기 실패: {importMutation.error instanceof Error ? importMutation.error.message : '오류'}
        </p>
      )}
    </section>
  )
}

// ---------- 메인 ----------
export function Accounts() {
  const { profile } = useAuth()
  const allowed = canManageAccounts(profile?.role)
  const { data: users, isLoading, isError, refetch } = useUsers(allowed)

  if (!allowed) {
    return (
      <div className="p-8 text-center text-gray-500" role="status">
        계정 관리 권한이 없습니다.
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* 페이지 제목 */}
      <div>
        <h1 className="text-lg font-bold text-gray-900">계정 관리</h1>
        <p className="mt-0.5 text-sm text-gray-500">
          직원 계정의 역할·부서·소속기관을 관리합니다. 시스템팀 관리자 전용.
        </p>
      </div>

      {/* 안내 */}
      <div
        role="note"
        className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800"
      >
        부서·소속기관 변경은 <strong>이후 신규 요청부터만</strong> 반영됩니다. 이미 접수된 요청의 공개범위는 접수 시점 스냅샷을 유지합니다.
      </div>

      {/* CSV 가져오기 */}
      <CsvImportPanel />

      {/* 사용자 목록 */}
      <section aria-labelledby="users-table-heading">
        <h2 id="users-table-heading" className="sr-only">
          사용자 목록
        </h2>

        {isLoading && (
          <p className="py-8 text-center text-sm text-gray-400" aria-live="polite">
            불러오는 중…
          </p>
        )}

        {isError && (
          <div className="rounded-md bg-red-50 p-4 text-sm text-red-700" role="alert">
            목록을 불러오지 못했습니다.{' '}
            <button
              type="button"
              onClick={() => void refetch()}
              className="underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500"
            >
              다시 시도
            </button>
          </div>
        )}

        {users && (
          <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
            <table className="min-w-full text-left text-sm" aria-label="사용자 목록">
              <thead className="border-b border-gray-200 bg-gray-50 text-xs font-medium uppercase text-gray-500">
                <tr>
                  <th scope="col" className="px-3 py-2.5">이름</th>
                  <th scope="col" className="px-3 py-2.5">이메일</th>
                  <th scope="col" className="px-3 py-2.5">부서</th>
                  <th scope="col" className="px-3 py-2.5">소속기관</th>
                  <th scope="col" className="px-3 py-2.5">직무</th>
                  <th scope="col" className="px-3 py-2.5">역할</th>
                  <th scope="col" className="px-3 py-2.5">
                    <span className="sr-only">액션</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {users.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-3 py-8 text-center text-gray-400">
                      등록된 사용자가 없습니다.
                    </td>
                  </tr>
                ) : (
                  users.map((user) => (
                    <UserRow key={user.id} user={user} onSaved={() => void refetch()} />
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}
