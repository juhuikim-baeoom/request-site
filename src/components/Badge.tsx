import type { ReactNode } from 'react'

interface BadgeProps {
  children: ReactNode
  className?: string
}

/** 상태·기한·우선순위 등에 쓰는 작은 뱃지. 색상은 className으로 주입. */
export function Badge({ children, className = 'bg-gray-100 text-gray-600' }: BadgeProps) {
  return (
    <span
      className={`inline-block whitespace-nowrap rounded px-1.5 py-0.5 text-xs font-medium ${className}`}
    >
      {children}
    </span>
  )
}
