"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

type TrpcBatchResponse = Array<{
  result?: { data?: { json?: { queued?: boolean } } };
  error?: { json?: { message?: string }; message?: string };
}>;

export function RecomputeCommissionButton({
  saleId,
  workspaceId,
  subAccountId,
}: {
  saleId: string;
  workspaceId: string;
  subAccountId: string | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function recompute() {
    setMessage(null);
    setError(null);
    startTransition(async () => {
      const res = await fetch("/api/trpc/commissions.recomputeOne?batch=1", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...trpcHeaders(workspaceId, subAccountId),
        },
        body: JSON.stringify({ "0": { json: { saleId } } }),
      });

      const json = (await res.json().catch(() => null)) as TrpcBatchResponse | null;
      const errorMessage = json?.[0]?.error?.json?.message ?? json?.[0]?.error?.message;
      if (!res.ok || errorMessage) {
        setError(errorMessage ?? `${res.status}: request failed`);
        return;
      }

      setMessage("Recompute queued. Refresh after the worker finishes.");
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col items-start gap-1 md:items-end">
      <button
        type="button"
        onClick={recompute}
        disabled={pending}
        className="rounded-md border border-blue-500/40 px-3 py-1.5 text-sm text-blue-300 hover:bg-blue-500/10 disabled:opacity-40"
      >
        {pending ? "Queueing..." : "Recompute commissions"}
      </button>
      {message && <p className="text-xs text-emerald-400">{message}</p>}
      {error && <p className="text-xs text-red-400">{error}</p>}
    </div>
  );
}

function trpcHeaders(workspaceId: string, subAccountId: string | null): Record<string, string> {
  const headers: Record<string, string> = { "x-workspace-id": workspaceId };
  if (subAccountId) headers["x-sub-account-id"] = subAccountId;
  return headers;
}
