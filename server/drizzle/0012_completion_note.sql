-- 강제 완료(SYSTEM_FORCED 등) 시 남기는 사유를 감사 추적으로 보존한다.
-- request_status_history에는 reason 컬럼이 없고, 완료 알림 메시지도 일반 문구라서
-- 지금까지는 강제 완료 사유가 어디에도 남지 않았다. 이 컬럼이 그 유일한 기록처다.
ALTER TABLE "requests" ADD COLUMN IF NOT EXISTS "completion_note" text;
