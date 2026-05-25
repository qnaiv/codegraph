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
const CONTAINER_HEADER_H = 56;
const METHOD_H           = 50;
const METHOD_GAP         = 4;
const CONTAINER_PAD_B    = 10;

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
  isAnySelectedForDim: boolean,
  onOpenFile: () => void,
  isContainer: boolean,
  onExpandDownstream: (() => void) | undefined,
  onCollapseDownstream: (() => void) | undefined,
  onToggleMethodLevel: (() => void) | undefined,
): Node {
  const isDimmed = isAnySelectedForDim && !isSelected && !isReferenced;
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
      isContainer,
      onExpandDownstream,
      onCollapseDownstream,
      onToggleMethodLevel,
    },
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
    nodes: gNodes,
    edges: gEdges,
    layoutState,
    viewState,
    progress,
    expandedMethodNodeIds,
    toggleNodeMethodLevel,
    focusRootId,
    focusUpstreamIds,
    focusExpandedIds,
    focusBoundaryIds,
    searchQuery,
    enterFocus,
    expandFocusDownstream,
    collapseFocusDownstream,
    expandFocusAll,
    exitFocus,
    setSearchQuery,
  } = useGraphStore();
  const { selectedNodeIds, highlightedEdgeIds, activeFilters } = viewState;
  const hasSelection = selectedNodeIds.length > 0;

  // ESC key: exit focus or clear search
  React.useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (focusRootId) exitFocus();
        else if (searchQuery) setSearchQuery('');
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [focusRootId, searchQuery, exitFocus, setSearchQuery]);

  // Base nodes: apply only persistent filters (hideTestClasses, hideManagedPackages)
  const baseNodes = useMemo(() => gNodes.filter((n) => {
    if (activeFilters.hideTestClasses &&
      (n.kind === 'apex-class' || n.kind === 'apex-interface') &&
      (n as ApexClassNode).isTestClass) return false;
    if (activeFilters.hideManagedPackages &&
      'namespace' in n && (n as ApexClassNode).namespace) return false;
    return true;
  }), [gNodes, activeFilters]);

  const baseNodeIds = useMemo(() => new Set(baseNodes.map((n) => n.id)), [baseNodes]);

  // Compute focus visible set from upstream + expanded downstream
  const focusVisibleIds = useMemo(() => {
    if (!focusRootId) return new Set<string>();
    const visible = new Set<string>([focusRootId]);
    for (const id of focusUpstreamIds) visible.add(id);
    for (const expandedId of focusExpandedIds) {
      for (const e of gEdges) {
        if (e.sourceId === expandedId && focusBoundaryIds.has(e.targetId)) {
          visible.add(e.targetId);
        }
      }
    }
    return visible;
  }, [focusRootId, focusUpstreamIds, focusExpandedIds, focusBoundaryIds, gEdges]);

  // Filtered nodes: apply focus or search on top of base
  const filteredNodes = useMemo(() => {
    if (focusRootId) return baseNodes.filter((n) => focusVisibleIds.has(n.id));
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      return baseNodes.filter((n) => n.label.toLowerCase().includes(q));
    }
    return baseNodes;
  }, [baseNodes, focusRootId, focusVisibleIds, searchQuery]);

  const filteredNodeIds = useMemo(() => new Set(filteredNodes.map((n) => n.id)), [filteredNodes]);

  // Set of class node IDs that are individually expanded to method level
  const expandedClassIds = useMemo(() => {
    const ids = new Set<string>();
    for (const n of filteredNodes) {
      if (isApexClass(n) && expandedMethodNodeIds.has(n.id)) {
        ids.add(n.id);
      }
    }
    return ids;
  }, [filteredNodes, expandedMethodNodeIds]);

  // Visible method IDs across all expanded class nodes
  const visibleMethodIds = useMemo(() => {
    if (expandedClassIds.size === 0) return null;
    const ids = new Set<string>();
    for (const n of filteredNodes) {
      if (isApexClass(n) && expandedClassIds.has(n.id)) {
        for (const m of n.methods) {
          if (m.accessModifier !== 'private') ids.add(m.id);
        }
      }
    }
    return ids;
  }, [expandedClassIds, filteredNodes]);

  const filteredEdges = useMemo(() => {
    const anyExpanded = expandedClassIds.size > 0;

    return gEdges.filter((e) => {
      const srcIsMethod = e.sourceId.startsWith('method:');
      const tgtIsMethod = e.targetId.startsWith('method:');

      // Method-level edges: show only when both endpoint classes are expanded
      if (srcIsMethod || tgtIsMethod) {
        if (!anyExpanded || !visibleMethodIds) return false;
        const srcOk = srcIsMethod
          ? visibleMethodIds.has(e.sourceId)
          : filteredNodeIds.has(e.sourceId);
        const tgtOk = tgtIsMethod
          ? visibleMethodIds.has(e.targetId)
          : filteredNodeIds.has(e.targetId);
        return srcOk && tgtOk;
      }

      // Class-level edges: both nodes must be visible
      if (!filteredNodeIds.has(e.sourceId) || !filteredNodeIds.has(e.targetId)) return false;

      if (anyExpanded) {
        const srcExpanded = expandedClassIds.has(e.sourceId);
        const tgtExpanded = expandedClassIds.has(e.targetId);
        // calls/instantiates: hide when both sides expanded (method-level edges replace them)
        if ((e.kind === 'calls' || e.kind === 'instantiates') && srcExpanded && tgtExpanded) {
          return false;
        }
        // soql/dml at class level: hide when source is expanded (method→sobject replaces)
        if ((e.kind === 'soql-references' || e.kind.startsWith('dml-')) && srcExpanded) {
          return false;
        }
      }

      return true;
    });
  }, [gEdges, filteredNodeIds, expandedClassIds, visibleMethodIds]);

  // Per-node expand/collapse state in focus mode
  const nodeExpandState = useMemo(() => {
    if (!focusRootId) return new Map<string, { canExpand: boolean; canCollapse: boolean }>();
    const map = new Map<string, { canExpand: boolean; canCollapse: boolean }>();
    for (const n of filteredNodes) {
      const hasHiddenDownstream = gEdges.some(
        (e) => e.sourceId === n.id && focusBoundaryIds.has(e.targetId) && !focusVisibleIds.has(e.targetId)
      );
      const isExpanded = focusExpandedIds.has(n.id);
      const hasAnyDownstreamInBoundary = gEdges.some(
        (e) => e.sourceId === n.id && focusBoundaryIds.has(e.targetId)
      );
      if (!hasAnyDownstreamInBoundary) continue;
      map.set(n.id, {
        canExpand: hasHiddenDownstream,
        canCollapse: isExpanded,
      });
    }
    return map;
  }, [focusRootId, filteredNodes, gEdges, focusBoundaryIds, focusVisibleIds, focusExpandedIds]);

  // Referenced nodes for edge highlight (only in non-focus mode)
  const referencedNodeIds = useMemo(() => {
    const refs = new Set<string>();
    if (!hasSelection || focusRootId) return refs;
    const hlSet = new Set(highlightedEdgeIds);
    for (const e of gEdges) {
      if (hlSet.has(e.id)) { refs.add(e.sourceId); refs.add(e.targetId); }
    }
    return refs;
  }, [hasSelection, focusRootId, highlightedEdgeIds, gEdges]);

  // In focus mode, suppress dim effect
  const isAnySelectedForDim = hasSelection && !focusRootId;

  // -----------------------------------------------------------------------
  // Build RF nodes: mix of method-expanded containers and flat class nodes
  // -----------------------------------------------------------------------
  const rfNodesBase = useMemo(() => {
    const topLevelNodes: Node[] = [];
    const methodChildNodes: Node[] = [];

    for (const n of filteredNodes) {
      const pos = layoutState[n.id] ?? { x: 0, y: 0 };

      if (isApexClass(n) && expandedClassIds.has(n.id)) {
        // Render as container with method children
        const publicMethods = n.methods.filter(m => m.accessModifier !== 'private');
        const { width, height } = containerSize(publicMethods.length);
        topLevelNodes.push({
          id: n.id,
          type: 'apexClass',
          position: pos,
          style: { width, height },
          data: { graphNode: n, isContainer: true },
        });
        publicMethods.forEach((method, i) => {
          methodChildNodes.push({
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
        topLevelNodes.push({
          id: n.id,
          type: nodeTypeForKind(n.kind),
          position: pos,
          data: { graphNode: n },
        });
      }
    }

    // Run Dagre on top-level nodes if no positions stored yet
    const needsLayout = !topLevelNodes.some((cn) => layoutState[cn.id]);
    if (needsLayout) {
      const rfEdgesForLayout: Edge[] = filteredEdges
        .filter(e => !e.sourceId.startsWith('method:') && !e.targetId.startsWith('method:'))
        .map((e) => ({ id: e.id, source: e.sourceId, target: e.targetId }));
      const laid = applyDagreLayout(topLevelNodes, rfEdgesForLayout, 'LR');
      return [...laid, ...methodChildNodes];
    }
    return [...topLevelNodes, ...methodChildNodes];
  }, [filteredNodes, filteredEdges, layoutState, expandedClassIds]);

  // Merge highlight / dim / interaction state onto top-level nodes
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
      const containerFlag = expandedClassIds.has(rfNode.id) && isApexClass(gNode);
      const expandState = nodeExpandState.get(rfNode.id);
      const onToggle = isApexClass(gNode)
        ? () => toggleNodeMethodLevel(rfNode.id)
        : undefined;
      return toRFNode(
        gNode,
        rfNode.position,
        rfNode.style as React.CSSProperties | undefined,
        isSelected,
        isReferenced,
        isAnySelectedForDim,
        onOpenFile,
        containerFlag,
        expandState?.canExpand ? () => expandFocusDownstream(rfNode.id) : undefined,
        expandState?.canCollapse ? () => collapseFocusDownstream(rfNode.id) : undefined,
        onToggle,
      );
    }),
  [rfNodesBase, gNodes, selectedNodeIds, referencedNodeIds, isAnySelectedForDim, expandedClassIds, nodeExpandState, expandFocusDownstream, collapseFocusDownstream, toggleNodeMethodLevel]);

  const rfEdges: Edge[] = useMemo(() =>
    filteredEdges.map((e) => toRFEdge(e, highlightedEdgeIds.includes(e.id), isAnySelectedForDim)),
  [filteredEdges, highlightedEdgeIds, isAnySelectedForDim]);

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

  // Single click: enter focus mode (method child nodes: ignore)
  const onNodeClick = useCallback((_: React.MouseEvent, node: Node) => {
    if (node.parentId) return;
    enterFocus(node.id, baseNodeIds);
  }, [enterFocus, baseNodeIds]);

  // Double click: open file in editor
  const onNodeDoubleClick = useCallback((_: React.MouseEvent, node: Node) => {
    if (node.parentId) return;
    const gNode = gNodes.find((n) => n.id === node.id);
    if (!gNode || !hasLocation(gNode)) return;
    postMessage({ type: 'OPEN_FILE', payload: { uri: gNode.uri, range: gNode.range } });
  }, [gNodes]);

  const onPaneClick = useCallback(() => {
    if (focusRootId) exitFocus();
    else useGraphStore.getState().clearHighlight();
  }, [focusRootId, exitFocus]);

  const isEmpty = gNodes.length === 0 && !progress;

  const focusRootLabel = focusRootId
    ? (gNodes.find((n) => n.id === focusRootId)?.label ?? focusRootId)
    : null;

  const anyMethodExpanded = expandedClassIds.size > 0;

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

      {/* Search box (top left) */}
      <div style={{
        position: 'absolute', top: 8, left: 8,
        display: 'flex', alignItems: 'center', gap: 4,
      }}>
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="クラスを検索…"
          style={{
            background: '#1e1e2e',
            border: `1px solid ${searchQuery ? '#4a90d9' : '#333'}`,
            borderRadius: 4,
            color: '#cce4f7',
            fontSize: 11,
            padding: '3px 8px',
            width: 160,
            outline: 'none',
          }}
        />
        {searchQuery && (
          <button
            onClick={() => setSearchQuery('')}
            style={{
              background: 'none', border: 'none', color: '#666',
              fontSize: 13, cursor: 'pointer', padding: '0 2px',
            }}
          >
            ×
          </button>
        )}
      </div>

      {/* Filter toggles (top right) */}
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
          color: '#555', pointerEvents: 'none',
          display: 'flex', alignItems: 'center', gap: 8,
        }}>
          {focusRootId ? (
            <>
              <span style={{ color: '#ff8c00' }}>
                フォーカス: {focusRootLabel}
              </span>
              <span>{filteredNodes.length} ノード表示中</span>
              <button
                onClick={expandFocusAll}
                style={{
                  pointerEvents: 'all',
                  background: '#1e1e2e',
                  border: '1px solid #444',
                  color: '#aaa',
                  fontSize: 10,
                  borderRadius: 3,
                  padding: '1px 6px',
                  cursor: 'pointer',
                }}
              >
                すべて展開
              </button>
              <span style={{ color: '#444' }}>ESCで解除</span>
            </>
          ) : (
            <>
              <span>{filteredNodes.length} nodes · {filteredEdges.length} edges</span>
              {anyMethodExpanded && (
                <span style={{ color: '#4a90d9' }}>{expandedClassIds.size} クラス展開中</span>
              )}
              {filteredEdges.some((e) => e.kind === 'instantiates' || e.kind === 'calls') && (
                <span style={{ display: 'flex', gap: 4 }}>
                  {filteredEdges.filter((e) => e.kind === 'instantiates').length > 0 && (
                    <span style={{ color: '#44ccbb' }}>
                      {filteredEdges.filter((e) => e.kind === 'instantiates').length} new
                    </span>
                  )}
                  {filteredEdges.filter((e) => e.kind === 'calls').length > 0 && (
                    <span style={{ color: '#bb88ff' }}>
                      {filteredEdges.filter((e) => e.kind === 'calls').length} calls
                    </span>
                  )}
                </span>
              )}
              {hasSelection && (
                <span style={{ color: '#ffd700' }}>
                  参照ハイライト中 — クリックで解除
                </span>
              )}
            </>
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
