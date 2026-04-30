// The single source of truth for authorization checks.
// Used by tRPC middleware, Server Actions, and the agent's tool registry.
// Adding a new resource type means adding a case here and nowhere else.

export type AccessRole =
  | "superadmin"
  | "workspace_admin"
  | "sub_account_admin"
  | "manager"
  | "contributor"
  | "viewer";

export type AuthContext = {
  userId: string;
  workspaceId: string | null;
  subAccountId: string | null;
  accessRole: AccessRole | null;
  salesRoleSlugs: string[];
  isSuperadmin: boolean;
};

export type Action =
  | "workspace:read"
  | "workspace:update"
  | "workspace:billing"
  | "subaccount:read"
  | "subaccount:update"
  | "member:invite"
  | "member:remove"
  | "member:update_role"
  | "salesrole:read"
  | "salesrole:create"
  | "salesrole:update"
  | "call:read"
  | "call:create"
  | "call:update"
  | "call:delete"
  | "sale:read"
  | "sale:create"
  | "sale:update"
  | "sale:link"
  | "commission:read"
  | "commission:approve"
  | "commission:adjust"
  | "commission:rule:update"
  | "task:read"
  | "task:complete"
  | "agent:invoke"
  | "agent:fact:write"
  | "audit:read"
  | "integration:connect"
  | "integration:disconnect";

const READ_ACTIONS: ReadonlySet<Action> = new Set([
  "workspace:read",
  "subaccount:read",
  "salesrole:read",
  "call:read",
  "sale:read",
  "commission:read",
  "task:read",
  "audit:read",
]);

const ADMIN_ACTIONS: ReadonlySet<Action> = new Set([
  "workspace:update",
  "workspace:billing",
  "member:invite",
  "member:remove",
  "member:update_role",
  "salesrole:create",
  "salesrole:update",
  "commission:rule:update",
  "integration:connect",
  "integration:disconnect",
]);

const MANAGER_ACTIONS: ReadonlySet<Action> = new Set([
  "commission:approve",
  "commission:adjust",
]);

export type AuthorizableResource = {
  type: string;
  id: string;
  workspaceId?: string | null;
  subAccountId?: string | null;
};

export function can(
  ctx: AuthContext,
  action: Action,
  resource?: AuthorizableResource,
): boolean {
  if (ctx.isSuperadmin) return true;
  if (!ctx.accessRole) return false;

  // Resource-scoped check: when a target row is given, the calling user's
  // workspace must match the row's. RLS catches misses at the database;
  // this is the application-layer fail-safe.
  if (resource && resource.workspaceId !== undefined && resource.workspaceId !== null) {
    if (resource.workspaceId !== ctx.workspaceId) return false;
  }

  if (READ_ACTIONS.has(action)) {
    return ctx.accessRole !== null;
  }

  if (ctx.accessRole === "viewer") return false;

  if (ADMIN_ACTIONS.has(action)) {
    return ctx.accessRole === "workspace_admin" || ctx.accessRole === "sub_account_admin";
  }

  if (MANAGER_ACTIONS.has(action)) {
    return (
      ctx.accessRole === "workspace_admin" ||
      ctx.accessRole === "sub_account_admin" ||
      ctx.accessRole === "manager"
    );
  }

  switch (action) {
    case "subaccount:update":
      return ctx.accessRole === "workspace_admin" || ctx.accessRole === "sub_account_admin";
    case "call:create":
    case "call:update":
    case "sale:create":
    case "sale:update":
    case "sale:link":
    case "task:complete":
    case "agent:invoke":
    case "agent:fact:write":
      return true;
    case "call:delete":
      return ctx.accessRole === "workspace_admin" || ctx.accessRole === "sub_account_admin";
    default:
      return false;
  }
}

export function requireWorkspace(ctx: AuthContext): asserts ctx is AuthContext & {
  workspaceId: string;
} {
  if (!ctx.workspaceId) {
    throw new Error("Workspace context required");
  }
}

export function requireAuth(ctx: AuthContext | null): asserts ctx is AuthContext {
  if (!ctx) {
    throw new Error("Authentication required");
  }
}
