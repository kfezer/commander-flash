import * as vscode from "vscode";
import { Actions } from "./actions";
import { Commander } from "./commander";
import { DevicesView } from "./devicesView";
import { installCommander } from "./installer";

export function activate(context: vscode.ExtensionContext) {
  const log = vscode.window.createOutputChannel("Commander");
  const commander = new Commander(log);
  const view = new DevicesView(commander);
  const actions = new Actions(commander, view, log, context.extensionPath, context.globalStorageUri.fsPath);

  context.subscriptions.push(
    log,
    vscode.window.registerTreeDataProvider("commanderFlash.devices", view),
    vscode.commands.registerCommand("commanderFlash.refresh", () => view.refresh()),
    vscode.commands.registerCommand("commanderFlash.flash", (item) => actions.flash(item)),
    vscode.commands.registerCommand("commanderFlash.flashFile", (uri) => actions.flashFile(uri)),
    vscode.commands.registerCommand("commanderFlash.console", (item) => actions.console(item)),
    vscode.commands.registerCommand("commanderFlash.build", () => actions.build()),
    vscode.commands.registerCommand("commanderFlash.debug", (item) => actions.debug(item)),
    vscode.commands.registerCommand("commanderFlash.checkBootloader", (item) => actions.checkBootloader(item)),
    vscode.commands.registerCommand("commanderFlash.installBootloader", (item) => actions.installBootloader(item)),
    vscode.commands.registerCommand("commanderFlash.erase", (item) => actions.erase(item)),
    vscode.commands.registerCommand("commanderFlash.setPath", async () => {
      const uris = await vscode.window.showOpenDialog({ canSelectMany: false, openLabel: "Use this Commander" });
      if (uris?.[0]) {
        await vscode.workspace
          .getConfiguration("commanderFlash")
          .update("path", uris[0].fsPath, vscode.ConfigurationTarget.Global);
        view.refresh();
      }
    }),
    vscode.commands.registerCommand("commanderFlash.installCommander", async () => {
      const go = await vscode.window.showInformationMessage(
        "Install Simplicity Commander?",
        {
          modal: true,
          detail:
            "This uses Silicon Labs' installer (slt) to download Commander (about 70 MB) into ~/.silabs/slt. " +
            "If slt isn't on this computer, it's downloaded from silabs.com first. Commander is Silicon Labs software, under their license terms.",
        },
        "Install",
      );
      if (go !== "Install") {
        return;
      }
      try {
        const exe = await vscode.window.withProgress(
          { location: vscode.ProgressLocation.Notification, title: "Installing Simplicity Commander…" },
          () => installCommander(context.globalStorageUri.fsPath, log),
        );
        await vscode.workspace
          .getConfiguration("commanderFlash")
          .update("path", exe, vscode.ConfigurationTarget.Global);
        vscode.window.showInformationMessage(`Simplicity Commander installed: ${exe}`);
        view.refresh();
      } catch (e: any) {
        const show = await vscode.window.showErrorMessage(String(e?.message ?? e), "Show output");
        if (show) {
          log.show(true);
        }
      }
    }),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("commanderFlash")) {
        startPolling();
        view.refresh();
      }
    }),
  );

  let timer: NodeJS.Timeout | undefined;
  const startPolling = () => {
    if (timer) {
      clearInterval(timer);
    }
    const secs = vscode.workspace.getConfiguration("commanderFlash").get<number>("autoRefreshSeconds") ?? 5;
    timer = secs > 0 ? setInterval(() => view.refresh(true), secs * 1000) : undefined;
  };
  startPolling();
  context.subscriptions.push({ dispose: () => timer && clearInterval(timer) });

  view.refresh();
}

export function deactivate() {}
