-- 검수대기 단계 + 이의제기.
-- 새 enum 값(검수대기)은 0005에서 이미 커밋됐으므로 여기서 안전하게 참조할 수 있다.

-- ① requests 신규 컬럼
ALTER TABLE "requests" ADD COLUMN IF NOT EXISTS "inspection_due_at" timestamptz;--> statement-breakpoint
ALTER TABLE "requests" ADD COLUMN IF NOT EXISTS "completion_route" varchar(16);--> statement-breakpoint
ALTER TABLE "requests" ADD CONSTRAINT "requests_completion_route_check"
  CHECK ("completion_route" IS NULL OR "completion_route" IN ('REQUESTER', 'AUTO', 'SYSTEM_FORCED'));--> statement-breakpoint

-- ② 이의제기 테이블
CREATE TABLE IF NOT EXISTS "request_disputes" (
  "id"             bigserial PRIMARY KEY,
  "request_id"     bigint NOT NULL REFERENCES "requests"("id") ON DELETE CASCADE,
  "raised_by"      uuid   NOT NULL REFERENCES "users"("id"),
  "reason"         text   NOT NULL,
  "status_cd"      varchar(16) NOT NULL DEFAULT 'OPEN'
                   CHECK ("status_cd" IN ('OPEN', 'ACCEPTED', 'REJECTED')),
  "reviewed_by"    uuid REFERENCES "users"("id"),
  "review_comment" text,
  "reviewed_at"    timestamptz,
  "created_at"     timestamptz NOT NULL DEFAULT now(),
  "updated_at"     timestamptz NOT NULL DEFAULT now()
);--> statement-breakpoint

-- 한 요청에 동시에 열린 이의는 1건만
CREATE UNIQUE INDEX IF NOT EXISTS "request_disputes_one_open"
  ON "request_disputes" ("request_id") WHERE "status_cd" = 'OPEN';--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_request_disputes_request"
  ON "request_disputes" ("request_id");--> statement-breakpoint

-- ③ on_status_change 트리거 교체
--    검수대기 진입 = 팀이 손을 뗀 시점 → 해결 SLA 판정 기준
--    최종 완료 = 요청자가 납득한 시점 → 종결 리드타임 기준
CREATE OR REPLACE FUNCTION on_status_change() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
DECLARE uid uuid := nullif(current_setting('app.user_id', true), '')::uuid;
BEGIN
  IF new.status IS DISTINCT FROM old.status THEN
    INSERT INTO request_status_history (request_id, from_status, to_status, changed_by)
    VALUES (new.id, old.status, new.status, uid);

    IF new.status = '검수대기' THEN
      -- 팀 작업 종료 시점. 재작업 후 재진입해도 first_resolved_at은 최초값을 보존한다.
      new.first_resolved_at := coalesce(new.first_resolved_at, now());
      new.inspection_due_at := now() + interval '7 days';
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
END $$;--> statement-breakpoint

-- ④ request_view 교체: has_open_dispute 추가, due_status 종결 목록에 검수대기 포함
--    검수대기는 팀이 손을 뗀 상태이므로 요청자가 늦게 확인해도 기한초과로 표시하지 않는다.
--    requests 테이블에 컬럼(inspection_due_at, completion_route)을 추가한 뒤라
--    r.*의 컬럼 위치가 바뀌어 CREATE OR REPLACE VIEW로는 교체할 수 없다
--    ("cannot change name of view column ... to ..."). DROP 후 재생성한다.
--    (의존 뷰·GRANT 없음을 사전 확인함)
DROP VIEW IF EXISTS request_view;--> statement-breakpoint

CREATE VIEW request_view AS
SELECT
  r.*,
  t.label AS type_label,
  CASE WHEN r.first_resolved_at IS NOT NULL
       THEN (r.first_resolved_at::date - r.created_at::date) END AS first_lead_days,
  CASE WHEN r.final_resolved_at IS NOT NULL
       THEN (r.final_resolved_at::date - r.created_at::date) END AS final_lead_days,
  CASE
    WHEN r.status IN ('완료','반려','철회','검수대기') THEN r.status::text
    WHEN r.resolution_due_at IS NOT NULL AND now() > r.resolution_due_at THEN '기한초과'
    WHEN r.resolution_due_at IS NOT NULL AND r.resolution_due_at - now() < interval '4 hour' THEN '임박'
    ELSE '여유'
  END AS due_status,
  EXISTS (
    SELECT 1 FROM request_disputes d
    WHERE d.request_id = r.id AND d.status_cd = 'OPEN'
  ) AS has_open_dispute
FROM requests r
LEFT JOIN request_types t ON t.code = r.type_code;
