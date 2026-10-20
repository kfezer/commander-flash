import * as vscode from "vscode";
import { boardLabel } from "./boards";
import { Commander } from "./commander";
import { Board, parseAdapterList } from "./parse";

export class BoardItem extends vscode.TreeItem {
  constructor(public readonly board: Board) {
    super(boardLabel(board), vscode.TreeItemCollapsibleState.None);
    this.description = `serial ${board.serial}`;
    this.tooltip = `${board.description}\nBoard ID ${board.boardId}\nSerial ${board.serial}`;
    this.contextValue = "board";
    this.iconPath = new vscode.ThemeIcon("circuit-board");
  }
}

export class DevicesView implements vscode.TreeDataProvider<BoardItem> {
  private readonly changed = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.changed.event;
  boards: Board[] = [];
  private busy = false;
  private lastKey = "";

  constructor(private readonly commander: Commander) {}

  getTreeItem(item: BoardItem): vscode.TreeItem {
    return item;
  }

  getChildren(): BoardItem[] {
    return this.boards.map((b) => new BoardItem(b));
  }

  /** Re-read the board list. `quiet` skips work while another refresh or a flash is running. */
  async refresh(quiet = false): Promise<void> {
    if (this.busy) {
      return;
    }
    this.busy = true;
    try {
      if (!this.commander.path) {
        this.boards = [];
        await this.setState("noCommander");
      } else {
        const r = await this.commander.read(["adapter", "list", "--json"], 30_000);
        try {
          this.boards = parseAdapterList(r.stdout);
        } catch {
          this.boards = [];
        }
        await this.setState(this.boards.length ? "ok" : "noBoards");
      }
      const key = this.boards.map((b) => b.serial).join(",");
      if (!quiet || key !== this.lastKey) {
        this.changed.fire();
      }
      this.lastKey = key;
    } finally {
      this.busy = false;
    }
  }

  /** Hold off background refreshes while Commander is talking to a board. */
  async whileBusy<T>(work: () => Promise<T>): Promise<T> {
    while (this.busy) {
      await new Promise((r) => setTimeout(r, 200));
    }
    this.busy = true;
    try {
      return await work();
    } finally {
      this.busy = false;
    }
  }

  private setState(state: string) {
    return vscode.commands.executeCommand("setContext", "commanderFlash.state", state);
  }
}
