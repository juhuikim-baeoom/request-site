import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useNotifications, useMarkRead, useMarkAllRead } from '../features/notifications/api'
import { fmtDateTime } from '../lib/format'

export function NotificationBell() {
  const [open, setOpen] = useState(false)
  const panelRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const navigate = useNavigate()

  const { data } = useNotifications()
  const markRead = useMarkRead()
  const markAllRead = useMarkAllRead()

  const items = data?.items ?? []
  const unreadCount = data?.unreadCount ?? 0

  // 패널 외부 클릭 시 닫기
  useEffect(() => {
    if (!open) return
    function handleClick(e: MouseEvent) {
      if (
        panelRef.current &&
        !panelRef.current.contains(e.target as Node) &&
        buttonRef.current &&
        !buttonRef.current.contains(e.target as Node)
      ) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [open])

  // Escape 키로 닫기
  useEffect(() => {
    if (!open) return
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setOpen(false)
        buttonRef.current?.focus()
      }
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [open])

  function handleItemClick(item: { id: number; request_id: number | null; is_read: boolean }) {
    if (!item.is_read) {
      markRead.mutate(item.id)
    }
    setOpen(false)
    if (item.request_id != null) {
      navigate(`/requests/${item.request_id}`)
    }
  }

  function handleMarkAll() {
    markAllRead.mutate()
  }

  return (
    <div className="relative">
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={
          unreadCount > 0
            ? `알림 ${unreadCount}개 읽지 않음, 알림 목록 열기`
            : '알림 목록 열기'
        }
        aria-haspopup="true"
        aria-expanded={open}
        className="relative flex h-8 w-8 items-center justify-center rounded-md text-gray-500 hover:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-1"
      >
        {/* 벨 아이콘 (SVG) */}
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="h-5 w-5"
          aria-hidden="true"
        >
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.73 21a2 2 0 0 1-3.46 0" />
        </svg>

        {/* 미읽음 뱃지 */}
        {unreadCount > 0 && (
          <span
            aria-hidden="true"
            className="absolute -right-0.5 -top-0.5 flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-red-500 px-0.5 text-[10px] font-bold leading-none text-white"
          >
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div
          ref={panelRef}
          role="dialog"
          aria-label="알림 목록"
          className="absolute right-0 top-full z-50 mt-1 w-80 rounded-lg border border-gray-200 bg-white shadow-lg"
        >
          {/* 헤더 */}
          <div className="flex items-center justify-between border-b border-gray-100 px-4 py-2.5">
            <span className="text-sm font-semibold text-gray-900">
              알림
              {unreadCount > 0 && (
                <span className="ml-1.5 rounded-full bg-red-500 px-1.5 py-0.5 text-[10px] font-bold text-white">
                  {unreadCount}
                </span>
              )}
            </span>
            {unreadCount > 0 && (
              <button
                type="button"
                onClick={handleMarkAll}
                disabled={markAllRead.isPending}
                className="text-xs text-brand hover:underline disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-1 rounded"
                aria-label="모든 알림 읽음 처리"
              >
                모두 읽음
              </button>
            )}
          </div>

          {/* 목록 */}
          <ul
            className="max-h-96 divide-y divide-gray-50 overflow-y-auto"
            role="list"
            aria-label="알림 항목"
          >
            {items.length === 0 ? (
              <li className="px-4 py-6 text-center text-sm text-gray-400">
                알림이 없습니다.
              </li>
            ) : (
              items.map((item) => (
                <li key={item.id} role="listitem">
                  <button
                    type="button"
                    onClick={() => handleItemClick(item)}
                    className={`w-full px-4 py-3 text-left transition-colors hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand ${
                      item.is_read ? 'opacity-60' : ''
                    }`}
                    aria-label={`${item.message}${item.is_read ? ' (읽음)' : ' (읽지 않음)'}`}
                  >
                    <div className="flex items-start gap-2">
                      {/* 미읽음 점 */}
                      <span
                        aria-hidden="true"
                        className={`mt-1.5 h-2 w-2 flex-none rounded-full ${
                          item.is_read ? 'bg-transparent' : 'bg-brand'
                        }`}
                      />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm text-gray-900">{item.message}</p>
                        <p className="mt-0.5 text-xs text-gray-400">
                          {fmtDateTime(item.created_at)}
                        </p>
                      </div>
                    </div>
                  </button>
                </li>
              ))
            )}
          </ul>
        </div>
      )}
    </div>
  )
}
