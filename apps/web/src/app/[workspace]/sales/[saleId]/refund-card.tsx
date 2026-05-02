"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

type Props = {
  saleId: string;
  bookedAmount: string;
  currency: string;
  refundStatus: string;
  refundedAmount: string;
};

export function RefundCard({
  saleId,
  bookedAmount,
  currency,
  refundStatus,
  refundedAmount,
}: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [amount, setAmount] = useState(bookedAmount);
  const [reason, setReason] = useState("");

  // Already-refunded sales render a banner, not a button.
  if (refundStatus !== "none") {
    return (
      <section className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-4">
        <p className="text-xs uppercase tracking-wider text-amber-400">Refunded</p>
        <p className="mt-1 text-sm text-zinc-100">
          {currency} {refundedAmount} of {currency} {bookedAmount} refunded.
          Commission entries clawed back.
        </p>
      </section>
    );
  }

  function submit() {
    setError(null);
    startTransition(async () => {
      const wsId = await fetchWorkspaceId();
      if (!wsId) return setError("No workspace");
      const res = await fetch("/api/trpc/sales.recordRefund?batch=1", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-workspace-id": wsId },
        body: JSON.stringify({
          "0": { json: { saleId, refundedAmount: amount, reason: reason || undefined } },
        }),
      });
      if (!res.ok) {
        const text = await res.text();
        return setError(`${res.status}: ${text.slice(0, 200)}`);
      }
      setOpen(false);
      router.refresh();
    });
  }

  if (!open) {
    return (
      <section className="rounded-lg border border-zinc-800 bg-zinc-950 p-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs uppercase tracking-wider text-zinc-400">Refund</p>
            <p className="mt-1 text-sm text-zinc-300">
              Record a partial or full refund. Commission entries are clawed back
              automatically.
            </p>
          </div>
          <button
            onClick={() => setOpen(true)}
            className="rounded-md border border-red-500/30 px-3 py-1.5 text-sm text-red-400 hover:bg-red-500/10"
          >
            Record refund
          </button>
        </div>
      </section>
    );
  }

  const numAmount = Number(amount);
  const numBooked = Number(bookedAmount);
  const isFull = numAmount > 0 && Math.abs(numAmount - numBooked) < 0.01;
  const isPartial = numAmount > 0 && numAmount < numBooked;
  const overflow = numAmount > numBooked + 0.01;

  return (
    <section className="rounded-lg border border-red-500/30 bg-red-500/5 p-4">
      <p className="text-xs uppercase tracking-wider text-red-400">Record refund</p>
      <p className="mt-1 text-xs text-zinc-400">
        Booked: {currency} {bookedAmount}
      </p>
      <div className="mt-3 flex flex-col gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-xs uppercase tracking-wider text-zinc-400">
            Refund amount ({currency})
          </span>
          <input
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="rounded-md border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-100"
          />
          <span className="text-xs text-zinc-500">
            {isFull && "Full refund — all installments marked refunded, all entries clawed back."}
            {isPartial &&
              "Partial refund — pending entries scaled down. Already-paid entries are not adjusted in Phase 1."}
            {overflow && (
              <span className="text-red-400">Cannot exceed booked amount.</span>
            )}
          </span>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs uppercase tracking-wider text-zinc-400">
            Reason (optional)
          </span>
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="customer churned in week 2"
            className="rounded-md border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-100"
          />
        </label>
        {error && <p className="text-sm text-red-400">{error}</p>}
        <div className="flex justify-end gap-2">
          <button
            onClick={() => setOpen(false)}
            disabled={pending}
            className="rounded-md border border-zinc-800 px-3 py-1.5 text-sm text-zinc-300 hover:bg-zinc-900 disabled:opacity-30"
          >
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={pending || overflow || numAmount <= 0}
            className="rounded-md bg-red-500 px-4 py-1.5 text-sm font-medium text-white hover:bg-red-600 disabled:opacity-30"
          >
            {pending ? "Processing…" : isFull ? "Issue full refund" : "Issue partial refund"}
          </button>
        </div>
      </div>
    </section>
  );
}

async function fetchWorkspaceId(): Promise<string | null> {
  const res = await fetch(
    "/api/trpc/me?batch=1&input=" + encodeURIComponent(JSON.stringify({ "0": {} })),
  );
  const json = await res.json();
  return json?.[0]?.result?.data?.json?.workspaceId ?? null;
}
