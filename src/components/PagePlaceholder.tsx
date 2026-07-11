import type { ReactNode } from 'react'

interface PagePlaceholderProps {
  title: string
  description?: string
  /** 이 화면에서 앞으로 구현할 항목 목록 */
  todo?: string[]
  children?: ReactNode
}

/**
 * 뼈대 단계용 플레이스홀더.
 * 각 기능 화면은 라우팅만 연결해 두고, 실제 구현은 다음 단계에서 채운다.
 */
export function PagePlaceholder({ title, description, todo, children }: PagePlaceholderProps) {
  return (
    <section>
      <div className="flex items-center gap-2">
        <h1 className="text-xl font-bold text-gray-900">{title}</h1>
        <span className="rounded bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">
          구현 예정
        </span>
      </div>
      {description && <p className="mt-2 text-sm text-gray-500">{description}</p>}

      {todo && todo.length > 0 && (
        <ul className="mt-6 space-y-1.5 rounded-lg border border-dashed border-gray-300 bg-white p-4 text-sm text-gray-600">
          {todo.map((item) => (
            <li key={item} className="flex items-start gap-2">
              <span className="mt-0.5 text-gray-300">□</span>
              <span>{item}</span>
            </li>
          ))}
        </ul>
      )}

      {children}
    </section>
  )
}
