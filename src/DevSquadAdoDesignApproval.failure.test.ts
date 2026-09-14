import { afterEach, expect, it } from "vitest";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  startDevSquadAdoDesignApproval as start,
  recoverDevSquadAdoDesignApproval as recover,
} from "./DevSquadAdoDesignApproval.js";
import {
  makeDecisionFixture,
  decisionAdapters,
} from "./DevSquadAdoDesignApprovalTestSupport.js";
const clean: Array<() => Promise<void>> = [];
afterEach(async () => {
  await Promise.all(clean.splice(0).map((f) => f()));
});
async function fixture() {
  const f = await makeDecisionFixture();
  clean.push(f.dispose);
  return f;
}
it.each(["r", "p", "a"])(
  "W057 capacity at %s retains consumed history without new effects",
  async (stage) => {
    const f = await fixture();
    const d = decisionAdapters(f);
    const checkpoint = async (q: any) =>
      q.operationId.startsWith("dg15." + stage + ".")
        ? {
            ok: false,
            error: {
              kind: "capacity-exceeded",
              resource: "checkpoints",
              limit: 10000,
              secret: "SECRET",
            },
          }
        : f.ledger.checkpoint(q);
    const r = await start(f.request, {
      ...d,
      ledger: { readRecord: f.ledger.readRecord, checkpoint },
    } as any);
    expect(r.reason).toBe("capacity-exceeded");
    expect(r.durableState).not.toBe("approved");
    expect(f.publishOnce).toHaveBeenCalledTimes(stage === "r" ? 0 : 1);
    expect(JSON.stringify(r)).not.toContain("SECRET");
    expect((await recover(f.request, f.dependencies)).durableState).toBe(
      stage === "r"
        ? "unreserved"
        : stage === "p"
          ? "attempt-consumed"
          : "publication-confirmed",
    );
  },
);
it.each([
  ["unsupported-filesystem", "unsupported-platform"],
  ["unsupported-permissions", "unsupported-platform"],
  ["unsupported-schema-version", "unsupported-schema"],
  ["corrupt-artifact", "corrupt-ledger"],
])("W057 maps %s without dependency diagnostics", async (kind, reason) => {
  const f = await fixture();
  const ledger: any = {
    readRecord: async () => ({
      ok: false,
      error: { kind, artifact: "SECRET-PATH", schemaVersion: 99 },
    }),
    checkpoint: async () => {
      throw Error("must not call");
    },
  };
  expect(await recover(f.request, { ledger })).toMatchObject({
    durableState: "unreadable",
    reason,
  });
  const r = await start(f.request, { ...f.dependencies, ledger });
  expect(r.reason).toBe(reason);
  expect(JSON.stringify(r)).not.toContain("SECRET");
  expect(f.publishOnce).not.toHaveBeenCalled();
});
it("W057 corrupt highest committed generation cannot fall back to older success", async () => {
  const f = await fixture();
  const oldRoot = join(f.root, ".sandcastle", "devsquad-ado", "records");
  const oldDir = join(oldRoot, (await readdir(oldRoot))[0]!);
  const oldName = (await readdir(oldDir)).find((n) => n.endsWith(".json"))!;
  const oldBytes = await readFile(join(oldDir, oldName));
  await start(f.request, decisionAdapters(f) as any);
  await writeFile(join(oldDir, oldName), oldBytes);
  const root = join(f.root, ".sandcastle", "devsquad-ado", "records");
  const dir = join(root, (await readdir(root))[0]!);
  const generations = (await readdir(dir))
    .filter((n) => n.endsWith(".json"))
    .sort();
  expect(generations.length).toBeGreaterThan(1);
  const highest = join(dir, generations.at(-1)!);
  await writeFile(highest, "{TRUNCATED-SECRET");
  expect(await recover(f.request, f.dependencies)).toMatchObject({
    durableState: "unreadable",
    reason: "corrupt-ledger",
  });
  expect(await readFile(highest, "utf8")).toBe("{TRUNCATED-SECRET");
});
it("W057 durable gate artifacts exclude bodies, prose, capabilities, and diagnostics", async () => {
  const f = await fixture();
  const d = decisionAdapters(f);
  const r = await start(
    {
      ...f.request,
      design: { ...f.request.design, content: "PROPOSAL-SECRET-SENTINEL" },
    },
    d as any,
  );
  expect(r.durableState).toBe("approved");
  async function scan(path: string): Promise<string> {
    let text = "";
    for (const e of await readdir(path, { withFileTypes: true })) {
      const p = join(path, e.name);
      text += e.isDirectory() ? await scan(p) : await readFile(p, "utf8");
    }
    return text;
  }
  const persisted = await scan(join(f.root, ".sandcastle", "devsquad-ado"));
  for (const secret of [
    "PROPOSAL-SECRET-SENTINEL",
    f.request.authority!.claimToken,
    "/devsquad approve-design",
    "human-identity",
    "grant-proof",
  ])
    expect(persisted + JSON.stringify(r)).not.toContain(secret);
  expect(await readdir(join(f.root, ".sandcastle", "devsquad-ado"))).toEqual(
    expect.arrayContaining(["ledger.json", "records"]),
  );
});
