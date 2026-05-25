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
  onOpenFile: () => void,
  onExpandDownstream: (() => void) | undefined,
  onCollapseDownstream: (() => void) | undefined,
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
      onExpandDownstream,
      onCollapseDownstream,
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
  const {
    nodes: gNodes,
    edges: gEdges,
    layoutState,
    viewState,
    progress,
    focusRootId,
    focusUpstreamIds,
    focusExpandedIds,
    focusBoundaryIds,
    searchQuery,
    activeFocusLabel,
    scanDepth,
    isPinned,
    enterFocus,
    expandFocusDownstream,
    collapseFocusDownstream,
    expandFocusAll,
    exitFocus,
    setSearchQuery,
    setScanDepth,
    setIsPinned,
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

  const filteredEdges = useMemo(
    () => gEdges.filter((e) => filteredNodeIds.has(e.sourceId) && filteredNodeIds.has(e.targetId)),
    [gEdges, filteredNodeIds]
  );

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

  // Build RF nodes: run Dagre only on first load (no existing layout positions)
  const rfNodesBase = useMemo(() => {
    const needsLayout = !filteredNodes.some((n) => layoutState[n.id]);

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

  // In focus mode, suppress dim effect (only relevant nodes are shown)
  const isAnySelectedForDim = hasSelection && !focusRootId;

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
      const expandState = nodeExpandState.get(rfNode.id);
      return toRFNode(
        gNode,
        rfNode.position,
        isSelected,
        isReferenced,
        isAnySelectedForDim,
        onOpenFile,
        expandState?.canExpand ? () => expandFocusDownstream(rfNode.id) : undefined,
        expandState?.canCollapse ? () => collapseFocusDownstream(rfNode.id) : undefined,
      );
    }),
  [rfNodesBase, gNodes, selectedNodeIds, referencedNodeIds, isAnySelectedForDim, nodeExpandState, expandFocusDownstream, collapseFocusDownstream]);

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

  // Single click: enter focus mode
  const onNodeClick = useCallback((_: React.MouseEvent, node: Node) => {
    enterFocus(node.id, baseNodeIds);
  }, [enterFocus, baseNodeIds]);

  // Double click: open file in editor
  const onNodeDoubleClick = useCallback((_: React.MouseEvent, node: Node) => {
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

      {/* Top-right toolbar */}
      <div style={{ position: 'absolute', top: 8, right: 8, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
        {/* フォーカスファイル名 */}
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

        {/* 深度セレクター */}
        <div style={{ display: 'flex', border: '1px solid #333', borderRadius: 4, overflow: 'hidden' }}>
          {([1, 2, 3] as const).map((d) => (
            <button
              key={d}
              onClick={() => {
                setScanDepth(d);
                postMessage({ type: 'SET_SCAN_DEPTH', payload: { depth: d } });
              }}
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

        {/* 固定トグル */}
        <button
          onClick={() => {
            const next = !isPinned;
            setIsPinned(next);
            postMessage({ type: 'PIN_FOCUS', payload: { pinned: next } });
          }}
          title={isPinned ? 'エディタ切り替えに追従しない（クリックで追従に戻す）' : 'エディタ切り替えに追従中（クリックで固定）'}
          style={{
            background: isPinned ? '#2a1a3a' : '#1e1e2e',
            color: isPinned ? '#cc88ff' : '#666',
            border: `1px solid ${isPinned ? '#7a44bb' : '#333'}`,
            borderRadius: 4, padding: '3px 9px', fontSize: 11, cursor: 'pointer',
          }}
        >
          {isPinned ? '📌 固定中' : '📍 追従中'}
        </button>

        {/* フィルタートグル */}
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

        {/* 全スキャンボタン */}
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
              <span>{filteredNodes.length} nodes · {filteredEdges.length} edges{activeFocusLabel ? ` · 深度${scanDepth}` : ''}</span>
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
          position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center', gap: 8,
          color: '#444', fontSize: 14, pointerEvents: 'none',
        }}>
          <span>{activeFocusLabel ? `${activeFocusLabel} の関連ノードが見つかりませんでした` : '.cls または .trigger ファイルをエディタで開いてください'}</span>
          <span style={{ fontSize: 11 }}>ツールバーの「↺ 全スキャン」でワークスペース全体を表示することもできます</span>
        </div>
      )}
    </div>
  );
}
