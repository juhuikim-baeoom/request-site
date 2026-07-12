-- 검수 리마인더를 건당 1회만 보내기 위한 발송 시각 기록
ALTER TABLE "requests" ADD COLUMN IF NOT EXISTS "inspection_reminder_sent_at" timestamptz;--> statement-breakpoint

-- 배치가 매시간 스캔하는 조건에 맞춘 부분 인덱스
CREATE INDEX IF NOT EXISTS "idx_requests_inspection_due"
  ON "requests" ("inspection_due_at") WHERE "status" = '검수대기';
