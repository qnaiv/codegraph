import * as vscode from 'vscode';
import * as path from 'path';
import { executeDocumentSymbol, executeWorkspaceSymbol } from './LspClient';

export interface RawClassSymbol {
  name: string;
  kind: vscode.SymbolKind;
  uri: vscode.Uri;
  range: vscode.Range;
  selectionRange: vscode.Range;
  children: vscode.DocumentSymbol[];
}

export interface SymbolIndex {
  /** key = fullyQualifiedName (e.g. "AccountService") */
  classes: Map<string, RawClassSymbol>;
  /** key = "ClassName.methodName" */
  methods: Map<string, { parent: string; symbol: vscode.DocumentSymbol }>;
}

export async function buildSymbolIndex(
  workspaceRoot: string,
  onProgress?: (done: number, total: number) => void
): Promise<SymbolIndex> {
  const index: SymbolIndex = { classes: new Map(), methods: new Map() };

  // 1. Find all .cls and .trigger files
  const clsFiles = await vscode.workspace.findFiles(
    new vscode.RelativePattern(workspaceRoot, '**/*.{cls,trigger}'),
    '**/node_modules/**'
  );

  const total = clsFiles.length;
  let done = 0;

  // 2. Per-file documentSymbol to get the full hierarchy
  await Promise.all(
    clsFiles.map(async (uri) => {
      try {
        const symbols = await executeDocumentSymbol(uri);
        for (const sym of symbols) {
          if (
            sym.kind === vscode.SymbolKind.Class ||
            sym.kind === vscode.SymbolKind.Interface ||
            sym.kind === vscode.SymbolKind.Enum ||
            sym.kind === vscode.SymbolKind.Module
          ) {
            const baseName = path.basename(uri.fsPath, path.extname(uri.fsPath));
            const className = sym.name || baseName;
            index.classes.set(className, {
              name: className,
              kind: sym.kind,
              uri,
              range: sym.range,
              selectionRange: sym.selectionRange,
              children: sym.children,
            });

            for (const child of sym.children) {
              if (
                child.kind === vscode.SymbolKind.Method ||
                child.kind === vscode.SymbolKind.Constructor ||
                child.kind === vscode.SymbolKind.Function
              ) {
                const methodKey = `${className}.${child.name}`;
                index.methods.set(methodKey, { parent: className, symbol: child });
              }
            }
          }
        }
      } catch {
        // Skip files with parse errors
      }
      done++;
      onProgress?.(done, total);
    })
  );

  // 3. Fallback: supplement with workspace/symbol for files not covered above
  try {
    const wsSymbols = await executeWorkspaceSymbol('');
    for (const sym of wsSymbols) {
      if (
        (sym.kind === vscode.SymbolKind.Class || sym.kind === vscode.SymbolKind.Module) &&
        !index.classes.has(sym.name)
      ) {
        index.classes.set(sym.name, {
          name: sym.name,
          kind: sym.kind,
          uri: sym.location.uri,
          range: sym.location.range,
          selectionRange: sym.location.range,
          children: [],
        });
      }
    }
  } catch {
    // workspace/symbol is optional
  }

  return index;
}
