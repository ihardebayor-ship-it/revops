// Tool registry. Tools are added by importing them here. The runtime auto-
// builds the per-turn tool list filtered by the user's permissions.

import { searchCalls } from "./calls/search-calls";
import { searchSales } from "./sales/search-sales";
import { linkSaleToCall } from "./sales/link-sale-to-call";
import { unlinkSaleFromCall } from "./sales/unlink-sale-from-call";
import { setCallDisposition } from "./calls/set-call-disposition";
import { setCallOutcome } from "./calls/set-call-outcome";
import { createTask } from "./tasks/create-task";
import { completeTask } from "./tasks/complete-task";
import { snoozeTask } from "./tasks/snooze-task";
import { recordFollowUp } from "./tasks/record-follow-up";
import { proposeCommissionLink } from "./commissions/propose-commission-link";
import { confirmFact, contradictFact } from "./memory/confirm-fact";
import { type Tool } from "../define-tool";

export const ALL_TOOLS: readonly Tool[] = [
  // Reads
  searchCalls,
  searchSales,
  // Mutations
  linkSaleToCall,
  unlinkSaleFromCall,
  setCallDisposition,
  setCallOutcome,
  createTask,
  completeTask,
  snoozeTask,
  recordFollowUp,
  proposeCommissionLink,
  confirmFact,
  contradictFact,
] as const;

export function getToolByName(name: string): Tool | undefined {
  return ALL_TOOLS.find((t) => t.name === name);
}

export function getReadOnlyTools(): readonly Tool[] {
  return ALL_TOOLS.filter((t) => t.risk === "low" && t.idempotent);
}

export {
  searchCalls,
  searchSales,
  linkSaleToCall,
  unlinkSaleFromCall,
  setCallDisposition,
  setCallOutcome,
  createTask,
  completeTask,
  snoozeTask,
  recordFollowUp,
  proposeCommissionLink,
  confirmFact,
  contradictFact,
};
