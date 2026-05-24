import * as vscode from 'vscode';

type OnChangeCallback = (uri: vscode.Uri) => void;

export function createFileWatcher(
  workspaceRoot: string,
  onChange: OnChangeCallback
): vscode.Disposable {
  const watcher = vscode.workspace.createFileSystemWatcher(
    new vscode.RelativePattern(workspaceRoot, '**/*.{cls,trigger,object-meta.xml}')
  );

  // Debounce to avoid rebuilding on every keystroke
  const pending = new Map<string, ReturnType<typeof setTimeout>>();
  const debounced = (uri: vscode.Uri) => {
    const key = uri.toString();
    const existing = pending.get(key);
    if (existing) clearTimeout(existing);
    pending.set(
      key,
      setTimeout(() => {
        pending.delete(key);
        onChange(uri);
      }, 1000)
    );
  };

  watcher.onDidChange(debounced);
  watcher.onDidCreate(debounced);
  watcher.onDidDelete(debounced);

  return watcher;
}
