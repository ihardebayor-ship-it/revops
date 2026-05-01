import { healthCheck } from "./health";
import { agentTurn } from "./agent-turn";
import { commissionRecompute } from "./commission-recompute";
import { speedToLeadSlaSweep } from "../schedules/speed-to-lead-sla-sweep";
import { commissionHoldRelease } from "../schedules/commission-hold-release";

export const functions = [
  healthCheck,
  agentTurn,
  commissionRecompute,
  speedToLeadSlaSweep,
  commissionHoldRelease,
];
export {
  healthCheck,
  agentTurn,
  commissionRecompute,
  speedToLeadSlaSweep,
  commissionHoldRelease,
};
