import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { ExtensionToWebviewMessage, WebviewToExtensionMessage } from '../shared/types';

export class WebviewPanelManager {
  private panel: vscode.WebviewPanel | undefined;
  private readonly context: vscode.ExtensionContext;

  constructor(context: vscode.ExtensionContext) {
    this.context = context;
  }

  open() {
    if (this.panel) {
      this.panel.reveal();
      return;
    }

    this.panel = vscode.window.createWebviewPanel(
      'codegraph',
      'CodeGraph',
      vscode.ViewColumn.Beside,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [
          vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'webview'),
        ],
      }
    );

    this.panel.webview.html = this.buildHtml();

    this.panel.webview.onDidReceiveMessage(
      (msg: WebviewToExtensionMessage) => this.handleMessage(msg),
      undefined,
      this.context.subscriptions
    );

    this.panel.onDidDispose(() => {
      this.panel = undefined;
    });
  }

  post(message: ExtensionToWebviewMessage) {
    this.panel?.webview.postMessage(message);
  }

  dispose() {
    this.panel?.dispose();
  }

  private handleMessage(msg: WebviewToExtensionMessage) {
    switch (msg.type) {
      case 'READY':
        this.post({ type: 'PROGRESS', payload: { stage: 'Connected', percent: 0 } });
        break;
      case 'OPEN_FILE': {
        const uri = vscode.Uri.parse(msg.payload.uri);
        const { start } = msg.payload.range;
        const pos = new vscode.Position(start.line, start.character);
        vscode.window.showTextDocument(uri, { selection: new vscode.Range(pos, pos) });
        break;
      }
    }
  }

  private buildHtml(): string {
    const webview = this.panel!.webview;
    const distDir = vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'webview');

    const isDev =
      this.context.extensionMode === vscode.ExtensionMode.Development &&
      this.isViteDevServerRunning();

    if (isDev) {
      return this.buildDevHtml();
    }

    const jsUri = webview.asWebviewUri(vscode.Uri.joinPath(distDir, 'main.js'));
    const cssPath = vscode.Uri.joinPath(distDir, 'main.css').fsPath;
    const hasCss = fs.existsSync(cssPath);
    const cssUri = hasCss
      ? webview.asWebviewUri(vscode.Uri.joinPath(distDir, 'main.css'))
      : undefined;

    const nonce = this.getNonce();
    const csp = [
      `default-src 'none'`,
      `script-src 'nonce-${nonce}'`,
      `style-src ${webview.cspSource} 'unsafe-inline'`,
      `img-src ${webview.cspSource} data:`,
      `font-src ${webview.cspSource}`,
    ].join('; ');

    return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="${csp}" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  ${cssUri ? `<link rel="stylesheet" href="${cssUri}" />` : ''}
  <title>CodeGraph</title>
</head>
<body>
  <div id="root"></div>
  <script nonce="${nonce}" src="${jsUri}"></script>
</body>
</html>`;
  }

  private buildDevHtml(): string {
    const nonce = this.getNonce();
    return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy"
    content="default-src 'none'; script-src 'unsafe-inline' http://localhost:5173; style-src 'unsafe-inline'; connect-src http://localhost:5173 ws://localhost:5173;" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>CodeGraph (dev)</title>
</head>
<body>
  <div id="root"></div>
  <script nonce="${nonce}" type="module">
    import RefreshRuntime from 'http://localhost:5173/@react-refresh';
    RefreshRuntime.injectIntoGlobalHook(window);
    window.$RefreshReg$ = () => {};
    window.$RefreshSig$ = () => (type) => type;
    window.__vite_plugin_react_preamble_installed__ = true;
  </script>
  <script type="module" src="http://localhost:5173/main.tsx"></script>
</body>
</html>`;
  }

  private isViteDevServerRunning(): boolean {
    // Heuristic: check if the built bundle exists. If not, assume dev server.
    const bundlePath = path.join(
      this.context.extensionUri.fsPath,
      'dist',
      'webview',
      'main.js'
    );
    return !fs.existsSync(bundlePath);
  }

  private getNonce(): string {
    let text = '';
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) {
      text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
  }
}
