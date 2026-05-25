import * as vscode from 'vscode';
import * as path from 'path';
import {
  ApexClassNode,
  ApexMethodNode,
  ApexTriggerNode,
  SObjectNode,
  GraphNode,
  GraphEdge,
  GraphSnapshot,
  NodeFilter,
  ViewState,
} from '../../shared/types';
import { extractSOQL, extractDML } from '../parser/SOQLExtractor';
import { parseSObjectDirectory, parseSObjectMeta } from '../parser/SObjectMetaParser';
import { parseApexDirectory, parseApexSource, ParsedApexClass, ParsedApexTrigger } from '../parser/ApexSourceParser';
import { extractMethodCalls } from '../parser/apexParseUtils';
import { executeReferences } from '../lsp/LspClient';

// -----------------------------------------------------------------------
// LSP を使って documentSymbol を補完 (任意・失敗しても続行)
// -----------------------------------------------------------------------
async function tryLspDocumentSymbol(uri: vscode.Uri): Promise<vscode.DocumentSymbol[]> {
  try {
    const result = await vscode.commands.executeCommand<vscode.DocumentSymbol[]>(
      'vscode.executeDocumentSymbolProvider',
      uri
    );
    return result ?? [];
  } catch {
    return [];
  }
}

function rangeToLSP(r: vscode.Range) {
  return {
    start: { line: r.start.line, character: r.start.character },
    end:   { line: r.end.line,   character: r.end.character },
  };
}

// -----------------------------------------------------------------------
// ParsedApexClass → ApexClassNode
// -----------------------------------------------------------------------
function buildClassNode(parsed: ParsedApexClass, lspSymbols: vscode.DocumentSymbol[]): ApexClassNode {
  const lspMethods = lspSymbols.filter(
    (s) => s.kind === vscode.SymbolKind.Method || s.kind === vscode.SymbolKind.Constructor
  );

  const methods: ApexMethodNode[] = lspMethods.length > 0
    ? lspMethods.map((s) => ({
        id: `method:${parsed.name}.${s.name}`,
        kind: s.kind === vscode.SymbolKind.Constructor ? 'apex-constructor' : 'apex-method',
        label: s.name,
        parentClassId: `cls:${parsed.name}`,
        uri: parsed.uri.toString(),
        range: rangeToLSP(s.range),
        returnType: '',
        parameters: [],
        accessModifier: 'public',
        isStatic: false,
        annotations: [],
        soqlQueries: [],
        dmlOperations: [],
      } as ApexMethodNode))
    : parsed.methods.map((m) => ({
        id: `method:${parsed.name}.${m.name}`,
        kind: m.name === parsed.name ? 'apex-constructor' : 'apex-method',
        label: m.name,
        parentClassId: `cls:${parsed.name}`,
        uri: parsed.uri.toString(),
        range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
        returnType: m.returnType,
        parameters: [],
        accessModifier: m.accessModifier,
        isStatic: m.isStatic,
        annotations: m.annotations,
        soqlQueries: [],
        dmlOperations: [],
      } as ApexMethodNode));

  // SOQL / DML を各メソッドに付与（LSP 範囲が利用可能なら行番号で割り当て）
  const allSOQL = extractSOQL(parsed.source);
  const allDML  = extractDML(parsed.source);

  const hasRanges = methods.some(m => m.range.end.line > m.range.start.line);
  if (hasRanges) {
    for (const method of methods) {
      method.soqlQueries   = allSOQL.filter(q =>
        q.range.start.line >= method.range.start.line &&
        q.range.start.line <= method.range.end.line,
      );
      method.dmlOperations = allDML.filter(d =>
        d.range.start.line >= method.range.start.line &&
        d.range.start.line <= method.range.end.line,
      );
    }
    // 未割り当て分を最初のメソッドに付与
    const matchedSOQL = new Set(methods.flatMap(m => m.soqlQueries));
    const matchedDML  = new Set(methods.flatMap(m => m.dmlOperations));
    const first = methods.find(m => m.kind === 'apex-method') ?? methods[0];
    if (first) {
      first.soqlQueries   = [...first.soqlQueries,   ...allSOQL.filter(q => !matchedSOQL.has(q))];
      first.dmlOperations = [...first.dmlOperations, ...allDML.filter(d => !matchedDML.has(d))];
    }
  } else {
    if (methods.length > 0) {
      const firstNonConstructor = methods.find((m) => m.kind === 'apex-method') ?? methods[0];
      firstNonConstructor.soqlQueries   = allSOQL;
      firstNonConstructor.dmlOperations = allDML;
    }
  }

  const lspClassSymbol = lspSymbols.find(
    (s) => s.kind === vscode.SymbolKind.Class || s.kind === vscode.SymbolKind.Interface
  );

  const range = lspClassSymbol
    ? rangeToLSP(lspClassSymbol.range)
    : { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } };

  const nsMatch = /^([A-Za-z][A-Za-z0-9]*)__(.+)$/.exec(parsed.name);
  const namespace = nsMatch?.[1];
  const localName  = nsMatch?.[2] ?? parsed.name;

  return {
    id: `cls:${parsed.name}`,
    kind: parsed.kind,
    label: localName,
    fullyQualifiedName: parsed.name,
    uri: parsed.uri.toString(),
    range,
    namespace,
    isAbstract: parsed.isAbstract,
    isVirtual:  parsed.isVirtual,
    accessModifier: parsed.accessModifier,
    annotations: parsed.annotations,
    methods,
    innerClasses: [],
    isTestClass: parsed.isTestClass,
    sharingMode: parsed.sharingMode,
  };
}

// -----------------------------------------------------------------------
// ParsedApexTrigger → ApexTriggerNode
// -----------------------------------------------------------------------
function buildTriggerNode(parsed: ParsedApexTrigger): ApexTriggerNode {
  return {
    id: `trigger:${parsed.name}`,
    kind: 'apex-trigger',
    label: parsed.name,
    uri: parsed.uri.toString(),
    range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
    targetSObject: parsed.targetSObject,
    events: parsed.events,
  };
}

// -----------------------------------------------------------------------
// デフォルト状態
// -----------------------------------------------------------------------
const defaultFilter: NodeFilter = {
  hideTestClasses: true,
  hideManagedPackages: true,
  sobjectTypes: 'referenced-only',
  minConnectionCount: 0,
};

export const defaultViewState: ViewState = {
  granularity: 'class',
  viewport: { x: 0, y: 0, zoom: 1 },
  selectedNodeIds: [],
  highlightedEdgeIds: [],
  activeFilters: defaultFilter,
  layoutAlgorithm: 'dagre-lr',
};

// -----------------------------------------------------------------------
// ノード + エッジ構築（共通ロジック）
// -----------------------------------------------------------------------
async function buildNodesAndEdges(
  parsedClasses: Map<string, ParsedApexClass>,
  parsedTriggers: ParsedApexTrigger[],
  sobjectNodes: SObjectNode[],
  onProgress?: (stage: string, percent: number) => void,
  basePercent = 40,
): Promise<{ nodes: GraphNode[]; edges: GraphEdge[] }> {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const classNodes = new Map<string, ApexClassNode>();

  const classEntries = [...parsedClasses.entries()];
  await Promise.all(
    classEntries.map(async ([, parsed], i) => {
      const lspSymbols = await tryLspDocumentSymbol(parsed.uri);
      const classNode = buildClassNode(parsed, lspSymbols);
      classNodes.set(parsed.name, classNode);
      if (i % 5 === 0) {
        onProgress?.('クラスノードを構築中…', basePercent + Math.round((i / classEntries.length) * 20));
      }
    })
  );

  for (const node of classNodes.values()) nodes.push(node);
  for (const parsed of parsedTriggers) nodes.push(buildTriggerNode(parsed));

  onProgress?.('継承・実装エッジを構築中…', basePercent + 25);

  // inherits / implements edges
  for (const [, parsed] of parsedClasses) {
    const classNode = classNodes.get(parsed.name);
    if (!classNode) continue;

    if (parsed.extendsClass && classNodes.has(parsed.extendsClass)) {
      edges.push({
        id: `edge:inherits:${classNode.id}:cls:${parsed.extendsClass}`,
        kind: 'inherits',
        sourceId: classNode.id,
        targetId: `cls:${parsed.extendsClass}`,
      });
    }

    for (const iface of parsed.implementsInterfaces) {
      if (classNodes.has(iface)) {
        edges.push({
          id: `edge:implements:${classNode.id}:cls:${iface}`,
          kind: 'implements',
          sourceId: classNode.id,
          targetId: `cls:${iface}`,
        });
      }
    }
  }

  // calls / instantiates edges
  const apexEdgeSet = new Set<string>();
  for (const [, parsed] of parsedClasses) {
    const sourceNode = classNodes.get(parsed.name);
    if (!sourceNode) continue;

    for (const ref of parsed.referencedClasses) {
      if (ref.targetClass === parsed.name) continue;
      if (!classNodes.has(ref.targetClass)) continue;
      if (parsed.extendsClass === ref.targetClass) continue;
      if (parsed.implementsInterfaces.includes(ref.targetClass)) continue;

      const edgeId = `edge:${ref.kind}:${sourceNode.id}:cls:${ref.targetClass}`;
      if (!apexEdgeSet.has(edgeId)) {
        apexEdgeSet.add(edgeId);
        edges.push({ id: edgeId, kind: ref.kind, sourceId: sourceNode.id, targetId: `cls:${ref.targetClass}` });
      }
    }
  }

  onProgress?.('SObject エッジを構築中…', basePercent + 45);

  // SObject nodes
  const sobjectIndex = new Map<string, SObjectNode>();
  for (const so of sobjectNodes) {
    sobjectIndex.set(so.label, so);
    nodes.push(so);
  }

  // SObject relationship edges
  for (const so of sobjectNodes) {
    for (const field of so.fields) {
      if (field.referenceTo) {
        for (const target of field.referenceTo) {
          if (sobjectIndex.has(target)) {
            edges.push({
              id: `edge:field-lookup:${field.id}:sobject:${target}`,
              kind: 'field-lookup',
              sourceId: so.id,
              targetId: `sobject:${target}`,
              label: field.apiName,
              metadata: { relationshipName: field.relationshipName },
            });
          }
        }
      }
    }
  }

  // Apex → SObject edges (SOQL / DML)
  const soEdgeSet = new Set<string>();
  const addEdge = (edge: GraphEdge) => {
    if (!soEdgeSet.has(edge.id)) { soEdgeSet.add(edge.id); edges.push(edge); }
  };

  for (const classNode of classNodes.values()) {
    const referencedSObjects = new Set<string>();
    const dmlByObject = new Map<string, string>();

    for (const method of classNode.methods) {
      for (const q of method.soqlQueries) {
        referencedSObjects.add(q.fromObject);
        for (const extra of q.additionalObjects) referencedSObjects.add(extra);
      }
      for (const dml of method.dmlOperations) {
        dmlByObject.set(dml.targetType, dml.type);
      }
    }

    for (const name of referencedSObjects) {
      if (sobjectIndex.has(name)) {
        addEdge({ id: `edge:soql:${classNode.id}:sobject:${name}`, kind: 'soql-references', sourceId: classNode.id, targetId: `sobject:${name}` });
      }
    }

    for (const [name, dmlType] of dmlByObject) {
      if (sobjectIndex.has(name)) {
        const kind = dmlType === 'insert' || dmlType === 'upsert' ? 'dml-insert'
          : dmlType === 'delete' || dmlType === 'undelete'        ? 'dml-delete'
          : 'dml-update';
        addEdge({ id: `edge:dml:${classNode.id}:sobject:${name}:${kind}`, kind, sourceId: classNode.id, targetId: `sobject:${name}` });
      }
    }
  }

  // trigger-on edges
  for (const trigger of parsedTriggers) {
    const sobjectId = `sobject:${trigger.targetSObject}`;
    addEdge({ id: `edge:trigger-on:trigger:${trigger.name}:${sobjectId}`, kind: 'trigger-on', sourceId: `trigger:${trigger.name}`, targetId: sobjectId });
  }

  onProgress?.('メソッドレベルエッジを構築中…', 90);

  // 9. メソッドレベルエッジ（method → SObject, method → method）
  for (const [, parsed] of parsedClasses) {
    const classNode = classNodes.get(parsed.name);
    if (!classNode) continue;

    const visibleMethods = classNode.methods.filter(m => m.accessModifier !== 'private');

    // 9a. Method → SObject（各メソッドの SOQL/DML から生成）
    for (const method of visibleMethods) {
      for (const q of method.soqlQueries) {
        if (sobjectIndex.has(q.fromObject)) {
          addEdge({
            id: `edge:soql:${method.id}:sobject:${q.fromObject}`,
            kind: 'soql-references',
            sourceId: method.id,
            targetId: `sobject:${q.fromObject}`,
          });
        }
        for (const extra of q.additionalObjects) {
          if (sobjectIndex.has(extra)) {
            addEdge({
              id: `edge:soql:${method.id}:sobject:${extra}`,
              kind: 'soql-references',
              sourceId: method.id,
              targetId: `sobject:${extra}`,
            });
          }
        }
      }
      for (const dml of method.dmlOperations) {
        if (sobjectIndex.has(dml.targetType)) {
          const kind = dml.type === 'insert' || dml.type === 'upsert' ? 'dml-insert'
            : dml.type === 'delete' || dml.type === 'undelete'        ? 'dml-delete'
            : 'dml-update';
          addEdge({
            id: `edge:dml:${method.id}:sobject:${dml.targetType}:${kind}`,
            kind,
            sourceId: method.id,
            targetId: `sobject:${dml.targetType}`,
          });
        }
      }
    }

    // 9b. Method → Method（クロスクラス静的呼び出し＋同一クラス内呼び出し）
    const visibleMethodNames = new Set(visibleMethods.map(m => m.label));
    const methodCallsInfo = extractMethodCalls(parsed.source, visibleMethodNames);

    for (const { methodName, crossClassCalls, intraClassCalls } of methodCallsInfo) {
      const sourceMethodId = `method:${parsed.name}.${methodName}`;
      if (!visibleMethods.some(m => m.id === sourceMethodId)) continue;

      for (const { targetClass, targetMethod } of crossClassCalls) {
        const targetClassNode = classNodes.get(targetClass);
        if (!targetClassNode) continue;
        const targetMethodId = `method:${targetClass}.${targetMethod}`;
        if (!targetClassNode.methods.some(m => m.id === targetMethodId && m.accessModifier !== 'private')) continue;
        addEdge({
          id: `edge:calls:${sourceMethodId}:${targetMethodId}`,
          kind: 'calls',
          sourceId: sourceMethodId,
          targetId: targetMethodId,
        });
      }

      for (const callee of intraClassCalls) {
        const targetMethodId = `method:${parsed.name}.${callee}`;
        if (!visibleMethods.some(m => m.id === targetMethodId)) continue;
        addEdge({
          id: `edge:calls:${sourceMethodId}:${targetMethodId}`,
          kind: 'calls',
          sourceId: sourceMethodId,
          targetId: targetMethodId,
        });
      }
    }
  }

  return { nodes, edges };
}

// -----------------------------------------------------------------------
// フルスキャン（既存の動作・opt-in として残す）
// -----------------------------------------------------------------------
export async function buildGraphSnapshot(
  workspaceRoot: string,
  onProgress?: (stage: string, percent: number) => void
): Promise<GraphSnapshot> {
  onProgress?.('Apex ソースを解析中…', 5);
  const { classes: parsedClasses, triggers: parsedTriggers } = await parseApexDirectory(workspaceRoot);

  onProgress?.('LSP シンボルを補完中…', 40);
  onProgress?.('SObject メタデータを解析中…', 70);
  const sobjectNodes = await parseSObjectDirectory(workspaceRoot);

  onProgress?.('グラフを構築中…', 80);
  const { nodes, edges } = await buildNodesAndEdges(parsedClasses, parsedTriggers, sobjectNodes, onProgress, 80);

  onProgress?.('完了', 100);

  console.log(`[CodeGraph] full snapshot: ${nodes.length} nodes, ${edges.length} edges`);

  return {
    version: 1,
    projectRoot: path.basename(workspaceRoot),
    nodes,
    edges,
    annotations: [],
    layoutState: {},
    viewState: defaultViewState,
  };
}

// -----------------------------------------------------------------------
// フォーカスドスキャン（アクティブファイル起点 BFS）
// -----------------------------------------------------------------------

function isApexUri(uri: vscode.Uri): boolean {
  return uri.fsPath.endsWith('.cls') || uri.fsPath.endsWith('.trigger');
}

async function resolveClassNameToUri(
  className: string,
  workspaceRoot: string
): Promise<vscode.Uri | null> {
  const files = await vscode.workspace.findFiles(
    new vscode.RelativePattern(workspaceRoot, `**/${className}.cls`),
    '**/node_modules/**',
    1
  );
  return files[0] ?? null;
}

function findClassNamePosition(source: string, className: string): vscode.Position {
  const escaped = className.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`(?:class|interface|enum)\\s+(${escaped})\\b`);
  const lines = source.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const match = re.exec(lines[i]);
    if (match) {
      const charPos = lines[i].indexOf(className, match.index);
      return new vscode.Position(i, charPos >= 0 ? charPos : 0);
    }
  }
  return new vscode.Position(0, 0);
}

export async function buildFocusedSnapshot(
  rootUri: vscode.Uri,
  workspaceRoot: string,
  depth: 1 | 2 | 3,
  onProgress?: (stage: string, percent: number) => void
): Promise<GraphSnapshot> {
  onProgress?.('関連ファイルを探索中…', 5);

  // ファイルパース結果キャッシュ
  const parseCache = new Map<string, ParsedApexClass | ParsedApexTrigger>();

  async function parseFile(uri: vscode.Uri): Promise<void> {
    const key = uri.toString();
    if (parseCache.has(key)) return;
    try {
      const bytes = await vscode.workspace.fs.readFile(uri);
      const source = Buffer.from(bytes).toString('utf8');
      const parsed = parseApexSource(uri, source);
      if (parsed) parseCache.set(key, parsed);
    } catch {
      // skip unreadable files
    }
  }

  // BFS: 起点から depth ホップ分の関連ファイルを収集
  const allUris = new Set<string>([rootUri.toString()]);
  let frontier: vscode.Uri[] = [rootUri];

  for (let d = 0; d < depth; d++) {
    // 現在の frontier を一括パース
    await Promise.all(frontier.map(parseFile));

    const nextFrontier: vscode.Uri[] = [];
    const neighborResolves: Promise<void>[] = [];

    for (const uri of frontier) {
      const parsed = parseCache.get(uri.toString());
      if (!parsed || 'targetSObject' in parsed) continue; // trigger は展開しない

      // 前進参照: referencedClasses / extends / implements
      const forwardNames = [
        ...parsed.referencedClasses.map((r) => r.targetClass),
        ...(parsed.extendsClass ? [parsed.extendsClass] : []),
        ...parsed.implementsInterfaces,
      ];

      neighborResolves.push(
        Promise.all(forwardNames.map((name) => resolveClassNameToUri(name, workspaceRoot)))
          .then((resolved) => {
            for (const r of resolved) {
              if (r && !allUris.has(r.toString())) {
                allUris.add(r.toString());
                nextFrontier.push(r);
              }
            }
          })
      );

      // 後退参照: LSP executeReferenceProvider
      const pos = findClassNamePosition(parsed.source, parsed.name);
      neighborResolves.push(
        executeReferences(uri, pos)
          .then((locations) => {
            for (const loc of locations) {
              const locStr = loc.uri.toString();
              if (!allUris.has(locStr) && isApexUri(loc.uri)) {
                allUris.add(locStr);
                nextFrontier.push(loc.uri);
              }
            }
          })
          .catch(() => { /* LSP 失敗は無視 */ })
      );
    }

    await Promise.all(neighborResolves);
    frontier = nextFrontier;

    const percent = 5 + Math.round(((d + 1) / depth) * 40);
    onProgress?.(`関連ファイルを探索中… (${allUris.size} ファイル)`, percent);
  }

  // BFS 最終ラウンドで発見されたファイルをパース（展開はしないが、ノード構築には必要）
  await Promise.all(frontier.map(parseFile));

  onProgress?.('クラスノードを構築中…', 50);

  // パース結果をクラス/トリガーに分類
  const parsedClasses = new Map<string, ParsedApexClass>();
  const parsedTriggers: ParsedApexTrigger[] = [];
  for (const parsed of parseCache.values()) {
    if ('targetSObject' in parsed) {
      parsedTriggers.push(parsed);
    } else {
      parsedClasses.set(parsed.name, parsed);
    }
  }

  onProgress?.('SObject メタデータを取得中…', 60);

  // 参照されている SObject 名を収集し、該当ファイルだけをパース
  const referencedSObjectNames = new Set<string>();
  for (const parsed of parsedClasses.values()) {
    for (const q of extractSOQL(parsed.source)) {
      referencedSObjectNames.add(q.fromObject);
      for (const extra of q.additionalObjects) referencedSObjectNames.add(extra);
    }
    for (const d of extractDML(parsed.source)) {
      referencedSObjectNames.add(d.targetType);
    }
  }
  for (const t of parsedTriggers) referencedSObjectNames.add(t.targetSObject);

  const sobjectResults = await Promise.all(
    [...referencedSObjectNames].map(async (name) => {
      const files = await vscode.workspace.findFiles(
        new vscode.RelativePattern(workspaceRoot, `**/${name}.object-meta.xml`),
        '**/node_modules/**',
        1
      );
      return files[0] ? parseSObjectMeta(files[0]) : null;
    })
  );
  const sobjectNodes = sobjectResults.filter((n): n is SObjectNode => n !== null);

  onProgress?.('エッジを構築中…', 75);

  const { nodes, edges } = await buildNodesAndEdges(
    parsedClasses, parsedTriggers, sobjectNodes, onProgress, 75
  );

  onProgress?.('完了', 100);

  console.log(`[CodeGraph] focused snapshot: ${nodes.length} nodes, ${edges.length} edges (${allUris.size} files scanned)`);

  return {
    version: 1,
    projectRoot: path.basename(workspaceRoot),
    nodes,
    edges,
    annotations: [],
    layoutState: {},
    viewState: defaultViewState,
  };
}
