-- 역할 모델 백필(server/src/db/backfill-roles.ts)이 최초 1회만 실행되도록 이력을 남긴다.
-- migrate.ts는 매 배포마다 db:migrate → backfillRoles()를 실행하는데, 이 마커가 없으면
-- 백필이 이메일만 보고 매번 juhuikim@baeoom.com을 system_admin으로 되돌려
-- 관리자가 계정 관리 화면에서 수동으로 바꾼 역할을 조용히 덮어써 버린다.
-- 백필은 (a) 이 테이블에 backfill_key를 원자적으로 claim(INSERT ... ON CONFLICT DO NOTHING)하고
-- (b) claim에 성공했을 때만 실제 UPDATE를 수행한다 — 이미 적용된 DB에서 재실행하면
-- claim이 실패해 UPDATE 자체가 스킵되므로, 이후 수동으로 바뀐 역할이 되살아나지 않는다.

create table role_backfill_history (
  backfill_key text primary key,
  created_at timestamptz not null default now()
);
