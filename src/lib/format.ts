// 날짜/시간 포맷 유틸 (ISO 문자열 기준, 로컬 파싱 없이 잘라서 표시)

/** 'YYYY-MM-DD' */
export function fmtDate(s: string | null | undefined): string {
  if (!s) return '-'
  return s.slice(0, 10)
}

/** 'YYYY-MM-DD HH:MM' (분까지) */
export function fmtDateTime(s: string | null | undefined): string {
  if (!s) return '-'
  return s.slice(0, 16).replace('T', ' ')
}
