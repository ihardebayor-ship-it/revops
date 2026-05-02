"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

// Mirrors the enum in packages/db/src/schema/enums.ts. "superadmin" is
// included because the schema permits it on memberships, but it's never
// shown in the dropdown — admins use workspace_admin for workspace owners.
type AccessRole =
  | "superadmin"
  | "workspace_admin"
  | "sub_account_admin"
  | "manager"
  | "contributor"
  | "viewer";

type Member = {
  membershipId: string;
  userId: string;
  email: string;
  name: string | null;
  accessRole: AccessRole;
  acceptedAt: string | null;
  createdAt: string;
  salesRoleIds: string[];
};

type Invitation = {
  id: string;
  email: string;
  accessRole: AccessRole;
  salesRoleIds: string[];
  invitedByUserId: string | null;
  invitedAt: string;
  expiresAt: string;
  token: string;
};

type RoleOption = { id: string; label: string };

const ACCESS_ROLE_OPTIONS: AccessRole[] = [
  "workspace_admin",
  "sub_account_admin",
  "manager",
  "contributor",
  "viewer",
];

export function TeamEditor({
  slug,
  currentUserId,
  canEdit,
  members,
  invitations,
  roles,
}: {
  slug: string;
  currentUserId: string;
  canEdit: boolean;
  members: Member[];
  invitations: Invitation[];
  roles: RoleOption[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // Invite form
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<AccessRole>("contributor");
  const [inviteSalesRoles, setInviteSalesRoles] = useState<Set<string>>(new Set());

  // Per-member edit
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editAccessRole, setEditAccessRole] = useState<AccessRole>("contributor");
  const [editSalesRoles, setEditSalesRoles] = useState<Set<string>>(new Set());

  function call(path: string, body: unknown, onDone?: () => void) {
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
      onDone?.();
      router.refresh();
    });
  }

  function startEdit(m: Member) {
    setEditingId(m.membershipId);
    setEditAccessRole(m.accessRole);
    setEditSalesRoles(new Set(m.salesRoleIds));
  }

  function toggle(setFn: (v: Set<string>) => void, current: Set<string>, id: string) {
    const next = new Set(current);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setFn(next);
  }

  return (
    <div className="space-y-6">
      {error && (
        <p className="rounded-md bg-red-500/10 px-3 py-2 text-sm text-red-400">{error}</p>
      )}

      {/* Invite */}
      {canEdit && (
        <div className="flex flex-col gap-3 rounded-lg border border-zinc-800 bg-zinc-950 p-4">
          <h3 className="text-sm font-semibold text-zinc-100">Invite a teammate</h3>
          <div className="flex flex-col gap-3 md:flex-row md:items-end">
            <label className="flex flex-1 flex-col gap-1">
              <span className="text-xs uppercase tracking-wider text-zinc-400">Email</span>
              <input
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                type="email"
                placeholder="rep@example.com"
                className="rounded-md border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
              />
            </label>
            <label className="flex w-48 flex-col gap-1">
              <span className="text-xs uppercase tracking-wider text-zinc-400">Access role</span>
              <select
                value={inviteRole}
                onChange={(e) => setInviteRole(e.target.value as AccessRole)}
                className="rounded-md border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm"
              >
                {ACCESS_ROLE_OPTIONS.map((r) => (
                  <option key={r} value={r}>
                    {r.replace("_", " ")}
                  </option>
                ))}
              </select>
            </label>
            <button
              onClick={() => {
                if (!inviteEmail.trim()) return;
                call(
                  "/api/trpc/team.invite?batch=1",
                  {
                    email: inviteEmail.trim(),
                    accessRole: inviteRole,
                    salesRoleIds: Array.from(inviteSalesRoles),
                  },
                  () => {
                    setInviteEmail("");
                    setInviteSalesRoles(new Set());
                  },
                );
              }}
              disabled={pending || !inviteEmail.trim()}
              className="rounded-md bg-blue-500 px-4 py-2 text-sm font-medium text-white hover:bg-blue-600 disabled:opacity-30"
            >
              {pending ? "Inviting…" : "Invite"}
            </button>
          </div>
          {roles.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs uppercase tracking-wider text-zinc-400">
                Sales roles:
              </span>
              {roles.map((r) => (
                <RolePill
                  key={r.id}
                  label={r.label}
                  active={inviteSalesRoles.has(r.id)}
                  onClick={() => toggle(setInviteSalesRoles, inviteSalesRoles, r.id)}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Pending invitations */}
      {invitations.length > 0 && (
        <div>
          <h3 className="mb-2 text-sm font-semibold text-zinc-300">Pending invitations</h3>
          <ul className="divide-y divide-zinc-800 rounded-lg border border-zinc-800 bg-zinc-950">
            {invitations.map((inv) => {
              const url = `${typeof window !== "undefined" ? window.location.origin : ""}/sign-up?invite=${inv.token}`;
              return (
                <li
                  key={inv.id}
                  className="flex flex-col gap-2 p-4 md:flex-row md:items-center"
                >
                  <div className="flex-1">
                    <p className="text-sm text-zinc-100">{inv.email}</p>
                    <p className="text-xs text-zinc-500">
                      {inv.accessRole.replace("_", " ")} · expires{" "}
                      {new Date(inv.expiresAt).toLocaleDateString()}
                    </p>
                  </div>
                  <button
                    onClick={() => {
                      void navigator.clipboard?.writeText(url);
                    }}
                    className="rounded-md border border-zinc-800 px-3 py-1.5 text-sm text-zinc-300 hover:bg-zinc-900"
                  >
                    Copy link
                  </button>
                  {canEdit && (
                    <button
                      onClick={() =>
                        call("/api/trpc/team.revokeInvite?batch=1", { invitationId: inv.id })
                      }
                      disabled={pending}
                      className="rounded-md border border-red-500/30 px-3 py-1.5 text-sm text-red-400 hover:bg-red-500/10 disabled:opacity-30"
                    >
                      Revoke
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {/* Members */}
      <div>
        <h3 className="mb-2 text-sm font-semibold text-zinc-300">
          Members · {members.length}
        </h3>
        <ul className="divide-y divide-zinc-800 rounded-lg border border-zinc-800 bg-zinc-950">
          {members.map((m) => {
            const isSelf = m.userId === currentUserId;
            const editing = editingId === m.membershipId;
            return (
              <li key={m.membershipId} className="flex flex-col gap-2 p-4">
                <div className="flex flex-col gap-1 md:flex-row md:items-center md:gap-3">
                  <div className="flex-1">
                    <p className="text-sm text-zinc-100">
                      {m.name || m.email}
                      {isSelf && <span className="ml-2 text-xs text-zinc-500">(you)</span>}
                    </p>
                    <p className="text-xs text-zinc-500">{m.email}</p>
                  </div>
                  {!editing && (
                    <span className="rounded bg-zinc-900 px-2 py-1 text-xs uppercase tracking-wider text-zinc-400">
                      {m.accessRole.replace("_", " ")}
                    </span>
                  )}
                  {!editing && m.salesRoleIds.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {m.salesRoleIds.map((id) => {
                        const r = roles.find((x) => x.id === id);
                        return r ? (
                          <span
                            key={id}
                            className="rounded bg-blue-500/10 px-2 py-1 text-xs text-blue-300"
                          >
                            {r.label}
                          </span>
                        ) : null;
                      })}
                    </div>
                  )}
                  {canEdit && !editing && (
                    <div className="flex gap-2">
                      <button
                        onClick={() => startEdit(m)}
                        className="rounded-md border border-zinc-800 px-3 py-1.5 text-sm text-zinc-300 hover:bg-zinc-900"
                      >
                        Edit
                      </button>
                      {!isSelf && (
                        <button
                          onClick={() =>
                            call("/api/trpc/team.removeMember?batch=1", {
                              membershipId: m.membershipId,
                            })
                          }
                          disabled={pending}
                          className="rounded-md border border-red-500/30 px-3 py-1.5 text-sm text-red-400 hover:bg-red-500/10 disabled:opacity-30"
                        >
                          Remove
                        </button>
                      )}
                    </div>
                  )}
                </div>

                {editing && (
                  <div className="flex flex-col gap-3 rounded-md bg-zinc-900/40 p-3">
                    <label className="flex w-full flex-col gap-1 md:w-64">
                      <span className="text-xs uppercase tracking-wider text-zinc-400">
                        Access role
                      </span>
                      <select
                        value={editAccessRole}
                        onChange={(e) => setEditAccessRole(e.target.value as AccessRole)}
                        className="rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm"
                      >
                        {ACCESS_ROLE_OPTIONS.map((r) => (
                          <option key={r} value={r}>
                            {r.replace("_", " ")}
                          </option>
                        ))}
                      </select>
                    </label>
                    {roles.length > 0 && (
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-xs uppercase tracking-wider text-zinc-400">
                          Sales roles:
                        </span>
                        {roles.map((r) => (
                          <RolePill
                            key={r.id}
                            label={r.label}
                            active={editSalesRoles.has(r.id)}
                            onClick={() => toggle(setEditSalesRoles, editSalesRoles, r.id)}
                          />
                        ))}
                      </div>
                    )}
                    <div className="flex gap-2">
                      <button
                        onClick={() => setEditingId(null)}
                        disabled={pending}
                        className="rounded-md border border-zinc-800 px-3 py-1.5 text-sm text-zinc-300 hover:bg-zinc-900 disabled:opacity-30"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={() =>
                          call(
                            "/api/trpc/team.updateMember?batch=1",
                            {
                              membershipId: m.membershipId,
                              accessRole: editAccessRole,
                              salesRoleIds: Array.from(editSalesRoles),
                            },
                            () => setEditingId(null),
                          )
                        }
                        disabled={pending}
                        className="rounded-md bg-blue-500 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-600 disabled:opacity-30"
                      >
                        {pending ? "Saving…" : "Save"}
                      </button>
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </div>
      <p className="text-xs text-zinc-500">
        Workspace: <code>{slug}</code>
      </p>
    </div>
  );
}

function RolePill({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-md px-3 py-1 text-xs ${active ? "bg-blue-500 text-white" : "border border-zinc-800 text-zinc-400 hover:bg-zinc-900"}`}
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
