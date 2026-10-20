import { readFileSync } from "node:fs";
import { basename, extname } from "node:path";
import * as vscode from "vscode";
import { boardLabel, boardTitle, bootloaderFor } from "./boards";
import { Commander } from "./commander";
import { findProjects, output, Project } from "./projects";
import { buildEnvPath, findTools } from "./tools";
import { BoardItem, DevicesView } from "./devicesView";
import {
  Board,
  boardHintFromFilename,
  flashBaseForPart,
  imageCoversFlashBase,
  isErased,
  parseDeviceInfo,
  parseReadmem,
} from "./parse";

const hex = (n: number) => "0x" + n.toString(16).padStart(8, "0");

export class Actions {
  private readonly consoles = new Map<string, vscode.Terminal>();
  private readonly flashBases = new Map<string, number | null>();
  private readonly parts = new Map<string, string>();

  constructor(
    private readonly commander: Commander,
    private readonly view: DevicesView,
    private readonly log: vscode.OutputChannel,
    private readonly extensionPath: string,
    private readonly storageDir: string,
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
    const base = await this.flashBase(board);
    let bringsOwnBootloader = true;
    if (base !== undefined) {
      try {
        bringsOwnBootloader = imageCoversFlashBase(readFileSync(file, "utf8"), extname(file), base);
      } catch {
        // Unreadable as text: let Commander decide.
      }
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

  // ---- build / debug (Silicon Labs CMake projects) ----

  private async pickProject(purpose: string): Promise<Project | undefined> {
    const projects = await findProjects();
    if (projects.length === 0) {
      vscode.window.showWarningMessage(
        "No Silicon Labs CMake project in this folder (looking for cmake_gcc/CMakePresets.json). Generate the project for the VS Code or CMake target.",
      );
      return undefined;
    }
    if (projects.length === 1) {
      return projects[0];
    }
    const pick = await vscode.window.showQuickPick(
      projects.map((p) => ({ label: p.name, description: vscode.workspace.asRelativePath(p.root, false), p })),
      { placeHolder: purpose },
    );
    return pick?.p;
  }

  async build(): Promise<Project | undefined> {
    const project = await this.pickProject("Build which project?");
    if (!project) {
      return undefined;
    }
    return (await this.buildProject(project)) ? project : undefined;
  }

  /** Runs `cmake --workflow --preset <preset>` as a VS Code task, so errors show in Problems. */
  private async buildProject(project: Project): Promise<boolean> {
    const tools = await findTools(this.storageDir);
    if (!tools.cmake) {
      this.fail("CMake wasn't found. Install it with Silicon Labs' installer (slt install cmake ninja gcc-arm-none-eabi) or put it on PATH.");
      return false;
    }
    const task = new vscode.Task(
      { type: "commanderFlash", project: project.name },
      vscode.TaskScope.Workspace,
      `Build ${project.name}`,
      "Commander Flash",
      new vscode.ProcessExecution(tools.cmake, ["--workflow", "--preset", project.workflowPreset], {
        cwd: project.cmakeDir,
        env: { PATH: buildEnvPath(tools) },
      }),
      "$gcc",
    );
    task.group = vscode.TaskGroup.Build;
    task.presentationOptions = { reveal: vscode.TaskRevealKind.Always, clear: true };
    const execution = await vscode.tasks.executeTask(task);
    const code = await new Promise<number | undefined>((resolve) => {
      const sub = vscode.tasks.onDidEndTaskProcess((e) => {
        if (e.execution === execution) {
          sub.dispose();
          resolve(e.exitCode);
        }
      });
    });
    if (code === 0) {
      vscode.window.showInformationMessage(`Built ${project.name}.`);
      return true;
    }
    vscode.window.showErrorMessage(`Building ${project.name} failed. See the terminal and the Problems panel.`);
    return false;
  }

  async debug(item?: BoardItem): Promise<void> {
    const board = await this.pickBoard(item, "Debug on which board?");
    if (!board) {
      return;
    }
    const project = await this.pickProject(`Debug which project on ${boardTitle(board)}?`);
    if (!project) {
      return;
    }
    if (!vscode.extensions.getExtension("marus25.cortex-debug")) {
      const go = await vscode.window.showWarningMessage(
        "Debugging uses the Cortex-Debug extension, which isn't installed.",
        "Install Cortex-Debug",
      );
      if (go) {
        await vscode.commands.executeCommand("workbench.extensions.installExtension", "marus25.cortex-debug");
      }
      return;
    }
    const tools = await findTools(this.storageDir);
    if (!tools.jlinkGdbServer || !tools.gdb) {
      this.fail(
        `Missing debug tools: ${[!tools.jlinkGdbServer && "J-Link GDB server", !tools.gdb && "arm-none-eabi-gdb"].filter(Boolean).join(", ")}. Install them with Silicon Labs' installer (slt install exx32 gcc-arm-none-eabi).`,
      );
      return;
    }

    // Always build first, like Silicon Labs' extension does.
    if (!(await this.buildProject(project))) {
      return;
    }
    const elf = output(project, ".out");
    if (!elf) {
      this.fail(`Built ${project.name}, but no .out file was found in its build folder.`);
      return;
    }

    // An app needs a bootloader on the board; Cortex-Debug only loads the app itself.
    const base = await this.flashBase(board);
    const image = output(project, ".s37") ?? output(project, ".hex");
    if (base !== undefined && image) {
      let covers = true;
      try {
        covers = imageCoversFlashBase(readFileSync(image, "utf8"), extname(image), base);
      } catch {
        // keep going
      }
      if (!covers && (await this.bootloaderPresent(board)) === false) {
        const go = await vscode.window.showWarningMessage(
          `${boardTitle(board)} has no bootloader, so ${project.name} won't start under the debugger.`,
          { modal: true },
          "Install bootloader, then debug",
          "Debug anyway",
        );
        if (!go) {
          return;
        }
        if (go === "Install bootloader, then debug" && !(await this.installBootloaderOn(board))) {
          return;
        }
      }
    }

    const part = this.parts.get(board.serial);
    if (!part) {
      this.fail(`Couldn't read the chip on ${boardTitle(board)}.`);
      return;
    }
    const folder = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(project.root));
    await vscode.debug.startDebugging(folder, {
      name: `Debug ${project.name} on ${boardLabel(board)}`,
      type: "cortex-debug",
      request: "launch",
      servertype: "jlink",
      serverpath: tools.jlinkGdbServer,
      gdbPath: tools.gdb,
      device: part,
      interface: "swd",
      serialNumber: board.serial,
      executable: elf,
      cwd: project.root,
      runToEntryPoint: "main",
    });
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
      iconPath: new vscode.ThemeIcon("terminal", new vscode.ThemeColor("terminal.ansiGreen")),
    });
    this.consoles.set(board.serial, term);
    term.show();
  }

  /** Start of flash for this board's chip, from its part number. undefined = unknown part. */
  private async flashBase(board: Board): Promise<number | undefined> {
    if (!this.flashBases.has(board.serial)) {
      const r = await this.view.whileBusy(() =>
        this.commander.read(["device", "info", "--serialno", board.serial, "--json"], 60_000),
      );
      const part = r.code === 0 ? parseDeviceInfo(r.stdout) : undefined;
      const base = part ? flashBaseForPart(part) : undefined;
      if (part) {
        this.parts.set(board.serial, part);
        this.log.appendLine(`${part}: flash starts at ${base === undefined ? "unknown" : hex(base)}`);
        // Only cache a real answer; a failed read (board busy, unplugged) is retried next time.
        this.flashBases.set(board.serial, base ?? null);
      }
      return base;
    }
    return this.flashBases.get(board.serial) ?? undefined;
  }

  /** true = present, false = erased, undefined = couldn't read or unsupported part. */
  private async bootloaderPresent(board: Board): Promise<boolean | undefined> {
    const base = await this.flashBase(board);
    if (base === undefined) {
      return undefined;
    }
    const r = await this.view.whileBusy(() =>
      this.commander.read(["readmem", "--range", `${hex(base)}:+0x10`, "--serialno", board.serial], 60_000),
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
      this.fail(
        (await this.flashBase(board)) === undefined
          ? `Bootloader check isn't supported for the chip on ${boardTitle(board)}.`
          : `Couldn't read ${boardTitle(board)}.`,
      );
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
