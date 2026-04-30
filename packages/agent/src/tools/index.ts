// Tool registry. Tools are added by importing them here. The runtime auto-
// builds the per-turn tool list filtered by the user's permissions.
import { searchCalls } from "./calls/search-calls";
import { searchSales } from "./sales/search-sales";
import { type Tool } from "../define-tool";

export const ALL_TOOLS: readonly Tool[] = [searchCalls, searchSales] as const;

export function getToolByName(name: string): Tool | undefined {
  return ALL_TOOLS.find((t) => t.name === name);
}

export function getReadOnlyTools(): readonly Tool[] {
  return ALL_TOOLS.filter((t) => t.risk === "low" && t.idempotent);
}

export { searchCalls, searchSales };
