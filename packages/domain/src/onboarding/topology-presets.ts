// Topology presets seeded into a workspace at onboarding. See ADR-0002.
// Splits are defaults; the commission rules engine reads actual splits from
// commission_rules, which can be arbitrarily complex.

export type TopologyPresetSlug = "solo" | "setter_closer" | "setter_closer_cx" | "custom";

export type TopologyRoleSeed = {
  slug: string;
  label: string;
  defaultCommissionShare: string;
  stageOwnership: string[];
  defaultSlaSeconds: number | null;
  sortOrder: number;
};

export type TopologyStageSeed = {
  slug: string;
  label: string;
  kind: "lead" | "call" | "sale" | "post_sale";
  ordinal: number;
};

export type TopologyPreset = {
  slug: TopologyPresetSlug;
  label: string;
  description: string;
  roles: TopologyRoleSeed[];
  stages: TopologyStageSeed[];
};

const COMMON_LEAD_STAGES: TopologyStageSeed[] = [
  { slug: "optin", label: "Opt-in", kind: "lead", ordinal: 10 },
  { slug: "contacted", label: "Contacted", kind: "lead", ordinal: 20 },
  { slug: "booked", label: "Booked", kind: "call", ordinal: 30 },
  { slug: "showed", label: "Showed", kind: "call", ordinal: 40 },
];

export const TOPOLOGY_PRESETS: Record<TopologyPresetSlug, TopologyPreset> = {
  solo: {
    slug: "solo",
    label: "Solo",
    description: "One person handles every stage. Right for solo coaches and indie founders.",
    roles: [
      {
        slug: "seller",
        label: "Seller",
        defaultCommissionShare: "1.0000",
        stageOwnership: ["optin", "contacted", "booked", "showed", "closed", "collected"],
        defaultSlaSeconds: 600,
        sortOrder: 0,
      },
    ],
    stages: [
      ...COMMON_LEAD_STAGES,
      { slug: "closed", label: "Closed", kind: "sale", ordinal: 50 },
      { slug: "collected", label: "Collected", kind: "post_sale", ordinal: 60 },
    ],
  },
  setter_closer: {
    slug: "setter_closer",
    label: "Setter + Closer",
    description: "Setter books the call, closer closes. Standard for high-ticket sales teams.",
    roles: [
      {
        slug: "setter",
        label: "Setter",
        defaultCommissionShare: "0.2000",
        stageOwnership: ["optin", "contacted", "booked"],
        defaultSlaSeconds: 300,
        sortOrder: 0,
      },
      {
        slug: "closer",
        label: "Closer",
        defaultCommissionShare: "0.8000",
        stageOwnership: ["showed", "pitched", "closed"],
        defaultSlaSeconds: null,
        sortOrder: 10,
      },
    ],
    stages: [
      ...COMMON_LEAD_STAGES,
      { slug: "pitched", label: "Pitched", kind: "call", ordinal: 45 },
      { slug: "closed", label: "Closed", kind: "sale", ordinal: 50 },
      { slug: "collected", label: "Collected", kind: "post_sale", ordinal: 60 },
    ],
  },
  setter_closer_cx: {
    slug: "setter_closer_cx",
    label: "Setter + Closer + CX",
    description:
      "CX retains and saves the customer post-sale. Pay CX on retention or save outcomes.",
    roles: [
      {
        slug: "setter",
        label: "Setter",
        defaultCommissionShare: "0.1500",
        stageOwnership: ["optin", "contacted", "booked"],
        defaultSlaSeconds: 300,
        sortOrder: 0,
      },
      {
        slug: "closer",
        label: "Closer",
        defaultCommissionShare: "0.7000",
        stageOwnership: ["showed", "pitched", "closed"],
        defaultSlaSeconds: null,
        sortOrder: 10,
      },
      {
        slug: "cx",
        label: "Customer Success",
        defaultCommissionShare: "0.1500",
        stageOwnership: ["collected", "retained", "saved"],
        defaultSlaSeconds: null,
        sortOrder: 20,
      },
    ],
    stages: [
      ...COMMON_LEAD_STAGES,
      { slug: "pitched", label: "Pitched", kind: "call", ordinal: 45 },
      { slug: "closed", label: "Closed", kind: "sale", ordinal: 50 },
      { slug: "collected", label: "Collected", kind: "post_sale", ordinal: 60 },
      { slug: "retained", label: "Retained", kind: "post_sale", ordinal: 70 },
      { slug: "churned", label: "Churned", kind: "post_sale", ordinal: 80 },
      { slug: "refunded", label: "Refunded", kind: "post_sale", ordinal: 90 },
    ],
  },
  custom: {
    slug: "custom",
    label: "Custom",
    description: "Define your own roles and pipeline.",
    roles: [],
    stages: [],
  },
};
