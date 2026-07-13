-- 역할 모델 정교화: user_role enum에 4개 값 추가.
-- ALTER TYPE ... ADD VALUE 로 추가한 값은 같은 트랜잭션에서 사용할 수 없으므로,
-- 이 값을 쓰는 데이터 이전은 다음 마이그레이션(0006)에서 수행한다.
-- 기존 'viewer'는 제거하지 않는다 (Postgres 미지원 + forward-only 원칙).

alter type user_role add value if not exists 'dept_monitor';
alter type user_role add value if not exists 'org_monitor';
alter type user_role add value if not exists 'exec';
alter type user_role add value if not exists 'system_admin';
