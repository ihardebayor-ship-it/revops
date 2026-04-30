import { healthCheck } from "./health";
import { agentTurn } from "./agent-turn";

export const functions = [healthCheck, agentTurn];
export { healthCheck, agentTurn };
