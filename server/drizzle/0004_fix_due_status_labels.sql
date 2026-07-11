-- Fix due_status labels to match FE contract:
--   '초과' → '기한초과', '정상' → '여유'
-- Also resets sla_resolution_breached on rework (완료→진행중).
-- '지연' was never produced by DB — only existed in stale FE constants; dropped.

-- ① Recreate request_view with updated labels
create or replace view request_view as
select
  r.*,
  t.label as type_label,
  case when r.first_resolved_at is not null
       then (r.first_resolved_at::date - r.created_at::date) end as first_lead_days,
  case when r.final_resolved_at is not null
       then (r.final_resolved_at::date - r.created_at::date) end  as final_lead_days,
  case
    when r.status in ('완료','반려','철회') then r.status::text
    when r.resolution_due_at is not null and now() > r.resolution_due_at then '기한초과'
    when r.resolution_due_at is not null and r.resolution_due_at - now() < interval '4 hour' then '임박'
    else '여유'
  end as due_status
from requests r
left join request_types t on t.code = r.type_code;
--> statement-breakpoint

-- ② Replace on_status_change trigger: reset sla_resolution_breached on rework
create or replace function on_status_change() returns trigger
language plpgsql set search_path = public as $$
declare uid uuid := nullif(current_setting('app.user_id', true), '')::uuid;
begin
  if new.status is distinct from old.status then
    insert into request_status_history (request_id, from_status, to_status, changed_by)
    values (new.id, old.status, new.status, uid);

    if new.status = '완료' then
      new.completed_at      := coalesce(new.completed_at, now());
      new.first_resolved_at := coalesce(new.first_resolved_at, now());
      new.final_resolved_at := now();
      if new.resolution_due_at is not null and now() > new.resolution_due_at then
        new.sla_resolution_breached := true;
      end if;
    elsif old.status = '완료' then
      new.completed_at      := null;
      new.final_resolved_at := null;
      if new.status = '진행중' then
        new.rework_count             := new.rework_count + 1;
        new.sla_resolution_breached  := false;  -- reset: rework may complete within SLA
      end if;
    end if;
  end if;
  return new;
end $$;
