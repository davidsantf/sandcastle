import { z } from "zod";

/** Host configuration only; never inferred from issue text or worker output. */
export const copilotExecutionControlsSchema = z.strictObject({
  profile: z.literal("local-files"),
  maxAiCredits: z.number().int().min(30).max(10000),
  maxAutopilotContinues: z.number().int().min(0).max(100),
  timeoutMs: z.number().int().min(1000).max(3600000),
  disabledMcpServers: z
    .array(z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,199}$/))
    .max(200)
    .refine(
      (names) => new Set(names).size === names.length,
      "duplicate MCP name",
    ),
});
export type CopilotExecutionControls = z.infer<
  typeof copilotExecutionControlsSchema
>;

export function assertCopilotFileScopes(scopes: readonly string[]): void {
  if (
    !scopes.length ||
    scopes.some(
      (scope) =>
        !scope ||
        /[\u0000-\u001f():*?[\]{}]/.test(scope) ||
        scope
          .split(/[\\/]/)
          .some(
            (part) =>
              !part ||
              part === ".." ||
              part === "." ||
              part.toLowerCase() === ".git",
          ) ||
        /^[\\/]|^[A-Za-z]:/.test(scope),
    )
  )
    throw new Error(
      "local-files execution requires literal relative task scopes",
    );
}

export const copilotControlledFlags = [
  "--max-ai-credits",
  "--max-autopilot-continues",
  "--available-tools",
  "--allow-tool",
  "--deny-tool",
  "--disable-builtin-mcps",
  "--disable-mcp-server",
  "--no-custom-instructions",
  "--no-auto-update",
  "--no-ask-user",
  "--disallow-temp-dir",
  "--sync-session",
] as const;
