import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  evaluateCoworkDependencies,
  type CoworkDependencyFile,
} from "./CoworkGovernanceDependencies.js";

const files = (): CoworkDependencyFile[] => [
  {
    file: "src/Contract.ts",
    source: "export interface API { value: string }",
    component: "api",
    role: "contract",
    governed: true,
  },
  {
    file: "src/Kit.ts",
    source:
      "import type { API } from './Contract.js'; export const value: API = {value:'a'};",
    component: "api",
    role: "kit",
    governed: true,
  },
  {
    file: "src/Implementation.ts",
    source: "import {value} from './Kit.js'; export const run = () => value;",
    component: "api",
    role: "implementation",
    governed: true,
  },
  {
    file: "src/Other.ts",
    source: "export const other = () => 1;",
    component: "other",
    role: "implementation",
    governed: true,
  },
  {
    file: "src/main.ts",
    source: "import {run} from './Implementation.js'; run();",
    component: "app",
    role: "binary",
    governed: true,
  },
];

describe("actual TypeScript dependency role edges", () => {
  it("permits contracts/kits and binary wiring with nonzero scope", () => {
    expect(evaluateCoworkDependencies(files())).toMatchObject({
      state: "passed",
      evaluatedScope: 5,
      regressions: 0,
    });
  });
  it("gates the real governed modules without new exceptions", () => {
    const names = [
      "CoworkReviewContract.ts",
      "CoworkReview.ts",
      "CoworkGovernanceContract.ts",
      "CoworkGovernance.ts",
      "CoworkGovernanceDependencies.ts",
    ];
    const inventory: CoworkDependencyFile[] = names.map((name) => ({
      file: `src/${name}`,
      source: readFileSync(new URL(`./${name}`, import.meta.url), "utf8"),
      component: name.startsWith("CoworkReview") ? "review" : "governance",
      role: name.includes("Contract.") ? "contract" : "implementation",
      governed: true,
    }));
    expect(evaluateCoworkDependencies(inventory)).toMatchObject({
      state: "passed",
      regressions: 0,
      evaluatedScope: 5,
    });
    inventory[1] = {
      ...inventory[1]!,
      source: inventory[1]!.source + "\nimport './CoworkGovernance.js';",
    };
    expect(evaluateCoworkDependencies(inventory).state).toBe("failed");
  });
  it.each([
    "import {other} from './Other.js';",
    "export {other} from './Other.js';",
    "const other = import('./Other.js');",
    "const other = require('./Other.js');",
    "type Other = import('./Other.js');",
    "import other = require('./Other.js');",
  ])("fails deliberately forbidden implementation dependency: %s", (source) => {
    const inventory = files().map((file) =>
      file.role === "implementation" && file.component === "api"
        ? { ...file, source }
        : file,
    );
    expect(evaluateCoworkDependencies(inventory)).toMatchObject({
      state: "failed",
      regressions: 1,
    });
    expect(evaluateCoworkDependencies(inventory).violations[0]).toMatchObject({
      from: "src/Implementation.ts",
      to: "src/Other.ts",
      rule: "forbidden-role-edge",
    });
  });
  it("ignores comments/string pseudo-imports rather than matching names", () => {
    const inventory = files().map((file) =>
      file.file === "src/Implementation.ts"
        ? {
            ...file,
            source:
              "// import './Other.js';\nconst text = \"require('./Other.js')\";",
          }
        : file,
    );
    expect(evaluateCoworkDependencies(inventory).state).toBe("passed");
  });
  it("resolves host-configured paths aliases as actual local edges", () => {
    const inventory = files().map((file) =>
      file.file === "src/Implementation.ts"
        ? { ...file, source: "import {other} from '@components/Other';" }
        : file,
    );
    expect(
      evaluateCoworkDependencies(inventory, {
        legacyBaseline: [],
        compilerOptions: { paths: { "@components/*": ["src/*"] } },
      }).state,
    ).toBe("failed");
  });
  it("rejects unknown local edges and computed imports", () => {
    for (const source of [
      "import './Missing.js';",
      "const p = './Other.js'; import(p);",
      "require(name);",
    ]) {
      const inventory = files().map((file) =>
        file.file === "src/Implementation.ts" ? { ...file, source } : file,
      );
      expect(evaluateCoworkDependencies(inventory).state).toBe("failed");
    }
  });
  it("prevents binary exports and dependencies on binaries", () => {
    const exported = files().map((file) =>
      file.role === "binary"
        ? { ...file, source: "export function reusable() { return 1; }" }
        : file,
    );
    expect(evaluateCoworkDependencies(exported).state).toBe("failed");
    const imported = files().map((file) =>
      file.role === "kit" ? { ...file, source: "import './main.js';" } : file,
    );
    expect(evaluateCoworkDependencies(imported).state).toBe("failed");
  });
  it("rejects inline binary logic, invalid syntax and triple-slash hidden edges", () => {
    for (const source of [
      "function logic() { return 1; } logic();",
      "if (true) console.log('not wiring');",
      "const broken = ;",
      '/// <reference path="Other.ts" />\n',
    ]) {
      const inventory = files().map((file) =>
        file.file ===
        (source.startsWith("///") ? "src/Implementation.ts" : "src/main.ts")
          ? { ...file, source }
          : file,
      );
      expect(evaluateCoworkDependencies(inventory).state).toBe("failed");
    }
  });
  it("ratchets exact legacy identities but never allows governed exceptions", () => {
    const inventory = files().map((file) => ({
      ...file,
      governed: false,
      source:
        file.file === "src/Implementation.ts"
          ? "import './Other.js';"
          : file.source,
    }));
    const baseline = evaluateCoworkDependencies(inventory).violations.map(
      (v) => v.identity,
    );
    expect(
      evaluateCoworkDependencies(inventory, { legacyBaseline: baseline }).state,
    ).toBe("passed");
    const governed = inventory.map((file) =>
      file.file === "src/Other.ts" ? { ...file, governed: true } : file,
    );
    expect(
      evaluateCoworkDependencies(governed, { legacyBaseline: baseline }).state,
    ).toBe("failed");
    const regressed = inventory.map((file) =>
      file.file === "src/Kit.ts"
        ? { ...file, source: "import './Other.js';" }
        : file,
    );
    expect(
      evaluateCoworkDependencies(regressed, { legacyBaseline: baseline })
        .regressions,
    ).toBe(1);
  });
  it("fails vacuous scopes and duplicate source identities", () => {
    expect(evaluateCoworkDependencies([]).state).toBe("failed");
    expect(evaluateCoworkDependencies([...files(), files()[0]!]).state).toBe(
      "failed",
    );
  });
});
