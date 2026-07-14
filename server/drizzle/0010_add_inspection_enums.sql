-- enum 값 추가는 별도 파일로 분리한다.
-- Postgres는 ALTER TYPE ... ADD VALUE로 추가한 값을 같은 트랜잭션에서 사용할 수 없고
-- (unsafe use of new value of enum type), drizzle 마이그레이터는 파일 하나를 한 트랜잭션으로 실행한다.
-- 새 값을 참조하는 컬럼·테이블·트리거·뷰는 0006에 있다.
ALTER TYPE "public"."request_status" ADD VALUE IF NOT EXISTS '검수대기' AFTER '진행중';
--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE IF NOT EXISTS 'dispute';
