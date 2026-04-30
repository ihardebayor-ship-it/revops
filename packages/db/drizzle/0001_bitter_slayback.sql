CREATE TABLE "funnel_event_dedupe" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"stage_id" uuid NOT NULL,
	"meta_hash" text NOT NULL,
	"funnel_event_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "funnel_event_dedupe_uq" UNIQUE("entity_type","entity_id","stage_id","meta_hash")
);
--> statement-breakpoint
CREATE TABLE "commission_recipients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"sub_account_id" uuid NOT NULL,
	"sale_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"sales_role_id" uuid NOT NULL,
	"sales_role_version_id" uuid NOT NULL,
	"share_pct" numeric(5, 4) NOT NULL,
	"computed_amount" numeric(14, 2),
	"rule_id" uuid,
	"rule_version_id" uuid,
	"currency" text DEFAULT 'USD' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "unique_key" text;--> statement-breakpoint
ALTER TABLE "optins" ADD COLUMN "contacted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "optins" ADD COLUMN "contacted_call_id" uuid;--> statement-breakpoint
ALTER TABLE "optins" ADD COLUMN "attributed_setter_user_id" text;--> statement-breakpoint
ALTER TABLE "funnel_event_dedupe" ADD CONSTRAINT "funnel_event_dedupe_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "funnel_event_dedupe" ADD CONSTRAINT "funnel_event_dedupe_stage_id_funnel_stages_id_fk" FOREIGN KEY ("stage_id") REFERENCES "public"."funnel_stages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "funnel_event_dedupe" ADD CONSTRAINT "funnel_event_dedupe_funnel_event_id_funnel_events_id_fk" FOREIGN KEY ("funnel_event_id") REFERENCES "public"."funnel_events"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_recipients" ADD CONSTRAINT "commission_recipients_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_recipients" ADD CONSTRAINT "commission_recipients_sub_account_id_sub_accounts_id_fk" FOREIGN KEY ("sub_account_id") REFERENCES "public"."sub_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_recipients" ADD CONSTRAINT "commission_recipients_sale_id_sales_id_fk" FOREIGN KEY ("sale_id") REFERENCES "public"."sales"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_recipients" ADD CONSTRAINT "commission_recipients_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_recipients" ADD CONSTRAINT "commission_recipients_sales_role_id_sales_roles_id_fk" FOREIGN KEY ("sales_role_id") REFERENCES "public"."sales_roles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_recipients" ADD CONSTRAINT "commission_recipients_sales_role_version_id_sales_role_versions_id_fk" FOREIGN KEY ("sales_role_version_id") REFERENCES "public"."sales_role_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_recipients" ADD CONSTRAINT "commission_recipients_rule_id_commission_rules_id_fk" FOREIGN KEY ("rule_id") REFERENCES "public"."commission_rules"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_recipients" ADD CONSTRAINT "commission_recipients_rule_version_id_commission_rule_versions_id_fk" FOREIGN KEY ("rule_version_id") REFERENCES "public"."commission_rule_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_recipients" ADD CONSTRAINT "commission_recipients_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "funnel_event_dedupe_workspace_idx" ON "funnel_event_dedupe" USING btree ("workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX "commission_recipients_sale_user_role_uq" ON "commission_recipients" USING btree ("sale_id","user_id","sales_role_id") WHERE "commission_recipients"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "commission_recipients_sale_idx" ON "commission_recipients" USING btree ("sale_id");--> statement-breakpoint
CREATE INDEX "commission_recipients_user_idx" ON "commission_recipients" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "commission_recipients_workspace_idx" ON "commission_recipients" USING btree ("workspace_id");--> statement-breakpoint
ALTER TABLE "optins" ADD CONSTRAINT "optins_contacted_call_id_calls_id_fk" FOREIGN KEY ("contacted_call_id") REFERENCES "public"."calls"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "optins" ADD CONSTRAINT "optins_attributed_setter_user_id_user_id_fk" FOREIGN KEY ("attributed_setter_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "tasks_unique_key_uq" ON "tasks" USING btree ("sub_account_id","unique_key") WHERE "tasks"."unique_key" is not null;--> statement-breakpoint
CREATE INDEX "tasks_inbox_idx" ON "tasks" USING btree ("sub_account_id","assigned_user_id","status","due_at");--> statement-breakpoint
CREATE INDEX "optins_sla_pending_idx" ON "optins" USING btree ("sub_account_id","submitted_at") WHERE "optins"."contacted_call_id" is null;