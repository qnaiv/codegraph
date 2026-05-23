import * as vscode from 'vscode';
import { GraphStore } from '../graph/GraphStore';
import { executeReferences } from './LspClient';
import { LSPRange, hasLocation } from '../../shared/types';

function lspRangeToVscode(r: LSPRange): vscode.Range {
  return new vscode.Range(r.start.line, r.start.character, r.end.line, r.end.character);
}

export async function resolveReferences(
  nodeId: string,
  store: GraphStore
): Promise<{ nodeId: string; locations: LSPRange[] }> {
  const node = store.getNode(nodeId);
  if (!node || !hasLocation(node)) {
    return { nodeId, locations: [] };
  }

  const uri = vscode.Uri.parse(node.uri);
  const pos = new vscode.Position(node.range.start.line, node.range.start.character);

  const locations = await executeReferences(uri, pos);

  const lspLocations: LSPRange[] = locations.map((loc) => ({
    start: { line: loc.range.start.line, character: loc.range.start.character },
    end: { line: loc.range.end.line, character: loc.range.end.character },
  }));

  return { nodeId, locations: lspLocations };
}
