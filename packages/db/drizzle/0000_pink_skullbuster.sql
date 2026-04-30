CREATE TYPE "public"."access_role" AS ENUM('superadmin', 'workspace_admin', 'sub_account_admin', 'manager', 'contributor', 'viewer');--> statement-breakpoint
CREATE TYPE "public"."agent_fact_kind" AS ENUM('preference', 'rule', 'fact', 'pattern');--> statement-breakpoint
CREATE TYPE "public"."agent_fact_scope" AS ENUM('workspace', 'user', 'customer', 'thread');--> statement-breakpoint
CREATE TYPE "public"."agent_message_role" AS ENUM('user', 'assistant', 'tool_call', 'tool_result', 'system_event');--> statement-breakpoint
CREATE TYPE "public"."audit_actor_kind" AS ENUM('user', 'agent_on_behalf_of_user', 'system', 'webhook');--> statement-breakpoint
CREATE TYPE "public"."commission_rule_type" AS ENUM('flat_rate', 'tiered', 'bonus', 'override', 'accelerator');--> statement-breakpoint
CREATE TYPE "public"."commission_status" AS ENUM('pending', 'available', 'paid', 'clawed_back', 'voided');--> statement-breakpoint
CREATE TYPE "public"."customer_status" AS ENUM('active', 'churned', 'refunded', 'won_back', 'paused');--> statement-breakpoint
CREATE TYPE "public"."data_source_kind" AS ENUM('optin', 'application', 'appointments', 'sales', 'calls', 'transcripts');--> statement-breakpoint
CREATE TYPE "public"."disposition_category" AS ENUM('positive', 'objection', 'disqualification', 'won', 'no_show', 'rescheduled', 'other');--> statement-breakpoint
CREATE TYPE "public"."funnel_stage_kind" AS ENUM('lead', 'call', 'sale', 'post_sale');--> statement-breakpoint
CREATE TYPE "public"."goal_kind" AS ENUM('ote', 'quota', 'ramp', 'target');--> statement-breakpoint
CREATE TYPE "public"."installment_status" AS ENUM('scheduled', 'collected', 'failed', 'refunded', 'skipped');--> statement-breakpoint
CREATE TYPE "public"."period_kind" AS ENUM('daily', 'weekly', 'monthly', 'quarterly', 'annual', 'ramp_window', 'custom');--> statement-breakpoint
CREATE TYPE "public"."recording_consent" AS ENUM('one_party', 'two_party', 'unknown', 'declined');--> statement-breakpoint
CREATE TYPE "public"."refund_status" AS ENUM('none', 'requested', 'in_save_flow', 'approved', 'issued', 'denied');--> statement-breakpoint
CREATE TYPE "public"."task_kind" AS ENUM('call_outcome_pending', 'sale_unlinked', 'follow_up_due', 'no_show_recovery', 'commission_approval', 'refund_save', 'agent_suggestion', 'manager_one_on_one', 'custom');--> statement-breakpoint
CREATE TYPE "public"."task_status" AS ENUM('open', 'snoozed', 'completed', 'dismissed');--> statement-breakpoint
CREATE TYPE "public"."topology_preset" AS ENUM('solo', 'setter_closer', 'setter_closer_cx', 'custom');--> statement-breakpoint
CREATE TABLE "account" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"account_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"password" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"token" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "platform_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"brand_name" text DEFAULT 'RevOps Pro' NOT NULL,
	"brand_tagline" text DEFAULT '' NOT NULL,
	"support_email" text DEFAULT 'support@revops.pro' NOT NULL,
	"primary_color" text DEFAULT 'hsl(216 100% 58%)' NOT NULL,
	"logo_url" text,
	"agent_persona" jsonb NOT NULL,
	"default_email_from" text DEFAULT 'noreply@revops.pro' NOT NULL,
	"feature_flags" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text
);
--> statement-breakpoint
CREATE TABLE "platform_users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	CONSTRAINT "platform_users_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "memberships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"workspace_id" uuid NOT NULL,
	"sub_account_id" uuid,
	"access_role" "access_role" DEFAULT 'contributor' NOT NULL,
	"invited_by" text,
	"accepted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "memberships_user_workspace_sub_uq" UNIQUE("user_id","workspace_id","sub_account_id")
);
--> statement-breakpoint
CREATE TABLE "sub_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"timezone" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "sub_accounts_workspace_slug_uq" UNIQUE("workspace_id","slug")
);
--> statement-breakpoint
CREATE TABLE "tenant_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"whitelabel_enabled" boolean DEFAULT false NOT NULL,
	"brand_name" text,
	"logo_url" text,
	"primary_color" text,
	"support_email" text,
	"agent_persona" jsonb,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tenant_settings_workspace_id_unique" UNIQUE("workspace_id")
);
--> statement-breakpoint
CREATE TABLE "workspace_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"default_hold_days" text DEFAULT '30' NOT NULL,
	"agent_daily_cost_cap_usd" text DEFAULT '25' NOT NULL,
	"agent_per_turn_cost_cap_usd" text DEFAULT '0.50' NOT NULL,
	"speed_to_lead_sla_seconds" text DEFAULT '300' NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workspace_settings_workspace_id_unique" UNIQUE("workspace_id")
);
--> statement-breakpoint
CREATE TABLE "workspaces" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"topology_preset" "topology_preset" DEFAULT 'solo' NOT NULL,
	"timezone" text DEFAULT 'UTC' NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "workspaces_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "sales_role_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"sales_role_id" uuid NOT NULL,
	"sub_account_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"effective_from" timestamp with time zone DEFAULT now() NOT NULL,
	"effective_to" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "sales_role_assignments_user_role_sub_uq" UNIQUE("user_id","sales_role_id","sub_account_id")
);
--> statement-breakpoint
CREATE TABLE "sales_role_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sales_role_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"snapshot" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	CONSTRAINT "sales_role_versions_role_version_uq" UNIQUE("sales_role_id","version")
);
--> statement-breakpoint
CREATE TABLE "sales_roles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"slug" text NOT NULL,
	"label" text NOT NULL,
	"stage_ownership" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"default_commission_share" numeric(5, 4) NOT NULL,
	"default_sla_seconds" integer,
	"color" text,
	"icon" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "sales_roles_workspace_slug_uq" UNIQUE("workspace_id","slug")
);
--> statement-breakpoint
CREATE TABLE "dispositions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"slug" text NOT NULL,
	"label" text NOT NULL,
	"category" "disposition_category" NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_active" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "dispositions_workspace_slug_uq" UNIQUE("workspace_id","slug")
);
--> statement-breakpoint
CREATE TABLE "funnel_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"sub_account_id" uuid NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"stage_id" uuid,
	"stage_version_id" uuid,
	"occurred_at" timestamp with time zone NOT NULL,
	"source_event_id" uuid,
	"actor_user_id" text,
	"meta" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "funnel_stage_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"funnel_stage_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"snapshot" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "funnel_stage_versions_stage_version_uq" UNIQUE("funnel_stage_id","version")
);
--> statement-breakpoint
CREATE TABLE "funnel_stages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"slug" text NOT NULL,
	"label" text NOT NULL,
	"kind" "funnel_stage_kind" NOT NULL,
	"ordinal" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "funnel_stages_workspace_slug_uq" UNIQUE("workspace_id","slug")
);
--> statement-breakpoint
CREATE TABLE "customers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"sub_account_id" uuid NOT NULL,
	"primary_email" text NOT NULL,
	"name" text,
	"phone" text,
	"status" "customer_status" DEFAULT 'active' NOT NULL,
	"lifetime_value" numeric(14, 2) DEFAULT '0' NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"original_sale_id" uuid,
	"attributed_setter_user_id" text,
	"attributed_closer_user_id" text,
	"attributed_cx_user_id" text,
	"churn_at" timestamp with time zone,
	"churn_reason" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "calls" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"sub_account_id" uuid NOT NULL,
	"customer_id" uuid,
	"contact_email" text,
	"contact_phone" text,
	"contact_name" text,
	"setter_user_id" text,
	"closer_user_id" text,
	"appointment_at" timestamp with time zone,
	"contacted_at" timestamp with time zone,
	"showed_at" timestamp with time zone,
	"pitched_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"duration_seconds" integer,
	"disposition_id" uuid,
	"notes" text,
	"recording_url" text,
	"transcript_url" text,
	"transcript_ingested_at" timestamp with time zone,
	"recording_consent" "recording_consent" DEFAULT 'unknown' NOT NULL,
	"linked_sale_id" uuid,
	"source_integration" text,
	"external_id" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "payment_plan_installments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"payment_plan_id" uuid NOT NULL,
	"sale_id" uuid NOT NULL,
	"sequence" integer NOT NULL,
	"expected_amount" numeric(14, 2) NOT NULL,
	"actual_amount" numeric(14, 2),
	"currency" text DEFAULT 'USD' NOT NULL,
	"expected_date" date NOT NULL,
	"collected_at" timestamp with time zone,
	"status" "installment_status" DEFAULT 'scheduled' NOT NULL,
	"failure_reason" text,
	"external_charge_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_plan_installments_plan_seq_uq" UNIQUE("payment_plan_id","sequence")
);
--> statement-breakpoint
CREATE TABLE "payment_plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"sub_account_id" uuid NOT NULL,
	"sale_id" uuid NOT NULL,
	"customer_id" uuid,
	"installment_frequency" text NOT NULL,
	"total_installments" integer NOT NULL,
	"installment_amount" numeric(14, 2) NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"first_installment_date" date NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sales" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"sub_account_id" uuid NOT NULL,
	"customer_id" uuid,
	"linked_call_id" uuid,
	"product_name" text,
	"booked_amount" numeric(14, 2) NOT NULL,
	"collected_amount" numeric(14, 2) DEFAULT '0' NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"closed_at" timestamp with time zone NOT NULL,
	"payment_processor" text,
	"refund_status" "refund_status" DEFAULT 'none' NOT NULL,
	"refunded_amount" numeric(14, 2) DEFAULT '0' NOT NULL,
	"refunded_at" timestamp with time zone,
	"original_sale_id" uuid,
	"source_integration" text,
	"external_id" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "sales_external_uq" UNIQUE("source_integration","external_id")
);
--> statement-breakpoint
CREATE TABLE "commission_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"sub_account_id" uuid NOT NULL,
	"sale_id" uuid NOT NULL,
	"installment_id" uuid,
	"period_id" uuid,
	"recipient_user_id" text NOT NULL,
	"sales_role_id" uuid,
	"sales_role_version_id" uuid,
	"rule_id" uuid,
	"rule_version_id" uuid,
	"amount" numeric(14, 2) NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"status" "commission_status" DEFAULT 'pending' NOT NULL,
	"pending_until" timestamp with time zone,
	"available_at" timestamp with time zone,
	"paid_at" timestamp with time zone,
	"clawed_back_at" timestamp with time zone,
	"computed_from" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "commission_periods" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"sub_account_id" uuid,
	"kind" "period_kind" NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"closed_at" timestamp with time zone,
	"paid_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "commission_rule_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"commission_rule_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"snapshot" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	CONSTRAINT "commission_rule_versions_rule_version_uq" UNIQUE("commission_rule_id","version")
);
--> statement-breakpoint
CREATE TABLE "commission_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name" text NOT NULL,
	"type" "commission_rule_type" NOT NULL,
	"sales_role_id" uuid,
	"share_pct" numeric(5, 4),
	"flat_amount" numeric(14, 2),
	"currency" text DEFAULT 'USD' NOT NULL,
	"product_match" jsonb,
	"source_match" jsonb,
	"hold_days" integer DEFAULT 30 NOT NULL,
	"paid_on" text DEFAULT 'collected' NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"is_active" integer DEFAULT 1 NOT NULL,
	"effective_from" timestamp with time zone,
	"effective_to" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "goals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"sub_account_id" uuid NOT NULL,
	"user_id" text,
	"sales_role_id" uuid,
	"kind" "goal_kind" NOT NULL,
	"metric" text NOT NULL,
	"target_value" numeric(14, 2) NOT NULL,
	"currency" text,
	"period_kind" "period_kind" NOT NULL,
	"period_start" date NOT NULL,
	"period_end" date NOT NULL,
	"accelerators" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"sub_account_id" uuid NOT NULL,
	"kind" "task_kind" NOT NULL,
	"status" "task_status" DEFAULT 'open' NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"assigned_user_id" text,
	"sales_role_id" uuid,
	"related_entity_type" text,
	"related_entity_id" uuid,
	"due_at" timestamp with time zone,
	"snoozed_until" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"completed_by" text,
	"agent_origin_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text
);
--> statement-breakpoint
CREATE TABLE "data_source_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"sub_account_id" uuid NOT NULL,
	"data_source_id" uuid NOT NULL,
	"tool_type" text NOT NULL,
	"label" text NOT NULL,
	"access_token_encrypted" text,
	"refresh_token_encrypted" text,
	"expires_at" timestamp with time zone,
	"scope" text,
	"external_account_id" text,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "data_sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"sub_account_id" uuid NOT NULL,
	"kind" "data_source_kind" NOT NULL,
	"label" text NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "applications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"sub_account_id" uuid NOT NULL,
	"data_source_connection_id" uuid,
	"email" text NOT NULL,
	"name" text,
	"phone" text,
	"form_response" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"qualifying_score" text,
	"source_integration" text,
	"external_id" text,
	"submitted_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "applications_external_uq" UNIQUE("source_integration","external_id")
);
--> statement-breakpoint
CREATE TABLE "optins" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"sub_account_id" uuid NOT NULL,
	"data_source_connection_id" uuid,
	"email" text NOT NULL,
	"name" text,
	"phone" text,
	"lead_source" text,
	"utm_source" text,
	"utm_medium" text,
	"utm_campaign" text,
	"utm_term" text,
	"utm_content" text,
	"form_response" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"source_integration" text,
	"external_id" text,
	"submitted_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	CONSTRAINT "optins_external_uq" UNIQUE("source_integration","external_id")
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid,
	"sub_account_id" uuid,
	"actor_kind" "audit_actor_kind" NOT NULL,
	"actor_user_id" text,
	"action" text NOT NULL,
	"resource_type" text NOT NULL,
	"resource_id" uuid,
	"before" jsonb,
	"after" jsonb,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"agent_trace_id" text,
	"request_id" text,
	"ip_address" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "outbound_webhook_subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"sub_account_id" uuid,
	"label" text NOT NULL,
	"url" text NOT NULL,
	"secret_encrypted" text NOT NULL,
	"event_types" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"last_delivered_at" timestamp with time zone,
	"failure_count" text DEFAULT '0' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "agent_eval_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"suite_slug" text NOT NULL,
	"run_at" timestamp with time zone DEFAULT now() NOT NULL,
	"model" text NOT NULL,
	"scorer_version" text NOT NULL,
	"score_summary" jsonb NOT NULL,
	"regressions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"langfuse_run_id" text,
	"duration_ms" integer,
	"cost_usd" numeric(10, 6),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_facts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"scope" "agent_fact_scope" NOT NULL,
	"scope_ref_id" uuid,
	"kind" "agent_fact_kind" NOT NULL,
	"content" text NOT NULL,
	"source_message_id" uuid,
	"embedding" vector(1536),
	"confidence" numeric(3, 2) DEFAULT '0.6' NOT NULL,
	"confirmed_by_user_at" timestamp with time zone,
	"contradicted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"thread_id" uuid NOT NULL,
	"turn_id" uuid NOT NULL,
	"role" "agent_message_role" NOT NULL,
	"content" jsonb NOT NULL,
	"model" text,
	"token_usage" jsonb,
	"cost_usd" numeric(10, 6),
	"langfuse_trace_id" text,
	"tool_name" text,
	"tool_call_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_threads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"sub_account_id" uuid,
	"user_id" text NOT NULL,
	"title" text DEFAULT 'New conversation' NOT NULL,
	"summary" text,
	"summary_updated_at" timestamp with time zone,
	"token_count_estimate" integer DEFAULT 0 NOT NULL,
	"total_cost_usd" numeric(10, 6) DEFAULT '0' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_message_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_settings" ADD CONSTRAINT "platform_settings_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_users" ADD CONSTRAINT "platform_users_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_users" ADD CONSTRAINT "platform_users_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_sub_account_id_sub_accounts_id_fk" FOREIGN KEY ("sub_account_id") REFERENCES "public"."sub_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_invited_by_user_id_fk" FOREIGN KEY ("invited_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sub_accounts" ADD CONSTRAINT "sub_accounts_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sub_accounts" ADD CONSTRAINT "sub_accounts_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_settings" ADD CONSTRAINT "tenant_settings_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_settings" ADD CONSTRAINT "workspace_settings_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspaces" ADD CONSTRAINT "workspaces_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_role_assignments" ADD CONSTRAINT "sales_role_assignments_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_role_assignments" ADD CONSTRAINT "sales_role_assignments_sales_role_id_sales_roles_id_fk" FOREIGN KEY ("sales_role_id") REFERENCES "public"."sales_roles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_role_assignments" ADD CONSTRAINT "sales_role_assignments_sub_account_id_sub_accounts_id_fk" FOREIGN KEY ("sub_account_id") REFERENCES "public"."sub_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_role_assignments" ADD CONSTRAINT "sales_role_assignments_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_role_versions" ADD CONSTRAINT "sales_role_versions_sales_role_id_sales_roles_id_fk" FOREIGN KEY ("sales_role_id") REFERENCES "public"."sales_roles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_role_versions" ADD CONSTRAINT "sales_role_versions_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_roles" ADD CONSTRAINT "sales_roles_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dispositions" ADD CONSTRAINT "dispositions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "funnel_events" ADD CONSTRAINT "funnel_events_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "funnel_events" ADD CONSTRAINT "funnel_events_sub_account_id_sub_accounts_id_fk" FOREIGN KEY ("sub_account_id") REFERENCES "public"."sub_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "funnel_events" ADD CONSTRAINT "funnel_events_stage_id_funnel_stages_id_fk" FOREIGN KEY ("stage_id") REFERENCES "public"."funnel_stages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "funnel_events" ADD CONSTRAINT "funnel_events_stage_version_id_funnel_stage_versions_id_fk" FOREIGN KEY ("stage_version_id") REFERENCES "public"."funnel_stage_versions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "funnel_events" ADD CONSTRAINT "funnel_events_actor_user_id_user_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "funnel_stage_versions" ADD CONSTRAINT "funnel_stage_versions_funnel_stage_id_funnel_stages_id_fk" FOREIGN KEY ("funnel_stage_id") REFERENCES "public"."funnel_stages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "funnel_stages" ADD CONSTRAINT "funnel_stages_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_sub_account_id_sub_accounts_id_fk" FOREIGN KEY ("sub_account_id") REFERENCES "public"."sub_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_attributed_setter_user_id_user_id_fk" FOREIGN KEY ("attributed_setter_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_attributed_closer_user_id_user_id_fk" FOREIGN KEY ("attributed_closer_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_attributed_cx_user_id_user_id_fk" FOREIGN KEY ("attributed_cx_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calls" ADD CONSTRAINT "calls_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calls" ADD CONSTRAINT "calls_sub_account_id_sub_accounts_id_fk" FOREIGN KEY ("sub_account_id") REFERENCES "public"."sub_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calls" ADD CONSTRAINT "calls_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calls" ADD CONSTRAINT "calls_setter_user_id_user_id_fk" FOREIGN KEY ("setter_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calls" ADD CONSTRAINT "calls_closer_user_id_user_id_fk" FOREIGN KEY ("closer_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calls" ADD CONSTRAINT "calls_disposition_id_dispositions_id_fk" FOREIGN KEY ("disposition_id") REFERENCES "public"."dispositions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calls" ADD CONSTRAINT "calls_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_plan_installments" ADD CONSTRAINT "payment_plan_installments_payment_plan_id_payment_plans_id_fk" FOREIGN KEY ("payment_plan_id") REFERENCES "public"."payment_plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_plan_installments" ADD CONSTRAINT "payment_plan_installments_sale_id_sales_id_fk" FOREIGN KEY ("sale_id") REFERENCES "public"."sales"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_plans" ADD CONSTRAINT "payment_plans_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_plans" ADD CONSTRAINT "payment_plans_sub_account_id_sub_accounts_id_fk" FOREIGN KEY ("sub_account_id") REFERENCES "public"."sub_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_plans" ADD CONSTRAINT "payment_plans_sale_id_sales_id_fk" FOREIGN KEY ("sale_id") REFERENCES "public"."sales"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_plans" ADD CONSTRAINT "payment_plans_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales" ADD CONSTRAINT "sales_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales" ADD CONSTRAINT "sales_sub_account_id_sub_accounts_id_fk" FOREIGN KEY ("sub_account_id") REFERENCES "public"."sub_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales" ADD CONSTRAINT "sales_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales" ADD CONSTRAINT "sales_linked_call_id_calls_id_fk" FOREIGN KEY ("linked_call_id") REFERENCES "public"."calls"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales" ADD CONSTRAINT "sales_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_entries" ADD CONSTRAINT "commission_entries_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_entries" ADD CONSTRAINT "commission_entries_sub_account_id_sub_accounts_id_fk" FOREIGN KEY ("sub_account_id") REFERENCES "public"."sub_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_entries" ADD CONSTRAINT "commission_entries_sale_id_sales_id_fk" FOREIGN KEY ("sale_id") REFERENCES "public"."sales"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_entries" ADD CONSTRAINT "commission_entries_installment_id_payment_plan_installments_id_fk" FOREIGN KEY ("installment_id") REFERENCES "public"."payment_plan_installments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_entries" ADD CONSTRAINT "commission_entries_period_id_commission_periods_id_fk" FOREIGN KEY ("period_id") REFERENCES "public"."commission_periods"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_entries" ADD CONSTRAINT "commission_entries_recipient_user_id_user_id_fk" FOREIGN KEY ("recipient_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_entries" ADD CONSTRAINT "commission_entries_sales_role_id_sales_roles_id_fk" FOREIGN KEY ("sales_role_id") REFERENCES "public"."sales_roles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_entries" ADD CONSTRAINT "commission_entries_sales_role_version_id_sales_role_versions_id_fk" FOREIGN KEY ("sales_role_version_id") REFERENCES "public"."sales_role_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_entries" ADD CONSTRAINT "commission_entries_rule_id_commission_rules_id_fk" FOREIGN KEY ("rule_id") REFERENCES "public"."commission_rules"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_entries" ADD CONSTRAINT "commission_entries_rule_version_id_commission_rule_versions_id_fk" FOREIGN KEY ("rule_version_id") REFERENCES "public"."commission_rule_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_periods" ADD CONSTRAINT "commission_periods_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_periods" ADD CONSTRAINT "commission_periods_sub_account_id_sub_accounts_id_fk" FOREIGN KEY ("sub_account_id") REFERENCES "public"."sub_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_rule_versions" ADD CONSTRAINT "commission_rule_versions_commission_rule_id_commission_rules_id_fk" FOREIGN KEY ("commission_rule_id") REFERENCES "public"."commission_rules"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_rule_versions" ADD CONSTRAINT "commission_rule_versions_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_rules" ADD CONSTRAINT "commission_rules_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_rules" ADD CONSTRAINT "commission_rules_sales_role_id_sales_roles_id_fk" FOREIGN KEY ("sales_role_id") REFERENCES "public"."sales_roles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_rules" ADD CONSTRAINT "commission_rules_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goals" ADD CONSTRAINT "goals_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goals" ADD CONSTRAINT "goals_sub_account_id_sub_accounts_id_fk" FOREIGN KEY ("sub_account_id") REFERENCES "public"."sub_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goals" ADD CONSTRAINT "goals_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goals" ADD CONSTRAINT "goals_sales_role_id_sales_roles_id_fk" FOREIGN KEY ("sales_role_id") REFERENCES "public"."sales_roles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goals" ADD CONSTRAINT "goals_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_sub_account_id_sub_accounts_id_fk" FOREIGN KEY ("sub_account_id") REFERENCES "public"."sub_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_assigned_user_id_user_id_fk" FOREIGN KEY ("assigned_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_sales_role_id_sales_roles_id_fk" FOREIGN KEY ("sales_role_id") REFERENCES "public"."sales_roles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_completed_by_user_id_fk" FOREIGN KEY ("completed_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "data_source_connections" ADD CONSTRAINT "data_source_connections_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "data_source_connections" ADD CONSTRAINT "data_source_connections_sub_account_id_sub_accounts_id_fk" FOREIGN KEY ("sub_account_id") REFERENCES "public"."sub_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "data_source_connections" ADD CONSTRAINT "data_source_connections_data_source_id_data_sources_id_fk" FOREIGN KEY ("data_source_id") REFERENCES "public"."data_sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "data_source_connections" ADD CONSTRAINT "data_source_connections_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "data_sources" ADD CONSTRAINT "data_sources_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "data_sources" ADD CONSTRAINT "data_sources_sub_account_id_sub_accounts_id_fk" FOREIGN KEY ("sub_account_id") REFERENCES "public"."sub_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "data_sources" ADD CONSTRAINT "data_sources_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "applications" ADD CONSTRAINT "applications_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "applications" ADD CONSTRAINT "applications_sub_account_id_sub_accounts_id_fk" FOREIGN KEY ("sub_account_id") REFERENCES "public"."sub_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "applications" ADD CONSTRAINT "applications_data_source_connection_id_data_source_connections_id_fk" FOREIGN KEY ("data_source_connection_id") REFERENCES "public"."data_source_connections"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "optins" ADD CONSTRAINT "optins_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "optins" ADD CONSTRAINT "optins_sub_account_id_sub_accounts_id_fk" FOREIGN KEY ("sub_account_id") REFERENCES "public"."sub_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "optins" ADD CONSTRAINT "optins_data_source_connection_id_data_source_connections_id_fk" FOREIGN KEY ("data_source_connection_id") REFERENCES "public"."data_source_connections"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "optins" ADD CONSTRAINT "optins_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_sub_account_id_sub_accounts_id_fk" FOREIGN KEY ("sub_account_id") REFERENCES "public"."sub_accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_actor_user_id_user_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outbound_webhook_subscriptions" ADD CONSTRAINT "outbound_webhook_subscriptions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outbound_webhook_subscriptions" ADD CONSTRAINT "outbound_webhook_subscriptions_sub_account_id_sub_accounts_id_fk" FOREIGN KEY ("sub_account_id") REFERENCES "public"."sub_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outbound_webhook_subscriptions" ADD CONSTRAINT "outbound_webhook_subscriptions_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_facts" ADD CONSTRAINT "agent_facts_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_facts" ADD CONSTRAINT "agent_facts_source_message_id_agent_messages_id_fk" FOREIGN KEY ("source_message_id") REFERENCES "public"."agent_messages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_messages" ADD CONSTRAINT "agent_messages_thread_id_agent_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."agent_threads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_threads" ADD CONSTRAINT "agent_threads_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_threads" ADD CONSTRAINT "agent_threads_sub_account_id_sub_accounts_id_fk" FOREIGN KEY ("sub_account_id") REFERENCES "public"."sub_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_threads" ADD CONSTRAINT "agent_threads_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "memberships_workspace_idx" ON "memberships" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "memberships_user_idx" ON "memberships" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "sub_accounts_workspace_idx" ON "sub_accounts" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "workspaces_slug_idx" ON "workspaces" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "sales_role_assignments_sub_idx" ON "sales_role_assignments" USING btree ("sub_account_id");--> statement-breakpoint
CREATE INDEX "sales_role_assignments_user_idx" ON "sales_role_assignments" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "sales_roles_workspace_idx" ON "sales_roles" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "dispositions_workspace_category_idx" ON "dispositions" USING btree ("workspace_id","category");--> statement-breakpoint
CREATE INDEX "funnel_events_entity_idx" ON "funnel_events" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "funnel_events_sub_occurred_idx" ON "funnel_events" USING btree ("sub_account_id","occurred_at");--> statement-breakpoint
CREATE INDEX "funnel_events_stage_occurred_idx" ON "funnel_events" USING btree ("stage_id","occurred_at");--> statement-breakpoint
CREATE INDEX "funnel_stages_workspace_ordinal_idx" ON "funnel_stages" USING btree ("workspace_id","ordinal");--> statement-breakpoint
CREATE INDEX "customers_sub_account_idx" ON "customers" USING btree ("sub_account_id");--> statement-breakpoint
CREATE INDEX "customers_workspace_email_idx" ON "customers" USING btree ("workspace_id","primary_email");--> statement-breakpoint
CREATE INDEX "customers_status_idx" ON "customers" USING btree ("status");--> statement-breakpoint
CREATE INDEX "calls_sub_appointment_idx" ON "calls" USING btree ("sub_account_id","appointment_at");--> statement-breakpoint
CREATE INDEX "calls_closer_idx" ON "calls" USING btree ("closer_user_id");--> statement-breakpoint
CREATE INDEX "calls_setter_idx" ON "calls" USING btree ("setter_user_id");--> statement-breakpoint
CREATE INDEX "calls_customer_idx" ON "calls" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "calls_external_idx" ON "calls" USING btree ("source_integration","external_id");--> statement-breakpoint
CREATE INDEX "payment_plan_installments_expected_date_idx" ON "payment_plan_installments" USING btree ("expected_date");--> statement-breakpoint
CREATE INDEX "payment_plan_installments_status_idx" ON "payment_plan_installments" USING btree ("status");--> statement-breakpoint
CREATE INDEX "payment_plans_sale_idx" ON "payment_plans" USING btree ("sale_id");--> statement-breakpoint
CREATE INDEX "sales_sub_closed_idx" ON "sales" USING btree ("sub_account_id","closed_at");--> statement-breakpoint
CREATE INDEX "sales_customer_idx" ON "sales" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "sales_call_idx" ON "sales" USING btree ("linked_call_id");--> statement-breakpoint
CREATE INDEX "commission_entries_sale_idx" ON "commission_entries" USING btree ("sale_id");--> statement-breakpoint
CREATE INDEX "commission_entries_recipient_idx" ON "commission_entries" USING btree ("recipient_user_id");--> statement-breakpoint
CREATE INDEX "commission_entries_status_idx" ON "commission_entries" USING btree ("status");--> statement-breakpoint
CREATE INDEX "commission_entries_period_idx" ON "commission_entries" USING btree ("period_id");--> statement-breakpoint
CREATE INDEX "commission_entries_available_idx" ON "commission_entries" USING btree ("available_at");--> statement-breakpoint
CREATE INDEX "commission_periods_workspace_range_idx" ON "commission_periods" USING btree ("workspace_id","start_date","end_date");--> statement-breakpoint
CREATE INDEX "commission_rules_workspace_idx" ON "commission_rules" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "commission_rules_role_idx" ON "commission_rules" USING btree ("sales_role_id");--> statement-breakpoint
CREATE INDEX "goals_sub_user_idx" ON "goals" USING btree ("sub_account_id","user_id");--> statement-breakpoint
CREATE INDEX "goals_period_idx" ON "goals" USING btree ("period_start","period_end");--> statement-breakpoint
CREATE INDEX "tasks_sub_assigned_status_idx" ON "tasks" USING btree ("sub_account_id","assigned_user_id","status");--> statement-breakpoint
CREATE INDEX "tasks_due_idx" ON "tasks" USING btree ("due_at");--> statement-breakpoint
CREATE INDEX "tasks_related_idx" ON "tasks" USING btree ("related_entity_type","related_entity_id");--> statement-breakpoint
CREATE INDEX "data_source_connections_ds_idx" ON "data_source_connections" USING btree ("data_source_id");--> statement-breakpoint
CREATE INDEX "data_source_connections_tool_idx" ON "data_source_connections" USING btree ("tool_type");--> statement-breakpoint
CREATE INDEX "data_sources_sub_kind_idx" ON "data_sources" USING btree ("sub_account_id","kind");--> statement-breakpoint
CREATE INDEX "applications_sub_email_idx" ON "applications" USING btree ("sub_account_id","email");--> statement-breakpoint
CREATE INDEX "optins_sub_email_idx" ON "optins" USING btree ("sub_account_id","email");--> statement-breakpoint
CREATE INDEX "optins_submitted_idx" ON "optins" USING btree ("submitted_at");--> statement-breakpoint
CREATE INDEX "audit_log_workspace_created_idx" ON "audit_log" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE INDEX "audit_log_actor_idx" ON "audit_log" USING btree ("actor_user_id");--> statement-breakpoint
CREATE INDEX "audit_log_resource_idx" ON "audit_log" USING btree ("resource_type","resource_id");--> statement-breakpoint
CREATE INDEX "outbound_webhook_subs_workspace_idx" ON "outbound_webhook_subscriptions" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "agent_eval_runs_suite_run_idx" ON "agent_eval_runs" USING btree ("suite_slug","run_at");--> statement-breakpoint
CREATE INDEX "agent_facts_workspace_scope_idx" ON "agent_facts" USING btree ("workspace_id","scope","scope_ref_id");--> statement-breakpoint
CREATE INDEX "agent_facts_embedding_idx" ON "agent_facts" USING hnsw (embedding vector_cosine_ops) WITH (m=16,ef_construction=64);--> statement-breakpoint
CREATE INDEX "agent_messages_thread_created_idx" ON "agent_messages" USING btree ("thread_id","created_at");--> statement-breakpoint
CREATE INDEX "agent_messages_turn_idx" ON "agent_messages" USING btree ("turn_id");--> statement-breakpoint
CREATE INDEX "agent_threads_user_idx" ON "agent_threads" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "agent_threads_workspace_idx" ON "agent_threads" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "agent_threads_last_message_idx" ON "agent_threads" USING btree ("last_message_at");