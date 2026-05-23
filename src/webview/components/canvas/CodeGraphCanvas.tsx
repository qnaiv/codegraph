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
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useGraphStore } from '../../store/graphStore';
import { postMessage } from '../../MessageHandler';
import {
  GraphNode,
  GraphEdge,
  ApexClassNode,
  ApexTriggerNode,
  SObjectNode,
  EdgeKind,
  hasLocation,
} from '../../../shared/types';

// -----------------------------------------------------------------------
// Graph node → React Flow Node conversion
// -----------------------------------------------------------------------

function nodeColor(kind: GraphNode['kind']): { bg: string; border: string; text: string } {
  switch (kind) {
    case 'apex-class':
    case 'apex-interface':
    case 'apex-enum':
      return { bg: '#1a2f4a', border: '#4a90d9', text: '#cce4f7' };
    case 'apex-trigger':
      return { bg: '#2e1a4a', border: '#9d4a9d', text: '#f0ccf7' };
    case 'sobject':
      return { bg: '#1a3a1a', border: '#4a9d4a', text: '#ccf0cc' };
    default:
      return { bg: '#2a2a2a', border: '#666', text: '#ddd' };
  }
}

function edgeStyle(kind: EdgeKind): { stroke: string; strokeDasharray?: string } {
  switch (kind) {
    case 'inherits':     return { stroke: '#4a90d9' };
    case 'implements':   return { stroke: '#7ec8e3', strokeDasharray: '5 3' };
    case 'calls':        return { stroke: '#888' };
    case 'soql-references': return { stroke: '#4a9d4a', strokeDasharray: '6 3' };
    case 'dml-insert':   return { stroke: '#e8a020' };
    case 'dml-update':   return { stroke: '#d4c820' };
    case 'dml-delete':   return { stroke: '#e03030' };
    case 'trigger-on':   return { stroke: '#9d4a9d' };
    case 'field-lookup': return { stroke: '#555', strokeDasharray: '3 3' };
    case 'instantiates': return { stroke: '#aaa', strokeDasharray: '4 2' };
    default:             return { stroke: '#555' };
  }
}

function toRFNode(
  gNode: GraphNode,
  pos: { x: number; y: number },
  isSelected: boolean,
  isHighlighted: boolean,
  isAnySelected: boolean
): Node {
  const c = nodeColor(gNode.kind);
  const dimmed = isAnySelected && !isSelected && !isHighlighted;
  const ringColor = isSelected ? '#ff8c00' : isHighlighted ? '#ffd700' : undefined;

  let label = gNode.label;
  if (gNode.kind === 'apex-trigger') label = `⚡ ${label}`;
  if (gNode.kind === 'sobject') {
    const so = gNode as SObjectNode;
    label = `${so.isCustomMetadata ? '🔧' : so.isCustom ? '📦' : '🗄️'} ${label}`;
  }
  if (gNode.kind === 'apex-interface') label = `«interface» ${label}`;
  if (gNode.kind === 'apex-enum') label = `«enum» ${label}`;

  // Method count badge for class nodes
  let sublabel = '';
  if (gNode.kind === 'apex-class' || gNode.kind === 'apex-interface') {
    const cls = gNode as ApexClassNode;
    const soqlCount = cls.methods.reduce((n, m) => n + m.soqlQueries.length, 0);
    const parts: string[] = [];
    if (cls.methods.length > 0) parts.push(`${cls.methods.length} methods`);
    if (soqlCount > 0) parts.push(`${soqlCount} SOQL`);
    if (cls.sharingMode) parts.push(cls.sharingMode);
    sublabel = parts.join(' · ');
  }
  if (gNode.kind === 'apex-trigger') {
    const tr = gNode as ApexTriggerNode;
    sublabel = tr.events.join(', ');
  }

  return {
    id: gNode.id,
    type: 'default',
    position: pos,
    data: { label: sublabel ? `${label}\n${sublabel}` : label, graphNodeId: gNode.id },
    style: {
      background: c.bg,
      color: c.text,
      border: `1.5px solid ${ringColor ?? c.border}`,
      borderRadius: 8,
      opacity: dimmed ? 0.2 : 1,
      boxShadow: ringColor ? `0 0 0 2px ${ringColor}` : undefined,
      fontSize: 12,
      padding: '6px 10px',
      minWidth: 140,
      whiteSpace: 'pre-line',
      transition: 'opacity 0.2s',
    },
  };
}

function toRFEdge(gEdge: GraphEdge, isHighlighted: boolean, isAnySelected: boolean): Edge {
  const s = edgeStyle(gEdge.kind);
  const dimmed = isAnySelected && !isHighlighted;
  return {
    id: gEdge.id,
    source: gEdge.sourceId,
    target: gEdge.targetId,
    label: gEdge.kind,
    animated: gEdge.kind === 'soql-references' || gEdge.kind.startsWith('dml-'),
    style: {
      stroke: s.stroke,
      strokeDasharray: s.strokeDasharray,
      opacity: dimmed ? 0.1 : 0.85,
    },
    labelStyle: { fontSize: 10, fill: '#888' },
    labelBgStyle: { fill: 'transparent' },
  };
}

// -----------------------------------------------------------------------
// Progress overlay
// -----------------------------------------------------------------------
function ProgressOverlay({ stage, percent }: { stage: string; percent: number }) {
  return (
    <div style={{
      position: 'absolute', inset: 0, display: 'flex',
      flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      background: 'rgba(10,10,20,0.85)', color: '#cce4f7', zIndex: 10,
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
// Main canvas
// -----------------------------------------------------------------------
export function CodeGraphCanvas() {
  const {
    nodes: gNodes,
    edges: gEdges,
    layoutState,
    viewState,
    progress,
  } = useGraphStore();

  const { selectedNodeIds, highlightedEdgeIds, activeFilters } = viewState;
  const hasSelection = selectedNodeIds.length > 0;

  // Determine which nodeIds are referenced
  const referencedNodeIds = useMemo(() => {
    const refs = new Set<string>();
    if (!hasSelection) return refs;
    const highlightSet = new Set(highlightedEdgeIds);
    for (const e of gEdges) {
      if (highlightSet.has(e.id)) {
        refs.add(e.sourceId);
        refs.add(e.targetId);
      }
    }
    return refs;
  }, [hasSelection, highlightedEdgeIds, gEdges]);

  // Apply filters
  const filteredNodes = useMemo(() => {
    return gNodes.filter((n) => {
      if (
        activeFilters.hideTestClasses &&
        (n.kind === 'apex-class' || n.kind === 'apex-interface') &&
        (n as ApexClassNode).isTestClass
      ) return false;
      if (
        activeFilters.hideManagedPackages &&
        'namespace' in n &&
        (n as ApexClassNode).namespace
      ) return false;
      return true;
    });
  }, [gNodes, activeFilters]);

  const filteredNodeIds = useMemo(
    () => new Set(filteredNodes.map((n) => n.id)),
    [filteredNodes]
  );

  const filteredEdges = useMemo(
    () => gEdges.filter((e) => filteredNodeIds.has(e.sourceId) && filteredNodeIds.has(e.targetId)),
    [gEdges, filteredNodeIds]
  );

  // Auto-assign grid positions for nodes without a saved layout position
  const defaultPositions = useMemo(() => {
    const pos = new Map<string, { x: number; y: number }>();
    filteredNodes.forEach((n, i) => {
      const col = i % 5;
      const row = Math.floor(i / 5);
      pos.set(n.id, { x: col * 220, y: row * 160 });
    });
    return pos;
  }, [filteredNodes]);

  // Convert to React Flow format
  const rfNodes: Node[] = useMemo(() =>
    filteredNodes.map((n) => {
      const pos = layoutState[n.id] ?? defaultPositions.get(n.id) ?? { x: 0, y: 0 };
      const isSelected = selectedNodeIds.includes(n.id);
      const isHighlighted = referencedNodeIds.has(n.id);
      return toRFNode(n, pos, isSelected, isHighlighted, hasSelection);
    }),
  [filteredNodes, layoutState, defaultPositions, selectedNodeIds, referencedNodeIds, hasSelection]);

  const rfEdges: Edge[] = useMemo(() =>
    filteredEdges.map((e) => {
      const isHighlighted = highlightedEdgeIds.includes(e.id);
      return toRFEdge(e, isHighlighted, hasSelection);
    }),
  [filteredEdges, highlightedEdgeIds, hasSelection]);

  const [nodes, setNodes] = React.useState<Node[]>(rfNodes);
  const [edges, setEdges] = React.useState<Edge[]>(rfEdges);

  // Sync store changes into local React Flow state
  React.useEffect(() => { setNodes(rfNodes); }, [rfNodes]);
  React.useEffect(() => { setEdges(rfEdges); }, [rfEdges]);

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {
      setNodes((nds) => applyNodeChanges(changes, nds));
      // Persist position changes
      const posChanges: Record<string, { x: number; y: number }> = {};
      for (const c of changes) {
        if (c.type === 'position' && c.position) {
          posChanges[c.id] = c.position;
          useGraphStore.getState().updateNodePosition(c.id, c.position);
        }
      }
      if (Object.keys(posChanges).length > 0) {
        postMessage({ type: 'SAVE_LAYOUT', payload: { positions: posChanges } });
      }
    },
    []
  );

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
    <div style={{ width: '100%', height: '100vh', position: 'relative' }}>
      {progress && <ProgressOverlay stage={progress.stage} percent={progress.percent} />}

      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={onNodeClick}
        onNodeDoubleClick={onNodeDoubleClick}
        onPaneClick={onPaneClick}
        fitView
        colorMode="dark"
        minZoom={0.1}
        maxZoom={4}
      >
        <Background />
        <Controls />
        <MiniMap
          nodeColor={(node) => {
            if (node.id.startsWith('sobject:')) return '#4a9d4a';
            if (node.id.startsWith('trigger:')) return '#9d4a9d';
            return '#4a90d9';
          }}
          style={{ background: '#111' }}
        />
      </ReactFlow>

      {isEmpty && (
        <div style={{
          position: 'absolute', inset: 0, display: 'flex',
          alignItems: 'center', justifyContent: 'center',
          color: '#555', fontSize: 14, pointerEvents: 'none',
        }}>
          Salesforce プロジェクトを開いてください
        </div>
      )}

      <div style={{
        position: 'absolute', top: 8, right: 8,
        display: 'flex', gap: 6,
      }}>
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

      {hasSelection && (
        <div style={{
          position: 'absolute', bottom: 8, left: 8,
          background: 'rgba(255,140,0,0.15)', border: '1px solid #ff8c00',
          color: '#ffd700', fontSize: 11, padding: '3px 8px', borderRadius: 4,
        }}>
          参照ハイライト中 — クリックで解除
        </div>
      )}
    </div>
  );
}

function FilterToggle({
  label,
  active,
  onToggle,
}: {
  label: string;
  active: boolean;
  onToggle: (v: boolean) => void;
}) {
  return (
    <button
      onClick={() => onToggle(!active)}
      style={{
        background: active ? '#1a3a5a' : '#2a2a2a',
        color: active ? '#cce4f7' : '#666',
        border: `1px solid ${active ? '#4a90d9' : '#444'}`,
        borderRadius: 4,
        padding: '3px 8px',
        fontSize: 11,
        cursor: 'pointer',
      }}
    >
      {label}
    </button>
  );
}
