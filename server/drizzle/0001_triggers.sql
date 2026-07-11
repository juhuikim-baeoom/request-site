-- Custom SQL migration file, put your code below! --

-- updated_at 자동 갱신
create function touch_updated_at() returns trigger
language plpgsql as $$
begin new.updated_at = now(); return new; end $$;
create trigger trg_requests_touch before update on requests
for each row execute function touch_updated_at();
--> statement-breakpoint

-- 접수번호 생성: YYMMDD-NN (KST, advisory lock으로 중복 방지)
create function gen_seq() returns trigger
language plpgsql as $$
declare d text := to_char(now() at time zone 'Asia/Seoul', 'YYMMDD'); n int;
begin
  if new.seq is not null then return new; end if;
  perform pg_advisory_xact_lock(hashtext('req_seq_' || d));
  select count(*) + 1 into n from requests where seq like d || '-%';
  new.seq := d || '-' || lpad(n::text, 2, '0');
  return new;
end $$;
create trigger trg_requests_seq before insert on requests
for each row execute function gen_seq();
--> statement-breakpoint

-- 접수 시점 요청자 소속 스냅샷 (profiles → users)
create function snapshot_requester() returns trigger
language plpgsql set search_path = public as $$
declare p record;
begin
  if new.requester_id is not null then
    select dept, org_affil, dept_function into p from users where id = new.requester_id;
    new.requester_dept     := coalesce(new.requester_dept, p.dept);
    new.requester_org      := coalesce(new.requester_org, p.org_affil);
    new.requester_function := coalesce(new.requester_function, p.dept_function);
  end if;
  return new;
end $$;
create trigger trg_requests_snapshot before insert on requests
for each row execute function snapshot_requester();
--> statement-breakpoint

-- 상태 변경 처리: 이력 기록(변경자=app.user_id) + 완료일/재작업 관리
create function on_status_change() returns trigger
language plpgsql set search_path = public as $$
declare uid uuid := nullif(current_setting('app.user_id', true), '')::uuid;
begin
  if new.status is distinct from old.status then
    insert into request_status_history (request_id, from_status, to_status, changed_by)
    values (new.id, old.status, new.status, uid);

    if new.status = '완료' then
      new.completed_at := coalesce(new.completed_at, now());
      new.first_completed_at := coalesce(new.first_completed_at, new.completed_at);
    elsif old.status = '완료' then
      new.completed_at := null;
      if new.status = '재작업' then new.rework_count := new.rework_count + 1; end if;
    end if;
  end if;
  return new;
end $$;
create trigger trg_requests_status before update on requests
for each row execute function on_status_change();
--> statement-breakpoint

-- 보드/대시보드용 계산 뷰 (RLS 제거 → 일반 뷰. 권한은 백엔드에서)
create view request_view as
select
  r.*,
  t.label as type_label,
  case when r.first_completed_at is not null
       then (r.first_completed_at::date - r.created_at::date) end as first_lead_days,
  case when r.completed_at is not null
       then (r.completed_at::date - r.created_at::date) end       as final_lead_days,
  case
    when r.status in ('완료','반려','보류','이관','철회') then r.status::text
    when r.desired_due is not null and r.desired_due <  current_date       then '기한초과'
    when r.desired_due is not null and r.desired_due <= current_date + 1   then '임박'
    when r.desired_due is null and r.created_at::date <= current_date - 3   then '지연'
    else '여유'
  end as due_status
from requests r
left join request_types t on t.code = r.type_code;