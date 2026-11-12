import { execFile } from "node:child_process";
import { z } from "zod";

const login = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/);
export const githubAccountAuthenticationSchema = z
  .strictObject({
    kind: z.literal("github-cli"),
    account: login,
    allowedAccounts: z
      .array(login)
      .min(1)
      .max(20)
      .refine(
        (accounts) =>
          new Set(accounts.map((account) => account.toLowerCase())).size ===
          accounts.length,
        "duplicate allowed GitHub account",
      ),
  })
  .refine(
    (authentication) =>
      authentication.allowedAccounts.some(
        (account) =>
          account.toLowerCase() === authentication.account.toLowerCase(),
      ),
    "selected GitHub account must be explicitly allowed",
  );
export type GithubAccountAuthentication = z.infer<
  typeof githubAccountAuthenticationSchema
>;
export class OrchestrationGithubAccountError extends Error {
  constructor(
    readonly reason:
      | "credential-unavailable"
      | "identity-unverified"
      | "identity-mismatch",
  ) {
    super(
      `Configured GitHub account ${reason}; inspect its existing sign-in and repository access. No account fallback or global switch performed.`,
    );
    this.name = "OrchestrationGithubAccountError";
  }
}
type Execute = (
  args: string[],
  environment: NodeJS.ProcessEnv,
  signal: AbortSignal,
) => Promise<string>;
const execute: Execute = (args, env, signal) =>
  new Promise((resolve, reject) => {
    execFile(
      "gh",
      args,
      { env, signal, timeout: 15000, maxBuffer: 65536, windowsHide: true },
      (error, stdout) =>
        error
          ? reject(
              new OrchestrationGithubAccountError("credential-unavailable"),
            )
          : resolve(stdout),
    );
  });

/** Selects an existing named credential without changing gh's global account. */
export function createGithubAccountEnvironment(
  input: GithubAccountAuthentication,
  run: Execute = execute,
) {
  const authentication = githubAccountAuthenticationSchema.parse(input);
  return async (signal: AbortSignal): Promise<NodeJS.ProcessEnv> => {
    const environment = { ...process.env };
    for (const key of [
      "GH_TOKEN",
      "GITHUB_TOKEN",
      "GH_ENTERPRISE_TOKEN",
      "GITHUB_ENTERPRISE_TOKEN",
      "GH_HOST",
    ])
      delete environment[key];
    let token: string;
    try {
      token = (
        await run(
          [
            "auth",
            "token",
            "--hostname",
            "github.com",
            "--user",
            authentication.account,
          ],
          environment,
          signal,
        )
      ).trim();
      if (!token || /\s/.test(token))
        throw new OrchestrationGithubAccountError("credential-unavailable");
    } catch {
      throw new OrchestrationGithubAccountError("credential-unavailable");
    }
    const selected = {
      ...environment,
      GH_HOST: "github.com",
      GH_TOKEN: token,
    };
    let identity: { login: string };
    try {
      identity = z
        .object({ login: z.string() })
        .parse(
          JSON.parse(
            await run(
              ["api", "--hostname", "github.com", "user"],
              selected,
              signal,
            ),
          ),
        );
    } catch {
      throw new OrchestrationGithubAccountError("identity-unverified");
    }
    if (identity.login.toLowerCase() !== authentication.account.toLowerCase())
      throw new OrchestrationGithubAccountError("identity-mismatch");
    return selected;
  };
}
