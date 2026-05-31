import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const routersDir = new URL(".", import.meta.url);

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
