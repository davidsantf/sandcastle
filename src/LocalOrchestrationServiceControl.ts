import {
  createHmac,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  chmodSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import net from "node:net";
import path from "node:path";
import type { OrchestrationFocus } from "./OrchestrationFocus.js";
import type {
  LocalOrchestrationServiceHandle,
  LocalOrchestrationServiceStatus,
} from "./LocalOrchestrationService.js";
import { orchestrationServiceDigest } from "./OrchestrationOperations.js";

export type LocalOrchestrationControlCommand =
  | { action: "status" | "pause" | "resume" | "stop" }
  | { action: "focus"; focus: OrchestrationFocus };

function assertPrivate(filename: string): void {
  const stat = lstatSync(filename);
  if (stat.isSymbolicLink())
    throw new Error("control-path-must-not-be-a-symlink");
  if (process.platform !== "win32") {
    if (stat.uid !== process.getuid?.() || (stat.mode & 0o077) !== 0)
      throw new Error(
        "control-path-must-be-owner-only: use a private 0700 directory",
      );
    return;
  }
  // Read-only ACL inspection: never modify the host's permissions.
  const script = [
    "$ErrorActionPreference='Stop'",
    "$me=[System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value",
    "$acl=if([System.IO.Directory]::Exists($env:SANDCASTLE_CONTROL_PATH)){[System.IO.Directory]::GetAccessControl($env:SANDCASTLE_CONTROL_PATH)}else{[System.IO.File]::GetAccessControl($env:SANDCASTLE_CONTROL_PATH)}",
    "$owner=$acl.GetOwner([System.Security.Principal.SecurityIdentifier]).Value",
    "if($owner -ne $me){throw 'owner'}",
    "$allowed=@($me,'S-1-5-18','S-1-5-32-544')",
    "foreach($r in $acl.GetAccessRules($true,$true,[System.Security.Principal.SecurityIdentifier])){",
    "if($r.AccessControlType -eq 'Allow' -and ($r.PropagationFlags -band 2) -eq 0){",
    "$sid=$r.IdentityReference.Value",
    "if($allowed -notcontains $sid){throw 'broad-access'}",
    "}}",
    "'private'",
  ].join("; ");
  try {
    const result = execFileSync(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", script],
      {
        env: { ...process.env, SANDCASTLE_CONTROL_PATH: filename },
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        timeout: 10_000,
      },
    );
    if (result.trim() !== "private") throw new Error("ACL verification failed");
  } catch {
    throw new Error(
      "control-path-privacy-unverified: select a current-user-owned directory granting access only to that user, SYSTEM, and Administrators; no ACL changes attempted",
    );
  }
}

function controlFile(directory: string, workspaceId: string): string {
  if (!path.isAbsolute(directory) || directory.startsWith("\\\\"))
    throw new Error("control-directory-must-be-absolute-and-machine-local");
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  if (
    realpathSync(directory).toLowerCase() !==
    path.resolve(directory).toLowerCase()
  )
    throw new Error("control-directory-must-be-canonical");
  assertPrivate(directory);
  return path.join(
    directory,
    `${orchestrationServiceDigest(workspaceId)}.control.json`,
  );
}

const proof = (secret: string, value: string) =>
  createHmac("sha256", secret).update(value).digest("hex");
function equalProof(actual: unknown, expected: string): boolean {
  return (
    typeof actual === "string" &&
    /^[a-f0-9]{64}$/.test(actual) &&
    timingSafeEqual(Buffer.from(actual, "hex"), Buffer.from(expected, "hex"))
  );
}

function receive(socket: net.Socket, callback: (line: string) => void): void {
  let buffer = "";
  socket.setTimeout(5_000, () => socket.destroy(new Error("control-timeout")));
  socket.on("data", (chunk: Buffer) => {
    buffer += chunk.toString("utf8");
    if (Buffer.byteLength(buffer) > 65_536) {
      socket.destroy(new Error("control-message-too-large"));
      return;
    }
    let newline: number;
    while ((newline = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      callback(line);
    }
  });
}

export async function startLocalOrchestrationControlChannel(
  handle: LocalOrchestrationServiceHandle,
  options: { directory: string; workspaceId: string },
): Promise<{ close(): Promise<void> }> {
  const descriptor = controlFile(options.directory, options.workspaceId);
  const secret = randomBytes(32).toString("hex");
  const nonce = randomUUID();
  const temporary = path.join(options.directory, `${nonce}.tmp`);
  const endpoint =
    process.platform === "win32"
      ? `\\\\.\\pipe\\sandcastle-${nonce}`
      : path.join(options.directory, `${nonce}.sock`);
  const sockets = new Set<net.Socket>();
  const responses = new Set<Promise<void>>();
  const server = net.createServer((socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    socket.on("error", () => socket.destroy());
    const challenge = randomBytes(32).toString("hex");
    let consumed = false;
    socket.write(
      JSON.stringify({
        challenge,
        proof: proof(secret, `server:${challenge}`),
      }) + "\n",
    );
    receive(socket, (line) => {
      if (consumed) return socket.destroy();
      consumed = true;
      const response = respond(line);
      responses.add(response);
      void response.finally(() => responses.delete(response));
    });
    async function endResponse(body: string) {
      if (socket.destroyed) return;
      await new Promise<void>((resolve) => {
        socket.once("close", resolve);
        socket.end(
          JSON.stringify({
            body,
            proof: proof(secret, `response:${challenge}:${body}`),
          }) + "\n",
          () => {
            socket.removeListener("close", resolve);
            resolve();
          },
        );
      });
    }
    async function respond(line: string) {
      try {
        const request = JSON.parse(line);
        const command = JSON.stringify(request.command);
        if (
          !equalProof(
            request.proof,
            proof(secret, `client:${challenge}:${command}`),
          )
        )
          throw new Error("unauthorized");
        switch (request.command.action) {
          case "status":
            break;
          case "pause":
            handle.pause();
            break;
          case "resume":
            handle.resume();
            break;
          case "focus":
            handle.updateFocus(request.command.focus);
            break;
          case "stop":
            await handle.stop();
            break;
          default:
            throw new Error("invalid-control-action");
        }
        const body = JSON.stringify({ status: handle.status() });
        await endResponse(body);
      } catch {
        const body = JSON.stringify({
          error:
            "control-rejected: check scope, ownership, or canonical journal",
        });
        await endResponse(body);
      }
    }
  });
  server.maxConnections = 16;
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(endpoint, () => {
      server.removeListener("error", reject);
      resolve();
    });
  });
  try {
    if (process.platform !== "win32") chmodSync(endpoint, 0o600);
    if (lstatExists(descriptor)) assertPrivate(descriptor);
    writeFileSync(
      temporary,
      JSON.stringify({ endpoint, secret, ownerId: handle.status().ownerId }),
      {
        mode: 0o600,
        flag: "wx",
      },
    );
    assertPrivate(temporary);
    renameSync(temporary, descriptor);
  } catch (error) {
    server.close();
    if (lstatExists(temporary)) unlinkSync(temporary);
    throw error;
  }
  return {
    async close() {
      const closed = new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
      while (responses.size) await Promise.allSettled([...responses]);
      for (const socket of sockets) socket.destroy();
      await closed;
      if (lstatExists(descriptor)) {
        assertPrivate(descriptor);
        const current = JSON.parse(readFileSync(descriptor, "utf8"));
        if (current.ownerId === handle.status().ownerId) unlinkSync(descriptor);
      }
    },
  };
}

function lstatExists(filename: string): boolean {
  try {
    lstatSync(filename);
    return true;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT")
      return false;
    throw error;
  }
}

export async function sendLocalOrchestrationControl(
  options: { directory: string; workspaceId: string },
  command: LocalOrchestrationControlCommand,
): Promise<LocalOrchestrationServiceStatus> {
  const filename = controlFile(options.directory, options.workspaceId);
  assertPrivate(filename);
  const descriptor = JSON.parse(readFileSync(filename, "utf8"));
  if (
    typeof descriptor.secret !== "string" ||
    !/^[a-f0-9]{64}$/.test(descriptor.secret) ||
    typeof descriptor.endpoint !== "string" ||
    (process.platform === "win32"
      ? !/^\\\\\.\\pipe\\sandcastle-[a-f0-9-]+$/.test(descriptor.endpoint)
      : path.dirname(descriptor.endpoint) !== options.directory)
  )
    throw new Error("invalid-private-control-descriptor");
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(descriptor.endpoint);
    let authenticated = false;
    let challenge = "";
    socket.on("error", () =>
      reject(
        new Error(
          "control-unavailable: verify service status and private endpoint",
        ),
      ),
    );
    socket.on("end", () => reject(new Error("control-ended-without-response")));
    receive(socket, (line) => {
      try {
        const message = JSON.parse(line);
        if (!authenticated) {
          if (
            typeof message.challenge !== "string" ||
            !/^[a-f0-9]{64}$/.test(message.challenge) ||
            !equalProof(
              message.proof,
              proof(descriptor.secret, `server:${message.challenge}`),
            )
          )
            throw new Error("control-server-authentication-failed");
          challenge = message.challenge;
          authenticated = true;
          socket.write(
            JSON.stringify({
              command,
              proof: proof(
                descriptor.secret,
                `client:${challenge}:${JSON.stringify(command)}`,
              ),
            }) + "\n",
          );
          return;
        }
        if (
          typeof message.body !== "string" ||
          !equalProof(
            message.proof,
            proof(descriptor.secret, `response:${challenge}:${message.body}`),
          )
        )
          throw new Error("control-response-authentication-failed");
        const response = JSON.parse(message.body);
        if (response.error) throw new Error(response.error);
        resolve(response.status);
        socket.end();
      } catch (error) {
        reject(error);
        socket.destroy();
      }
    });
  });
}

export function createLocalOrchestrationStartupArtifact(options: {
  platform?: NodeJS.Platform;
  executable: string;
  args: string[];
  workingDirectory: string;
}): { filename: string; content: string; diagnostic: string } {
  if (
    !path.isAbsolute(options.executable) ||
    !path.isAbsolute(options.workingDirectory) ||
    [options.executable, options.workingDirectory, ...options.args].some(
      (value) => /[\r\n\0]/.test(value),
    )
  )
    throw new Error(
      "startup-requires-absolute-paths-and-single-line-arguments",
    );
  const platform = options.platform ?? process.platform;
  const xml = (value: string) =>
    value
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");
  if (platform === "win32") {
    const quote = (value: string) =>
      `"${value.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/, "$1$1")}"`;
    return {
      filename: "sandcastle-orchestration.xml",
      content: `<?xml version="1.0" encoding="UTF-8"?>\n<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task"><Triggers><LogonTrigger><Enabled>true</Enabled></LogonTrigger></Triggers><Principals><Principal id="CurrentUser"><LogonType>InteractiveToken</LogonType><RunLevel>LeastPrivilege</RunLevel></Principal></Principals><Settings><MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy><ExecutionTimeLimit>PT0S</ExecutionTimeLimit></Settings><Actions Context="CurrentUser"><Exec><Command>${xml(options.executable)}</Command><Arguments>${xml(options.args.map(quote).join(" "))}</Arguments><WorkingDirectory>${xml(options.workingDirectory)}</WorkingDirectory></Exec></Actions></Task>\n`,
      diagnostic:
        "Preview only. Review and register in Task Scheduler for the current user without elevation; nothing was installed.",
    };
  }
  if (platform === "linux") {
    const quote = (value: string) =>
      `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"').replaceAll("%", "%%").replaceAll("$", "$$")}"`;
    return {
      filename: "sandcastle-orchestration.service",
      content: `[Unit]\nDescription=Sandcastle user orchestration\n[Service]\nType=simple\nWorkingDirectory=${quote(options.workingDirectory)}\nExecStart=${[options.executable, ...options.args].map(quote).join(" ")}\nRestart=on-failure\n[Install]\nWantedBy=default.target\n`,
      diagnostic:
        "Preview only. Review before installing as a systemd user unit; no startup registration was performed.",
    };
  }
  if (platform === "darwin") {
    return {
      filename: "dev.sandcastle.orchestration.plist",
      content: `<?xml version="1.0" encoding="UTF-8"?>\n<plist version="1.0"><dict><key>Label</key><string>dev.sandcastle.orchestration</string><key>ProgramArguments</key><array>${[options.executable, ...options.args].map((arg) => `<string>${xml(arg)}</string>`).join("")}</array><key>WorkingDirectory</key><string>${xml(options.workingDirectory)}</string><key>RunAtLoad</key><true/></dict></plist>\n`,
      diagnostic:
        "Preview only. Review before installing as a current-user LaunchAgent; nothing was registered.",
    };
  }
  throw new Error(
    `startup-platform-unsupported: ${platform}; launch the service explicitly`,
  );
}
