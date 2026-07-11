#!/usr/bin/env node
/**
 * PostToolUse 훅 (비차단) — 문서 동기화 리마인더
 *
 * Edit/Write/MultiEdit 로 소스/설정 파일이 바뀌면, CLAUDE.md 의 "영향 매핑 표"에 따라
 * 함께 갱신할 문서를 Claude 에게 상기시킨다. 작업을 막지 않는다(additionalContext 만 주입).
 *
 * SSOT: CLAUDE.md §1 (영향 매핑 표), docs/standards/04-document-management-rules.md §2
 * 매핑 규칙을 바꾸려면 아래 RULES 배열과 CLAUDE.md 표를 함께 갱신한다.
 */

'use strict';

// 변경 파일(repo-상대 경로) → 함께 갱신할 문서. 순서대로 매칭, 매칭된 것 모두 수집.
const RULES = [
  { test: (p) => p === 'schema.sql' || /^supabase\/migrations\/.*\.sql$/.test(p),
    docs: ['docs/reference/db-schema.md', 'CHANGELOG.md'] },
  { test: (p) => /^src\/types\//.test(p) || p === 'src/lib/constants.ts',
    docs: ['docs/reference/db-schema.md'] },
  { test: (p) => /^src\/auth\//.test(p),
    docs: ['docs/reference/db-schema.md (RLS·역할)', 'docs/00-overview/index.md'] },
  { test: (p) => /^src\/(features|pages|components)\//.test(p),
    docs: ['docs/reference/requirements.md', 'CHANGELOG.md'] },
  { test: (p) => p === '.env.example' || p === 'vite.config.ts' || p === 'package.json',
    docs: ['docs/00-overview/index.md'] },
  { test: (p) => p === 'CLAUDE.md',
    docs: ['docs/00-overview/index.md'] },
];

function readStdin() {
  return new Promise((resolve) => {
    let data = '';
    process.stdin.on('data', (c) => (data += c));
    process.stdin.on('end', () => resolve(data));
    // stdin 이 없으면 즉시 종료 안전장치
    setTimeout(() => resolve(data), 1000);
  });
}

function emit(context) {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PostToolUse',
      additionalContext: context,
    },
  }));
}

(async () => {
  try {
    const raw = await readStdin();
    if (!raw.trim()) return process.exit(0);
    const input = JSON.parse(raw);

    const filePath = input?.tool_input?.file_path;
    if (!filePath) return process.exit(0);

    const cwd = input?.cwd || process.cwd();
    // repo-상대 경로로 정규화
    let rel = filePath.startsWith(cwd) ? filePath.slice(cwd.length) : filePath;
    rel = rel.replace(/^\/+/, '');

    // 문서/훅/설정 자체 편집은 리마인더 대상 아님 (무한 상기 방지)
    if (rel.endsWith('.md') || rel.startsWith('.claude/') || rel.startsWith('docs/')) {
      return process.exit(0);
    }

    const docs = new Set();
    for (const rule of RULES) {
      if (rule.test(rel)) rule.docs.forEach((d) => docs.add(d));
    }
    if (docs.size === 0) return process.exit(0);

    const list = [...docs].map((d) => `  - ${d}`).join('\n');
    emit(
      `[문서 동기화 리마인더] \`${rel}\` 변경 감지.\n` +
      `이 변경이 사용자 노출(화면·엔드포인트·옵션·스키마) 수준이면 다음 문서를 같은 작업에서 갱신하세요:\n${list}\n` +
      `내부 리팩토링·테스트·주석만이면 스킵하되 커밋 메시지에 "docs sync: 스킵(사유)" 한 줄을 남기세요. ` +
      `frontmatter가 있는 문서는 last_updated를 오늘 날짜로 갱신. 판단 기준: CLAUDE.md §1.`
    );
    process.exit(0);
  } catch (_e) {
    // 훅 오류가 작업을 막지 않도록 조용히 통과
    process.exit(0);
  }
})();
