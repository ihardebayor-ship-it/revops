import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const routersDir = new URL(".", import.meta.url);
const contextSource = readFileSync(new URL("../context.ts", import.meta.url), "utf8");
const callsSource = readFileSync(new URL("./calls.ts", import.meta.url), "utf8");
const salesSource = readFileSync(new URL("./sales.ts", import.meta.url), "utf8");

describe("router mutation authorization", () => {
  it("does not define mutations from plain authedProcedure", () => {
    const offenders = readdirSync(routersDir)
      .filter((file) => file.endsWith(".ts") && !file.endsWith(".test.ts"))
      .flatMap((file) => {
        const source = readFileSync(join(routersDir.pathname, file), "utf8");
        return findPlainAuthedMutations(source).map((name) => `${file}:${name}`);
      });

    expect(offenders).toEqual([]);
  });
});

describe("data spine guards", () => {
  it("populates sales role slugs for role-targeted task visibility", () => {
    expect(contextSource).toContain("salesRoleAssignments");
    expect(contextSource).toContain("salesRoles.slug");
    expect(contextSource).toContain(
      "salesRoleSlugs: [...new Set(roleRows.map((row) => row.slug))]",
    );
    expect(contextSource).not.toContain("for now `salesRoleSlugs` is empty");
  });

  it("keeps core list APIs date-range filterable", () => {
    expect(callsSource).toContain("appointmentFrom");
    expect(callsSource).toContain("appointmentTo");
    expect(salesSource).toContain("closedFrom");
    expect(salesSource).toContain("closedTo");
  });
});

function findPlainAuthedMutations(source: string): string[] {
  const offenders: string[] = [];
  const mutationPattern = /\b([A-Za-z0-9_]+):\s+authedProcedure\b[\s\S]*?\.mutation\(/g;
  let match: RegExpExecArray | null;

  while ((match = mutationPattern.exec(source))) {
    const snippet = match[0];
    if (!snippet.includes("authedProcedureWith(")) {
      offenders.push(match[1]!);
    }
  }

  return offenders;
}
