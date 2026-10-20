// Build/debug tools that Silicon Labs' installer (slt) manages: cmake, ninja, the Arm GCC
// toolchain (with gdb), and exx32 (SEGGER J-Link GDB server). Found with `slt where <pkg> --json`.

import { execFile } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { delimiter, dirname, join } from "node:path";
import { existingSlt } from "./installer";
import { parseSltWhere } from "./parse";

const EXE = process.platform === "win32" ? ".exe" : "";

export interface Toolset {
  slt?: string;
  cmake?: string;
  ninjaDir?: string;
  gccBin?: string;
  gdb?: string;
  jlinkGdbServer?: string;
}

function where(slt: string, pkg: string): Promise<string | undefined> {
  return new Promise((resolve) => {
    execFile(slt, ["where", pkg, "--json"], { timeout: 60_000 }, (err, stdout) => {
      resolve(err ? undefined : parseSltWhere(stdout));
    });
  });
}

function firstExisting(...paths: (string | undefined)[]): string | undefined {
  return paths.find((p) => p && existsSync(p));
}

function onPath(name: string): string | undefined {
  for (const dir of (process.env.PATH ?? "").split(delimiter)) {
    const p = dir && join(dir, name + EXE);
    if (p && existsSync(p)) {
      return p;
    }
  }
  return undefined;
}

let cached: Toolset | undefined;

/** Locate the tools once per session (slt calls take a moment). */
export async function findTools(storageDir: string, refresh = false): Promise<Toolset> {
  if (cached && !refresh) {
    return cached;
  }
  const slt = existingSlt(storageDir);
  const t: Toolset = { slt };
  if (slt) {
    const [cmake, ninja, gcc, exx32] = await Promise.all(
      ["cmake", "ninja", "gcc-arm-none-eabi", "exx32"].map((p) => where(slt, p)),
    );
    t.cmake = firstExisting(
      cmake && join(cmake, "bin", "cmake" + EXE),
      cmake && join(cmake, "CMake.app", "Contents", "bin", "cmake"), // macOS package layout
      cmake && join(cmake, "cmake" + EXE),
    );
    t.ninjaDir = ninja && existsSync(join(ninja, "ninja" + EXE)) ? ninja : undefined;
    t.gccBin = gcc && existsSync(join(gcc, "bin")) ? join(gcc, "bin") : undefined;
    // Prefer the toolchain's gdb: exx32's `arm-none-eabi-gdb` on macOS is a wrapper script
    // that passes `$@` unquoted, which breaks arguments containing spaces.
    t.gdb = firstExisting(
      t.gccBin && join(t.gccBin, "arm-none-eabi-gdb" + EXE),
      exx32 && join(exx32, "arm-none-eabi-mac-gdb"),
      exx32 && join(exx32, "arm-none-eabi-gdb" + EXE),
    );
    t.jlinkGdbServer = firstExisting(
      exx32 && join(exx32, "JLinkGDBServerCLExe" + EXE),
      exx32 && join(exx32, "JLinkGDBServerCL" + EXE),
    );
  }
  t.cmake ??= onPath("cmake");
  t.gdb ??= onPath("arm-none-eabi-gdb");
  t.jlinkGdbServer ??= onPath(process.platform === "win32" ? "JLinkGDBServerCL" : "JLinkGDBServerCLExe");
  if (!t.jlinkGdbServer && process.platform === "darwin" && existsSync("/Applications/SEGGER")) {
    const dirs = readdirSync("/Applications/SEGGER").filter((d) => d.startsWith("JLink")).sort().reverse();
    t.jlinkGdbServer = firstExisting(...dirs.map((d) => join("/Applications/SEGGER", d, "JLinkGDBServerCLExe")));
  }
  cached = t;
  return t;
}

/** PATH for builds: the generated toolchain file calls `slt where`, and CMake needs ninja. */
export function buildEnvPath(t: Toolset): string {
  const extra = [t.slt && dirname(t.slt), t.ninjaDir, t.gccBin, t.cmake && dirname(t.cmake)].filter(
    (p): p is string => !!p,
  );
  return [...extra, process.env.PATH ?? ""].join(delimiter);
}
