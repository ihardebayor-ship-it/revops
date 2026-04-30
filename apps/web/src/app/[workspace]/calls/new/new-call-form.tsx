"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

export function NewCallForm({ slug }: { slug: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function onSubmit(form: FormData) {
    setError(null);
    const contactName = String(form.get("contactName") || "").trim();
    const contactEmail = String(form.get("contactEmail") || "").trim();
    const contactPhone = String(form.get("contactPhone") || "").trim();
    const appointmentAt = String(form.get("appointmentAt") || "");
    const notes = String(form.get("notes") || "");

    startTransition(async () => {
      const meRes = await fetch(
        "/api/trpc/me?batch=1&input=" + encodeURIComponent(JSON.stringify({ "0": {} })),
      );
      const meJson = await meRes.json();
      const wsId = meJson?.[0]?.result?.data?.json?.workspaceId;
      if (!wsId) {
        setError("No workspace");
        return;
      }
      const body: Record<string, unknown> = {};
      if (contactName) body.contactName = contactName;
      if (contactEmail) body.contactEmail = contactEmail;
      if (contactPhone) body.contactPhone = contactPhone;
      if (appointmentAt) body.appointmentAt = new Date(appointmentAt).toISOString();
      if (notes) body.notes = notes;
      const res = await fetch("/api/trpc/calls.create?batch=1", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-workspace-id": wsId },
        body: JSON.stringify({ "0": { json: body } }),
      });
      if (!res.ok) {
        const text = await res.text();
        setError(`Failed (${res.status}): ${text.slice(0, 200)}`);
        return;
      }
      const json = await res.json();
      const callId = json?.[0]?.result?.data?.json?.id;
      router.push(callId ? `/${slug}/calls/${callId}` : `/${slug}/calls`);
      router.refresh();
    });
  }

  return (
    <form action={onSubmit} className="flex flex-col gap-4">
      <label className="flex flex-col gap-1">
        <span className="text-xs uppercase tracking-wider text-zinc-400">Contact name</span>
        <input
          name="contactName"
          autoFocus
          className="rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
        />
      </label>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <label className="flex flex-col gap-1">
          <span className="text-xs uppercase tracking-wider text-zinc-400">Email</span>
          <input
            name="contactEmail"
            type="email"
            className="rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs uppercase tracking-wider text-zinc-400">Phone</span>
          <input
            name="contactPhone"
            type="tel"
            className="rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
          />
        </label>
      </div>
      <label className="flex flex-col gap-1">
        <span className="text-xs uppercase tracking-wider text-zinc-400">Appointment</span>
        <input
          name="appointmentAt"
          type="datetime-local"
          className="rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
        />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-xs uppercase tracking-wider text-zinc-400">Notes</span>
        <textarea
          name="notes"
          rows={4}
          className="resize-none rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
        />
      </label>

      {error && <p className="rounded-md bg-red-500/10 px-3 py-2 text-sm text-red-400">{error}</p>}

      <div className="flex justify-end gap-2">
        <a
          href={`/${slug}/calls`}
          className="rounded-md border border-zinc-800 px-3 py-2 text-sm text-zinc-300 hover:bg-zinc-900"
        >
          Cancel
        </a>
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-blue-500 px-4 py-2 text-sm font-medium text-white hover:bg-blue-600 disabled:opacity-50"
        >
          {pending ? "Creating…" : "Create call"}
        </button>
      </div>
    </form>
  );
}
