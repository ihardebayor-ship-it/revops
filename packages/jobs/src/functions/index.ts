import { healthCheck } from "./health";
import { agentTurn } from "./agent-turn";
import { commissionRecompute } from "./commission-recompute";
import { speedToLeadSlaSweep } from "../schedules/speed-to-lead-sla-sweep";
import { commissionHoldRelease } from "../schedules/commission-hold-release";
import { oauthRefresh } from "../workflows/oauth-refresh";

export const functions = [
  healthCheck,
  agentTurn,
  commissionRecompute,
  speedToLeadSlaSweep,
  commissionHoldRelease,
  oauthRefresh,
];
export {
  healthCheck,
  agentTurn,
  commissionRecompute,
  speedToLeadSlaSweep,
  commissionHoldRelease,
  oauthRefresh,
};
