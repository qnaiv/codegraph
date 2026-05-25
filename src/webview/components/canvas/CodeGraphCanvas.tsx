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
// Container sizing constants (must match ApexClassNode.tsx)
// -----------------------------------------------------------------------
const CONTAINER_W            = 220;
const CONTAINER_HEADER_H     = 56;
const METHOD_ITEM_H          = 22;   // compact row (no doc comment)
const METHOD_ITEM_DETAIL_H   = 40;   // rich row (with doc comment line)
export const MAX_METHOD_SCROLL_H = 280; // max scrollable method area
const CONTAINER_PAD_B        = 6;

function containerSize(methodCount: number, detailCount = 0) {
  // detailCount rows at DETAIL_H, remainder at compact H
  const compactCount = Math.max(0, methodCount - detailCount);
  const methodAreaH = methodCount > 0
    ? Math.min(compactCount * METHOD_ITEM_H + detailCount * METHOD_ITEM_DETAIL_H, MAX_METHOD_SCROLL_H)
    : 0;
  return { width: CONTAINER_W, height: Math.max(CONTAINER_HEADER_H + methodAreaH + CONTAINER_PAD_B, 80) };
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

function classIdFromMethodId(methodId: string): string {
  return `cls:${methodId.replace(/^method:/, '').split('.')[0]}`;
}

function toRFNode(
  gNode: GraphNode,
  pos: { x: number; y: number },
  existingStyle: React.CSSProperties | undefined,
  existingData: Record<string, unknown>,
  isSelected: boolean,
  isReferenced: boolean,
  isAnySelectedForDim: boolean,
  onOpenFile: () => void,
  onExpandDownstream: (() => void) | undefined,
  onCollapseDownstream: (() => void) | undefined,
  onToggleMethodLevel: (() => void) | undefined,
  onMethodClick: ((methodId: string) => void) | undefined,
): Node {
  const isDimmed = isAnySelectedForDim && !isSelected && !isReferenced;
  const isHighlighted = isSelected || isReferenced;
  return {
    id: gNode.id,
    type: nodeTypeForKind(gNode.kind),
    position: pos,
    data: {
      ...existingData,
      isDimmed,
      isHighlighted,
      onOpenFile,
      onExpandDownstream,
      onCollapseDownstream,
      onToggleMethodLevel,
      onMethodClick,
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
    selectedMethodId,
    toggleNodeMethodLevel,
    selectMethod,
    clearMethodSelection,
    focusRootId,
    focusUpstreamIds,
    focusExpandedIds,
    focusBoundaryIds,
    searchQuery,
    activeFocusLabel,
    scanDepth,
    followMode,
    enterFocus,
    expandFocusDownstream,
    collapseFocusDownstream,
    expandFocusAll,
    exitFocus,
    setSearchQuery,
    setScanDepth,
    setFollowMode,
  } = useGraphStore();
  const { selectedNodeIds, highlightedEdgeIds, activeFilters } = viewState;
  const hasSelection = selectedNodeIds.length > 0;

  // ESC key: clear method selection → exit focus → clear search
  React.useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (selectedMethodId) clearMethodSelection();
        else if (focusRootId) exitFocus();
        else if (searchQuery) setSearchQuery('');
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [selectedMethodId, clearMethodSelection, focusRootId, searchQuery, exitFocus, setSearchQuery]);

  // Base nodes: persistent filters (hideTestClasses, hideManagedPackages)
  const baseNodes = useMemo(() => gNodes.filter((n) => {
    if (activeFilters.hideTestClasses &&
      (n.kind === 'apex-class' || n.kind === 'apex-interface') &&
      (n as ApexClassNode).isTestClass) return false;
    if (activeFilters.hideManagedPackages &&
      'namespace' in n && (n as ApexClassNode).namespace) return false;
    return true;
  }), [gNodes, activeFilters]);

  const baseNodeIds = useMemo(() => new Set(baseNodes.map((n) => n.id)), [baseNodes]);

  // -----------------------------------------------------------------------
  // Method focus: compute which nodes to show and which methods to highlight
  // -----------------------------------------------------------------------
  const methodFocusInfo = useMemo(() => {
    if (!selectedMethodId) return null;
    const sourceClassId = classIdFromMethodId(selectedMethodId);
    const calleeClassIds = new Set<string>([sourceClassId]);
    const calleeMethodIds = new Set<string>();

    for (const e of gEdges) {
      if (e.sourceId !== selectedMethodId) continue;
      if (e.targetId.startsWith('method:')) {
        const targetClassId = classIdFromMethodId(e.targetId);
        if (targetClassId !== sourceClassId) {
          calleeClassIds.add(targetClassId);
          calleeMethodIds.add(e.targetId);
        }
      }
      if (e.targetId.startsWith('sobject:')) {
        calleeClassIds.add(e.targetId);
      }
    }
    return { sourceClassId, calleeClassIds, calleeMethodIds };
  }, [selectedMethodId, gEdges]);

  // Focus visible set (class focus mode)
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

  // Filtered nodes: method focus > class focus > search > all
  const filteredNodes = useMemo(() => {
    if (methodFocusInfo) {
      return baseNodes.filter((n) => methodFocusInfo.calleeClassIds.has(n.id));
    }
    if (focusRootId) return baseNodes.filter((n) => focusVisibleIds.has(n.id));
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      return baseNodes.filter((n) => n.label.toLowerCase().includes(q));
    }
    return baseNodes;
  }, [baseNodes, methodFocusInfo, focusRootId, focusVisibleIds, searchQuery]);

  const filteredNodeIds = useMemo(() => new Set(filteredNodes.map((n) => n.id)), [filteredNodes]);

  // Classes expanded to method level
  const expandedClassIds = useMemo(() => {
    if (methodFocusInfo) {
      // Method focus: expand all shown classes
      const ids = new Set<string>();
      for (const n of filteredNodes) {
        if (isApexClass(n)) ids.add(n.id);
      }
      return ids;
    }
    const ids = new Set<string>();
    for (const n of filteredNodes) {
      if (isApexClass(n) && expandedMethodNodeIds.has(n.id)) ids.add(n.id);
    }
    return ids;
  }, [filteredNodes, expandedMethodNodeIds, methodFocusInfo]);

  // Edges: class-level only (methods rendered as HTML, no React Flow child nodes)
  const filteredEdges = useMemo(() =>
    gEdges.filter((e) =>
      !e.sourceId.startsWith('method:') &&
      !e.targetId.startsWith('method:') &&
      filteredNodeIds.has(e.sourceId) &&
      filteredNodeIds.has(e.targetId),
    ),
  [gEdges, filteredNodeIds]);

  // Per-node expand/collapse state in class focus mode
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
      map.set(n.id, { canExpand: hasHiddenDownstream, canCollapse: isExpanded });
    }
    return map;
  }, [focusRootId, filteredNodes, gEdges, focusBoundaryIds, focusVisibleIds, focusExpandedIds]);

  // Referenced nodes for edge highlight
  const referencedNodeIds = useMemo(() => {
    const refs = new Set<string>();
    if (!hasSelection || focusRootId) return refs;
    const hlSet = new Set(highlightedEdgeIds);
    for (const e of gEdges) {
      if (hlSet.has(e.id)) { refs.add(e.sourceId); refs.add(e.targetId); }
    }
    return refs;
  }, [hasSelection, focusRootId, highlightedEdgeIds, gEdges]);

  const isAnySelectedForDim = hasSelection && !focusRootId;

  // -----------------------------------------------------------------------
  // Build RF nodes: containers (HTML method list) or flat class nodes
  // No React Flow method child nodes — methods are HTML inside container
  // -----------------------------------------------------------------------
  const rfNodesBase = useMemo(() => {
    const topLevelNodes: Node[] = [];

    for (const n of filteredNodes) {
      const pos = layoutState[n.id] ?? { x: 0, y: 0 };

      if (isApexClass(n) && expandedClassIds.has(n.id)) {
        const publicMethods = n.methods.filter(m => m.accessModifier !== 'private');
        // Callee classes: show only the called methods
        const isCalleeClass = methodFocusInfo !== null && n.id !== methodFocusInfo.sourceClassId;
        const shownCount = (isCalleeClass && methodFocusInfo)
          ? publicMethods.filter(m => methodFocusInfo.calleeMethodIds.has(m.id)).length
          : publicMethods.length;
        // Only the one selected method row is detail-sized; all others stay compact
        const detailCount = (selectedMethodId && publicMethods.some(m => m.id === selectedMethodId)) ? 1 : 0;
        const { width, height } = containerSize(shownCount, detailCount);
        topLevelNodes.push({
          id: n.id,
          type: 'apexClass',
          position: pos,
          style: { width, height },
          data: {
            graphNode: n,
            isContainer: true,
            isCalleeClass,
            calleeMethodIds: methodFocusInfo?.calleeMethodIds ?? null,
            selectedMethodId,
          },
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

    const needsLayout = !topLevelNodes.some((cn) => layoutState[cn.id]);
    if (needsLayout) {
      const rfEdgesForLayout: Edge[] = filteredEdges.map((e) => ({
        id: e.id, source: e.sourceId, target: e.targetId,
      }));
      return applyDagreLayout(topLevelNodes, rfEdgesForLayout, 'LR');
    }
    return topLevelNodes;
  }, [filteredNodes, filteredEdges, layoutState, expandedClassIds, methodFocusInfo, selectedMethodId]);

  // Method click callback
  const handleMethodClick = useCallback((methodId: string) => {
    if (selectedMethodId === methodId) {
      clearMethodSelection();
    } else {
      selectMethod(methodId);
    }
  }, [selectedMethodId, selectMethod, clearMethodSelection]);

  // Merge highlight / dim / interaction onto nodes
  const rfNodes: Node[] = useMemo(() =>
    rfNodesBase.map((rfNode) => {
      const gNode = gNodes.find((n) => n.id === rfNode.id);
      if (!gNode) return rfNode;

      const isSelected   = selectedNodeIds.includes(rfNode.id);
      const isReferenced = referencedNodeIds.has(rfNode.id);
      const onOpenFile = () => {
        if (hasLocation(gNode)) {
          postMessage({ type: 'OPEN_FILE', payload: { uri: gNode.uri, range: gNode.range } });
        }
      };
      const expandState = nodeExpandState.get(rfNode.id);
      const onToggle = isApexClass(gNode) && !selectedMethodId
        ? () => toggleNodeMethodLevel(rfNode.id)
        : undefined;
      const onMethodClickForNode = isApexClass(gNode) ? handleMethodClick : undefined;

      return toRFNode(
        gNode,
        rfNode.position,
        rfNode.style as React.CSSProperties | undefined,
        rfNode.data as Record<string, unknown>,
        isSelected,
        isReferenced,
        isAnySelectedForDim,
        onOpenFile,
        expandState?.canExpand ? () => expandFocusDownstream(rfNode.id) : undefined,
        expandState?.canCollapse ? () => collapseFocusDownstream(rfNode.id) : undefined,
        onToggle,
        onMethodClickForNode,
      );
    }),
  [rfNodesBase, gNodes, selectedNodeIds, referencedNodeIds, isAnySelectedForDim, selectedMethodId,
   nodeExpandState, expandFocusDownstream, collapseFocusDownstream, toggleNodeMethodLevel, handleMethodClick]);

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

  // Single click: if method focus active, clear it; otherwise enter class focus
  const onNodeClick = useCallback((_: React.MouseEvent, node: Node) => {
    if (selectedMethodId) {
      clearMethodSelection();
      return;
    }
    enterFocus(node.id, baseNodeIds);
  }, [enterFocus, baseNodeIds, selectedMethodId, clearMethodSelection]);

  // Double click: open file in editor
  const onNodeDoubleClick = useCallback((_: React.MouseEvent, node: Node) => {
    const gNode = gNodes.find((n) => n.id === node.id);
    if (!gNode || !hasLocation(gNode)) return;
    postMessage({ type: 'OPEN_FILE', payload: { uri: gNode.uri, range: gNode.range } });
  }, [gNodes]);

  const onPaneClick = useCallback(() => {
    if (selectedMethodId) { clearMethodSelection(); return; }
    if (focusRootId) exitFocus();
    else useGraphStore.getState().clearHighlight();
  }, [selectedMethodId, clearMethodSelection, focusRootId, exitFocus]);

  const isEmpty = gNodes.length === 0 && !progress;
  const focusRootLabel = focusRootId
    ? (gNodes.find((n) => n.id === focusRootId)?.label ?? focusRootId)
    : null;
  const selectedMethodLabel = selectedMethodId
    ? selectedMethodId.replace(/^method:/, '').replace('.', '.')
    : null;
  const anyMethodExpanded = expandedClassIds.size > 0 && !selectedMethodId;

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
            borderRadius: 4, color: '#cce4f7', fontSize: 11,
            padding: '3px 8px', width: 160, outline: 'none',
          }}
        />
        {searchQuery && (
          <button
            onClick={() => setSearchQuery('')}
            style={{ background: 'none', border: 'none', color: '#666', fontSize: 13, cursor: 'pointer', padding: '0 2px' }}
          >
            ×
          </button>
        )}
      </div>

      {/* Top-right toolbar */}
      <div style={{ position: 'absolute', top: 8, right: 8, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
        {activeFocusLabel ? (
          <span style={{
            color: '#4a90d9', fontSize: 11, padding: '3px 8px',
            background: '#0e1525', border: '1px solid #2a3a5a', borderRadius: 4,
            maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }} title={activeFocusLabel}>
            {activeFocusLabel}
          </span>
        ) : (
          <span style={{ color: '#444', fontSize: 11, padding: '3px 8px' }}>
            .cls ファイルを開いてください
          </span>
        )}

        <div style={{ display: 'flex', border: '1px solid #333', borderRadius: 4, overflow: 'hidden' }}>
          {([1, 2, 3] as const).map((d) => (
            <button
              key={d}
              onClick={() => { setScanDepth(d); postMessage({ type: 'SET_SCAN_DEPTH', payload: { depth: d } }); }}
              style={{
                background: scanDepth === d ? '#1a3a5a' : '#1e1e2e',
                color: scanDepth === d ? '#cce4f7' : '#666',
                border: 'none',
                borderRight: d < 3 ? '1px solid #333' : 'none',
                padding: '3px 8px', fontSize: 11, cursor: 'pointer',
              }}
            >
              {d}
            </button>
          ))}
        </div>

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

        <button
          onClick={() => { const next = !followMode; setFollowMode(next); postMessage({ type: 'FOLLOW_MODE', payload: { enabled: next } }); }}
          title={followMode ? 'エディタ追従: ON（クリックでOFF）' : 'エディタ追従: OFF（クリックでON）'}
          style={{
            background: followMode ? '#1a3a2a' : '#1e1e2e',
            color: followMode ? '#4acca4' : '#666',
            border: `1px solid ${followMode ? '#2a9d6a' : '#333'}`,
            borderRadius: 4, padding: '3px 9px', fontSize: 11, cursor: 'pointer',
          }}
        >
          {followMode ? '追従 ON' : '追従 OFF'}
        </button>

        <button
          onClick={() => postMessage({ type: 'REFRESH_GRAPH' })}
          disabled={!!progress}
          title="ワークスペース全体をスキャン（時間がかかります）"
          style={{
            background: '#1e1e2e', color: progress ? '#444' : '#888',
            border: '1px solid #333', borderRadius: 4,
            padding: '3px 9px', fontSize: 11, cursor: progress ? 'not-allowed' : 'pointer',
          }}
        >
          ↺ 全スキャン
        </button>
      </div>

      {/* Status bar */}
      {!isEmpty && !progress && (
        <div style={{
          position: 'absolute', bottom: 8, left: 8, fontSize: 10,
          color: '#555', pointerEvents: 'none',
          display: 'flex', alignItems: 'center', gap: 8,
        }}>
          {selectedMethodId ? (
            <>
              <span style={{ color: '#bb88ff' }}>メソッドフォーカス: {selectedMethodLabel}</span>
              <span>{filteredNodes.length} ノード表示中</span>
              <span style={{ color: '#444' }}>ESCで解除</span>
            </>
          ) : focusRootId ? (
            <>
              <span style={{ color: '#ff8c00' }}>フォーカス: {focusRootLabel}</span>
              <span>{filteredNodes.length} ノード表示中</span>
              <button
                onClick={expandFocusAll}
                style={{
                  pointerEvents: 'all', background: '#1e1e2e',
                  border: '1px solid #444', color: '#aaa', fontSize: 10,
                  borderRadius: 3, padding: '1px 6px', cursor: 'pointer',
                }}
              >
                すべて展開
              </button>
              <span style={{ color: '#444' }}>ESCで解除</span>
            </>
          ) : (
            <>
              <span>{filteredNodes.length} nodes · {filteredEdges.length} edges{activeFocusLabel ? ` · 深度${scanDepth}` : ''}</span>
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
                <span style={{ color: '#ffd700' }}>参照ハイライト中 — クリックで解除</span>
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
