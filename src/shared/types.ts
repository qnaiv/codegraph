// ============================================================
// プリミティブ
// ============================================================

export interface LSPRange {
  start: { line: number; character: number };
  end: { line: number; character: number };
}

export interface XYPosition {
  x: number;
  y: number;
}

export interface Viewport {
  x: number;
  y: number;
  zoom: number;
}

// ============================================================
// ノード種別・エッジ種別
// ============================================================

export type NodeKind =
  | 'apex-class'
  | 'apex-interface'
  | 'apex-enum'
  | 'apex-trigger'
  | 'apex-method'
  | 'apex-constructor'
  | 'sobject'
  | 'sobject-field';

export type EdgeKind =
  | 'inherits'
  | 'implements'
  | 'calls'
  | 'soql-references'
  | 'dml-insert'
  | 'dml-update'
  | 'dml-delete'
  | 'field-lookup'
  | 'instantiates'
  | 'trigger-on'
  | 'annotation-attach';

export type GranularityLevel = 'class' | 'method' | 'soql';

// ============================================================
// Apex ノード
// ============================================================

export interface ApexClassNode {
  id: string;
  kind: 'apex-class' | 'apex-interface' | 'apex-enum';
  label: string;
  fullyQualifiedName: string;
  uri: string;
  range: LSPRange;
  namespace?: string;
  isAbstract: boolean;
  isVirtual: boolean;
  accessModifier: 'public' | 'private' | 'global' | 'protected';
  annotations: ApexAnnotation[];
  methods: ApexMethodNode[];
  innerClasses: string[];
  isTestClass: boolean;
  sharingMode?: 'with sharing' | 'without sharing' | 'inherited sharing';
}

export interface ApexMethodNode {
  id: string;
  kind: 'apex-method' | 'apex-constructor';
  label: string;
  parentClassId: string;
  uri: string;
  range: LSPRange;
  returnType: string;
  parameters: ApexParameter[];
  accessModifier: 'public' | 'private' | 'global' | 'protected';
  isStatic: boolean;
  annotations: ApexAnnotation[];
  soqlQueries: SOQLQuery[];
  dmlOperations: DMLOperation[];
}

export interface ApexTriggerNode {
  id: string;
  kind: 'apex-trigger';
  label: string;
  uri: string;
  range: LSPRange;
  targetSObject: string;
  events: TriggerEvent[];
}

export interface ApexParameter {
  name: string;
  type: string;
}

export interface ApexAnnotation {
  name: string;
  parameters?: Record<string, string>;
}

export type TriggerEvent =
  | 'before insert'
  | 'before update'
  | 'before delete'
  | 'after insert'
  | 'after update'
  | 'after delete'
  | 'after undelete';

// ============================================================
// SObject ノード
// ============================================================

export interface SObjectNode {
  id: string;
  kind: 'sobject';
  label: string;
  isCustom: boolean;
  isCustomMetadata: boolean;
  uri?: string;
  fields: SObjectFieldNode[];
  recordTypes: string[];
}

export interface SObjectFieldNode {
  id: string;
  kind: 'sobject-field';
  label: string;
  apiName: string;
  parentSObjectId: string;
  fieldType: SalesforceFieldType;
  referenceTo?: string[];
  relationshipName?: string;
  required: boolean;
  externalId: boolean;
}

export type SalesforceFieldType =
  | 'Text'
  | 'Number'
  | 'Currency'
  | 'Date'
  | 'DateTime'
  | 'Boolean'
  | 'Picklist'
  | 'MultiPicklist'
  | 'TextArea'
  | 'LongTextArea'
  | 'RichTextArea'
  | 'Lookup'
  | 'MasterDetail'
  | 'ExternalLookup'
  | 'HierarchyLookup'
  | 'Email'
  | 'Phone'
  | 'Url'
  | 'Id'
  | 'Formula'
  | 'Rollup'
  | 'EncryptedText'
  | 'AutoNumber';

// ============================================================
// SOQL・DML抽出結果
// ============================================================

export interface SOQLQuery {
  raw: string;
  fromObject: string;
  additionalObjects: string[];
  fields: string[];
  hasSubquery: boolean;
  range: LSPRange;
}

export interface DMLOperation {
  type: 'insert' | 'update' | 'upsert' | 'delete' | 'undelete' | 'merge';
  targetType: string;
  range: LSPRange;
}

// ============================================================
// エッジ
// ============================================================

export interface GraphEdge {
  id: string;
  kind: EdgeKind;
  sourceId: string;
  targetId: string;
  label?: string;
  metadata?: EdgeMetadata;
}

export interface EdgeMetadata {
  callSites?: LSPRange[];
  soqlQuery?: SOQLQuery;
  dmlOp?: DMLOperation;
  relationshipName?: string;
}

// ============================================================
// ホワイトボード / アノテーション
// ============================================================

export type AnnotationKind = 'sticky-note' | 'freehand-stroke' | 'label-pin';

export interface StickyNote {
  id: string;
  kind: 'sticky-note';
  content: string;
  position: XYPosition;
  size: { width: number; height: number };
  color: StickyColor;
  attachedToNodeId?: string;
  createdAt: string;
  updatedAt: string;
}

export type StickyColor = 'yellow' | 'blue' | 'green' | 'pink' | 'orange';

export interface FreehandStroke {
  id: string;
  kind: 'freehand-stroke';
  points: XYPosition[];
  color: string;
  strokeWidth: number;
  roughness: number;
}

export interface LabelPin {
  id: string;
  kind: 'label-pin';
  text: string;
  attachedToNodeId: string;
  offset: XYPosition;
}

export type Annotation = StickyNote | FreehandStroke | LabelPin;

// ============================================================
// ビュー状態
// ============================================================

export interface ViewState {
  granularity: GranularityLevel;
  viewport: Viewport;
  selectedNodeIds: string[];
  highlightedEdgeIds: string[];
  activeFilters: NodeFilter;
  layoutAlgorithm: 'dagre-lr' | 'dagre-tb' | 'manual';
}

export interface NodeFilter {
  hideTestClasses: boolean;
  hideManagedPackages: boolean;
  sobjectTypes: 'all' | 'custom-only' | 'referenced-only';
  minConnectionCount: number;
}

// ============================================================
// グラフスナップショット
// ============================================================

export type GraphNode = ApexClassNode | ApexMethodNode | ApexTriggerNode | SObjectNode | SObjectFieldNode;

export interface GraphSnapshot {
  version: number;
  projectRoot: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
  annotations: Annotation[];
  layoutState: Record<string, XYPosition>;
  viewState: ViewState;
}

// ============================================================
// MessageBus プロトコル
// ============================================================

export type ExtensionToWebviewMessage =
  | { type: 'GRAPH_UPDATE'; payload: GraphSnapshot }
  | { type: 'REFERENCES_RESULT'; payload: { nodeId: string; locations: LSPRange[] } }
  | { type: 'DEFINITION_RESULT'; payload: { uri: string; range: LSPRange } }
  | { type: 'PROGRESS'; payload: { stage: string; percent: number } }
  | { type: 'ERROR'; payload: { message: string; code: string } }
  | { type: 'ACTIVE_FILE_CHANGED'; payload: { label: string; uri: string } };

// ============================================================
// 型ガードユーティリティ
// ============================================================

/** uri と range を持つノード（LSP操作が可能）かを判定する */
export function hasLocation(
  node: GraphNode
): node is GraphNode & { uri: string; range: LSPRange } {
  return (
    'uri' in node &&
    typeof (node as { uri?: unknown }).uri === 'string' &&
    'range' in node &&
    (node as { range?: unknown }).range != null
  );
}

export type WebviewToExtensionMessage =
  | { type: 'READY' }
  | { type: 'GET_REFERENCES'; payload: { nodeId: string } }
  | { type: 'GET_DEFINITION'; payload: { nodeId: string } }
  | { type: 'OPEN_FILE'; payload: { uri: string; range: LSPRange } }
  | { type: 'SAVE_ANNOTATION'; payload: Annotation }
  | { type: 'DELETE_ANNOTATION'; payload: { annotationId: string } }
  | { type: 'SAVE_LAYOUT'; payload: { positions: Record<string, XYPosition> } }
  | { type: 'REFRESH_GRAPH' }
  | { type: 'SET_SCAN_DEPTH'; payload: { depth: 1 | 2 | 3 } }
  | { type: 'FOLLOW_MODE'; payload: { enabled: boolean } };
