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
import { buildSymbolIndex, RawClassSymbol } from '../lsp/SymbolIndexer';
import { extractSOQL, extractDML } from '../parser/SOQLExtractor';
import { parseSObjectDirectory } from '../parser/SObjectMetaParser';

const NAMESPACE_RE = /^([A-Za-z][A-Za-z0-9]*)__(.+)$/;
const TEST_ANNOTATION_RE = /@isTest/i;
const SHARING_RE = /\b(with\s+sharing|without\s+sharing|inherited\s+sharing)\b/i;

function rangeToLSP(r: vscode.Range) {
  return {
    start: { line: r.start.line, character: r.start.character },
    end: { line: r.end.line, character: r.end.character },
  };
}

function parseNamespace(name: string): { namespace?: string; localName: string } {
  const m = NAMESPACE_RE.exec(name);
  if (m) return { namespace: m[1], localName: m[2] };
  return { localName: name };
}

async function readSource(uri: vscode.Uri): Promise<string> {
  try {
    const bytes = await vscode.workspace.fs.readFile(uri);
    return Buffer.from(bytes).toString('utf8');
  } catch {
    return '';
  }
}

function buildClassNode(raw: RawClassSymbol, source: string): ApexClassNode {
  const { namespace, localName } = parseNamespace(raw.name);
  const isTrigger = raw.uri.fsPath.endsWith('.trigger');

  const sharingMatch = SHARING_RE.exec(source);
  const sharingMode = sharingMatch
    ? (sharingMatch[1].toLowerCase().replace(/\s+/g, ' ') as ApexClassNode['sharingMode'])
    : undefined;

  return {
    id: `cls:${raw.name}`,
    kind: raw.kind === vscode.SymbolKind.Interface
      ? 'apex-interface'
      : raw.kind === vscode.SymbolKind.Enum
        ? 'apex-enum'
        : 'apex-class',
    label: localName,
    fullyQualifiedName: raw.name,
    uri: raw.uri.toString(),
    range: rangeToLSP(raw.range),
    namespace,
    isAbstract: /\babstract\b/i.test(source),
    isVirtual: /\bvirtual\b/i.test(source),
    accessModifier: /\bglobal\b/i.test(source)
      ? 'global'
      : /\bprivate\b/i.test(source)
        ? 'private'
        : 'public',
    annotations: [],
    methods: [],
    innerClasses: [],
    isTestClass: TEST_ANNOTATION_RE.test(source) || isTrigger === false && /\btestmethod\b/i.test(source),
    sharingMode,
  };
}

function buildMethodNode(
  methodName: string,
  sym: vscode.DocumentSymbol,
  parentClassId: string,
  uri: vscode.Uri
): ApexMethodNode {
  return {
    id: `method:${parentClassId.replace('cls:', '')}.${methodName}`,
    kind: sym.kind === vscode.SymbolKind.Constructor ? 'apex-constructor' : 'apex-method',
    label: methodName,
    parentClassId,
    uri: uri.toString(),
    range: rangeToLSP(sym.range),
    returnType: '',
    parameters: [],
    accessModifier: 'public',
    isStatic: false,
    annotations: [],
    soqlQueries: [],
    dmlOperations: [],
  };
}

function buildTriggerNode(raw: RawClassSymbol, source: string): ApexTriggerNode {
  const triggerHeader = /trigger\s+\w+\s+on\s+(\w+)\s*\(([^)]+)\)/i.exec(source);
  const targetSObject = triggerHeader?.[1] ?? 'Unknown';

  type TriggerEvent = ApexTriggerNode['events'][number];
  const eventMap: Record<string, TriggerEvent> = {
    'before insert': 'before insert',
    'before update': 'before update',
    'before delete': 'before delete',
    'after insert': 'after insert',
    'after update': 'after update',
    'after delete': 'after delete',
    'after undelete': 'after undelete',
  };
  const eventsRaw = triggerHeader?.[2] ?? '';
  const events: TriggerEvent[] = eventsRaw
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter((e): e is TriggerEvent => e in eventMap)
    .map((e) => eventMap[e]);

  return {
    id: `trigger:${raw.name}`,
    kind: 'apex-trigger',
    label: raw.name,
    uri: raw.uri.toString(),
    range: rangeToLSP(raw.range),
    targetSObject,
    events,
  };
}

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

export async function buildGraphSnapshot(
  workspaceRoot: string,
  onProgress?: (stage: string, percent: number) => void
): Promise<GraphSnapshot> {
  onProgress?.('Indexing symbols…', 0);

  const index = await buildSymbolIndex(workspaceRoot, (done, total) => {
    onProgress?.('Indexing symbols…', Math.round((done / total) * 60));
  });

  onProgress?.('Building nodes…', 60);

  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const classNodes = new Map<string, ApexClassNode>();
  const triggerNodes: ApexTriggerNode[] = [];

  for (const [name, raw] of index.classes) {
    const source = await readSource(raw.uri);
    const isTrigger = raw.uri.fsPath.endsWith('.trigger');

    if (isTrigger) {
      const trigger = buildTriggerNode(raw, source);
      triggerNodes.push(trigger);
      nodes.push(trigger);
    } else {
      const classNode = buildClassNode(raw, source);

      // Attach methods
      for (const [key, { symbol }] of index.methods) {
        if (key.startsWith(`${name}.`)) {
          const methodName = key.slice(name.length + 1);
          classNode.methods.push(buildMethodNode(methodName, symbol, classNode.id, raw.uri));
        }
      }

      classNodes.set(name, classNode);
      nodes.push(classNode);
    }
  }

  // Enrich methods with SOQL / DML from source
  for (const classNode of classNodes.values()) {
    const raw = index.classes.get(classNode.fullyQualifiedName)!;
    const source = await readSource(raw.uri);
    for (const method of classNode.methods) {
      // Extract SOQL/DML from the method's source range
      const methodLines = source.split('\n');
      const methodSource = methodLines
        .slice(method.range.start.line, method.range.end.line + 1)
        .join('\n');
      method.soqlQueries = extractSOQL(methodSource);
      method.dmlOperations = extractDML(methodSource);
    }
  }

  // Parse SObject metadata
  onProgress?.('Parsing SObject metadata…', 70);
  const sobjectNodes = await parseSObjectDirectory(workspaceRoot);
  const sobjectIndex = new Map<string, SObjectNode>();
  for (const so of sobjectNodes) {
    sobjectIndex.set(so.label, so);
    nodes.push(so);
  }

  // SObject relationship edges (Lookup / Master-Detail)
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

  // Apex → SObject edges from SOQL / DML
  for (const classNode of classNodes.values()) {
    const referencedSObjects = new Set<string>();
    const dmlTargets = new Map<string, string>();

    for (const method of classNode.methods) {
      for (const q of method.soqlQueries) {
        referencedSObjects.add(q.fromObject);
        for (const extra of q.additionalObjects) referencedSObjects.add(extra);
      }
      for (const dml of method.dmlOperations) {
        dmlTargets.set(dml.targetType, dml.type);
      }
    }

    for (const sobjectName of referencedSObjects) {
      if (sobjectIndex.has(sobjectName)) {
        const eid = `edge:soql:${classNode.id}:sobject:${sobjectName}`;
        if (!edges.find((e) => e.id === eid)) {
          edges.push({ id: eid, kind: 'soql-references', sourceId: classNode.id, targetId: `sobject:${sobjectName}` });
        }
      }
    }

    for (const [sobjectName, dmlType] of dmlTargets) {
      if (sobjectIndex.has(sobjectName)) {
        const kind = dmlType === 'insert' || dmlType === 'upsert'
          ? 'dml-insert'
          : dmlType === 'delete' || dmlType === 'undelete'
            ? 'dml-delete'
            : 'dml-update';
        const eid = `edge:dml:${classNode.id}:sobject:${sobjectName}:${kind}`;
        if (!edges.find((e) => e.id === eid)) {
          edges.push({ id: eid, kind, sourceId: classNode.id, targetId: `sobject:${sobjectName}` });
        }
      }
    }
  }

  onProgress?.('Building edges…', 85);

  // Build inheritance / implements edges from source scanning
  for (const [, classNode] of classNodes) {
    const raw = index.classes.get(classNode.fullyQualifiedName)!;
    const source = await readSource(raw.uri);

    const extendsMatch = /\bextends\s+(\w+)/i.exec(source);
    if (extendsMatch) {
      const parentName = extendsMatch[1];
      const parentId = `cls:${parentName}`;
      if (classNodes.has(parentName)) {
        edges.push({
          id: `edge:inherits:${classNode.id}:${parentId}`,
          kind: 'inherits',
          sourceId: classNode.id,
          targetId: parentId,
        });
      }
    }

    const implementsMatch = /\bimplements\s+([\w,\s]+?)(?:\s*\{|$)/i.exec(source);
    if (implementsMatch) {
      for (const iface of implementsMatch[1].split(',')) {
        const ifaceName = iface.trim();
        const ifaceId = `cls:${ifaceName}`;
        if (classNodes.has(ifaceName)) {
          edges.push({
            id: `edge:implements:${classNode.id}:${ifaceId}`,
            kind: 'implements',
            sourceId: classNode.id,
            targetId: ifaceId,
          });
        }
      }
    }
  }

  // trigger-on edges
  for (const trigger of triggerNodes) {
    const sobjectId = `sobject:${trigger.targetSObject}`;
    edges.push({
      id: `edge:trigger-on:${trigger.id}:${sobjectId}`,
      kind: 'trigger-on',
      sourceId: trigger.id,
      targetId: sobjectId,
    });
  }

  onProgress?.('Done', 100);

  const baseName = path.basename(workspaceRoot);
  return {
    version: 1,
    projectRoot: baseName,
    nodes,
    edges,
    annotations: [],
    layoutState: {},
    viewState: defaultViewState,
  };
}
