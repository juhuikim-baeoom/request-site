DO $$ BEGIN
 ALTER TABLE "requests" ADD CONSTRAINT "requests_parent_request_id_requests_id_fk" FOREIGN KEY ("parent_request_id") REFERENCES "public"."requests"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_requests_thread" ON "requests" USING btree ("source_thread_id") WHERE source_thread_id is not null;