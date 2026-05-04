// Analytics module — pure metric functions consumed by every dashboard,
// agent analytics tools, and (later) Slack alerts + exports. Each function
// takes a Db + typed args and returns a typed result; nothing here knows
// about HTTP or React.

export {
  type Period,
  type BucketGranularity,
  type TimeseriesPoint,
  type Trend,
  type ComparativeMetric,
  compareMetrics,
  previousPeriod,
} from "./types";

export {
  bookedAmountSeries,
  callCountSeries,
  commissionAvailableSeries,
  type SeriesArgs,
} from "./timeseries";

export {
  attainment,
  computeAttainment,
  type AttainmentArgs,
  type AttainmentResult,
} from "./attainment";

export {
  funnelStats,
  type FunnelArgs,
  type FunnelStageStat,
} from "./funnel";

export {
  pipelineHealth,
  type PipelineArgs,
  type PipelineHealth,
} from "./pipeline";

export {
  detectAnomaly,
  type AnomalyArgs,
  type AnomalyResult,
} from "./anomaly";

export {
  leaderboard,
  type LeaderboardArgs,
  type LeaderboardEntry,
} from "./leaderboard";

export {
  speedToLead,
  percentile,
  type SpeedArgs,
  type SpeedResult,
} from "./speed-to-lead";

export {
  bookHealth,
  customersNeedingTouch,
  cohortRetention,
  type BookHealthArgs,
  type BookHealthSummary,
  type AtRiskCustomer,
  type CohortRow,
} from "./retention";

export {
  getActiveQuota,
  currentMonth,
  type QuotaArgs,
  type ActiveQuota,
} from "./quotas";

export {
  revenueTrajectory,
  cashForecast,
  concentrationRisk,
  agentProductivity,
  type RevenueTrajectoryArgs,
  type RevenueTrajectoryResult,
  type CashForecastArgs,
  type CashForecastResult,
  type ConcentrationRisk,
  type AgentProductivity,
} from "./owner";
