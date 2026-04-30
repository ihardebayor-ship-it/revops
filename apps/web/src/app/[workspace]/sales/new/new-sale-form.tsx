"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

export function NewSaleForm({ slug }: { slug: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [scheduleKind, setScheduleKind] = useState<"one_time" | "plan">("one_time");

  function onSubmit(form: FormData) {
    setError(null);
    const customerEmail = String(form.get("customerEmail") || "").trim();
    const customerName = String(form.get("customerName") || "").trim();
    const productName = String(form.get("productName") || "").trim();
    const bookedAmount = String(form.get("bookedAmount") || "").trim();

    if (!customerEmail || !bookedAmount) {
      setError("Customer email and booked amount required.");
      return;
    }

    let paymentSchedule: Record<string, unknown> | undefined;
    if (scheduleKind === "plan") {
      const totalInstallments = Number(form.get("totalInstallments") || 0);
      const installmentAmount = String(form.get("installmentAmount") || "");
      const firstInstallmentDate = String(form.get("firstInstallmentDate") || "");
      const installmentFrequency = String(form.get("installmentFrequency") || "monthly");
      if (!totalInstallments || !installmentAmount || !firstInstallmentDate) {
        setError("Plan requires totalInstallments, installmentAmount, firstInstallmentDate.");
        return;
      }
      paymentSchedule = {
        kind: "plan",
        installmentFrequency,
        totalInstallments,
        installmentAmount,
        firstInstallmentDate: new Date(firstInstallmentDate).toISOString(),
      };
    } else {
      const collectedAmount = String(form.get("collectedAmount") || "").trim();
      paymentSchedule = {
        kind: "one_time",
        ...(collectedAmount && { collectedAmount }),
      };
    }

    startTransition(async () => {
      const meRes = await fetch(
        "/api/trpc/me?batch=1&input=" + encodeURIComponent(JSON.stringify({ "0": {} })),
      );
      const wsId = (await meRes.json())?.[0]?.result?.data?.json?.workspaceId;
      if (!wsId) {
        setError("No workspace");
        return;
      }
      const body: Record<string, unknown> = {
        customerEmail,
        bookedAmount,
        paymentSchedule,
      };
      if (customerName) body.customerName = customerName;
      if (productName) body.productName = productName;

      const res = await fetch("/api/trpc/sales.create?batch=1", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-workspace-id": wsId },
        body: JSON.stringify({ "0": { json: body } }),
      });
      if (!res.ok) {
        const text = await res.text();
        try {
          const json = JSON.parse(text);
          setError(json[0]?.error?.json?.message ?? `Failed (${res.status})`);
        } catch {
          setError(`Failed (${res.status}): ${text.slice(0, 200)}`);
        }
        return;
      }
      const json = await res.json();
      const saleId = json?.[0]?.result?.data?.json?.saleId;
      router.push(saleId ? `/${slug}/sales/${saleId}` : `/${slug}/sales`);
      router.refresh();
    });
  }

  return (
    <form action={onSubmit} className="flex flex-col gap-4">
      <label className="flex flex-col gap-1">
        <span className="text-xs uppercase tracking-wider text-zinc-400">Customer email</span>
        <input
          name="customerEmail"
          type="email"
          required
          autoFocus
          className="rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
        />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-xs uppercase tracking-wider text-zinc-400">Customer name</span>
        <input
          name="customerName"
          className="rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
        />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-xs uppercase tracking-wider text-zinc-400">Product</span>
        <input
          name="productName"
          placeholder="What did they buy?"
          className="rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
        />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-xs uppercase tracking-wider text-zinc-400">
          Booked amount (USD)
        </span>
        <input
          name="bookedAmount"
          type="number"
          step="0.01"
          min="0"
          required
          className="rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
        />
      </label>

      <fieldset className="flex flex-col gap-3 rounded-lg border border-zinc-800 p-4">
        <legend className="px-2 text-xs uppercase tracking-wider text-zinc-400">
          Payment schedule
        </legend>
        <div className="flex gap-3 text-sm">
          <label className="flex items-center gap-2">
            <input
              type="radio"
              name="scheduleKind"
              checked={scheduleKind === "one_time"}
              onChange={() => setScheduleKind("one_time")}
            />
            One-time
          </label>
          <label className="flex items-center gap-2">
            <input
              type="radio"
              name="scheduleKind"
              checked={scheduleKind === "plan"}
              onChange={() => setScheduleKind("plan")}
            />
            Installment plan
          </label>
        </div>

        {scheduleKind === "one_time" ? (
          <label className="flex flex-col gap-1">
            <span className="text-xs uppercase tracking-wider text-zinc-400">
              Collected amount (optional)
            </span>
            <input
              name="collectedAmount"
              type="number"
              step="0.01"
              min="0"
              placeholder="0.00"
              className="rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
            />
            <span className="text-xs text-zinc-500">
              Leave blank if payment is still pending; matches booked amount = paid in full.
            </span>
          </label>
        ) : (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <label className="flex flex-col gap-1">
              <span className="text-xs uppercase tracking-wider text-zinc-400">Frequency</span>
              <select
                name="installmentFrequency"
                defaultValue="monthly"
                className="rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
              >
                <option value="weekly">Weekly</option>
                <option value="biweekly">Biweekly</option>
                <option value="monthly">Monthly</option>
                <option value="quarterly">Quarterly</option>
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs uppercase tracking-wider text-zinc-400"># installments</span>
              <input
                name="totalInstallments"
                type="number"
                min="2"
                max="120"
                defaultValue="3"
                className="rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs uppercase tracking-wider text-zinc-400">
                Installment amount
              </span>
              <input
                name="installmentAmount"
                type="number"
                step="0.01"
                min="0"
                placeholder="0.00"
                className="rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs uppercase tracking-wider text-zinc-400">
                First installment date
              </span>
              <input
                name="firstInstallmentDate"
                type="date"
                className="rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
              />
            </label>
          </div>
        )}
      </fieldset>

      {error && <p className="rounded-md bg-red-500/10 px-3 py-2 text-sm text-red-400">{error}</p>}

      <div className="flex justify-end gap-2">
        <a
          href={`/${slug}/sales`}
          className="rounded-md border border-zinc-800 px-3 py-2 text-sm text-zinc-300 hover:bg-zinc-900"
        >
          Cancel
        </a>
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-blue-500 px-4 py-2 text-sm font-medium text-white hover:bg-blue-600 disabled:opacity-50"
        >
          {pending ? "Creating…" : "Create sale"}
        </button>
      </div>
    </form>
  );
}
