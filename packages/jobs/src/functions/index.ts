import { healthCheck } from "./health";
import { agentTurn } from "./agent-turn";
import { commissionRecompute } from "./commission-recompute";
import { speedToLeadSlaSweep } from "../schedules/speed-to-lead-sla-sweep";
import { commissionHoldRelease } from "../schedules/commission-hold-release";
import { oauthRefresh } from "../workflows/oauth-refresh";
import { ghlBackfill } from "../workflows/ghl-backfill";
import { ghlWebhookHandler } from "../webhooks/ghl-handler";
import { aircallWebhookHandler } from "../webhooks/aircall-handler";
import { fathomWebhookHandler } from "../webhooks/fathom-handler";

export const functions = [
  healthCheck,
  agentTurn,
  commissionRecompute,
  speedToLeadSlaSweep,
  commissionHoldRelease,
  oauthRefresh,
  ghlBackfill,
  ghlWebhookHandler,
  aircallWebhookHandler,
  fathomWebhookHandler,
];
export {
  healthCheck,
  agentTurn,
  commissionRecompute,
  speedToLeadSlaSweep,
  commissionHoldRelease,
  oauthRefresh,
  ghlBackfill,
  ghlWebhookHandler,
  aircallWebhookHandler,
  fathomWebhookHandler,
};
