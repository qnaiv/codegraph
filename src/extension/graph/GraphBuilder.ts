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
import { parseSObjectDirectory } from '../parser/SObjectMetaParser';
import { parseApexDirectory, ParsedApexClass, ParsedApexTrigger } from '../parser/ApexSourceParser';

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
  // method 一覧: LSP シンボルがあれば優先（精度が高い）、なければ regex 結果を使用
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

  // SOQL / DML を各メソッドに付与（ソース全体から抽出してメソッドに紐付け）
  const allSOQL = extractSOQL(parsed.source);
  const allDML  = extractDML(parsed.source);

  // 簡易的にすべて最初のメソッドに割り当て（メソッドが存在する場合）
  // より精密な行ベースの割り当ては Phase 追加改善で対応
  if (methods.length > 0) {
    const firstNonConstructor = methods.find((m) => m.kind === 'apex-method') ?? methods[0];
    firstNonConstructor.soqlQueries = allSOQL;
    firstNonConstructor.dmlOperations = allDML;
  }

  const lspClassSymbol = lspSymbols.find(
    (s) => s.kind === vscode.SymbolKind.Class || s.kind === vscode.SymbolKind.Interface
  );

  const range = lspClassSymbol
    ? rangeToLSP(lspClassSymbol.range)
    : { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } };

  // namespace 抽出 (managedNs__ClassName 形式)
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

const defaultViewState: ViewState = {
  granularity: 'class',
  viewport: { x: 0, y: 0, zoom: 1 },
  selectedNodeIds: [],
  highlightedEdgeIds: [],
  activeFilters: defaultFilter,
  layoutAlgorithm: 'dagre-lr',
};

// -----------------------------------------------------------------------
// メインエントリ
// -----------------------------------------------------------------------
export async function buildGraphSnapshot(
  workspaceRoot: string,
  onProgress?: (stage: string, percent: number) => void
): Promise<GraphSnapshot> {

  onProgress?.('Apex ソースを解析中…', 5);

  // 1. regex ベースで Apex ファイルを解析（LSP 不要・常に動作）
  const { classes: parsedClasses, triggers: parsedTriggers } = await parseApexDirectory(workspaceRoot);

  onProgress?.('LSP シンボルを補完中…', 40);

  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const classNodes = new Map<string, ApexClassNode>();

  // 2. クラスノードを構築（LSP で補完できれば精度向上）
  const classEntries = [...parsedClasses.entries()];
  await Promise.all(
    classEntries.map(async ([, parsed], i) => {
      // LSP の documentSymbol でメソッド階層を補完（失敗しても続行）
      const lspSymbols = await tryLspDocumentSymbol(parsed.uri);

      const classNode = buildClassNode(parsed, lspSymbols);
      classNodes.set(parsed.name, classNode);

      if (i % 5 === 0) {
        onProgress?.('クラスノードを構築中…', 40 + Math.round((i / classEntries.length) * 20));
      }
    })
  );

  // class名の重複を除去して追加
  for (const node of classNodes.values()) {
    nodes.push(node);
  }

  // 3. トリガーノードを構築
  for (const parsed of parsedTriggers) {
    nodes.push(buildTriggerNode(parsed));
  }

  onProgress?.('継承・実装エッジを構築中…', 65);

  // 4. 継承・実装エッジ（regex パーサーから）
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

  onProgress?.('Apexクラス間の参照エッジを構築中…', 67);

  // 4.5. Apex → Apex calls / instantiates エッジ
  // parsedClasses から抽出した参照候補をクラス名セットで絞り込む
  const apexEdgeSet = new Set<string>();
  const addApexEdge = (edge: GraphEdge) => {
    if (!apexEdgeSet.has(edge.id)) { apexEdgeSet.add(edge.id); edges.push(edge); }
  };

  for (const [, parsed] of parsedClasses) {
    const sourceNode = classNodes.get(parsed.name);
    if (!sourceNode) continue;

    for (const ref of parsed.referencedClasses) {
      // 自己参照・未知クラス・継承/実装済みの関係は除外
      if (ref.targetClass === parsed.name) continue;
      if (!classNodes.has(ref.targetClass)) continue;
      if (parsed.extendsClass === ref.targetClass) continue;
      if (parsed.implementsInterfaces.includes(ref.targetClass)) continue;

      addApexEdge({
        id: `edge:${ref.kind}:${sourceNode.id}:cls:${ref.targetClass}`,
        kind: ref.kind,
        sourceId: sourceNode.id,
        targetId: `cls:${ref.targetClass}`,
      });
    }
  }

  onProgress?.('SObject メタデータを解析中…', 70);

  // 5. SObject ノード
  const sobjectNodes = await parseSObjectDirectory(workspaceRoot);
  const sobjectIndex = new Map<string, SObjectNode>();
  for (const so of sobjectNodes) {
    sobjectIndex.set(so.label, so);
    nodes.push(so);
  }

  // 6. SObject リレーションシップエッジ
  for (const so of sobjectNodes) {
    for (const field of so.fields) {
      if (field.referenceTo) {
        for (const target of field.referenceTo) {
          const targetId = `sobject:${target}`;
          if (sobjectIndex.has(target)) {
            edges.push({
              id: `edge:field-lookup:${field.id}:${targetId}`,
              kind: 'field-lookup',
              sourceId: so.id,
              targetId,
              label: field.apiName,
              metadata: { relationshipName: field.relationshipName },
            });
          }
        }
      }
    }
  }

  onProgress?.('Apex → SObject エッジを構築中…', 85);

  // 7. Apex → SObject エッジ（SOQL / DML）
  const edgeSet = new Set<string>();
  const addEdge = (edge: GraphEdge) => {
    if (!edgeSet.has(edge.id)) { edgeSet.add(edge.id); edges.push(edge); }
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
        addEdge({
          id: `edge:soql:${classNode.id}:sobject:${name}`,
          kind: 'soql-references',
          sourceId: classNode.id,
          targetId: `sobject:${name}`,
        });
      }
    }

    for (const [name, dmlType] of dmlByObject) {
      if (sobjectIndex.has(name)) {
        const kind = dmlType === 'insert' || dmlType === 'upsert' ? 'dml-insert'
          : dmlType === 'delete' || dmlType === 'undelete'        ? 'dml-delete'
          : 'dml-update';
        addEdge({
          id: `edge:dml:${classNode.id}:sobject:${name}:${kind}`,
          kind,
          sourceId: classNode.id,
          targetId: `sobject:${name}`,
        });
      }
    }
  }

  // 8. trigger-on エッジ
  for (const trigger of parsedTriggers) {
    const sobjectId = `sobject:${trigger.targetSObject}`;
    addEdge({
      id: `edge:trigger-on:trigger:${trigger.name}:${sobjectId}`,
      kind: 'trigger-on',
      sourceId: `trigger:${trigger.name}`,
      targetId: sobjectId,
    });
  }

  onProgress?.('完了', 100);

  const edgeKindCounts = edges.reduce<Record<string, number>>((acc, e) => {
    acc[e.kind] = (acc[e.kind] ?? 0) + 1;
    return acc;
  }, {});
  console.log(`[CodeGraph] snapshot: ${nodes.length} nodes, ${edges.length} edges`, edgeKindCounts);

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
