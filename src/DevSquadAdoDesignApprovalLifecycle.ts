import type { DevSquadAdoDesignApprovalResult } from "./DevSquadAdoDesignApproval.js";

// W050 / SEC-002,006: every enabled effect starts with retirement and deadline guards.
export class GateFault extends Error {
  constructor(readonly reason: DevSquadAdoDesignApprovalResult["reason"]) {
    super(reason);
  }
}
const limits = {
  read: 4,
  checkpoint: 3,
  mutation: 3,
  design: 1,
  publisher: 1,
  publication: 1,
  page: 8,
  human: 128,
  target: 1,
} as const;
const deadlines = {
  read: 5000,
  checkpoint: 5000,
  mutation: 1000,
  design: 5000,
  publisher: 10000,
  publication: 5000,
  page: 5000,
  human: 1000,
  target: 5000,
} as const;
type Call = keyof typeof limits;
export class GateLifecycle {
  private readonly started: number;
  private latest: number;
  private retired = false;
  private readonly calls = new Map<Call, number>();
  constructor(
    private readonly signal: AbortSignal | undefined,
    private readonly monotonic: () => number,
  ) {
    if (
      typeof monotonic !== "function" ||
      (signal !== undefined &&
        (typeof signal.aborted !== "boolean" ||
          typeof signal.addEventListener !== "function" ||
          typeof signal.removeEventListener !== "function"))
    )
      throw new GateFault("invalid-input");
    this.started = this.latest = monotonic();
    this.check();
  }
  check(): number {
    if (this.signal?.aborted) {
      this.retired = true;
      throw new GateFault("cancelled");
    }
    const now = this.monotonic();
    if (!Number.isFinite(now) || now < this.latest)
      throw new GateFault("invalid-input");
    this.latest = now;
    if (this.retired || now - this.started >= 180000) {
      this.retired = true;
      throw new GateFault("dependency-timeout");
    }
    return 180000 - (now - this.started);
  }
  async call<T>(
    kind: Call,
    invoke: (signal: AbortSignal) => Promise<T>,
  ): Promise<T> {
    const remaining = this.check();
    const count = (this.calls.get(kind) ?? 0) + 1;
    if (count > limits[kind]) throw new GateFault("dependency-limit");
    this.calls.set(kind, count);
    const controller = new AbortController();
    const value = await new Promise<T>((resolve, reject) => {
      let active = true;
      const cleanup = () => {
        clearTimeout(timer);
        this.signal?.removeEventListener("abort", abort);
      };
      const fail = (reason: DevSquadAdoDesignApprovalResult["reason"]) => {
        if (!active) return;
        active = false;
        this.retired = true;
        cleanup();
        controller.abort();
        reject(new GateFault(reason));
      };
      const abort = () => fail("cancelled");
      const timer = setTimeout(
        () => fail("dependency-timeout"),
        Math.min(remaining, deadlines[kind]),
      );
      this.signal?.addEventListener("abort", abort, { once: true });
      if (this.signal?.aborted) {
        abort();
        return;
      }
      try {
        Promise.resolve(invoke(controller.signal)).then(
          (result) => {
            if (!active) return;
            active = false;
            cleanup();
            resolve(result);
          },
          () => fail("evidence-unavailable"),
        );
      } catch {
        fail("evidence-unavailable");
      }
    });
    this.check();
    return value;
  }
}
