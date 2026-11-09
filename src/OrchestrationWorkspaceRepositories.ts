import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import type { WorkspaceConfiguration } from "./OrchestrationWorkspaceContract.js";

export function verifyWorkspaceRepositoryRoot(repositoryRoot: string): string {
  const canonical = fs.realpathSync.native(path.resolve(repositoryRoot));
  const root = execFileSync("git", ["rev-parse", "--show-toplevel"], {
    cwd: canonical,
    encoding: "utf8",
    timeout: 10_000,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  }).trim();
  const actual = fs.realpathSync.native(root);
  const normalize = (value: string) =>
    process.platform === "win32"
      ? path.resolve(value).toLowerCase()
      : path.resolve(value);
  if (normalize(actual) !== normalize(canonical))
    throw new Error("repository-root must be the exact Git checkout root");
  return canonical;
}

export function validateWorkspaceRepositories(
  configuration: WorkspaceConfiguration,
) {
  return configuration.projects.map((project) => {
    try {
      verifyWorkspaceRepositoryRoot(project.repositoryRoot);
      const remote = execFileSync("git", ["remote", "get-url", "origin"], {
        cwd: project.repositoryRoot,
        encoding: "utf8",
        timeout: 10_000,
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      }).trim();
      const expected =
        project.hub.kind === "github"
          ? `github.com/${project.hub.repository}`
          : `dev.azure.com/${project.hub.organization}/${project.hub.project}/_git/${project.hub.repository}`;
      const normalized = decodeURIComponent(remote)
        .replace(/^git@github\.com:/i, "github.com/")
        .replace(/^ssh:\/\/git@github\.com\//i, "github.com/")
        .replace(
          /^git@ssh\.dev\.azure\.com:v3\/([^/]+)\/([^/]+)\//i,
          "dev.azure.com/$1/$2/_git/",
        )
        .replace(
          /^ssh:\/\/git@ssh\.dev\.azure\.com\/v3\/([^/]+)\/([^/]+)\//i,
          "dev.azure.com/$1/$2/_git/",
        )
        .replace(/^https:\/\/(?:[^/@]+@)?/i, "")
        .replace(/^([^.]+)\.visualstudio\.com\//i, "dev.azure.com/$1/")
        .replace(/\.git\/?$/, "")
        .replace(/\/$/, "");
      if (normalized.toLowerCase() !== expected.toLowerCase())
        return {
          projectId: project.id,
          status: "blocked" as const,
          diagnostic:
            "origin does not match registered hub; execution is not ready",
        };
      return {
        projectId: project.id,
        status: "ready" as const,
        diagnostic:
          "Git root and origin match registration; no write or worker capability implied",
      };
    } catch (error) {
      return {
        projectId: project.id,
        status: "blocked" as const,
        diagnostic: error instanceof Error ? error.message : String(error),
      };
    }
  });
}
