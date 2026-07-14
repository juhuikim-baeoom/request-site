-- 공유 설정 변경 이력.
-- 공유 변경은 열람 권한의 변경이므로 "누가 언제 무엇을 열었는가"를 추적할 수 있어야 한다.
-- request_status_history는 상태 전이 전용이라 재사용하지 않는다.
-- changed_at 이름은 request_status_history의 기존 관례를 따른다.

create table if not exists request_sharing_history (
  id              bigint generated always as identity primary key,
  request_id      bigint not null references requests(id) on delete cascade,
  changed_by      uuid references users(id),
  changed_at      timestamptz not null default now(),
  from_visibility text,
  to_visibility   text,
  added           jsonb not null default '[]'::jsonb,
  removed         jsonb not null default '[]'::jsonb
);

create index if not exists idx_sharing_history_request on request_sharing_history(request_id);
