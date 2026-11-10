import { execFile } from "node:child_process";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import {
  createOrchestrationAdoReadTransport,
  OrchestrationDiscoveryError,
  type OrchestrationDiscoveryTransport,
} from "./OrchestrationDiscovery.js";

const resource = "499b84ac-1321-427f-aa17-267ca6975798";
const refreshMarginMs = 60_000;
type AuthFailure =
  | "cli-unavailable"
  | "reauthentication-required"
  | "identity-mismatch"
  | "invalid-token"
  | "access-denied";
export class OrchestrationAzureCliAuthError extends OrchestrationDiscoveryError {
  constructor(readonly reason: AuthFailure) {
    super("access");
    this.message = `Azure CLI ADO authentication ${reason}; inspect the configured account outside the service; no automatic login or account switch`;
  }
}
type Execute = (args: string[], signal: AbortSignal) => Promise<string>;
const executeFile = (file: string, args: string[], signal: AbortSignal) =>
  new Promise<string>((resolve, reject) => {
    execFile(
      file,
      args,
      { signal, timeout: 15_000, maxBuffer: 128 * 1024, windowsHide: true },
      (error, stdout) =>
        error
          ? reject(
              new OrchestrationAzureCliAuthError("reauthentication-required"),
            )
          : resolve(stdout),
    );
  });
let windowsLauncher: { file: string; args: string[] } | undefined;
const executeAzureCli: Execute = async (args, signal) => {
  if (process.platform !== "win32") return executeFile("az", args, signal);
  if (!windowsLauncher) {
    try {
      const candidates = (
        await executeFile(
          path.join(
            process.env.SystemRoot ?? "C:\\Windows",
            "System32",
            "where.exe",
          ),
          ["az"],
          signal,
        )
      )
        .trim()
        .split(/\r?\n/);
      const launcher = candidates[0]!;
      if (!path.isAbsolute(launcher)) throw new Error("invalid launcher");
      if (path.extname(launcher).toLowerCase() === ".exe") {
        windowsLauncher = { file: launcher, args: [] };
      } else {
        const body = await readFile(launcher, "utf8");
        if (
          path.basename(launcher).toLowerCase() !== "az.cmd" ||
          !body.includes('"%~dp0\\..\\python.exe" -IBm azure.cli %*')
        )
          throw new Error("unsupported Azure CLI launcher");
        const python = path.resolve(path.dirname(launcher), "..", "python.exe");
        await access(python);
        windowsLauncher = { file: python, args: ["-IBm", "azure.cli"] };
      }
    } catch {
      signal.throwIfAborted();
      throw new OrchestrationAzureCliAuthError("cli-unavailable");
    }
  }
  return executeFile(
    windowsLauncher.file,
    [...windowsLauncher.args, ...args],
    signal,
  );
};
const accountSchema = z.object({
  id: z.uuid(),
  tenantId: z.uuid(),
  user: z.object({ name: z.string(), type: z.literal("user") }),
});
const tokenSchema = z.object({
  accessToken: z.string().min(1).max(64_000),
  tokenType: z.literal("Bearer"),
  expires_on: z.union([z.number(), z.string().regex(/^\d+$/)]),
});
const claimsSchema = z.object({
  aud: z.literal(resource),
  tid: z.uuid(),
  exp: z.number().int().positive(),
  upn: z.string().optional(),
  preferred_username: z.string().optional(),
  unique_name: z.string().optional(),
});

/** Existing host Azure CLI credentials only; never logs in or persists a token. */
export function createOrchestrationAzureCliReadTransport(
  options: { expectedIdentity: string },
  dependencies: {
    execute?: Execute;
    now?: () => number;
    transport?: (credential: {
      kind: "bearer";
      token: string;
    }) => OrchestrationDiscoveryTransport;
  } = {},
): OrchestrationDiscoveryTransport {
  const expected = z.email().parse(options.expectedIdentity).toLowerCase();
  const execute = dependencies.execute ?? executeAzureCli;
  const now = dependencies.now ?? Date.now;
  let cached: { token: string; expiresAt: number; account: string } | undefined;
  return async (request, signal) => {
    try {
      signal.throwIfAborted();
      const account = accountSchema.parse(
        JSON.parse(
          await execute(
            ["account", "show", "--output", "json", "--only-show-errors"],
            signal,
          ),
        ),
      );
      if (account.user.name.toLowerCase() !== expected)
        throw new OrchestrationAzureCliAuthError("identity-mismatch");
      const accountKey = `${account.tenantId.toLowerCase()}/${account.id.toLowerCase()}`;
      if (
        !cached ||
        cached.expiresAt <= now() + refreshMarginMs ||
        cached.account !== accountKey
      ) {
        cached = undefined;
        const raw = await execute(
          [
            "account",
            "get-access-token",
            "--resource",
            resource,
            "--tenant",
            account.tenantId,
            "--subscription",
            account.id,
            "--output",
            "json",
            "--only-show-errors",
          ],
          signal,
        );
        try {
          const token = tokenSchema.parse(JSON.parse(raw));
          const parts = token.accessToken.split(".");
          if (
            parts.length !== 3 ||
            parts.some((part) => !/^[A-Za-z0-9_-]+$/.test(part))
          )
            throw new Error("invalid token");
          const claims = claimsSchema.parse(
            JSON.parse(Buffer.from(parts[1]!, "base64url").toString("utf8")),
          );
          const identities = [
            claims.upn,
            claims.preferred_username,
            claims.unique_name,
          ].filter((value): value is string => value !== undefined);
          const expiresAt =
            Math.min(Number(token.expires_on), claims.exp) * 1000;
          if (
            !identities.length ||
            identities.some((value) => value.toLowerCase() !== expected) ||
            claims.tid.toLowerCase() !== account.tenantId.toLowerCase() ||
            !Number.isSafeInteger(expiresAt) ||
            expiresAt <= now() + refreshMarginMs
          )
            throw new Error("invalid token");
          cached = { token: token.accessToken, expiresAt, account: accountKey };
        } catch {
          throw new OrchestrationAzureCliAuthError("invalid-token");
        }
        // Detect an account change during token acquisition before using it.
        const current = accountSchema.parse(
          JSON.parse(
            await execute(
              ["account", "show", "--output", "json", "--only-show-errors"],
              signal,
            ),
          ),
        );
        if (
          current.user.name.toLowerCase() !== expected ||
          current.tenantId.toLowerCase() !== account.tenantId.toLowerCase() ||
          current.id.toLowerCase() !== account.id.toLowerCase()
        )
          throw new OrchestrationAzureCliAuthError("identity-mismatch");
      }
      signal.throwIfAborted();
      const response = await (
        dependencies.transport ?? createOrchestrationAdoReadTransport
      )({
        kind: "bearer",
        token: cached.token,
      })(request, signal);
      if ([401, 403].includes(response.status))
        throw new OrchestrationAzureCliAuthError("access-denied");
      return response;
    } catch (error) {
      cached = undefined;
      signal.throwIfAborted();
      if (error instanceof OrchestrationDiscoveryError) throw error;
      // Subprocess stdout/stderr, Zod input and fetch causes may contain secrets.
      throw new OrchestrationAzureCliAuthError("reauthentication-required");
    }
  };
}
