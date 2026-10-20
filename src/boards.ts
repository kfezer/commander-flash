import { existsSync } from "node:fs";
import { join } from "node:path";
import * as vscode from "vscode";
import { Board } from "./parse";

/** Friendlier names for boards whose connector is easy to mix up. */
const KNOWN: Record<string, string> = {
  "2601B": "EFR32xG24 Dev Kit · micro-USB",
  "2703A": "xG24 Explorer Kit · USB-C",
};

/** Bootloaders bundled with the extension, by board ID. */
const BUNDLED_BOOTLOADERS: Record<string, string> = {
  "2601B": "xg24-internal-single-1536k.s37",
  "2703A": "xg24-internal-single-1536k.s37",
};

export function boardLabel(b: Board): string {
  return KNOWN[b.boardId] ?? b.description;
}

export function boardTitle(b: Board): string {
  return `${boardLabel(b)} (${b.serial})`;
}

/** User setting first, then the bundled image. */
export function bootloaderFor(boardId: string, extensionPath: string): string | undefined {
  const user = vscode.workspace.getConfiguration("commanderFlash").get<Record<string, string>>("bootloaders") ?? {};
  const configured = user[boardId] ?? user[boardId.toLowerCase()];
  if (configured) {
    return configured;
  }
  const bundled = BUNDLED_BOOTLOADERS[boardId];
  if (bundled) {
    const p = join(extensionPath, "bootloaders", bundled);
    return existsSync(p) ? p : undefined;
  }
  return undefined;
}
