import React, { useCallback, useMemo } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  Node,
  Edge,
  NodeChange,
  EdgeChange,
  applyNodeChanges,
  applyEdgeChanges,
  NodeTypes,
  EdgeTypes,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useGraphStore } from '../../store/graphStore';
import { postMessage } from '../../MessageHandler';
import {
  GraphNode,
  GraphEdge,
  ApexClassNode,
  hasLocation,
} from '../../../shared/types';
import { ApexClassNodeComponent } from '../nodes/ApexClassNode';
import { SObjectNodeComponent } from '../nodes/SObjectNode';
import { ApexTriggerNodeComponent } from '../nodes/ApexTriggerNode';
import { ApexMethodNodeComponent } from '../nodes/ApexMethodNode';
import { CodeGraphEdgeComponent } from '../edges/CodeGraphEdge';
import { applyDagreLayout } from '../../layout/DagreLayout';

// -----------------------------------------------------------------------
// React Flow type registrations
// -----------------------------------------------------------------------
const nodeTypes: NodeTypes = {
  apexClass:   ApexClassNodeComponent,
  sobject:     SObjectNodeComponent,
  apexTrigger: ApexTriggerNodeComponent,
  apexMethod:  ApexMethodNodeComponent,
};

const edgeTypes: EdgeTypes = {
  codeGraph: CodeGraphEdgeComponent,
};

// -----------------------------------------------------------------------
// Container sizing constants
// -----------------------------------------------------------------------
const CONTAINER_W        = 200;
const CONTAINER_HEADER_H = 56;   // class header area (name + sharing badge)
const METHOD_H           = 50;   // height per method node
const METHOD_GAP         = 4;    // vertical gap between methods
const CONTAINER_PAD_B    = 10;   // bottom padding

function containerSize(methodCount: number) {
  const height = methodCount > 0
    ? CONTAINER_HEADER_H + methodCount * (METHOD_H + METHOD_GAP) + CONTAINER_PAD_B
    : 80;
  return { width: CONTAINER_W, height };
}

// -----------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------
function nodeTypeForKind(kind: GraphNode['kind']): string {
  switch (kind) {
    case 'apex-class':
    case 'apex-interface':
    case 'apex-enum':    return 'apexClass';
    case 'apex-trigger': return 'apexTrigger';
    case 'apex-method':
    case 'apex-constructor': return 'apexMethod';
    case 'sobject':      return 'sobject';
    default:             return 'default';
  }
}

function isApexClass(n: GraphNode): n is ApexClassNode {
  return n.kind === 'apex-class' || n.kind === 'apex-interface' || n.kind === 'apex-enum';
}

function toRFNode(
  gNode: GraphNode,
  pos: { x: number; y: number },
  existingStyle: React.CSSProperties | undefined,
  isSelected: boolean,
  isReferenced: boolean,
  isAnySelected: boolean,
  onOpenFile: () => void,
  isContainer: boolean,
): Node {
  const isDimmed = isAnySelected && !isSelected && !isReferenced;
  const isHighlighted = isSelected || isReferenced;
  return {
    id: gNode.id,
    type: nodeTypeForKind(gNode.kind),
    position: pos,
    data: { graphNode: gNode, isDimmed, isHighlighted, onOpenFile, isContainer },
    style: {
      ...existingStyle,
      ...(isHighlighted ? { boxShadow: `0 0 0 2px ${isSelected ? '#ff8c00' : '#ffd700'}`, borderRadius: 8 } : {}),
    },
  };
}

function toRFEdge(gEdge: GraphEdge, isHighlighted: boolean, isAnySelected: boolean): Edge {
  return {
    id: gEdge.id,
    source: gEdge.sourceId,
    target: gEdge.targetId,
    type: 'codeGraph',
    animated: gEdge.kind === 'soql-references' || gEdge.kind.startsWith('dml-'),
    data: {
      kind: gEdge.kind,
      isHighlighted,
      isDimmed: isAnySelected && !isHighlighted,
    },
  };
}

// -----------------------------------------------------------------------
// Progress overlay
// -----------------------------------------------------------------------
function ProgressOverlay({ stage, percent }: { stage: string; percent: number }) {
  return (
    <div style={{
      position: 'absolute', inset: 0, zIndex: 10,
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      background: 'rgba(10,10,20,0.88)', color: '#cce4f7',
    }}>
      <div style={{ fontSize: 14, marginBottom: 12 }}>{stage}</div>
      <div style={{ width: 240, height: 6, background: '#333', borderRadius: 3 }}>
        <div style={{ width: `${percent}%`, height: '100%', background: '#4a90d9', borderRadius: 3, transition: 'width 0.3s' }} />
      </div>
      <div style={{ fontSize: 11, marginTop: 8, color: '#888' }}>{percent}%</div>
    </div>
  );
}

// -----------------------------------------------------------------------
// Toggle button
// -----------------------------------------------------------------------
function FilterToggle({ label, active, onToggle }: { label: string; active: boolean; onToggle: (v: boolean) => void }) {
  return (
    <button
      onClick={() => onToggle(!active)}
      style={{
        background: active ? '#1a3a5a' : '#1e1e2e',
        color: active ? '#cce4f7' : '#666',
        border: `1px solid ${active ? '#4a90d9' : '#333'}`,
        borderRadius: 4, padding: '3px 9px', fontSize: 11, cursor: 'pointer',
      }}
    >
      {label}
    </button>
  );
}

// -----------------------------------------------------------------------
// Main canvas
// -----------------------------------------------------------------------
export function CodeGraphCanvas() {
  const {
    nodes: gNodes, edges: gEdges, layoutState, viewState, progress,
    showMethodLevel, toggleMethodLevel,
  } = useGraphStore();
  const { selectedNodeIds, highlightedEdgeIds, activeFilters } = viewState;
  const hasSelection = selectedNodeIds.length > 0;

  const referencedNodeIds = useMemo(() => {
    const refs = new Set<string>();
    if (!hasSelection) return refs;
    const hlSet = new Set(highlightedEdgeIds);
    for (const e of gEdges) {
      if (hlSet.has(e.id)) { refs.add(e.sourceId); refs.add(e.targetId); }
    }
    return refs;
  }, [hasSelection, highlightedEdgeIds, gEdges]);

  // Base filter (test classes, managed packages)
  const filteredNodes = useMemo(() => gNodes.filter((n) => {
    if (activeFilters.hideTestClasses && isApexClass(n) && (n as ApexClassNode).isTestClass) return false;
    if (activeFilters.hideManagedPackages && 'namespace' in n && (n as ApexClassNode).namespace) return false;
    return true;
  }), [gNodes, activeFilters]);

  const filteredNodeIds = useMemo(() => new Set(filteredNodes.map((n) => n.id)), [filteredNodes]);
  // メソッドレベル表示時に可視メソッドの ID セットを構築
  const visibleMethodIds = useMemo(() => {
    if (!showMethodLevel) return null;
    const ids = new Set<string>();
    for (const n of filteredNodes) {
      if (isApexClass(n)) {
        for (const m of n.methods) {
          if (m.accessModifier !== 'private') ids.add(m.id);
        }
      }
    }
    return ids;
  }, [showMethodLevel, filteredNodes]);

  const filteredEdges = useMemo(() => {
    if (showMethodLevel && visibleMethodIds) {
      return gEdges.filter((e) => {
        const srcIsMethod = e.sourceId.startsWith('method:');
        const tgtIsMethod = e.targetId.startsWith('method:');
        if (srcIsMethod || tgtIsMethod) {
          // メソッドレベルエッジ: 可視メソッド間のみ
          const srcOk = srcIsMethod ? visibleMethodIds.has(e.sourceId) : filteredNodeIds.has(e.sourceId);
          const tgtOk = tgtIsMethod ? visibleMethodIds.has(e.targetId) : filteredNodeIds.has(e.targetId);
          return srcOk && tgtOk;
        }
        // クラスレベルの calls/instantiates/soql/dml はメソッドレベルで置換するため非表示
        if (
          e.kind === 'calls' || e.kind === 'instantiates' ||
          e.kind === 'soql-references' || e.kind.startsWith('dml-')
        ) {
          return false;
        }
        // inherits / implements / trigger-on / field-lookup はそのまま表示
        return filteredNodeIds.has(e.sourceId) && filteredNodeIds.has(e.targetId);
      });
    }
    // クラスレベル表示: メソッドレベルエッジを除外
    return gEdges.filter(
      (e) =>
        !e.sourceId.startsWith('method:') &&
        !e.targetId.startsWith('method:') &&
        filteredNodeIds.has(e.sourceId) &&
        filteredNodeIds.has(e.targetId),
    );
  }, [gEdges, filteredNodeIds, showMethodLevel, visibleMethodIds]);

  // -----------------------------------------------------------------------
  // Build RF nodes: method-level containers OR flat class nodes
  // -----------------------------------------------------------------------
  const rfNodesBase = useMemo(() => {
    if (showMethodLevel) {
      const containerNodes: Node[] = [];
      const methodNodes: Node[] = [];

      for (const n of filteredNodes) {
        const pos = layoutState[n.id] ?? { x: 0, y: 0 };

        if (isApexClass(n)) {
          const publicMethods = n.methods.filter(m => m.accessModifier !== 'private');
          const { width, height } = containerSize(publicMethods.length);
          containerNodes.push({
            id: n.id,
            type: 'apexClass',
            position: pos,
            style: { width, height },
            data: { graphNode: n, isContainer: true },
          });
          publicMethods.forEach((method, i) => {
            methodNodes.push({
              id: method.id,
              type: 'apexMethod',
              position: {
                x: 8,
                y: CONTAINER_HEADER_H + i * (METHOD_H + METHOD_GAP),
              },
              parentId: n.id,
              extent: 'parent' as const,
              draggable: false,
              selectable: false,
              data: { graphNode: method },
            });
          });
        } else {
          containerNodes.push({
            id: n.id,
            type: nodeTypeForKind(n.kind),
            position: pos,
            data: { graphNode: n },
          });
        }
      }

      // Dagre on container nodes only (method children are positioned inside)
      const needsLayout = !containerNodes.some((cn) => layoutState[cn.id]);
      const containerIdSet = new Set(containerNodes.map(cn => cn.id));
      // レイアウト用エッジはコンテナ間のクラスレベルエッジのみ使用
      const rfEdgesForLayout: Edge[] = gEdges
        .filter(e =>
          !e.sourceId.startsWith('method:') &&
          !e.targetId.startsWith('method:') &&
          containerIdSet.has(e.sourceId) &&
          containerIdSet.has(e.targetId),
        )
        .map((e) => ({ id: e.id, source: e.sourceId, target: e.targetId }));
      const laid = needsLayout
        ? applyDagreLayout(containerNodes, rfEdgesForLayout, 'LR')
        : containerNodes;

      return [...laid, ...methodNodes];
    }

    // Flat class-level mode
    const needsLayout = filteredNodes.some((n) => !layoutState[n.id]);
    const withPos: Node[] = filteredNodes.map((n, i): Node => {
      const col = i % 5;
      const row = Math.floor(i / 5);
      const pos = layoutState[n.id] ?? { x: col * 220, y: row * 160 };
      return { id: n.id, type: nodeTypeForKind(n.kind), position: pos, data: { graphNode: n } };
    });
    const rfEdgesForLayout: Edge[] = filteredEdges.map((e) => ({
      id: e.id, source: e.sourceId, target: e.targetId,
    }));
    return needsLayout ? applyDagreLayout(withPos, rfEdgesForLayout, 'LR') : withPos;
  }, [filteredNodes, filteredEdges, gEdges, layoutState, showMethodLevel]);

  // Merge highlight / dim state onto top-level nodes; pass through method child nodes as-is
  const rfNodes: Node[] = useMemo(() =>
    rfNodesBase.map((rfNode) => {
      // Method child nodes: no interaction state needed
      if (rfNode.parentId) return rfNode;

      const gNode = gNodes.find((n) => n.id === rfNode.id);
      if (!gNode) return rfNode;

      const isSelected  = selectedNodeIds.includes(rfNode.id);
      const isReferenced = referencedNodeIds.has(rfNode.id);
      const onOpenFile = () => {
        if (hasLocation(gNode)) {
          postMessage({ type: 'OPEN_FILE', payload: { uri: gNode.uri, range: gNode.range } });
        }
      };
      const containerFlag = showMethodLevel && isApexClass(gNode);
      return toRFNode(
        gNode, rfNode.position, rfNode.style as React.CSSProperties | undefined,
        isSelected, isReferenced, hasSelection, onOpenFile, containerFlag,
      );
    }),
  [rfNodesBase, gNodes, selectedNodeIds, referencedNodeIds, hasSelection, showMethodLevel]);

  const rfEdges: Edge[] = useMemo(() =>
    filteredEdges.map((e) => toRFEdge(e, highlightedEdgeIds.includes(e.id), hasSelection)),
  [filteredEdges, highlightedEdgeIds, hasSelection]);

  const [nodes, setNodes] = React.useState<Node[]>(rfNodes);
  const [edges, setEdges] = React.useState<Edge[]>(rfEdges);

  React.useEffect(() => { setNodes(rfNodes); }, [rfNodes]);
  React.useEffect(() => { setEdges(rfEdges); }, [rfEdges]);

  const onNodesChange = useCallback((changes: NodeChange[]) => {
    setNodes((nds) => applyNodeChanges(changes, nds));
    const positions: Record<string, { x: number; y: number }> = {};
    for (const c of changes) {
      if (c.type === 'position' && c.position) {
        positions[c.id] = c.position;
        useGraphStore.getState().updateNodePosition(c.id, c.position);
      }
    }
    if (Object.keys(positions).length > 0) {
      postMessage({ type: 'SAVE_LAYOUT', payload: { positions } });
    }
  }, []);

  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) => setEdges((eds) => applyEdgeChanges(changes, eds)),
    []
  );

  const onNodeClick = useCallback((_: React.MouseEvent, node: Node) => {
    if (node.parentId) return; // method child nodes: ignore
    useGraphStore.getState().setSelectedNodes([node.id]);
    postMessage({ type: 'GET_REFERENCES', payload: { nodeId: node.id } });
  }, []);

  const onNodeDoubleClick = useCallback((_: React.MouseEvent, node: Node) => {
    if (node.parentId) return;
    const gNode = gNodes.find((n) => n.id === node.id);
    if (!gNode || !hasLocation(gNode)) return;
    postMessage({ type: 'OPEN_FILE', payload: { uri: gNode.uri, range: gNode.range } });
  }, [gNodes]);

  const onPaneClick = useCallback(() => {
    useGraphStore.getState().clearHighlight();
  }, []);

  const isEmpty = gNodes.length === 0 && !progress;

  return (
    <div style={{ width: '100%', height: '100vh', position: 'relative', background: '#0a0c14' }}>
      {progress && <ProgressOverlay stage={progress.stage} percent={progress.percent} />}

      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={onNodeClick}
        onNodeDoubleClick={onNodeDoubleClick}
        onPaneClick={onPaneClick}
        fitView
        colorMode="dark"
        minZoom={0.05}
        maxZoom={4}
        proOptions={{ hideAttribution: true }}
      >
        <Background color="#1a1e2e" />
        <Controls />
        <MiniMap
          nodeColor={(node) => {
            if (node.id.startsWith('sobject:')) return '#4a9d4a';
            if (node.id.startsWith('trigger:')) return '#9d4a9d';
            if (node.id.startsWith('method:'))  return '#2a4060';
            return '#4a90d9';
          }}
          style={{ background: '#0e1018', border: '1px solid #222' }}
        />
      </ReactFlow>

      {/* Toolbar: filter toggles + method level toggle */}
      <div style={{ position: 'absolute', top: 8, right: 8, display: 'flex', gap: 6 }}>
        <FilterToggle
          label="テスト非表示"
          active={activeFilters.hideTestClasses}
          onToggle={(v) => useGraphStore.getState().updateFilter({ hideTestClasses: v })}
        />
        <FilterToggle
          label="MPkg非表示"
          active={activeFilters.hideManagedPackages}
          onToggle={(v) => useGraphStore.getState().updateFilter({ hideManagedPackages: v })}
        />
        <FilterToggle
          label="メソッドレベル"
          active={showMethodLevel}
          onToggle={toggleMethodLevel}
        />
      </div>

      {/* Status bar */}
      {!isEmpty && !progress && (
        <div style={{
          position: 'absolute', bottom: 8, left: 8, fontSize: 10,
          color: '#444', pointerEvents: 'none',
        }}>
          {filteredNodes.length} nodes · {filteredEdges.length} edges
          {showMethodLevel && (
            <span style={{ color: '#4a90d9', marginLeft: 8 }}>
              メソッドレベル表示中
            </span>
          )}
          {hasSelection && (
            <span style={{ color: '#ffd700', marginLeft: 8 }}>
              参照ハイライト中 — クリックで解除
            </span>
          )}
        </div>
      )}

      {isEmpty && (
        <div style={{
          position: 'absolute', inset: 0, display: 'flex',
          alignItems: 'center', justifyContent: 'center',
          color: '#444', fontSize: 14, pointerEvents: 'none',
        }}>
          Salesforce プロジェクトを開いてください
        </div>
      )}
    </div>
  );
}
