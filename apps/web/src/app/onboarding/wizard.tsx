"use client";

// Elite onboarding wizard. Differentiators vs typical SaaS onboarding:
//   1. Live preview of what each topology configures (roles + splits +
//      funnel stages) so the user picks with information.
//   2. First-quota step suggests an industry-default value tied to
//      their topology (closer presets default $50k/mo, solo $20k/mo)
//      so they don't fly blind. Skip is always one click away.
//   3. "Try with sample data" CTA on the final step populates a Demo
//      sub-account so the dashboards aren't empty on first paint —
//      huge unlock for design-partner demos.
// Skip is never blocked at any step; every choice has a "Use default
// and continue" path.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

type Preset = {
  slug: string;
  label: string;
  description: string;
  roles: Array<{ slug: string; label: string; sharePct: number }>;
  stages: Array<{ slug: string; label: string }>;
};

type Workspace = {
  id: string;
  name: string;
  slug: string;
  topologyPreset: string;
};

const QUOTA_DEFAULTS: Record<string, number> = {
  solo: 20000,
  setter_closer: 50000,
  setter_closer_cx: 75000,
  custom: 50000,
};

export function OnboardingWizard({
  workspace,
  presets,
}: {
  workspace: Workspace;
  presets: Preset[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState<1 | 2 | 3>(1);

  // Step 1 state
  const [name, setName] = useState(workspace.name);
  const [presetSlug, setPresetSlug] = useState(workspace.topologyPreset);

  // Step 2 state
  const [quota, setQuota] = useState<string>(
    String(QUOTA_DEFAULTS[workspace.topologyPreset] ?? 50000),
  );
  const [skipQuota, setSkipQuota] = useState(false);

  // Step 3 state
  const [seeding, setSeeding] = useState(false);

  function call(path: string, body: unknown, onDone: () => void) {
    setError(null);
    startTransition(async () => {
      const res = await fetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-workspace-id": workspace.id },
        body: JSON.stringify({ "0": { json: body } }),
      });
      if (!res.ok) {
        const text = await res.text();
        return setError(parseTrpcError(text));
      }
      onDone();
    });
  }

  function applyStep1AndContinue() {
    setError(null);
    startTransition(async () => {
      // Update name if changed.
      if (name.trim() && name.trim() !== workspace.name) {
        const res = await fetch("/api/trpc/onboarding.updateWorkspaceName?batch=1", {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-workspace-id": workspace.id },
          body: JSON.stringify({ "0": { json: { name: name.trim() } } }),
        });
        if (!res.ok) {
          return setError(parseTrpcError(await res.text()));
        }
      }
      // Apply topology if changed.
      if (presetSlug !== workspace.topologyPreset) {
        const res = await fetch("/api/trpc/onboarding.applyTopology?batch=1", {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-workspace-id": workspace.id },
          body: JSON.stringify({ "0": { json: { preset: presetSlug } } }),
        });
        if (!res.ok) {
          return setError(parseTrpcError(await res.text()));
        }
        // Update default quota when preset changes.
        const newDefault = QUOTA_DEFAULTS[presetSlug];
        if (newDefault) setQuota(String(newDefault));
      }
      setStep(2);
    });
  }

  function applyStep2AndContinue() {
    if (skipQuota) {
      setStep(3);
      return;
    }
    if (!quota || Number(quota) <= 0) {
      return setError("Quota must be a positive number, or skip to continue.");
    }
    call(
      "/api/trpc/onboarding.setFirstQuota?batch=1",
      { targetValue: Number(quota).toFixed(2) },
      () => setStep(3),
    );
  }

  function finish() {
    call("/api/trpc/onboarding.markComplete?batch=1", {}, () => {
      router.push(`/${workspace.slug}/inbox`);
    });
  }

  async function seedSampleData() {
    setError(null);
    setSeeding(true);
    try {
      const res = await fetch("/api/onboarding/seed-demo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspaceId: workspace.id }),
      });
      if (!res.ok) {
        const text = await res.text();
        setError(parseTrpcError(text) || `Seed failed (${res.status})`);
        return;
      }
      finish();
    } finally {
      setSeeding(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <Stepper current={step} />

      {error && <p className="rounded-md bg-red-500/10 px-3 py-2 text-sm text-red-400">{error}</p>}

      {step === 1 && (
        <Step1
          name={name}
          setName={setName}
          presetSlug={presetSlug}
          setPresetSlug={setPresetSlug}
          presets={presets}
          pending={pending}
          onContinue={applyStep1AndContinue}
        />
      )}

      {step === 2 && (
        <Step2
          presetSlug={presetSlug}
          quota={quota}
          setQuota={setQuota}
          skipQuota={skipQuota}
          setSkipQuota={setSkipQuota}
          pending={pending}
          onBack={() => setStep(1)}
          onContinue={applyStep2AndContinue}
        />
      )}

      {step === 3 && (
        <Step3
          slug={workspace.slug}
          seeding={seeding || pending}
          onSeedAndFinish={seedSampleData}
          onSkipAndFinish={finish}
          onBack={() => setStep(2)}
        />
      )}
    </div>
  );
}

// ─── Step 1: topology + workspace name ───────────────────────────

function Step1({
  name,
  setName,
  presetSlug,
  setPresetSlug,
  presets,
  pending,
  onContinue,
}: {
  name: string;
  setName: (v: string) => void;
  presetSlug: string;
  setPresetSlug: (v: string) => void;
  presets: Preset[];
  pending: boolean;
  onContinue: () => void;
}) {
  const selected = presets.find((p) => p.slug === presetSlug) ?? presets[0]!;
  return (
    <div className="flex flex-col gap-5">
      <label className="flex flex-col gap-1">
        <span className="text-xs uppercase tracking-wider text-zinc-400">Workspace name</span>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="rounded-md border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 focus:border-blue-500 focus:outline-none"
        />
      </label>

      <div className="flex flex-col gap-2">
        <p className="text-xs uppercase tracking-wider text-zinc-400">How does your team sell?</p>
        <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
          {presets.map((p) => {
            const active = p.slug === presetSlug;
            return (
              <button
                key={p.slug}
                onClick={() => setPresetSlug(p.slug)}
                className={
                  active
                    ? "rounded-lg border border-blue-500 bg-blue-500/5 p-3 text-left"
                    : "rounded-lg border border-zinc-800 bg-zinc-950 p-3 text-left hover:border-zinc-700"
                }
              >
                <p className="text-sm font-medium text-zinc-100">{p.label}</p>
                <p className="mt-1 text-xs text-zinc-400">{p.description}</p>
              </button>
            );
          })}
        </div>
      </div>

      <PresetPreview preset={selected} />

      <div className="flex justify-end">
        <button
          onClick={onContinue}
          disabled={pending || !name.trim()}
          className="rounded-md bg-blue-500 px-4 py-2 text-sm font-medium text-white hover:bg-blue-600 disabled:opacity-30"
        >
          {pending ? "Saving…" : "Continue"}
        </button>
      </div>
    </div>
  );
}

function PresetPreview({ preset }: { preset: Preset }) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-4">
      <p className="text-xs uppercase tracking-wider text-zinc-400">What this configures</p>
      <div className="mt-3 flex flex-col gap-3">
        <div>
          <p className="text-xs text-zinc-500">Roles + commission split</p>
          <div className="mt-1 flex flex-wrap gap-2">
            {preset.roles.length === 0 ? (
              <span className="text-xs text-zinc-500">
                Custom — you'll define roles in Settings later.
              </span>
            ) : (
              preset.roles.map((r) => (
                <span key={r.slug} className="rounded bg-zinc-900 px-2 py-1 text-xs text-zinc-200">
                  {r.label}
                  <span className="ml-1 text-blue-400">{(r.sharePct * 100).toFixed(0)}%</span>
                </span>
              ))
            )}
          </div>
        </div>
        <div>
          <p className="text-xs text-zinc-500">Funnel stages</p>
          <div className="mt-1 flex flex-wrap items-center gap-1 text-xs text-zinc-400">
            {preset.stages.length === 0 ? (
              <span>Custom — you'll define stages in Settings.</span>
            ) : (
              preset.stages.map((s, i) => (
                <span key={s.slug} className="flex items-center gap-1">
                  <span className="rounded bg-zinc-900 px-2 py-0.5 text-zinc-200">{s.label}</span>
                  {i < preset.stages.length - 1 && <span className="text-zinc-600">→</span>}
                </span>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Step 2: first quota ─────────────────────────────────────────

function Step2({
  presetSlug,
  quota,
  setQuota,
  skipQuota,
  setSkipQuota,
  pending,
  onBack,
  onContinue,
}: {
  presetSlug: string;
  quota: string;
  setQuota: (v: string) => void;
  skipQuota: boolean;
  setSkipQuota: (v: boolean) => void;
  pending: boolean;
  onBack: () => void;
  onContinue: () => void;
}) {
  const suggestion = QUOTA_DEFAULTS[presetSlug] ?? 50000;
  return (
    <div className="flex flex-col gap-5">
      <div>
        <p className="text-xs uppercase tracking-wider text-zinc-400">First quota</p>
        <h2 className="mt-1 text-lg font-semibold text-zinc-100">What's your monthly target?</h2>
        <p className="mt-1 text-sm text-zinc-400">
          We use this on your dashboard's forecast card. You can change it anytime in Settings →
          Goals.
        </p>
      </div>

      <label className={skipQuota ? "flex flex-col gap-1 opacity-50" : "flex flex-col gap-1"}>
        <span className="text-xs uppercase tracking-wider text-zinc-400">Monthly quota (USD)</span>
        <div className="flex items-center gap-2">
          <input
            value={quota}
            onChange={(e) => setQuota(e.target.value)}
            disabled={skipQuota}
            type="number"
            min={0}
            className="flex-1 rounded-md border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 focus:border-blue-500 focus:outline-none disabled:cursor-not-allowed"
          />
          <button
            type="button"
            onClick={() => setQuota(String(suggestion))}
            disabled={skipQuota}
            className="rounded-md border border-zinc-800 px-3 py-2 text-xs text-zinc-400 hover:bg-zinc-900 disabled:opacity-30"
          >
            Use ${suggestion.toLocaleString()}
          </button>
        </div>
        <span className="text-xs text-zinc-500">
          Industry default for this topology: ${suggestion.toLocaleString()}/month.
        </span>
      </label>

      <label className="flex items-center gap-2 text-sm text-zinc-300">
        <input
          type="checkbox"
          checked={skipQuota}
          onChange={(e) => setSkipQuota(e.target.checked)}
          className="h-4 w-4 rounded border-zinc-700 bg-zinc-900"
        />
        Skip — I'll set quotas later
      </label>

      <div className="flex justify-between">
        <button
          onClick={onBack}
          disabled={pending}
          className="rounded-md border border-zinc-800 px-3 py-2 text-sm text-zinc-300 hover:bg-zinc-900 disabled:opacity-30"
        >
          Back
        </button>
        <button
          onClick={onContinue}
          disabled={pending}
          className="rounded-md bg-blue-500 px-4 py-2 text-sm font-medium text-white hover:bg-blue-600 disabled:opacity-30"
        >
          {pending ? "Saving…" : "Continue"}
        </button>
      </div>
    </div>
  );
}

// ─── Step 3: sample data choice ──────────────────────────────────

function Step3({
  slug,
  seeding,
  onSeedAndFinish,
  onSkipAndFinish,
  onBack,
}: {
  slug: string;
  seeding: boolean;
  onSeedAndFinish: () => void;
  onSkipAndFinish: () => void;
  onBack: () => void;
}) {
  void slug;
  return (
    <div className="flex flex-col gap-5">
      <div>
        <p className="text-xs uppercase tracking-wider text-zinc-400">Last step</p>
        <h2 className="mt-1 text-lg font-semibold text-zinc-100">
          Want to start with sample data?
        </h2>
        <p className="mt-1 text-sm text-zinc-400">
          We can seed a Demo sub-account with 30 days of realistic activity (50 customers, ~125
          calls, ~30 sales, refund + commission flows) so the dashboards aren't empty on first
          paint. Your real workspace stays untouched — sample data lives in its own sub-account you
          can delete later.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <button
          onClick={onSeedAndFinish}
          disabled={seeding}
          className="flex flex-col items-start gap-2 rounded-lg border border-blue-500 bg-blue-500/5 p-4 text-left hover:bg-blue-500/10 disabled:opacity-50"
        >
          <span className="rounded bg-blue-500/20 px-2 py-0.5 text-xs uppercase tracking-wider text-blue-300">
            Recommended
          </span>
          <p className="text-base font-semibold text-zinc-100">Yes — seed sample data</p>
          <p className="text-xs text-zinc-400">
            See the system populated immediately. ~10 seconds.
          </p>
          {seeding && <p className="text-xs text-blue-300">Seeding…</p>}
        </button>

        <button
          onClick={onSkipAndFinish}
          disabled={seeding}
          className="flex flex-col items-start gap-2 rounded-lg border border-zinc-800 bg-zinc-950 p-4 text-left hover:border-zinc-700 disabled:opacity-50"
        >
          <span className="rounded bg-zinc-900 px-2 py-0.5 text-xs uppercase tracking-wider text-zinc-400">
            Skip
          </span>
          <p className="text-base font-semibold text-zinc-100">Take me to my empty workspace</p>
          <p className="text-xs text-zinc-400">
            I'll connect integrations / log my own data first.
          </p>
        </button>
      </div>

      <div className="flex justify-between">
        <button
          onClick={onBack}
          disabled={seeding}
          className="rounded-md border border-zinc-800 px-3 py-2 text-sm text-zinc-300 hover:bg-zinc-900 disabled:opacity-30"
        >
          Back
        </button>
      </div>
    </div>
  );
}

// ─── Stepper ─────────────────────────────────────────────────────

function Stepper({ current }: { current: 1 | 2 | 3 }) {
  const steps = [
    { n: 1, label: "Topology" },
    { n: 2, label: "Quota" },
    { n: 3, label: "Sample data" },
  ];
  return (
    <ol className="flex items-center gap-2 text-xs uppercase tracking-wider">
      {steps.map((s, i) => {
        const active = s.n === current;
        const done = s.n < current;
        return (
          <li key={s.n} className="flex items-center gap-2">
            <span
              className={
                active
                  ? "flex h-6 w-6 items-center justify-center rounded-full bg-blue-500 text-white"
                  : done
                    ? "flex h-6 w-6 items-center justify-center rounded-full bg-emerald-500 text-white"
                    : "flex h-6 w-6 items-center justify-center rounded-full border border-zinc-800 text-zinc-500"
              }
            >
              {done ? "✓" : s.n}
            </span>
            <span className={active ? "text-zinc-100" : done ? "text-zinc-300" : "text-zinc-500"}>
              {s.label}
            </span>
            {i < steps.length - 1 && <span className="text-zinc-700">/</span>}
          </li>
        );
      })}
    </ol>
  );
}

function parseTrpcError(text: string): string {
  try {
    const j = JSON.parse(text);
    const msg = j?.[0]?.error?.json?.message ?? j?.error?.json?.message ?? j?.error?.message;
    if (typeof msg === "string") return msg;
  } catch {
    /* not JSON */
  }
  return text.slice(0, 200);
}
