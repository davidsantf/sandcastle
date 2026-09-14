import { PhaseFault } from "./DevSquadAdoPhaseProtocol.js";

/** Retirement prevents new effects; it cannot prove an external effect stopped. */
export class PhaseLifecycle {
  readonly controller = new AbortController();
  private readonly started: number;
  private last: number;
  private calls = 0;
  private lease = Infinity;
  private leaseDeadline = Infinity;
  private lastUtc: number;
  constructor(
    private readonly timeout: number,
    private readonly outer: AbortSignal | undefined,
    readonly utcNow: () => number,
    private readonly monotonicNow: () => number,
  ) {
    this.started = this.last = monotonicNow();
    this.lastUtc = utcNow();
    if (!Number.isFinite(this.started) || !Number.isFinite(this.lastUtc))
      throw new PhaseFault("invalid-input");
    this.check();
  }
  setLease(expiresAt: string) {
    this.lease = Date.parse(expiresAt);
    if (!Number.isFinite(this.lease))
      throw new PhaseFault("authority-rejected");
    this.leaseDeadline = Math.min(
      this.leaseDeadline,
      this.last + this.lease - this.now(),
    );
    this.check();
  }
  now() {
    const utc = this.utcNow();
    if (!Number.isFinite(utc) || utc < this.lastUtc)
      throw new PhaseFault("deadline");
    this.lastUtc = utc;
    return utc;
  }
  check() {
    if (this.outer?.aborted || this.controller.signal.aborted)
      throw new PhaseFault("cancelled");
    const mono = this.monotonicNow();
    if (!Number.isFinite(mono) || mono < this.last)
      throw new PhaseFault("deadline");
    this.last = mono;
    const remaining = Math.min(
      this.timeout - (mono - this.started),
      this.lease - this.now(),
      this.leaseDeadline - mono,
    );
    if (remaining <= 0) throw new PhaseFault("deadline");
    return remaining;
  }
  async call<T>(effect: (signal: AbortSignal) => Promise<T>): Promise<T> {
    if (++this.calls > 256) throw new PhaseFault("call-limit");
    const remaining = this.check();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let onAbort: (() => void) | undefined;
    const retirement = new Promise<never>((_, reject) => {
      const retire = (reason: "deadline" | "cancelled") => {
        this.controller.abort();
        reject(new PhaseFault(reason));
      };
      timer = setTimeout(() => retire("deadline"), remaining);
      onAbort = () => retire("cancelled");
      this.outer?.addEventListener("abort", onAbort, { once: true });
    });
    try {
      this.check();
      const result = await Promise.race([
        effect(this.controller.signal),
        retirement,
      ]);
      this.check();
      return result;
    } catch (error) {
      this.controller.abort();
      throw error instanceof PhaseFault
        ? error
        : new PhaseFault("dependency-failed");
    } finally {
      if (timer !== undefined) clearTimeout(timer);
      if (onAbort) this.outer?.removeEventListener("abort", onAbort);
    }
  }
  close() {
    this.controller.abort();
  }
}
