-- =====================================================================
-- 업무요청 접수·관리 사이트 — Supabase(PostgreSQL) 스키마
-- 실행: Supabase 대시보드 > SQL Editor 에 붙여넣고 실행
-- 위에서부터 한 번에 실행되도록 구성됨
-- =====================================================================

-- ---------- 0. ENUM 타입 ----------
create type user_role        as enum ('staff', 'system', 'viewer');
create type request_org      as enum ('배움', '배론', '허브', '공통');
create type request_status   as enum ('접수','확인','진행중','검수대기','재작업','완료','보류','반려','이관');
create type request_priority as enum ('긴급', '보통', '낮음');
create type request_source   as enum ('web', 'email');
create type request_visibility as enum ('private', 'dept', 'function', 'org', 'shared');

-- ---------- 1. 프로필 (auth.users 확장: 역할·소속) ----------
create table profiles (
  id         uuid primary key references auth.users on delete cascade,
  email      text unique not null,
  name       text,
  org        text,                                   -- (참고용) 소속 부서/기관 자유 기재
  dept       text,                                   -- 부서 코드/명 (레거시, 미사용)
  org_affil  request_org,                            -- 소속 기관 (동일기관 판정): 배움/배론/허브/공통
  dept_function text,                                -- 직무: 교학팀/상담영업팀/시스템팀/기획마케팅팀/상품개발팀/경영지원팀/원장/임원/그로스전략실
  role       user_role not null default 'staff',
  created_at timestamptz not null default now()
);

-- 조직도 사전 등록 테이블: 직원 계정을 미리 등록해두면 최초 로그인 시 자동 반영
-- (email PK. 데이터는 CSV import 등으로 별도 적재)
create table org_directory (
  email      text primary key,
  name       text not null,
  dept       text not null,
  org_affil  request_org not null,
  dept_function text,                                -- 직무 (profiles.dept_function 로 반영)
  role       user_role not null default 'staff',
  synced     boolean not null default false,          -- 실제 가입되어 profiles로 반영됐는지
  created_at timestamptz not null default now()
);

-- 가입 시 profiles 자동 생성 + 허용 도메인 제한 + 조직도 사전등록 반영
-- @baeoom.com / @baeron.com 이 아니면 예외 발생 → auth.users insert 롤백(가입 차단)
-- (Google OAuth를 External로 설정해 Workspace Internal 제한을 못 쓰므로 DB에서 강제)
create function handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  email_domain text := lower(split_part(coalesce(new.email, ''), '@', 2));
  dir org_directory%rowtype;
begin
  -- 1) 허용 도메인 외 가입 차단
  if email_domain not in ('baeoom.com', 'baeron.com') then
    raise exception '허용되지 않은 도메인입니다. @baeoom.com 또는 @baeron.com 계정만 이용할 수 있습니다.'
      using errcode = 'P0001', hint = 'DOMAIN_NOT_ALLOWED';
  end if;

  -- 2) org_directory 사전 등록 정보 조회 (이메일 대소문자 무시)
  select * into dir from org_directory
  where lower(email) = lower(new.email)
  limit 1;

  if found then
    -- 사전 등록된 직원: name·dept·org_affil·role 그대로 반영
    insert into profiles (id, email, name, dept, org_affil, dept_function, role)
    values (new.id, new.email, dir.name, dir.dept, dir.org_affil, dir.dept_function, dir.role)
    on conflict (id) do nothing;

    update org_directory set synced = true where lower(email) = lower(new.email);
  else
    -- 미등록 이메일: 기본값(role=staff, dept/org_affil=null)
    insert into profiles (id, email, name)
    values (new.id, new.email, coalesce(new.raw_user_meta_data->>'full_name', new.email))
    on conflict (id) do nothing;
  end if;

  return new;
end $$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function handle_new_user();

-- ---------- 2. 요청 유형 코드 (주간보고 매핑 포함) ----------
create table request_types (
  code            text primary key,        -- 'error','feature','data','file'
  label           text not null,           -- 화면 표시명
  sort_order      int default 0,
  active          boolean default true
);

insert into request_types (code, label, sort_order) values
  ('error',   '오류',       1),
  ('feature', '기능요청',   2),
  ('data',    '데이터추출', 3),
  ('file',    '파일변경',   4);

-- ---------- 3. 요청 원장 ----------
create table requests (
  id                bigint generated always as identity primary key,
  seq               text unique,                       -- 접수번호 YYMMDD-NN (트리거 생성)
  source            request_source not null default 'web',
  org               request_org not null,
  type_code         text not null references request_types(code),
  priority          request_priority not null default '보통',
  title             text not null,
  body              text,                              -- 에디터 HTML
  requester_id      uuid references profiles(id),      -- 웹 접수자
  requester_name    text,                              -- 메일 접수 등 계정 없는 경우
  requester_email   text,
  assignee_id       uuid references profiles(id),      -- 담당(시스템팀)
  status            request_status not null default '접수',
  visibility        request_visibility not null default 'dept',  -- 공개 범위(요청자 선택, 미선택 시 부서)
  requester_dept    text,                              -- 접수 시점 요청자 부서 스냅샷(레거시)
  requester_org     request_org,                       -- 접수 시점 요청자 소속기관 스냅샷
  requester_function text,                             -- 접수 시점 요청자 직무 스냅샷
  desired_due       date,                              -- 희망완료일
  first_completed_at timestamptz,                      -- 1차 완료
  completed_at      timestamptz,                       -- 최종 완료
  rework_count      int not null default 0,
  parent_request_id bigint references requests(id),    -- 하위 연결(같은 건 재접수 등)
  source_thread_id  text,                              -- 메일 접수 시 gmail thread id
  is_locked         boolean not null default false,    -- 메일 자동추적 보호용
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index idx_requests_status    on requests(status);
create index idx_requests_org       on requests(org);
create index idx_requests_assignee  on requests(assignee_id);
create index idx_requests_requester on requests(requester_id);
create index idx_requests_created   on requests(created_at);
create index idx_requests_parent    on requests(parent_request_id);
create unique index idx_requests_thread on requests(source_thread_id) where source_thread_id is not null;

-- ---------- 4. 처리 코멘트 ----------
create table request_comments (
  id         bigint generated always as identity primary key,
  request_id bigint not null references requests(id) on delete cascade,
  author_id  uuid references profiles(id),
  body       text not null,
  created_at timestamptz not null default now()
);
create index idx_comments_request on request_comments(request_id);

-- ---------- 5. 상태 변경 이력 (리드타임·재작업 근거) ----------
create table request_status_history (
  id          bigint generated always as identity primary key,
  request_id  bigint not null references requests(id) on delete cascade,
  from_status request_status,
  to_status   request_status not null,
  changed_by  uuid references profiles(id),
  changed_at  timestamptz not null default now()
);
create index idx_history_request on request_status_history(request_id);

-- ---------- 6. 첨부 (Supabase Storage 메타) ----------
create table request_attachments (
  id           bigint generated always as identity primary key,
  request_id   bigint not null references requests(id) on delete cascade,
  storage_path text not null,                          -- bucket 내 경로
  file_name    text,
  file_size    bigint,
  mime_type    text,
  uploaded_by  uuid references profiles(id),
  created_at   timestamptz not null default now()
);
create index idx_attach_request on request_attachments(request_id);

-- ---------- 7. 추가 공유부서 (공개범위 외 지정 공유, 다중) ----------
create table request_shared_targets (
  id          bigint generated always as identity primary key,
  request_id  bigint not null references requests(id) on delete cascade,
  target_type text not null check (target_type in ('function','dept')),  -- 직무단위 / 기관별 세부부서
  target_value text not null,                        -- function: '교학팀' / dept: '배움|교학팀'
  created_at  timestamptz not null default now(),
  unique (request_id, target_type, target_value)
);
create index idx_shared_targets_request on request_shared_targets(request_id);

-- =====================================================================
--  트리거 / 함수
-- =====================================================================

-- updated_at 자동 갱신
create function touch_updated_at() returns trigger
language plpgsql as $$
begin new.updated_at = now(); return new; end $$;
create trigger trg_requests_touch before update on requests
for each row execute function touch_updated_at();

-- 접수번호 생성: YYMMDD-NN (일자별 연번, 예: 260711-03)
-- advisory lock으로 동시 접수 시 번호 중복 방지
create function gen_seq() returns trigger
language plpgsql as $$
declare d text := to_char(now(), 'YYMMDD'); n int;
begin
  if new.seq is not null then return new; end if;
  perform pg_advisory_xact_lock(hashtext('req_seq_' || d));
  select count(*) + 1 into n from requests where seq like d || '-%';
  new.seq := d || '-' || lpad(n::text, 2, '0');
  return new;
end $$;
create trigger trg_requests_seq before insert on requests
for each row execute function gen_seq();

-- 접수 시점 요청자 소속(부서·기관·직무) 스냅샷 (요청자 이동해도 접수 당시 기준 유지)
create function snapshot_requester() returns trigger
language plpgsql security definer set search_path = public as $$
declare p record;
begin
  if new.requester_id is not null then
    select dept, org_affil, dept_function into p from profiles where id = new.requester_id;
    new.requester_dept     := coalesce(new.requester_dept, p.dept);
    new.requester_org      := coalesce(new.requester_org, p.org_affil);
    new.requester_function := coalesce(new.requester_function, p.dept_function);
  end if;
  return new;
end $$;
create trigger trg_requests_snapshot before insert on requests
for each row execute function snapshot_requester();

-- 상태 변경 처리: 이력 기록 + 완료일/재작업 자동 관리
create function on_status_change() returns trigger
language plpgsql as $$
begin
  if new.status is distinct from old.status then
    insert into request_status_history (request_id, from_status, to_status, changed_by)
    values (new.id, old.status, new.status, auth.uid());

    if new.status = '완료' then
      new.completed_at := coalesce(new.completed_at, now());
      new.first_completed_at := coalesce(new.first_completed_at, new.completed_at);
    elsif old.status = '완료' then
      -- 완료에서 재작업 등으로 되돌림: 최종완료 해제, 1차완료 이력은 유지
      new.completed_at := null;
      if new.status = '재작업' then new.rework_count := new.rework_count + 1; end if;
    end if;
  end if;
  return new;
end $$;
create trigger trg_requests_status before update on requests
for each row execute function on_status_change();

-- =====================================================================
--  뷰: 계산 필드(리드타임·기한상태) 포함 보드/대시보드용
-- =====================================================================
-- security_invoker=on: 조회자의 RLS가 적용되도록 (SECURITY DEFINER 뷰의 RLS 우회 방지)
create view request_view with (security_invoker = on) as
select
  r.*,
  t.label           as type_label,
  case when r.first_completed_at is not null
       then (r.first_completed_at::date - r.created_at::date) end as first_lead_days,
  case when r.completed_at is not null
       then (r.completed_at::date - r.created_at::date) end       as final_lead_days,
  case
    when r.status in ('완료','반려','보류','이관') then r.status::text
    when r.desired_due is not null and r.desired_due <  current_date       then '기한초과'
    when r.desired_due is not null and r.desired_due <= current_date + 1   then '임박'
    when r.desired_due is null and r.created_at::date <= current_date - 3   then '지연'
    else '여유'
  end as due_status
from requests r
left join request_types t on t.code = r.type_code;

-- =====================================================================
--  RLS (행수준 보안) — 권한 3단계
-- =====================================================================
create function is_system() returns boolean
language sql stable security definer set search_path = public as $$
  select exists(select 1 from profiles where id = auth.uid() and role = 'system');
$$;
create function is_viewer_up() returns boolean
language sql stable security definer set search_path = public as $$
  select exists(select 1 from profiles where id = auth.uid() and role in ('system','viewer'));
$$;
create function my_dept() returns text
language sql stable security definer set search_path = public as $$
  select dept from profiles where id = auth.uid();
$$;
create function my_org() returns request_org
language sql stable security definer set search_path = public as $$
  select org_affil from profiles where id = auth.uid();
$$;
create function my_function() returns text
language sql stable security definer set search_path = public as $$
  select dept_function from profiles where id = auth.uid();
$$;
-- 세부부서(기관×직무) 옵션 목록 — 추가 공유 UI용 (org_directory 기반)
create function list_dept_options()
returns table(org_affil request_org, dept_function text)
language sql stable security definer set search_path = public as $$
  select distinct org_affil, dept_function
  from org_directory
  where dept_function is not null
  order by org_affil, dept_function;
$$;
grant execute on function list_dept_options() to authenticated;

-- 특정 요청을 볼 수 있는지 (공개범위 5단계 + 추가 공유 반영). comments/attachments/history/requests 공용
--   private=본인 / dept=같은기관·같은직무 / function=같은직무 / org=같은기관 / shared=전직원
--   + request_shared_targets 지정공유(직무 또는 기관|직무)
create function can_see_request(req_id bigint) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from requests r where r.id = req_id and (
      is_viewer_up()
      or r.requester_id = auth.uid()
      or r.visibility = 'shared'
      or (r.visibility = 'org'      and r.requester_org      is not null and r.requester_org      = my_org())
      or (r.visibility = 'function' and r.requester_function is not null and r.requester_function = my_function())
      or (r.visibility = 'dept'     and r.requester_org is not null and r.requester_function is not null
                                    and r.requester_org = my_org() and r.requester_function = my_function())
      or exists (
        select 1 from request_shared_targets st
        where st.request_id = r.id and (
          (st.target_type = 'function' and st.target_value = my_function())
          or (st.target_type = 'dept' and st.target_value = my_org()::text || '|' || my_function())
        )
      )
    )
  );
$$;

alter table profiles               enable row level security;
alter table requests               enable row level security;
alter table request_comments       enable row level security;
alter table request_status_history enable row level security;
alter table request_attachments    enable row level security;
alter table request_shared_targets enable row level security;
alter table request_types          enable row level security;

-- request_types: 로그인 사용자 모두 읽기
create policy types_read on request_types for select to authenticated using (true);

-- profiles: 로그인 사용자 전체 읽기 (이름·부서·담당자 표시용). 수정은 시스템팀만.
create policy prof_read on profiles for select to authenticated
  using (true);
-- 수정은 시스템팀만 (계정 관리 페이지). 본인 자가수정 불가.
-- dept/org_affil을 바꿔도 과거 요청의 requester_dept/org 스냅샷이라 영향 없음(이후 요청부터 반영)
create policy prof_update_admin on profiles for update to authenticated
  using (is_system()) with check (is_system());

-- requests
--  읽기: can_see_request 로 단일화 (공개범위 5단계 + 추가 공유). comments/attachments/history와 동일 판정
create policy req_read on requests for select to authenticated
  using (can_see_request(id));
--  등록: 로그인 사용자, 본인 명의로만
--  (메일 접수 건은 GAS/서버가 service_role 키로 insert → RLS 미적용, source='email')
create policy req_insert on requests for insert to authenticated
  with check (requester_id = auth.uid());
--  수정: 시스템팀 전체 / 요청자 본인은 '접수' 상태일 때만 (내용·공개범위·희망일 정정용,
--        처리 시작되면 잠김. 상태·담당 필드 변경은 앱단에서 차단)
create policy req_update on requests for update to authenticated
  using (is_system() or (requester_id = auth.uid() and status = '접수'))
  with check (is_system() or (requester_id = auth.uid() and status = '접수'));
create policy req_delete on requests for delete to authenticated
  using (is_system());

-- comments: 해당 요청을 볼 수 있으면 읽기/작성
create policy cmt_read on request_comments for select to authenticated
  using (can_see_request(request_id));
create policy cmt_insert on request_comments for insert to authenticated
  with check (author_id = auth.uid() and can_see_request(request_id));

-- status_history: 읽기만(변경은 트리거가 security definer로 처리)
create policy hist_read on request_status_history for select to authenticated
  using (can_see_request(request_id));

-- attachments: 요청 접근권 있으면 읽기 / 본인 업로드
create policy att_read on request_attachments for select to authenticated
  using (can_see_request(request_id));
create policy att_insert on request_attachments for insert to authenticated
  with check (uploaded_by = auth.uid());
create policy att_delete on request_attachments for delete to authenticated
  using (uploaded_by = auth.uid() or is_system());

-- shared_targets: 요청 접근권 있으면 읽기 / 소유자(접수상태) 또는 시스템팀 추가·삭제
create policy shared_read on request_shared_targets for select to authenticated
  using (can_see_request(request_id));
create policy shared_insert on request_shared_targets for insert to authenticated
  with check (
    is_system() or exists (
      select 1 from requests r
      where r.id = request_id and r.requester_id = auth.uid() and r.status = '접수'
    )
  );
create policy shared_delete on request_shared_targets for delete to authenticated
  using (
    is_system() or exists (
      select 1 from requests r
      where r.id = request_id and r.requester_id = auth.uid() and r.status = '접수'
    )
  );

-- =====================================================================
--  Storage 버킷 (첨부)
-- =====================================================================
insert into storage.buckets (id, name, public) values ('request-attachments','request-attachments', false)
  on conflict (id) do nothing;

-- 업로드: 로그인 사용자 / 읽기: 시스템·열람자 또는 본인 폴더
create policy "att upload" on storage.objects for insert to authenticated
  with check (bucket_id = 'request-attachments');
create policy "att read" on storage.objects for select to authenticated
  using (bucket_id = 'request-attachments' and (is_viewer_up() or owner = auth.uid()));
