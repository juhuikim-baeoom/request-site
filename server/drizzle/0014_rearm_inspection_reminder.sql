-- 재작업 후 재검수 라운드마다 3일차 리마인더가 다시 나가도록 재무장한다.
-- 문제: 검수대기 진입 시 inspection_due_at은 재설정되지만 inspection_reminder_sent_at은
-- 그대로 남아있어, (검수대기→리마인더 발송→반려/재작업→진행중→검수대기) 순으로 재진입해도
-- 배치의 "IS NULL" 조건에 걸려 두 번째 검수 라운드에서는 리마인더가 다시 나가지 않았다.
-- 해결: 검수대기 진입 branch에서 inspection_reminder_sent_at := null 로 초기화해
-- 라운드마다 자기 몫의 리마인더를 다시 무장한다.
--
-- 아래 함수 본문은 현재 라이브 DB의 pg_get_functiondef(on_status_change())를 그대로 베이스로 하고
-- inspection_reminder_sent_at 초기화 한 줄만 추가한 것이다 (기존 동작 무손실 보존).
CREATE OR REPLACE FUNCTION public.on_status_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE uid uuid := nullif(current_setting('app.user_id', true), '')::uuid;
BEGIN
  IF new.status IS DISTINCT FROM old.status THEN
    INSERT INTO request_status_history (request_id, from_status, to_status, changed_by)
    VALUES (new.id, old.status, new.status, uid);

    IF new.status = '검수대기' THEN
      -- 팀 작업 종료 시점. 재작업 후 재진입해도 first_resolved_at은 최초값을 보존한다.
      new.first_resolved_at := coalesce(new.first_resolved_at, now());
      new.inspection_due_at := now() + interval '7 days';
      new.inspection_reminder_sent_at := null;  -- 재검수 라운드마다 리마인더 재무장
      IF new.resolution_due_at IS NOT NULL AND now() > new.resolution_due_at THEN
        new.sla_resolution_breached := true;
      END IF;

    ELSIF new.status = '완료' THEN
      new.completed_at      := coalesce(new.completed_at, now());
      new.first_resolved_at := coalesce(new.first_resolved_at, now());
      new.final_resolved_at := now();
      new.inspection_due_at := null;

    ELSIF old.status IN ('완료', '검수대기') AND new.status = '진행중' THEN
      -- 재작업: 검수 반려(검수대기→진행중)와 이의 수락(완료→진행중) 둘 다 카운트한다.
      new.completed_at             := null;
      new.final_resolved_at        := null;
      new.inspection_due_at        := null;
      new.completion_route         := null;
      new.rework_count             := new.rework_count + 1;
      new.sla_resolution_breached  := false;  -- 재작업은 SLA 안에 끝낼 수 있다

    ELSIF old.status = '완료' THEN
      new.completed_at      := null;
      new.final_resolved_at := null;
      new.completion_route  := null;
    END IF;
  END IF;
  RETURN new;
END $function$
;
