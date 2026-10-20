import { readFileSync } from "node:fs";
import { basename, extname } from "node:path";
import * as vscode from "vscode";
import { boardLabel, boardTitle, bootloaderFor } from "./boards";
import { Commander } from "./commander";
import { BoardItem, DevicesView } from "./devicesView";
import { Board, boardHintFromFilename, imageCoversFlashBase, isErased, parseReadmem } from "./parse";

const FLASH_BASE = "0x08000000";

export class Actions {
  private readonly consoles = new Map<string, vscode.Terminal>();

  constructor(
    private readonly commander: Commander,
    private readonly view: DevicesView,
    private readonly log: vscode.OutputChannel,
    private readonly extensionPath: string,
  ) {
    vscode.window.onDidCloseTerminal((t) => {
      for (const [serial, term] of this.consoles) {
        if (term === t) {
          this.consoles.delete(serial);
        }
      }
    });
  }

  // ---- board / file selection ----

  private async pickBoard(item?: BoardItem, purpose = "Choose a board"): Promise<Board | undefined> {
    if (item?.board) {
      return item.board;
    }
    await this.view.refresh(true);
    const boards = this.view.boards;
    if (boards.length === 0) {
      vscode.window.showWarningMessage("No boards connected. Plug one in with a USB data cable.");
      return undefined;
    }
    if (boards.length === 1) {
      return boards[0];
    }
    const pick = await vscode.window.showQuickPick(
      boards.map((b) => ({ label: boardLabel(b), description: `serial ${b.serial}`, board: b })),
      { placeHolder: purpose },
    );
    return pick?.board;
  }

  private async pickFile(board: Board): Promise<string | undefined> {
    const files = await vscode.workspace.findFiles(
      "**/*.{hex,s37,HEX,S37}",
      "{**/node_modules/**,**/autogen/**,**/.git/**}",
      500,
    );
    const hint = (f: vscode.Uri) => boardHintFromFilename(basename(f.fsPath));
    // Files named for this board first, then unnamed, then files named for other boards.
    const rank = (f: vscode.Uri) => (hint(f) === board.boardId ? 0 : hint(f) ? 2 : 1);
    files.sort((a, b) => rank(a) - rank(b) || a.fsPath.localeCompare(b.fsPath));
    const browse = { label: "$(folder-opened) Browse…", path: "" };
    const items = [
      ...files.map((f) => ({
        label: basename(f.fsPath),
        description: vscode.workspace.asRelativePath(f, false),
        detail: hint(f) && hint(f) !== board.boardId ? `Named for board ${hint(f)}, not this one` : undefined,
        path: f.fsPath,
      })),
      browse,
    ];
    const pick = await vscode.window.showQuickPick(items, {
      placeHolder: `File to flash onto ${boardTitle(board)}`,
      matchOnDescription: true,
    });
    if (!pick) {
      return undefined;
    }
    if (pick === browse) {
      const uris = await vscode.window.showOpenDialog({
        canSelectMany: false,
        filters: { Firmware: ["hex", "s37"] },
        openLabel: "Flash",
      });
      return uris?.[0]?.fsPath;
    }
    return pick.path;
  }

  // ---- commands ----

  async flash(item?: BoardItem): Promise<void> {
    const board = await this.pickBoard(item, "Choose the board to flash");
    if (!board) {
      return;
    }
    const file = await this.pickFile(board);
    if (file) {
      await this.flashChecked(board, file);
    }
  }

  async flashFile(uri?: vscode.Uri): Promise<void> {
    const file = uri?.fsPath;
    if (!file) {
      return this.flash();
    }
    const board = await this.pickBoard(undefined, `Flash ${basename(file)} onto which board?`);
    if (board) {
      await this.flashChecked(board, file);
    }
  }

  private async flashChecked(board: Board, file: string): Promise<void> {
    const name = basename(file);

    // Swap guard: the filename names a different board.
    const hint = boardHintFromFilename(name);
    if (hint && hint !== board.boardId) {
      const go = await vscode.window.showWarningMessage(
        `${name} looks like it's for board ${hint}, but you picked ${boardTitle(board)} (board ${board.boardId}).`,
        { modal: true },
        "Flash anyway",
      );
      if (go !== "Flash anyway") {
        return;
      }
    }

    // Bootloader guard: an app-only image onto a board with no bootloader won't start.
    let bringsOwnBootloader = true;
    try {
      bringsOwnBootloader = imageCoversFlashBase(readFileSync(file, "utf8"), extname(file));
    } catch {
      // Unreadable as text: let Commander decide.
    }
    if (!bringsOwnBootloader) {
      const present = await this.bootloaderPresent(board);
      if (present === false) {
        const choice = await vscode.window.showWarningMessage(
          `${boardTitle(board)} has no bootloader, and ${name} doesn't include one. Without it the app won't start.`,
          { modal: true },
          "Install bootloader, then flash",
          "Flash anyway",
        );
        if (!choice) {
          return;
        }
        if (choice === "Install bootloader, then flash") {
          if (!(await this.installBootloaderOn(board))) {
            return;
          }
        }
      }
    }

    await this.flashRaw(board, file);
  }

  private async flashRaw(board: Board, file: string): Promise<boolean> {
    const name = basename(file);
    const r = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: `Flashing ${name} → ${boardTitle(board)}` },
      () => this.view.whileBusy(() => this.commander.run(["flash", file, "--serialno", board.serial], 300_000)),
    );
    if (r.code === 0) {
      vscode.window.showInformationMessage(`Flashed ${name} to ${boardTitle(board)}.`);
      return true;
    }
    this.fail(`Flashing ${name} failed.`);
    return false;
  }

  async console(item?: BoardItem): Promise<void> {
    const board = await this.pickBoard(item, "Open the console of which board?");
    const exe = this.commander.path;
    if (!board || !exe) {
      return;
    }
    const existing = this.consoles.get(board.serial);
    if (existing) {
      existing.show();
      return;
    }
    const term = vscode.window.createTerminal({
      name: `Console · ${boardLabel(board)} (${board.serial})`,
      shellPath: exe,
      shellArgs: ["vcom", "connect", "--serialno", board.serial],
      iconPath: new vscode.ThemeIcon("terminal"),
    });
    this.consoles.set(board.serial, term);
    term.show();
  }

  /** true = present, false = erased, undefined = couldn't read. */
  private async bootloaderPresent(board: Board): Promise<boolean | undefined> {
    const r = await this.view.whileBusy(() =>
      this.commander.run(["readmem", "--range", `${FLASH_BASE}:+0x10`, "--serialno", board.serial], 60_000),
    );
    const bytes = parseReadmem(r.stdout);
    if (r.code !== 0 || bytes.length === 0) {
      return undefined;
    }
    return !isErased(bytes);
  }

  async checkBootloader(item?: BoardItem): Promise<void> {
    const board = await this.pickBoard(item, "Check the bootloader on which board?");
    if (!board) {
      return;
    }
    const present = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: `Checking ${boardTitle(board)}…` },
      () => this.bootloaderPresent(board),
    );
    if (present === undefined) {
      this.fail(`Couldn't read ${boardTitle(board)}.`);
    } else if (present) {
      vscode.window.showInformationMessage(`${boardTitle(board)}: bootloader present.`);
    } else {
      const go = await vscode.window.showWarningMessage(
        `${boardTitle(board)}: no bootloader. Apps that expect one won't start.`,
        "Install bootloader",
      );
      if (go) {
        await this.installBootloaderOn(board);
      }
    }
  }

  async installBootloader(item?: BoardItem): Promise<void> {
    const board = await this.pickBoard(item, "Install a bootloader on which board?");
    if (board) {
      await this.installBootloaderOn(board);
    }
  }

  private async installBootloaderOn(board: Board): Promise<boolean> {
    let image = bootloaderFor(board.boardId, this.extensionPath);
    if (!image) {
      const choice = await vscode.window.showWarningMessage(
        `No bootloader is bundled for board ${board.boardId}. Build one for your part, or point to a file.`,
        "Choose a bootloader file…",
      );
      if (!choice) {
        return false;
      }
      const uris = await vscode.window.showOpenDialog({
        canSelectMany: false,
        filters: { Firmware: ["hex", "s37"] },
        openLabel: "Install bootloader",
      });
      image = uris?.[0]?.fsPath;
      if (!image) {
        return false;
      }
    }
    return this.flashRaw(board, image);
  }

  async erase(item?: BoardItem): Promise<void> {
    const board = await this.pickBoard(item, "Erase which board?");
    if (!board) {
      return;
    }
    const go = await vscode.window.showWarningMessage(
      `Erase all of ${boardTitle(board)}?`,
      { modal: true, detail: "This removes everything on the chip, including the bootloader." },
      "Erase",
    );
    if (go !== "Erase") {
      return;
    }
    const r = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: `Erasing ${boardTitle(board)}…` },
      () => this.view.whileBusy(() => this.commander.run(["device", "masserase", "--serialno", board.serial], 120_000)),
    );
    if (r.code === 0) {
      vscode.window.showInformationMessage(`Erased ${boardTitle(board)}.`);
    } else {
      this.fail(`Erasing ${boardTitle(board)} failed.`);
    }
  }

  private async fail(message: string) {
    const show = await vscode.window.showErrorMessage(message, "Show output");
    if (show) {
      this.log.show(true);
    }
  }
}
