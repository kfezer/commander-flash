import { execFile } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";
import * as vscode from "vscode";
import { findCommanderExecutable } from "./installer";

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

/** Anything Silicon Labs' installer (slt) put in ~/.silabs/slt/installs/archive, on any OS. */
function sltInstalled(): string | undefined {
  const archive = join(homedir(), ".silabs", "slt", "installs", "archive");
  let entries: string[];
  try {
    entries = readdirSync(archive).filter((e) => /^commander/i.test(e) && !/\.zip$/i.test(e));
  } catch {
    return undefined;
  }
  // Newest-looking first (e.g. "Commander.app", "commander", "commander-cli").
  for (const e of entries.sort().reverse()) {
    const exe = findCommanderExecutable(join(archive, e), 2);
    if (exe) {
      return exe;
    }
  }
  return undefined;
}

export function locateCommander(): string | undefined {
  const configured = vscode.workspace.getConfiguration("commanderFlash").get<string>("path")?.trim();
  if (configured) {
    return existsSync(configured) ? configured : undefined;
  }
  return onPath() ?? knownLocations().find((p) => existsSync(p)) ?? sltInstalled();
}

export class Commander {
  constructor(private readonly log: vscode.OutputChannel) {}

  get path(): string | undefined {
    return locateCommander();
  }

  /**
   * For read-only commands (adapter list, device info, readmem): retry once after a short
   * pause. The J-Link can be briefly busy, e.g. when another Silicon Labs tool polls it.
   */
  async read(args: string[], timeoutMs = 60_000): Promise<RunResult> {
    const first = await this.run(args, timeoutMs);
    if (first.code === 0 || first.code === -1) {
      return first;
    }
    await new Promise((r) => setTimeout(r, 1500));
    this.log.appendLine("(retrying)");
    return this.run(args, timeoutMs);
  }

  run(args: string[], timeoutMs = 120_000): Promise<RunResult> {
    const exe = this.path;
    if (!exe) {
      vscode.window
        .showWarningMessage("Simplicity Commander wasn't found.", "Install Commander", "Set Commander Path…")
        .then((c) => {
          if (c === "Install Commander") {
            vscode.commands.executeCommand("commanderFlash.installCommander");
          } else if (c) {
            vscode.commands.executeCommand("commanderFlash.setPath");
          }
        });
      return Promise.resolve({ code: -1, stdout: "", stderr: "Commander not found" });
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
