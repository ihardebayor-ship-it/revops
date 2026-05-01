"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

type Match = { kind: "any" } | { kind: "name"; value: string };

type Rule = {
  id: string;
  name: string;
  type: string;
  salesRoleId: string | null;
  salesRoleLabel: string | null;
  sharePct: string | null;
  flatAmount: string | null;
  currency: string;
  productMatch: Match | null;
  sourceMatch: Match | null;
  holdDays: number;
  paidOn: string;
  isActive: number;
  effectiveFrom: string | null;
  effectiveTo: string | null;
  createdAt: string;
};

type RoleOption = { id: string; label: string };

type FormState = {
  name: string;
  salesRoleId: string;
  amountKind: "share" | "flat";
  sharePct: string;
  flatAmount: string;
  productMatchKind: "any" | "name";
  productMatchValue: string;
  sourceMatchKind: "any" | "name";
  sourceMatchValue: string;
  holdDays: number;
  paidOn: "collected" | "booked";
};

const DEFAULT_FORM: FormState = {
  name: "",
  salesRoleId: "",
  amountKind: "share",
  sharePct: "0.20",
  flatAmount: "",
  productMatchKind: "any",
  productMatchValue: "",
  sourceMatchKind: "any",
  sourceMatchValue: "",
  holdDays: 30,
  paidOn: "collected",
};

export function CommissionRulesEditor({
  slug,
  initialRules,
  roles,
}: {
  slug: string;
  initialRules: Rule[];
  roles: RoleOption[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [createForm, setCreateForm] = useState<FormState>(DEFAULT_FORM);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<FormState>(DEFAULT_FORM);

  void slug;

  function startEdit(rule: Rule) {
    setEditingId(rule.id);
    setEditForm({
      name: rule.name,
      salesRoleId: rule.salesRoleId ?? "",
      amountKind: rule.sharePct ? "share" : "flat",
      sharePct: rule.sharePct ?? "",
      flatAmount: rule.flatAmount ?? "",
      productMatchKind: rule.productMatch?.kind === "name" ? "name" : "any",
      productMatchValue: rule.productMatch?.kind === "name" ? rule.productMatch.value : "",
      sourceMatchKind: rule.sourceMatch?.kind === "name" ? "name" : "any",
      sourceMatchValue: rule.sourceMatch?.kind === "name" ? rule.sourceMatch.value : "",
      holdDays: rule.holdDays,
      paidOn: (rule.paidOn === "booked" ? "booked" : "collected"),
    });
  }

  function cancel() {
    setEditingId(null);
    setCreating(false);
    setError(null);
  }

  function buildPayload(form: FormState) {
    const productMatch: Match =
      form.productMatchKind === "name" && form.productMatchValue
        ? { kind: "name", value: form.productMatchValue }
        : { kind: "any" };
    const sourceMatch: Match =
      form.sourceMatchKind === "name" && form.sourceMatchValue
        ? { kind: "name", value: form.sourceMatchValue }
        : { kind: "any" };
    return {
      name: form.name,
      salesRoleId: form.salesRoleId || null,
      sharePct: form.amountKind === "share" ? form.sharePct : null,
      flatAmount: form.amountKind === "flat" ? form.flatAmount : null,
      currency: "USD",
      productMatch,
      sourceMatch,
      holdDays: form.holdDays,
      paidOn: form.paidOn,
    };
  }

  function call(path: string, body: unknown) {
    setError(null);
    startTransition(async () => {
      const wsId = await fetchWorkspaceId();
      if (!wsId) return setError("No workspace");
      const res = await fetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-workspace-id": wsId },
        body: JSON.stringify({ "0": { json: body } }),
      });
      if (!res.ok) {
        const text = await res.text();
        return setError(`${res.status}: ${text.slice(0, 200)}`);
      }
      cancel();
      setCreateForm(DEFAULT_FORM);
      router.refresh();
    });
  }

  return (
    <div className="space-y-3">
      {error && (
        <p className="rounded-md bg-red-500/10 px-3 py-2 text-sm text-red-400">{error}</p>
      )}

      <div className="flex justify-end">
        {!creating && (
          <button
            onClick={() => setCreating(true)}
            className="rounded-md bg-blue-500 px-3 py-2 text-sm font-medium text-white hover:bg-blue-600"
          >
            + New rule
          </button>
        )}
      </div>

      {creating && (
        <RuleForm
          title="New commission rule"
          form={createForm}
          setForm={setCreateForm}
          roles={roles}
          pending={pending}
          onCancel={cancel}
          onSubmit={() =>
            call("/api/trpc/commissionRules.create?batch=1", buildPayload(createForm))
          }
        />
      )}

      <ul className="divide-y divide-zinc-800 rounded-lg border border-zinc-800 bg-zinc-950">
        {initialRules.length === 0 && !creating && (
          <li className="px-4 py-6 text-sm text-zinc-400">
            No rules yet. Click "New rule" to add one.
          </li>
        )}
        {initialRules.map((rule) =>
          editingId === rule.id ? (
            <li key={rule.id} className="p-4">
              <RuleForm
                title={`Edit · ${rule.name}`}
                form={editForm}
                setForm={setEditForm}
                roles={roles}
                pending={pending}
                onCancel={cancel}
                onSubmit={() =>
                  call("/api/trpc/commissionRules.update?batch=1", {
                    ruleId: rule.id,
                    ...buildPayload(editForm),
                  })
                }
                onDelete={() =>
                  call("/api/trpc/commissionRules.softDelete?batch=1", { ruleId: rule.id })
                }
              />
            </li>
          ) : (
            <li
              key={rule.id}
              className="flex flex-col gap-1 p-4 md:flex-row md:items-center md:gap-3"
            >
              <div className="flex-1">
                <div className="flex items-center gap-2 text-sm">
                  <span className="font-medium text-zinc-100">{rule.name}</span>
                  {rule.salesRoleLabel && (
                    <span className="rounded bg-zinc-900 px-2 py-0.5 text-xs uppercase tracking-wider text-zinc-400">
                      {rule.salesRoleLabel}
                    </span>
                  )}
                  {rule.isActive === 0 && (
                    <span className="rounded bg-amber-500/10 px-2 py-0.5 text-xs uppercase tracking-wider text-amber-400">
                      inactive
                    </span>
                  )}
                </div>
                <div className="mt-1 text-xs text-zinc-400">
                  {rule.sharePct
                    ? `${(Number(rule.sharePct) * 100).toFixed(0)}% of base`
                    : `$${rule.flatAmount} flat`}
                  {" · "}
                  hold {rule.holdDays}d · paid on {rule.paidOn}
                  {rule.productMatch?.kind === "name" &&
                    ` · product "${rule.productMatch.value}"`}
                  {rule.sourceMatch?.kind === "name" &&
                    ` · source "${rule.sourceMatch.value}"`}
                </div>
              </div>
              <button
                onClick={() => startEdit(rule)}
                className="rounded-md border border-zinc-800 px-3 py-1.5 text-sm text-zinc-300 hover:bg-zinc-900"
              >
                Edit
              </button>
            </li>
          ),
        )}
      </ul>
    </div>
  );
}

function RuleForm({
  title,
  form,
  setForm,
  roles,
  pending,
  onCancel,
  onSubmit,
  onDelete,
}: {
  title: string;
  form: FormState;
  setForm: (f: FormState) => void;
  roles: RoleOption[];
  pending: boolean;
  onCancel: () => void;
  onSubmit: () => void;
  onDelete?: () => void;
}) {
  return (
    <div className="flex flex-col gap-4 rounded-lg border border-zinc-800 bg-zinc-900/40 p-4">
      <h3 className="text-sm font-semibold text-zinc-100">{title}</h3>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Field label="Rule name">
          <input
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder="Closer 80%"
            className="w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
          />
        </Field>

        <Field label="Applies to role">
          <select
            value={form.salesRoleId}
            onChange={(e) => setForm({ ...form, salesRoleId: e.target.value })}
            className="w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm"
          >
            <option value="">— Any role —</option>
            {roles.map((r) => (
              <option key={r.id} value={r.id}>
                {r.label}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Amount type">
          <div className="flex gap-2 text-sm">
            <RadioPill
              checked={form.amountKind === "share"}
              onChange={() => setForm({ ...form, amountKind: "share" })}
              label="% share"
            />
            <RadioPill
              checked={form.amountKind === "flat"}
              onChange={() => setForm({ ...form, amountKind: "flat" })}
              label="flat $"
            />
          </div>
        </Field>

        <Field label={form.amountKind === "share" ? "Share (0–1)" : "Flat amount"}>
          {form.amountKind === "share" ? (
            <input
              value={form.sharePct}
              onChange={(e) => setForm({ ...form, sharePct: e.target.value })}
              placeholder="0.20"
              className="w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
            />
          ) : (
            <input
              value={form.flatAmount}
              onChange={(e) => setForm({ ...form, flatAmount: e.target.value })}
              placeholder="500.00"
              className="w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
            />
          )}
        </Field>

        <Field label="Hold (days)">
          <input
            type="number"
            value={form.holdDays}
            onChange={(e) => setForm({ ...form, holdDays: Number(e.target.value) })}
            className="w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
          />
        </Field>

        <Field label="Paid on">
          <select
            value={form.paidOn}
            onChange={(e) => setForm({ ...form, paidOn: e.target.value as "collected" | "booked" })}
            className="w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm"
          >
            <option value="collected">Collected (when payment lands)</option>
            <option value="booked">Booked (at sale)</option>
          </select>
        </Field>

        <Field label="Product filter">
          <div className="flex gap-2">
            <select
              value={form.productMatchKind}
              onChange={(e) =>
                setForm({ ...form, productMatchKind: e.target.value as "any" | "name" })
              }
              className="rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm"
            >
              <option value="any">Any product</option>
              <option value="name">Product name =</option>
            </select>
            {form.productMatchKind === "name" && (
              <input
                value={form.productMatchValue}
                onChange={(e) => setForm({ ...form, productMatchValue: e.target.value })}
                placeholder="High-Ticket Coaching"
                className="flex-1 rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
              />
            )}
          </div>
        </Field>

        <Field label="Source filter">
          <div className="flex gap-2">
            <select
              value={form.sourceMatchKind}
              onChange={(e) =>
                setForm({ ...form, sourceMatchKind: e.target.value as "any" | "name" })
              }
              className="rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm"
            >
              <option value="any">Any source</option>
              <option value="name">Source =</option>
            </select>
            {form.sourceMatchKind === "name" && (
              <input
                value={form.sourceMatchValue}
                onChange={(e) => setForm({ ...form, sourceMatchValue: e.target.value })}
                placeholder="stripe"
                className="flex-1 rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
              />
            )}
          </div>
        </Field>
      </div>

      <div className="flex items-center justify-between gap-2">
        {onDelete ? (
          <button
            type="button"
            onClick={onDelete}
            disabled={pending}
            className="rounded-md border border-red-500/30 px-3 py-2 text-sm text-red-400 hover:bg-red-500/10 disabled:opacity-30"
          >
            Delete rule
          </button>
        ) : (
          <span />
        )}
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={pending}
            className="rounded-md border border-zinc-800 px-3 py-2 text-sm text-zinc-300 hover:bg-zinc-900 disabled:opacity-30"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onSubmit}
            disabled={pending || form.name.trim().length === 0}
            className="rounded-md bg-blue-500 px-4 py-2 text-sm font-medium text-white hover:bg-blue-600 disabled:opacity-30"
          >
            {pending ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs uppercase tracking-wider text-zinc-400">{label}</span>
      {children}
    </label>
  );
}

function RadioPill({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onChange}
      className={`rounded-md px-3 py-2 text-sm ${checked ? "bg-blue-500 text-white" : "border border-zinc-800 text-zinc-400 hover:bg-zinc-900"}`}
    >
      {label}
    </button>
  );
}

async function fetchWorkspaceId(): Promise<string | null> {
  const res = await fetch(
    "/api/trpc/me?batch=1&input=" + encodeURIComponent(JSON.stringify({ "0": {} })),
  );
  const json = await res.json();
  return json?.[0]?.result?.data?.json?.workspaceId ?? null;
}
