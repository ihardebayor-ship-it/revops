"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

export function AircallConnectForm({ workspaceSlug }: { workspaceSlug: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <form
      className="flex flex-col gap-4 rounded-lg border border-zinc-800 bg-zinc-950 p-6"
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        const fd = new FormData(e.currentTarget);
        startTransition(async () => {
          const res = await fetch("/api/integrations/aircall/connect", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              workspaceSlug,
              apiId: fd.get("apiId"),
              apiToken: fd.get("apiToken"),
              aircallUserId: fd.get("aircallUserId"),
              label: fd.get("label") || undefined,
            }),
          });
          if (!res.ok) {
            const text = await res.text();
            setError(text || `Connect failed (${res.status})`);
            return;
          }
          router.push(`/${workspaceSlug}/integrations`);
        });
      }}
    >
      <Field label="API ID" name="apiId" required />
      <Field label="API token" name="apiToken" type="password" required />
      <Field
        label="Aircall user.id"
        name="aircallUserId"
        required
        helper="The numeric Aircall user.id whose calls map to this connection."
      />
      <Field label="Label" name="label" placeholder="Aircall (production)" />
      {error && <p className="text-sm text-red-400">{error}</p>}
      <button
        type="submit"
        disabled={pending}
        className="self-end rounded-md bg-blue-500 px-4 py-2 text-sm font-medium text-white hover:bg-blue-600 disabled:opacity-30"
      >
        {pending ? "Connecting…" : "Connect"}
      </button>
    </form>
  );
}

function Field({
  label,
  name,
  type = "text",
  required,
  placeholder,
  helper,
}: {
  label: string;
  name: string;
  type?: string;
  required?: boolean;
  placeholder?: string;
  helper?: string;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs uppercase tracking-wider text-zinc-400">{label}</span>
      <input
        type={type}
        name={name}
        required={required}
        placeholder={placeholder}
        className="rounded-md border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-100"
      />
      {helper && <span className="text-xs text-zinc-500">{helper}</span>}
    </label>
  );
}
