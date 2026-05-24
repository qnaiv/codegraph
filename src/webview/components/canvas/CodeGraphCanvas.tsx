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
import { CodeGraphEdgeComponent } from '../edges/CodeGraphEdge';
import { applyDagreLayout } from '../../layout/DagreLayout';

// -----------------------------------------------------------------------
// React Flow type registrations
// -----------------------------------------------------------------------
const nodeTypes: NodeTypes = {
  apexClass: ApexClassNodeComponent,
  sobject: SObjectNodeComponent,
  apexTrigger: ApexTriggerNodeComponent,
};

const edgeTypes: EdgeTypes = {
  codeGraph: CodeGraphEdgeComponent,
};

// -----------------------------------------------------------------------
// Graph node → React Flow Node conversion
// -----------------------------------------------------------------------
function nodeTypeForKind(kind: GraphNode['kind']): string {
  switch (kind) {
    case 'apex-class':
    case 'apex-interface':
    case 'apex-enum':
      return 'apexClass';
    case 'apex-trigger':
      return 'apexTrigger';
    case 'sobject':
      return 'sobject';
    default:
      return 'default';
  }
}

function toRFNode(
  gNode: GraphNode,
  pos: { x: number; y: number },
  isSelected: boolean,
  isReferenced: boolean,
  isAnySelected: boolean,
  onOpenFile: () => void
): Node {
  const isDimmed = isAnySelected && !isSelected && !isReferenced;
  const isHighlighted = isSelected || isReferenced;

  return {
    id: gNode.id,
    type: nodeTypeForKind(gNode.kind),
    position: pos,
    data: {
      graphNode: gNode,
      isDimmed,
      isHighlighted,
      onOpenFile,
    },
    style: isHighlighted
      ? { boxShadow: `0 0 0 2px ${isSelected ? '#ff8c00' : '#ffd700'}`, borderRadius: 8 }
      : undefined,
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
    <div
      style={{
        position: 'absolute', inset: 0, zIndex: 10,
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        background: 'rgba(10,10,20,0.88)', color: '#cce4f7',
      }}
    >
      <div style={{ fontSize: 14, marginBottom: 12 }}>{stage}</div>
      <div style={{ width: 240, height: 6, background: '#333', borderRadius: 3 }}>
        <div style={{ width: `${percent}%`, height: '100%', background: '#4a90d9', borderRadius: 3, transition: 'width 0.3s' }} />
      </div>
      <div style={{ fontSize: 11, marginTop: 8, color: '#888' }}>{percent}%</div>
    </div>
  );
}

// -----------------------------------------------------------------------
// Filter toggle button
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
  const { nodes: gNodes, edges: gEdges, layoutState, viewState, progress } = useGraphStore();
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

  // Apply filters
  const filteredNodes = useMemo(() => gNodes.filter((n) => {
    if (activeFilters.hideTestClasses &&
      (n.kind === 'apex-class' || n.kind === 'apex-interface') &&
      (n as ApexClassNode).isTestClass) return false;
    if (activeFilters.hideManagedPackages &&
      'namespace' in n && (n as ApexClassNode).namespace) return false;
    return true;
  }), [gNodes, activeFilters]);

  const filteredNodeIds = useMemo(() => new Set(filteredNodes.map((n) => n.id)), [filteredNodes]);
  const filteredEdges = useMemo(
    () => gEdges.filter((e) => filteredNodeIds.has(e.sourceId) && filteredNodeIds.has(e.targetId)),
    [gEdges, filteredNodeIds]
  );

  // Build RF nodes, applying Dagre on first load
  const rfNodesBase = useMemo(() => {
    const needsLayout = filteredNodes.some((n) => !layoutState[n.id]);

    const withPos: Node[] = filteredNodes.map((n, i): Node => {
      const col = i % 5;
      const row = Math.floor(i / 5);
      const pos = layoutState[n.id] ?? { x: col * 220, y: row * 160 };
      return {
        id: n.id,
        type: nodeTypeForKind(n.kind),
        position: pos,
        data: { graphNode: n },
      };
    });

    const rfEdgesForLayout: Edge[] = filteredEdges.map((e) => ({
      id: e.id, source: e.sourceId, target: e.targetId,
    }));

    if (needsLayout) {
      return applyDagreLayout(withPos, rfEdgesForLayout, 'LR');
    }
    return withPos;
  }, [filteredNodes, filteredEdges, layoutState]);

  // Merge highlight/dim state
  const rfNodes: Node[] = useMemo(() =>
    rfNodesBase.map((rfNode) => {
      const gNode = gNodes.find((n) => n.id === rfNode.id);
      if (!gNode) return rfNode;
      const isSelected = selectedNodeIds.includes(rfNode.id);
      const isReferenced = referencedNodeIds.has(rfNode.id);
      const onOpenFile = () => {
        if (hasLocation(gNode)) {
          postMessage({ type: 'OPEN_FILE', payload: { uri: gNode.uri, range: gNode.range } });
        }
      };
      return toRFNode(gNode, rfNode.position, isSelected, isReferenced, hasSelection, onOpenFile);
    }),
  [rfNodesBase, gNodes, selectedNodeIds, referencedNodeIds, hasSelection]);

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
    useGraphStore.getState().setSelectedNodes([node.id]);
    postMessage({ type: 'GET_REFERENCES', payload: { nodeId: node.id } });
  }, []);

  const onNodeDoubleClick = useCallback((_: React.MouseEvent, node: Node) => {
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
        minZoom={0.08}
        maxZoom={4}
        proOptions={{ hideAttribution: true }}
      >
        <Background color="#1a1e2e" />
        <Controls />
        <MiniMap
          nodeColor={(node) => {
            if (node.id.startsWith('sobject:')) return '#4a9d4a';
            if (node.id.startsWith('trigger:')) return '#9d4a9d';
            return '#4a90d9';
          }}
          style={{ background: '#0e1018', border: '1px solid #222' }}
        />
      </ReactFlow>

      {/* Filter toggles */}
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
      </div>

      {/* Status bar */}
      {!isEmpty && !progress && (
        <div style={{
          position: 'absolute', bottom: 8, left: 8, fontSize: 10,
          color: '#444', pointerEvents: 'none',
        }}>
          {filteredNodes.length} nodes · {filteredEdges.length} edges
          {filteredEdges.some((e) => e.kind === 'instantiates' || e.kind === 'calls') && (
            <span style={{ marginLeft: 6 }}>
              {filteredEdges.filter((e) => e.kind === 'instantiates').length > 0 && (
                <span style={{ color: '#44ccbb' }}>
                  {filteredEdges.filter((e) => e.kind === 'instantiates').length} new
                </span>
              )}
              {filteredEdges.filter((e) => e.kind === 'calls').length > 0 && (
                <span style={{ color: '#bb88ff', marginLeft: 4 }}>
                  {filteredEdges.filter((e) => e.kind === 'calls').length} calls
                </span>
              )}
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
