// Installs Simplicity Commander with Silicon Labs' own installer CLI (slt):
//   slt install commander --non-interactive
//   slt where commander --json
// slt itself is downloaded from silabs.com if it isn't already on the machine.

import { execFile, spawn } from "node:child_process";
import { chmodSync, createWriteStream, existsSync, mkdirSync, readdirSync, readFileSync, statSync } from "node:fs";
import { get } from "node:https";
import { homedir } from "node:os";
import { join } from "node:path";
import * as vscode from "vscode";
import { parseSltWhere } from "./parse";

const SLT_VERSION = "1.2.1";
const EXE = process.platform === "win32" ? ".exe" : "";

function sltZipName(): string | undefined {
  if (process.platform === "darwin") {
    return `slt-cli-${SLT_VERSION}-mac-${process.arch === "arm64" ? "arm64" : "x64"}.zip`;
  }
  if (process.platform === "win32" && process.arch === "x64") {
    return `slt-cli-${SLT_VERSION}-windows-x64.zip`;
  }
  if (process.platform === "linux" && process.arch === "x64") {
    return `slt-cli-${SLT_VERSION}-linux-x64.zip`;
  }
  return undefined;
}

/** An slt that's already installed: the one other Silicon Labs tools registered, or the GUI installer's copy. */
export function existingSlt(storageDir: string): string | undefined {
  const candidates: string[] = [];
  try {
    candidates.push(readFileSync(join(homedir(), ".silabs", "slt", "slt.location"), "utf8").trim());
  } catch {
    // not registered
  }
  candidates.push(
    join(storageDir, "slt", `slt${EXE}`),
    "/Applications/SimplicityInstaller.app/Contents/Resources/slt",
    "/opt/SimplicityInstaller/resources/slt",
    join(process.env.LOCALAPPDATA ?? "", "Programs", "SimplicityInstaller", "resources", "slt.exe"),
  );
  return candidates.find((p) => p && existsSync(p) && statSync(p).isFile());
}

/**
 * silabs.com's download server rejects most HTTP clients (HTTP 403) but accepts curl, so use the
 * system curl (macOS, Windows 10+, most Linux) and fall back to Node's https only if it's missing.
 */
async function download(url: string, dest: string): Promise<void> {
  const curl = process.platform === "win32" ? "curl.exe" : "curl";
  const r = await exec(curl, ["-fsSL", "--retry", "2", "-o", dest, url]);
  if (r.code === 0) {
    return;
  }
  if ((r as any).missing) {
    return httpsDownload(url, dest);
  }
  throw new Error(`Download failed: ${url}\n${r.stderr.trim()}`);
}

function httpsDownload(url: string, dest: string, redirects = 5): Promise<void> {
  return new Promise((resolve, reject) => {
    get(url, (res) => {
      const status = res.statusCode ?? 0;
      if (status >= 300 && status < 400 && res.headers.location && redirects > 0) {
        res.resume();
        httpsDownload(new URL(res.headers.location, url).toString(), dest, redirects - 1).then(resolve, reject);
        return;
      }
      if (status !== 200) {
        res.resume();
        reject(new Error(`Download failed (HTTP ${status}): ${url}`));
        return;
      }
      const file = createWriteStream(dest);
      res.pipe(file);
      file.on("finish", () => file.close(() => resolve()));
      file.on("error", reject);
    }).on("error", reject);
  });
}

function exec(cmd: string, args: string[]): Promise<{ code: number; stdout: string; stderr: string; missing?: boolean }> {
  return new Promise((resolve) => {
    execFile(cmd, args, { maxBuffer: 16 * 1024 * 1024 }, (err, stdout, stderr) => {
      const missing = (err as any)?.code === "ENOENT";
      resolve({ code: err ? (typeof (err as any).code === "number" ? (err as any).code : 1) : 0, stdout, stderr, missing });
    });
  });
}

async function unzip(zip: string, dest: string): Promise<void> {
  mkdirSync(dest, { recursive: true });
  let r;
  if (process.platform === "darwin") {
    r = await exec("ditto", ["-x", "-k", zip, dest]);
  } else if (process.platform === "win32") {
    r = await exec("tar", ["-xf", zip, "-C", dest]);
  } else {
    r = await exec("unzip", ["-o", "-q", zip, "-d", dest]);
    if (r.code !== 0) {
      r = await exec("python3", ["-m", "zipfile", "-e", zip, dest]);
    }
  }
  if (r.code !== 0) {
    throw new Error(`Couldn't unzip ${zip}: ${r.stderr}`);
  }
}

/** Run slt, streaming its output to the log. */
function runSlt(slt: string, args: string[], log: vscode.OutputChannel): Promise<{ code: number; stdout: string }> {
  log.appendLine(`$ slt ${args.join(" ")}`);
  return new Promise((resolve) => {
    let stdout = "";
    const p = spawn(slt, args);
    p.stdout.on("data", (d) => {
      stdout += d;
      log.append(String(d));
    });
    p.stderr.on("data", (d) => log.append(String(d)));
    p.on("error", (e) => {
      log.appendLine(String(e));
      resolve({ code: 1, stdout });
    });
    p.on("close", (code) => resolve({ code: code ?? 1, stdout }));
  });
}

/** Turn what `slt where` returns (a folder, or a macOS .app) into the commander executable. */
export function findCommanderExecutable(installPath: string, depth = 3): string | undefined {
  if (!existsSync(installPath)) {
    return undefined;
  }
  if (installPath.endsWith(".app")) {
    const p = join(installPath, "Contents", "MacOS", "commander");
    return existsSync(p) ? p : undefined;
  }
  if (statSync(installPath).isFile()) {
    return installPath;
  }
  const names = [`commander${EXE}`, `commander-cli${EXE}`];
  const walk = (dir: string, left: number): string | undefined => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return undefined;
    }
    for (const e of entries) {
      if (e.isFile() && names.includes(e.name)) {
        return join(dir, e.name);
      }
    }
    for (const e of entries) {
      if (e.isDirectory() && left > 0) {
        const hit = e.name.endsWith(".app") ? findCommanderExecutable(join(dir, e.name)) : walk(join(dir, e.name), left - 1);
        if (hit) {
          return hit;
        }
      }
    }
    return undefined;
  };
  return walk(installPath, depth);
}

/** Download slt if needed, install Commander with it, and return the commander executable. */
export async function installCommander(storageDir: string, log: vscode.OutputChannel): Promise<string> {
  mkdirSync(storageDir, { recursive: true });
  let slt = existingSlt(storageDir);
  if (!slt) {
    const zipName = sltZipName();
    if (!zipName) {
      throw new Error(`No Silicon Labs installer (slt) download for ${process.platform}/${process.arch}. Install Simplicity Commander manually.`);
    }
    const url = `https://www.silabs.com/documents/public/software/${zipName}`;
    const zip = join(storageDir, zipName);
    log.appendLine(`Downloading ${url}`);
    await download(url, zip);
    await unzip(zip, join(storageDir, "slt"));
    slt = join(storageDir, "slt", `slt${EXE}`);
    if (!existsSync(slt)) {
      throw new Error(`slt wasn't in ${zipName}.`);
    }
    if (process.platform !== "win32") {
      chmodSync(slt, 0o755);
    }
  }
  log.appendLine(`Using slt: ${slt}`);

  const install = await runSlt(slt, ["install", "commander", "--non-interactive"], log);
  if (install.code !== 0) {
    throw new Error("slt couldn't install Commander. See the Commander output for details.");
  }
  const where = await runSlt(slt, ["where", "commander", "--json"], log);
  const installPath = parseSltWhere(where.stdout);
  const exe = installPath ? findCommanderExecutable(installPath) : undefined;
  if (!exe) {
    throw new Error(`Commander installed, but its executable wasn't found under ${installPath ?? "(unknown)"}.`);
  }
  if (process.platform !== "win32") {
    try {
      chmodSync(exe, 0o755);
    } catch {
      // read-only install: fine if it's already executable
    }
  }
  return exe;
}
