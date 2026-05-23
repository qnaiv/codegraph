import * as vscode from 'vscode';

const APEX_EXTENSION_ID = 'salesforce.salesforcedx-vscode-apex';

function assertApexExtension(): void {
  const ext = vscode.extensions.getExtension(APEX_EXTENSION_ID);
  if (!ext) {
    void vscode.window.showErrorMessage(
      'CodeGraph requires "Salesforce Extensions for VS Code" (salesforce.salesforcedx-vscode-apex). Please install it and reload.'
    );
    throw new Error(`Extension not found: ${APEX_EXTENSION_ID}`);
  }
}

export async function executeWorkspaceSymbol(
  query: string
): Promise<vscode.SymbolInformation[]> {
  assertApexExtension();
  const result = await vscode.commands.executeCommand<vscode.SymbolInformation[]>(
    'vscode.executeWorkspaceSymbolProvider',
    query
  );
  return result ?? [];
}

export async function executeDocumentSymbol(
  uri: vscode.Uri
): Promise<vscode.DocumentSymbol[]> {
  assertApexExtension();
  const result = await vscode.commands.executeCommand<vscode.DocumentSymbol[]>(
    'vscode.executeDocumentSymbolProvider',
    uri
  );
  return result ?? [];
}

export async function executeReferences(
  uri: vscode.Uri,
  position: vscode.Position
): Promise<vscode.Location[]> {
  assertApexExtension();
  const result = await vscode.commands.executeCommand<vscode.Location[]>(
    'vscode.executeReferenceProvider',
    uri,
    position
  );
  return result ?? [];
}

export async function executeDefinition(
  uri: vscode.Uri,
  position: vscode.Position
): Promise<vscode.Location[]> {
  assertApexExtension();
  const result = await vscode.commands.executeCommand<
    vscode.Location | vscode.Location[] | vscode.LocationLink[]
  >('vscode.executeDefinitionProvider', uri, position);

  if (!result) return [];
  if (Array.isArray(result)) {
    return result.filter((r): r is vscode.Location => 'uri' in r && 'range' in r);
  }
  return [result as vscode.Location];
}
