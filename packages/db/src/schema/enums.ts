import { pgEnum } from "drizzle-orm/pg-core";

export const accessRoleEnum = pgEnum("access_role", [
  "superadmin",
  "workspace_admin",
  "sub_account_admin",
  "manager",
  "contributor",
  "viewer",
]);

export const topologyPresetEnum = pgEnum("topology_preset", [
  "solo",
  "setter_closer",
  "setter_closer_cx",
  "custom",
]);

export const commissionStatusEnum = pgEnum("commission_status", [
  "pending",
  "available",
  "paid",
  "clawed_back",
  "voided",
]);

export const commissionRuleTypeEnum = pgEnum("commission_rule_type", [
  "flat_rate",
  "tiered",
  "bonus",
  "override",
  "accelerator",
]);

export const periodKindEnum = pgEnum("period_kind", [
  "daily",
  "weekly",
  "monthly",
  "quarterly",
  "annual",
  "ramp_window",
  "custom",
]);

export const goalKindEnum = pgEnum("goal_kind", ["ote", "quota", "ramp", "target"]);

export const customerStatusEnum = pgEnum("customer_status", [
  "active",
  "churned",
  "refunded",
  "won_back",
  "paused",
]);

export const funnelStageKindEnum = pgEnum("funnel_stage_kind", [
  "lead",
  "call",
  "sale",
  "post_sale",
]);

export const dispositionCategoryEnum = pgEnum("disposition_category", [
  "positive",
  "objection",
  "disqualification",
  "won",
  "no_show",
  "rescheduled",
  "other",
]);

export const recordingConsentEnum = pgEnum("recording_consent", [
  "one_party",
  "two_party",
  "unknown",
  "declined",
]);

export const taskStatusEnum = pgEnum("task_status", [
  "open",
  "snoozed",
  "completed",
  "dismissed",
]);

export const taskKindEnum = pgEnum("task_kind", [
  "call_outcome_pending",
  "sale_unlinked",
  "follow_up_due",
  "no_show_recovery",
  "commission_approval",
  "refund_save",
  "agent_suggestion",
  "manager_one_on_one",
  "custom",
]);

export const agentMessageRoleEnum = pgEnum("agent_message_role", [
  "user",
  "assistant",
  "tool_call",
  "tool_result",
  "system_event",
]);

export const agentFactScopeEnum = pgEnum("agent_fact_scope", [
  "workspace",
  "user",
  "customer",
  "thread",
]);

export const agentFactKindEnum = pgEnum("agent_fact_kind", [
  "preference",
  "rule",
  "fact",
  "pattern",
]);

export const auditActorKindEnum = pgEnum("audit_actor_kind", [
  "user",
  "agent_on_behalf_of_user",
  "system",
  "webhook",
]);

export const dataSourceKindEnum = pgEnum("data_source_kind", [
  "optin",
  "application",
  "appointments",
  "sales",
  "calls",
  "transcripts",
]);

export const installmentStatusEnum = pgEnum("installment_status", [
  "scheduled",
  "collected",
  "failed",
  "refunded",
  "skipped",
]);

export const refundStatusEnum = pgEnum("refund_status", [
  "none",
  "requested",
  "in_save_flow",
  "approved",
  "issued",
  "denied",
]);
