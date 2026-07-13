import { useRef, useState } from 'react'

export type ComposerVariant = 'public' | 'internal'

type Props = {
  variant: ComposerVariant
  /** 성공 시 null, 실패 시 오류 메시지를 반환한다. */
  onSubmit: (body: string, files: File[]) => Promise<string | null>
  disabled?: boolean
}

const COPY: Record<
  ComposerVariant,
  { title: string; badge: string; hint: string; placeholder: string; submit: string }
> = {
  public: {
    title: '공개 코멘트',
    badge: '공개',
    hint: '요청자와 열람 권한이 있는 사람에게 보입니다.',
    placeholder: '코멘트를 입력하세요',
    submit: '공개 코멘트 등록',
  },
  internal: {
    title: '내부 메모',
    badge: '내부메모',
    hint: '시스템팀에게만 보입니다. 코드·로그를 붙여넣을 수 있고 Tab으로 들여쓰기합니다 (Esc를 누른 뒤 Tab을 누르면 다음 요소로 이동).',
    placeholder: '내부 메모 · 코드/로그 (요청자에게 노출되지 않습니다)',
    submit: '내부 메모 등록',
  },
}

/**
 * 코멘트 작성기. 공개·내부 두 변형을 각각 독립된 폼으로 렌더링한다.
 * 내부 변형은 코드 입력을 전제로 monospace · 넓은 높이 · Tab 들여쓰기를 지원한다.
 */
export function CommentComposer({ variant, onSubmit, disabled = false }: Props) {
  const internal = variant === 'internal'
  const copy = COPY[variant]

  const [body, setBody] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  // Esc를 먼저 누르면 다음 Tab은 들여쓰기 대신 포커스 이동으로 처리한다 (키보드 트랩 방지).
  const escapedRef = useRef(false)

  const bodyId = `comment-body-${variant}`
  const busy = pending || disabled

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (!internal) return
    if (e.key === 'Escape') {
      escapedRef.current = true
      return
    }
    if (e.key !== 'Tab' || e.shiftKey || escapedRef.current) {
      escapedRef.current = false
      return
    }
    e.preventDefault()
    const ta = e.currentTarget
    const start = ta.selectionStart
    const end = ta.selectionEnd
    setBody(`${body.slice(0, start)}  ${body.slice(end)}`)
    requestAnimationFrame(() => {
      ta.selectionStart = ta.selectionEnd = start + 2
    })
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!body.trim() || busy) return
    setPending(true)
    setError(null)
    const message = await onSubmit(body, files)
    setPending(false)
    if (message) {
      setError(message)
      return
    }
    setBody('')
    setFiles([])
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  return (
    <form
      onSubmit={(e) => void handleSubmit(e)}
      className={[
        'rounded-lg border p-3',
        internal ? 'border-amber-200 bg-amber-50' : 'border-gray-200 bg-white',
      ].join(' ')}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={[
            'rounded px-1.5 py-0.5 text-xs font-medium',
            internal ? 'bg-amber-200 text-amber-800' : 'bg-blue-100 text-blue-700',
          ].join(' ')}
        >
          {copy.badge}
        </span>
        <label htmlFor={bodyId} className="text-sm font-semibold text-gray-700">
          {copy.title}
        </label>
      </div>
      <p className="mt-1 text-xs text-gray-500">{copy.hint}</p>

      <textarea
        id={bodyId}
        className={[
          'mt-2 block w-full resize-y rounded-md border px-3 py-2 shadow-sm focus:outline-none focus:ring-1',
          internal
            ? 'border-amber-300 bg-white font-mono text-[13px] leading-relaxed text-gray-800 focus:border-amber-400 focus:ring-amber-300'
            : 'border-gray-300 bg-white text-sm focus:border-brand focus:ring-brand',
        ].join(' ')}
        rows={internal ? 8 : 3}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={copy.placeholder}
        disabled={busy}
        spellCheck={!internal}
        autoCapitalize={internal ? 'off' : undefined}
        autoCorrect={internal ? 'off' : undefined}
        wrap={internal ? 'off' : undefined}
      />

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <label className="cursor-pointer rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-50">
          파일 첨부
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="sr-only"
            disabled={busy}
            onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
          />
        </label>
        {files.length > 0 && (
          <span className="min-w-0 truncate text-xs text-gray-500">
            {files.map((f) => f.name).join(', ')}
          </span>
        )}
        <button
          type="submit"
          disabled={busy || !body.trim()}
          className={[
            'ml-auto rounded-md px-4 py-1.5 text-sm font-medium text-white disabled:opacity-60',
            internal ? 'bg-amber-600 hover:bg-amber-700' : 'bg-brand hover:bg-brand-dark',
          ].join(' ')}
        >
          {pending ? '등록 중…' : copy.submit}
        </button>
      </div>

      {error && (
        <p role="alert" className="mt-2 text-xs text-red-600">
          {error}
        </p>
      )}
    </form>
  )
}
