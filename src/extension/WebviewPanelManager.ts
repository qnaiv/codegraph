import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { ExtensionToWebviewMessage, WebviewToExtensionMessage, GraphSnapshot } from '../shared/types';
import { GraphStore } from './graph/GraphStore';
import { buildGraphSnapshot, buildSingleNodeSnapshot, buildNeighborNodes, defaultViewState } from './graph/GraphBuilder';
import { resolveReferences } from './lsp/ReferenceResolver';
import { createFileWatcher } from './FileWatcher';

function emptySnapshot(): GraphSnapshot {
  return {
    version: 1,
    projectRoot: '',
    nodes: [],
    edges: [],
    annotations: [],
    layoutState: {},
    viewState: defaultViewState,
  };
}

export class WebviewPanelManager {
  private panel: vscode.WebviewPanel | undefined;
  private readonly context: vscode.ExtensionContext;
  private readonly store = new GraphStore();
  private fileWatcher: vscode.Disposable | undefined;
  private editorListener: vscode.Disposable | undefined;
  private followMode = false;
  private currentFocusUri: vscode.Uri | undefined;
  private pendingBootstrapUri: vscode.Uri | undefined;
  private readonly snapshotCache = new Map<string, GraphSnapshot>();
  private static readonly MAX_CACHE_SIZE = 10;

  constructor(context: vscode.ExtensionContext) {
    this.context = context;
  }

  open() {
    if (this.panel) {
      this.panel.reveal();
      return;
    }

    // Capture the active editor before the webview panel steals focus
    const activeEditor = vscode.window.activeTextEditor;
    if (activeEditor && this.isApexFile(activeEditor.document.uri)) {
      this.pendingBootstrapUri = activeEditor.document.uri;
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
      this.fileWatcher?.dispose();
      this.editorListener?.dispose();
    });

    this.editorListener = vscode.window.onDidChangeActiveTextEditor(async (editor: vscode.TextEditor | undefined) => {
      if (!this.followMode || !this.panel) return;
      if (!editor || !this.isApexFile(editor.document.uri)) return;
      if (editor.document.uri.toString() === this.currentFocusUri?.toString()) return;
      await this.buildFocused(editor.document.uri);
    });
  }

  post(message: ExtensionToWebviewMessage) {
    this.panel?.webview.postMessage(message);
  }

  dispose() {
    this.fileWatcher?.dispose();
    this.editorListener?.dispose();
    this.panel?.dispose();
  }

  private async handleMessage(msg: WebviewToExtensionMessage) {
    switch (msg.type) {
      case 'READY':
        await this.bootstrapFromActiveEditor();
        break;

      case 'EXPAND_NODE': {
        const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        if (!workspaceRoot) break;
        try {
          const targetUri = vscode.Uri.parse(msg.payload.nodeUri);
          const result = await buildNeighborNodes(
            targetUri,
            msg.payload.alreadyIncludedUris,
            workspaceRoot,
            (stage, percent) => this.post({ type: 'PROGRESS', payload: { stage, percent } })
          );
          this.post({
            type: 'NODE_EXPANDED',
            payload: {
              newNodes: result.newNodes,
              newEdges: result.newEdges,
              neighborCounts: result.neighborCounts,
              cappedCount: result.cappedCount,
            },
          });
        } catch (e) {
          this.post({ type: 'ERROR', payload: { message: String(e), code: 'EXPAND_ERROR' } });
        }
        break;
      }

      case 'GET_REFERENCES': {
        try {
          const result = await resolveReferences(msg.payload.nodeId, this.store);
          this.post({ type: 'REFERENCES_RESULT', payload: result });
        } catch (e) {
          this.post({ type: 'ERROR', payload: { message: String(e), code: 'REF_ERROR' } });
        }
        break;
      }

      case 'OPEN_FILE': {
        const uri = vscode.Uri.parse(msg.payload.uri);
        const { start } = msg.payload.range;
        const pos = new vscode.Position(start.line, start.character);
        await vscode.window.showTextDocument(uri, {
          selection: new vscode.Range(pos, pos),
        });
        break;
      }

      case 'SAVE_LAYOUT':
        this.store.updateLayout(msg.payload.positions);
        break;

      case 'FOLLOW_MODE':
        this.followMode = msg.payload.enabled;
        break;

      case 'REFRESH_GRAPH': {
        // 全スキャン（opt-in）
        const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        if (workspaceRoot) await this.runFullScan(workspaceRoot);
        break;
      }
    }
  }

  private async bootstrapFromActiveEditor() {
    const uri = this.pendingBootstrapUri ?? vscode.window.activeTextEditor?.document.uri;
    this.pendingBootstrapUri = undefined;
    if (uri && this.isApexFile(uri)) {
      await this.buildFocused(uri);
    } else {
      this.post({ type: 'GRAPH_UPDATE', payload: emptySnapshot() });
    }
  }

  private async buildFocused(uri: vscode.Uri) {
    this.currentFocusUri = uri;
    const label = path.basename(uri.fsPath);
    this.post({ type: 'ACTIVE_FILE_CHANGED', payload: { label, uri: uri.toString() } });

    const cacheKey = uri.toString();
    const cached = this.snapshotCache.get(cacheKey);
    if (cached) {
      this.store.setSnapshot(cached);
      this.post({ type: 'GRAPH_UPDATE', payload: cached });
      return;
    }

    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspaceRoot) {
      this.post({ type: 'ERROR', payload: { message: 'No workspace folder open.', code: 'NO_WORKSPACE' } });
      return;
    }

    try {
      const snapshot = await buildSingleNodeSnapshot(
        uri,
        workspaceRoot,
        (stage, percent) => this.post({ type: 'PROGRESS', payload: { stage, percent } })
      );
      if (this.snapshotCache.size >= WebviewPanelManager.MAX_CACHE_SIZE) {
        const oldest = this.snapshotCache.keys().next().value;
        if (oldest) this.snapshotCache.delete(oldest);
      }
      this.snapshotCache.set(cacheKey, snapshot);
      this.store.setSnapshot(snapshot);
      this.post({ type: 'GRAPH_UPDATE', payload: snapshot });
      this.setupFileWatcher(workspaceRoot);
    } catch (e) {
      this.post({ type: 'ERROR', payload: { message: String(e), code: 'BUILD_ERROR' } });
    }
  }

  private async runFullScan(workspaceRoot: string) {
    this.currentFocusUri = undefined;
    this.snapshotCache.clear();
    try {
      const snapshot = await buildGraphSnapshot(workspaceRoot, (stage, percent) => {
        this.post({ type: 'PROGRESS', payload: { stage, percent } });
      });
      this.store.setSnapshot(snapshot);
      this.post({ type: 'GRAPH_UPDATE', payload: snapshot });
      this.setupFileWatcher(workspaceRoot);
    } catch (e) {
      this.post({ type: 'ERROR', payload: { message: String(e), code: 'BUILD_ERROR' } });
    }
  }

  private setupFileWatcher(workspaceRoot: string) {
    this.fileWatcher?.dispose();
    this.fileWatcher = createFileWatcher(workspaceRoot, async () => {
      this.snapshotCache.clear();
      if (this.currentFocusUri) {
        await this.buildFocused(this.currentFocusUri);
      }
    });
  }

  private isApexFile(uri: vscode.Uri): boolean {
    return uri.fsPath.endsWith('.cls') || uri.fsPath.endsWith('.trigger');
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

    const nonce = getNonce();
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
  <script type="module">
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
    const bundlePath = path.join(
      this.context.extensionUri.fsPath,
      'dist',
      'webview',
      'main.js'
    );
    return !fs.existsSync(bundlePath);
  }
}

function getNonce(): string {
  let text = '';
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) {
    text += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return text;
}
