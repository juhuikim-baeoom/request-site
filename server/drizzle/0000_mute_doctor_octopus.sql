CREATE TYPE "public"."request_org" AS ENUM('배움', '배론', '허브', '공통');--> statement-breakpoint
CREATE TYPE "public"."request_priority" AS ENUM('긴급', '보통', '낮음');--> statement-breakpoint
CREATE TYPE "public"."request_source" AS ENUM('web', 'email');--> statement-breakpoint
CREATE TYPE "public"."request_status" AS ENUM('접수', '확인', '진행중', '검수대기', '재작업', '완료', '보류', '반려', '이관', '철회');--> statement-breakpoint
CREATE TYPE "public"."request_visibility" AS ENUM('private', 'dept', 'function', 'org', 'shared');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('staff', 'system', 'viewer');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "org_directory" (
	"email" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"dept" text NOT NULL,
	"org_affil" "request_org" NOT NULL,
	"dept_function" text,
	"role" "user_role" DEFAULT 'staff' NOT NULL,
	"synced" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "request_attachments" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "request_attachments_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"request_id" bigint NOT NULL,
	"storage_path" text NOT NULL,
	"file_name" text,
	"file_size" bigint,
	"mime_type" text,
	"uploaded_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "request_comments" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "request_comments_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"request_id" bigint NOT NULL,
	"author_id" uuid,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "request_shared_targets" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "request_shared_targets_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"request_id" bigint NOT NULL,
	"target_type" text NOT NULL,
	"target_value" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_shared_target" UNIQUE("request_id","target_type","target_value")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "request_status_history" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "request_status_history_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"request_id" bigint NOT NULL,
	"from_status" "request_status",
	"to_status" "request_status" NOT NULL,
	"changed_by" uuid,
	"changed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "request_types" (
	"code" text PRIMARY KEY NOT NULL,
	"label" text NOT NULL,
	"sort_order" integer DEFAULT 0,
	"active" boolean DEFAULT true
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "requests" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "requests_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"seq" text,
	"source" "request_source" DEFAULT 'web' NOT NULL,
	"org" "request_org" NOT NULL,
	"type_code" text NOT NULL,
	"priority" "request_priority" DEFAULT '보통' NOT NULL,
	"title" text NOT NULL,
	"body" text,
	"requester_id" uuid,
	"requester_name" text,
	"requester_email" text,
	"assignee_id" uuid,
	"status" "request_status" DEFAULT '접수' NOT NULL,
	"visibility" "request_visibility" DEFAULT 'dept' NOT NULL,
	"requester_dept" text,
	"requester_org" "request_org",
	"requester_function" text,
	"desired_due" date,
	"first_completed_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"rework_count" integer DEFAULT 0 NOT NULL,
	"parent_request_id" bigint,
	"source_thread_id" text,
	"is_locked" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "requests_seq_unique" UNIQUE("seq")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"google_sub" text,
	"name" text,
	"dept" text,
	"org_affil" "request_org",
	"dept_function" text,
	"role" "user_role" DEFAULT 'staff' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email"),
	CONSTRAINT "users_google_sub_unique" UNIQUE("google_sub")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "request_attachments" ADD CONSTRAINT "request_attachments_request_id_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."requests"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "request_attachments" ADD CONSTRAINT "request_attachments_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "request_comments" ADD CONSTRAINT "request_comments_request_id_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."requests"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "request_comments" ADD CONSTRAINT "request_comments_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "request_shared_targets" ADD CONSTRAINT "request_shared_targets_request_id_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."requests"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "request_status_history" ADD CONSTRAINT "request_status_history_request_id_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."requests"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "request_status_history" ADD CONSTRAINT "request_status_history_changed_by_users_id_fk" FOREIGN KEY ("changed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "requests" ADD CONSTRAINT "requests_type_code_request_types_code_fk" FOREIGN KEY ("type_code") REFERENCES "public"."request_types"("code") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "requests" ADD CONSTRAINT "requests_requester_id_users_id_fk" FOREIGN KEY ("requester_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "requests" ADD CONSTRAINT "requests_assignee_id_users_id_fk" FOREIGN KEY ("assignee_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_attach_request" ON "request_attachments" USING btree ("request_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_comments_request" ON "request_comments" USING btree ("request_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_shared_targets_request" ON "request_shared_targets" USING btree ("request_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_history_request" ON "request_status_history" USING btree ("request_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_requests_status" ON "requests" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_requests_org" ON "requests" USING btree ("org");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_requests_assignee" ON "requests" USING btree ("assignee_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_requests_requester" ON "requests" USING btree ("requester_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_requests_created" ON "requests" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_requests_parent" ON "requests" USING btree ("parent_request_id");