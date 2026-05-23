import * as vscode from 'vscode';
import { WebviewPanelManager } from './WebviewPanelManager';

let panelManager: WebviewPanelManager | undefined;

export function activate(context: vscode.ExtensionContext) {
  panelManager = new WebviewPanelManager(context);

  context.subscriptions.push(
    vscode.commands.registerCommand('codegraph.open', () => {
      panelManager?.open();
    })
  );
}

export function deactivate() {
  panelManager?.dispose();
}
