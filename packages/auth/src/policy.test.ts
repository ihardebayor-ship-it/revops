import { describe, expect, it } from "vitest";
import { can, type AuthContext } from "./policy";

function ctx(overrides: Partial<AuthContext> = {}): AuthContext {
  return {
    userId: "user-1",
    workspaceId: "workspace-1",
    subAccountId: "sub-1",
    accessRole: "contributor",
    salesRoleSlugs: [],
    isSuperadmin: false,
    ...overrides,
  };
}

describe("can", () => {
  it("denies write actions to viewers", () => {
    expect(can(ctx({ accessRole: "viewer" }), "sale:create")).toBe(false);
    expect(can(ctx({ accessRole: "viewer" }), "task:create")).toBe(false);
    expect(can(ctx({ accessRole: "viewer" }), "call:update")).toBe(false);
  });

  it("allows contributors to perform non-admin operating actions", () => {
    const user = ctx({ accessRole: "contributor" });

    expect(can(user, "sale:create")).toBe(true);
    expect(can(user, "call:create")).toBe(true);
    expect(can(user, "task:complete")).toBe(true);
  });

  it("reserves admin actions for workspace and sub-account admins", () => {
    expect(can(ctx({ accessRole: "manager" }), "member:invite")).toBe(false);
    expect(can(ctx({ accessRole: "contributor" }), "commission:rule:update")).toBe(false);
    expect(can(ctx({ accessRole: "workspace_admin" }), "member:invite")).toBe(true);
    expect(can(ctx({ accessRole: "sub_account_admin" }), "commission:rule:update")).toBe(true);
  });

  it("denies resource access across workspace boundaries", () => {
    expect(
      can(ctx(), "sale:update", {
        type: "sale",
        id: "sale-1",
        workspaceId: "other-workspace",
      }),
    ).toBe(false);
  });

  it("allows superadmins regardless of tenant role", () => {
    expect(
      can(ctx({ accessRole: null, isSuperadmin: true }), "workspace:billing", {
        type: "workspace",
        id: "workspace-2",
        workspaceId: "workspace-2",
      }),
    ).toBe(true);
  });
});
