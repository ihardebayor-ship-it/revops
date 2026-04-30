import { healthCheck } from "./health";
import { agentTurn } from "./agent-turn";
import { speedToLeadSlaSweep } from "../schedules/speed-to-lead-sla-sweep";

export const functions = [healthCheck, agentTurn, speedToLeadSlaSweep];
export { healthCheck, agentTurn, speedToLeadSlaSweep };
