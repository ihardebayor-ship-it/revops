// Single import surface for the full schema. Drizzle queries reference
// `schema.<table>`. New tables: add the file, then export here.

export * from "./enums";
export * from "./auth";
export * from "./platform";
export * from "./tenancy";
export * from "./roles";
export * from "./funnel";
export * from "./customers";
export * from "./calls";
export * from "./sales";
export * from "./commissions";
export * from "./goals";
export * from "./tasks";
export * from "./data-sources";
export * from "./forms";
export * from "./audit";
export * from "./webhooks";
export * from "./agent";
export * from "./commission-recipients";
