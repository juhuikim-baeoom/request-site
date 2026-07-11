---
title: 마이그레이션 규약 (forward-only)
last_updated: 2026-07-11
status: Active
owner: 시스템팀
diataxis: how-to
ssot_for: DB 마이그레이션 작성·적용 절차
---

# 마이그레이션 규약 (forward-only)

DB 스키마 변경은 이 디렉토리의 **버전 파일로만** 관리한다. 상세 원칙은 `docs/standards/03-data-management-rules.md`가 SSOT.

## 베이스라인

- 저장소 루트 `schema.sql`이 현재 스키마의 **베이스라인**이다. 신규 환경은 이 파일을 Supabase SQL Editor에 실행해 초기화한다.
- 베이스라인 이후 모든 변경은 이 디렉토리에 파일을 **추가**한다. `schema.sql`은 베이스라인 기록으로 두되, 대규모 개편 시에만 후속 ADR과 함께 재생성한다.

## 파일명 규약

Supabase CLI 관례를 따른다.

```text
supabase/migrations/{YYYYMMDDHHMMSS}_{설명}.sql
예: 20260711143527_add_requests_deleted_flag.sql
```

## 작성 전 필수 확인 (MUST)

1. `ls supabase/migrations | sort | tail` — 저장소 최신 버전 확인.
2. 실제 DB에 적용된 최신 버전 확인(가능한 경우).
3. 새 버전 식별자가 위 두 값보다 **명확히 큰지** 확인 후 생성.
4. 이미 적용된 파일은 **편집 금지** — 정정도 새 버전 파일(roll-forward)로 한다.

## 작성 규칙 (요약)

- SQL 본문에 환경별 스키마 접두사(`prod.`, `qa.`)를 하드코딩하지 않는다.
- 시드/참조 데이터는 멱등(`WHERE NOT EXISTS` / `ON CONFLICT`)하게.
- 운영 데이터에 영향 주는 `UPDATE`/`DELETE`는 `BEGIN; ... ROLLBACK;` dry-run으로 영향 행수 검증 후 적용.
- 삭제는 soft-delete(`deleted_flag`) 우선, 물리삭제는 근거 명시.
- 시크릿·PII 평문을 SQL·주석·커밋에 남기지 않는다.
- 신규 컬럼/코드값은 `CLAUDE.md` §2(네이밍·접미사·코드값) 준수.

전체 체크리스트는 `docs/standards/03-data-management-rules.md` §2, §9 참조.
