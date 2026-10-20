// Silicon Labs projects generated for CMake / VS Code: a folder with `cmake_gcc/CMakePresets.json`.
// Build = `cmake --workflow --preset project`; outputs land in `cmake_gcc/build/<configuration>/`.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import * as vscode from "vscode";

export interface Project {
  name: string;
  root: string;
  cmakeDir: string;
  workflowPreset: string;
  configuration: string;
}

export function readProject(presetsPath: string): Project | undefined {
  try {
    const presets = JSON.parse(readFileSync(presetsPath, "utf8"));
    const cmakeDir = dirname(presetsPath);
    const root = dirname(cmakeDir);
    const workflow = presets.workflowPresets?.[0]?.name ?? "project";
    const configuration =
      presets.buildPresets?.[0]?.configuration ??
      String(presets.configurePresets?.[0]?.cacheVariables?.CMAKE_CONFIGURATION_TYPES ?? "base").split(";")[0];
    return { name: basename(root), root, cmakeDir, workflowPreset: workflow, configuration };
  } catch {
    return undefined;
  }
}

export async function findProjects(): Promise<Project[]> {
  const files = await vscode.workspace.findFiles("**/cmake_gcc/CMakePresets.json", "**/node_modules/**", 50);
  return files
    .map((f) => readProject(f.fsPath))
    .filter((p): p is Project => !!p)
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function outputDir(p: Project): string {
  return join(p.cmakeDir, "build", p.configuration);
}

/** The newest file with this extension in the project's build output. */
export function output(p: Project, ext: string): string | undefined {
  const dir = outputDir(p);
  if (!existsSync(dir)) {
    return undefined;
  }
  const hit = readdirSync(dir).find((f) => f.toLowerCase().endsWith(ext) && f.startsWith(p.name));
  const any = hit ?? readdirSync(dir).find((f) => f.toLowerCase().endsWith(ext));
  return any ? join(dir, any) : undefined;
}
