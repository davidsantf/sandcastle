import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  OrchestrationWorkspaceStore,
  initializeWorkspace,
  updateWorkspaceConfiguration,
} from "./OrchestrationWorkspace.js";
import {
  nativeValidationKey,
  runNativeLocalValidation,
} from "./OrchestrationNativeValidation.js";
import { parseWorkspaceConfiguration } from "./OrchestrationWorkspaceContract.js";
const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0))
    fs.rmSync(root, { recursive: true, force: true });
});
function fixture(code: string, timeoutMs = 3000) {
  const root = fs.realpathSync.native(
    fs.mkdtempSync(path.join(os.tmpdir(), "native-validation-test-")),
  );
  roots.push(root);
  const repositoryRoot = path.join(root, "repository");
  fs.mkdirSync(repositoryRoot);
  const git = (...args: string[]) =>
    execFileSync("git", ["-C", repositoryRoot, ...args], {
      encoding: "utf8",
      stdio: "pipe",
    }).trim();
  git("init", "-b", "main");
  fs.writeFileSync(
    path.join(repositoryRoot, "value.txt"),
    "actual implementation\n",
  );
  git("add", ".");
  git(
    "-c",
    "user.name=Fixture",
    "-c",
    "user.email=fixture@example.invalid",
    "commit",
    "-m",
    "fixture",
  );
  const revision = git("rev-parse", "HEAD");
  const store = new OrchestrationWorkspaceStore(
    path.join(root, "workspace.sqlite"),
  );
  initializeWorkspace(store);
  const command = {
    projectId: "fixture",
    label: "regression",
    executable: process.execPath,
    args: ["-e", code],
    timeoutMs,
  };
  const configuration = updateWorkspaceConfiguration(store, 1, (current) => ({
    ...current,
    projects: [
      {
        id: "fixture",
        repositoryRoot,
        mode: "individual",
        hub: { kind: "github", repository: "fixture/code" },
      },
    ],
    taskTemplates: [
      {
        id: "code",
        projectId: "fixture",
        title: "Code fixture",
        brief: "Host-controlled code scope",
        branch: "work/code",
        baseBranch: "main",
        scopes: ["value.txt"],
        dependsOn: [],
        requiresContracts: [],
        providesContracts: [],
        labels: [],
        acceptance: [
          {
            label: "regression",
            command: JSON.stringify([command.executable, ...command.args]),
          },
        ],
      },
    ],
    runtime: {
      ...current.runtime,
      executionControls: {
        profile: "local-files",
        maxAiCredits: 30,
        maxAutopilotContinues: 0,
        timeoutMs: 2000,
        disabledMcpServers: [],
      },
      localValidation: [command],
    },
  }));
  const controller = new AbortController();
  const options = {
    configuration,
    proposalId: "fixture-proposal",
    projectId: "fixture",
    repositoryRoot,
    revision,
    signal: controller.signal,
    store,
    assertCurrent: async () => {},
    write: (key: string, value: unknown, kind: string) => {
      expect(
        store.compareAndSwap(key, store.read(key).version, value, {
          kind,
          at: new Date().toISOString(),
        }),
      ).toBe(true);
    },
  };
  return { root, git, store, configuration, command, options, controller };
}
describe("bounded host local validation (actual processes, local fixtures)", () => {
  it("checks the exact committed snapshot with nonzero scope, retains evidence and never repeats", async () => {
    const f = fixture(
      `const fs=require('node:fs'); if(fs.readFileSync('value.txt','utf8')!=='actual implementation\\n') process.exit(1); console.log(JSON.stringify({schemaVersion:1,state:'passed',evaluatedScope:2}));`,
    );
    try {
      const result = await runNativeLocalValidation(f.options);
      expect(result).toMatchObject({
        state: "passed",
        revision: f.options.revision,
        evaluatedScope: 2,
        checks: [{ name: "regression", state: "passed", exitCode: 0 }],
      });
      expect(
        await runNativeLocalValidation({
          ...f.options,
          assertCurrent: async () => {
            throw new Error("must not rerun");
          },
        }),
      ).toEqual(result);
      expect(
        f.store
          .events()
          .filter((event) => event.kind === "native-local-validation-reserved"),
      ).toHaveLength(1);
      expect(f.git("worktree", "list", "--porcelain")).not.toContain(
        "sandcastle-validation-",
      );
      expect(f.git("status", "--porcelain")).toBe("");
      const mutated = structuredClone(f.configuration);
      mutated.runtime.localValidation![0]!.timeoutMs += 1;
      await expect(
        runNativeLocalValidation({ ...f.options, configuration: mutated }),
      ).rejects.toThrow("binding changed");
    } finally {
      f.store.close();
    }
  });
  it.each([
    [
      "failed",
      "console.log(JSON.stringify({schemaVersion:1,state:'failed',evaluatedScope:2}));process.exit(1);",
    ],
    [
      "unknown",
      "console.log(JSON.stringify({schemaVersion:1,state:'passed',evaluatedScope:0}));",
    ],
    ["unknown", "console.log('model said tests pass');"],
    [
      "unknown",
      "console.log(JSON.stringify({schemaVersion:1,state:'passed',evaluatedScope:2}));process.exit(1);",
    ],
    [
      "unknown",
      "require('node:fs').writeFileSync('value.txt','modified'); console.log(JSON.stringify({schemaVersion:1,state:'passed',evaluatedScope:2}));",
    ],
  ] as const)(
    "records true %s instead of accepting failed, vacuous, malformed or mutating checks",
    async (state, code) => {
      const f = fixture(code);
      try {
        expect(await runNativeLocalValidation(f.options)).toMatchObject({
          state,
        });
      } finally {
        f.store.close();
      }
    },
  );
  it("records deadline uncertainty and does not repeat the process", async () => {
    const f = fixture("setInterval(()=>{},1000);", 1000);
    try {
      expect(await runNativeLocalValidation(f.options)).toMatchObject({
        state: "unknown",
        diagnostic: expect.stringMatching(/deadline|canceled/),
      });
      expect(await runNativeLocalValidation(f.options)).toMatchObject({
        state: "unknown",
      });
      expect(
        f.store
          .events()
          .filter((event) => event.kind === "native-local-validation-reserved"),
      ).toHaveLength(1);
    } finally {
      f.store.close();
    }
  });
  it("holds a reserved crash outcome without starting any process", async () => {
    const f = fixture("throw new Error('must not launch')");
    try {
      const key = nativeValidationKey(f.configuration.id, f.options.proposalId);
      const { digest } = await import("./MultiProjectProtocol.js");
      f.options.write(
        key,
        {
          revision: f.options.revision,
          configurationRevision: f.configuration.revision,
          commandsDigest: digest(f.configuration.runtime.localValidation),
          state: "reserved",
          evaluatedScope: 0,
          checks: [],
        },
        "fixture-crash",
      );
      expect(await runNativeLocalValidation(f.options)).toMatchObject({
        state: "reserved",
      });
    } finally {
      f.store.close();
    }
  });
  it("cancels the owned checker, records uncertainty and never repeats", async () => {
    const f = fixture("setInterval(()=>{},1000);");
    let calls = 0;
    try {
      await expect(
        runNativeLocalValidation({
          ...f.options,
          assertCurrent: async () => {
            if (++calls === 2)
              setTimeout(
                () => f.controller.abort(new Error("fixture cancellation")),
                100,
              );
          },
        }),
      ).rejects.toThrow("fixture cancellation");
      expect(await runNativeLocalValidation(f.options)).toMatchObject({
        state: "unknown",
      });
      expect(
        f.store
          .events()
          .filter((event) => event.kind === "native-local-validation-reserved"),
      ).toHaveLength(1);
      expect(f.git("worktree", "list", "--porcelain")).not.toContain(
        "sandcastle-validation-",
      );
    } finally {
      f.store.close();
    }
  });
  it("does not accept passed test output after current source or ownership is lost", async () => {
    const f = fixture(
      "console.log(JSON.stringify({schemaVersion:1,state:'passed',evaluatedScope:2}));",
    );
    let calls = 0;
    try {
      expect(
        await runNativeLocalValidation({
          ...f.options,
          assertCurrent: async () => {
            if (++calls === 3)
              throw new Error("Implementation changed during local validation");
          },
        }),
      ).toMatchObject({
        state: "unknown",
        evaluatedScope: 2,
        diagnostic: "Implementation changed during local validation",
      });
    } finally {
      f.store.close();
    }
  });
  it("denies stale ownership before reservation and rejects unsupported registry authority", async () => {
    const f = fixture("throw new Error('must not launch')");
    try {
      await expect(
        runNativeLocalValidation({
          ...f.options,
          assertCurrent: async () => {
            throw new Error("owner lost");
          },
        }),
      ).rejects.toThrow("owner lost");
      expect(
        f.store
          .events()
          .some((event) => event.kind === "native-local-validation-reserved"),
      ).toBe(false);
      for (const mutate of [
        (value: typeof f.configuration) => {
          value.runtime.localValidation![0]!.executable = "node";
        },
        (value: typeof f.configuration) => {
          value.runtime.localValidation![0]!.projectId = "absent";
        },
        (value: typeof f.configuration) => {
          value.runtime.localValidation![0]!.args.push("hub-injected-command");
        },
        (value: typeof f.configuration) => {
          delete value.runtime.executionControls;
        },
      ]) {
        const changed = structuredClone(f.configuration);
        mutate(changed);
        expect(() => parseWorkspaceConfiguration(changed)).toThrow();
      }
    } finally {
      f.store.close();
    }
  });
});
