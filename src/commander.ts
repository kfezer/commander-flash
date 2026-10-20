import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";
import * as vscode from "vscode";

export interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

/** Where Commander usually lives. Only the first macOS path is verified. */
function knownLocations(): string[] {
  const home = homedir();
  switch (process.platform) {
    case "darwin":
      return [
        join(home, ".silabs/slt/installs/archive/Commander.app/Contents/MacOS/commander"),
        "/Applications/Commander.app/Contents/MacOS/commander",
        "/Applications/Simplicity Commander.app/Contents/MacOS/commander",
      ];
    case "win32": {
      const local = process.env.LOCALAPPDATA ?? join(home, "AppData", "Local");
      return [
        join(home, ".silabs", "slt", "installs", "archive", "Commander", "commander.exe"),
        join(local, "SiliconLabs", "SimplicityCommander", "commander.exe"),
        "C:\\SiliconLabs\\SimplicityStudio\\v5\\developer\\adapter_packs\\commander\\commander.exe",
      ];
    }
    default:
      return [
        join(home, ".silabs/slt/installs/archive/commander/commander"),
        join(home, ".silabs/slt/installs/archive/commander-cli/commander-cli"),
        "/opt/commander/commander",
      ];
  }
}

function onPath(): string | undefined {
  const exe = process.platform === "win32" ? "commander.exe" : "commander";
  for (const dir of (process.env.PATH ?? "").split(delimiter)) {
    if (dir && existsSync(join(dir, exe))) {
      return join(dir, exe);
    }
  }
  return undefined;
}

export function locateCommander(): string | undefined {
  const configured = vscode.workspace.getConfiguration("commanderFlash").get<string>("path")?.trim();
  if (configured) {
    return existsSync(configured) ? configured : undefined;
  }
  return onPath() ?? knownLocations().find((p) => existsSync(p));
}

export class Commander {
  constructor(private readonly log: vscode.OutputChannel) {}

  get path(): string | undefined {
    return locateCommander();
  }

  run(args: string[], timeoutMs = 120_000): Promise<RunResult> {
    const exe = this.path;
    if (!exe) {
      return Promise.reject(new Error("Simplicity Commander wasn't found. Set commanderFlash.path."));
    }
    this.log.appendLine(`$ commander ${args.join(" ")}`);
    return new Promise((resolve) => {
      execFile(exe, args, { timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024 }, (err, stdout, stderr) => {
        const code = err ? (typeof (err as any).code === "number" ? (err as any).code : 1) : 0;
        if (stdout) {
          this.log.append(stdout.endsWith("\n") ? stdout : stdout + "\n");
        }
        if (stderr) {
          this.log.append(stderr.endsWith("\n") ? stderr : stderr + "\n");
        }
        if (err && (err as any).killed) {
          this.log.appendLine(`(timed out after ${timeoutMs / 1000}s)`);
        }
        resolve({ code, stdout, stderr });
      });
    });
  }
}
