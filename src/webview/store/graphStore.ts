import { create } from 'zustand';
import {
  GraphSnapshot,
  GraphNode,
  GraphEdge,
  Annotation,
  ViewState,
  NodeFilter,
  GranularityLevel,
  LSPRange,
  XYPosition,
  hasLocation,
} from '../../shared/types';

const defaultFilter: NodeFilter = {
  hideTestClasses: true,
  hideManagedPackages: true,
  sobjectTypes: 'referenced-only',
  minConnectionCount: 0,
  hideInnerClasses: false,
};

const defaultViewState: ViewState = {
  granularity: 'class',
  viewport: { x: 0, y: 0, zoom: 1 },
  selectedNodeIds: [],
  highlightedEdgeIds: [],
  activeFilters: defaultFilter,
  layoutAlgorithm: 'dagre-lr',
};

export interface Progress {
  stage: string;
  percent: number;
}

type ReferenceMap = Map<string, Set<string>>;

/** Reverse BFS: collect all callers (upstream) of rootId within allowedIds. */
function bfsUpstream(rootId: string, edges: GraphEdge[], allowedIds: Set<string>): Set<string> {
  const visited = new Set<string>();
  const queue = [rootId];
  while (queue.length > 0) {
    const cur = queue.shift()!;
    for (const e of edges) {
      const caller = e.targetId === cur && !visited.has(e.sourceId) ? e.sourceId : null;
      if (caller && allowedIds.has(caller)) {
        visited.add(caller);
        queue.push(caller);
      }
    }
  }
  return visited;
}

interface GraphStore {
  nodes: GraphNode[];
  edges: GraphEdge[];
  annotations: Annotation[];
  layoutState: Record<string, XYPosition>;
  viewState: ViewState;
  progress: Progress | null;
  referenceMap: ReferenceMap;
  expandedMethodNodeIds: Set<string>;
  selectedMethodId: string | null;
  focusRootId: string | null;
  focusUpstreamIds: Set<string>;
  focusExpandedIds: Set<string>;
  focusBoundaryIds: Set<string>;
  searchQuery: string;

  // オンデマンドスキャン状態
  activeFocusLabel: string;
  followMode: boolean;
  neighborCounts: Record<string, number>;
  pendingExpansionNodeId: string | null;

  // エラー状態
  errorCode: string | null;
  errorMessage: string | null;

  setSnapshot: (snapshot: GraphSnapshot) => void;
  setGranularity: (level: GranularityLevel) => void;
  setSelectedNodes: (ids: string[]) => void;
  setReferences: (nodeId: string, locations: LSPRange[]) => void;
  clearHighlight: () => void;
  updateFilter: (patch: Partial<NodeFilter>) => void;
  updateNodePosition: (nodeId: string, pos: XYPosition) => void;
  setLayoutState: (positions: Record<string, XYPosition>) => void;
  setProgress: (progress: Progress) => void;
  toggleNodeMethodLevel: (nodeId: string) => void;
  selectMethod: (methodId: string) => void;
  clearMethodSelection: () => void;
  enterFocus: (rootId: string, baseNodeIds: Set<string>) => void;
  expandFocusDownstream: (nodeId: string) => void;
  collapseFocusDownstream: (nodeId: string) => void;
  expandFocusAll: () => void;
  exitFocus: () => void;
  setSearchQuery: (q: string) => void;
  setActiveFocusLabel: (label: string) => void;
  setFollowMode: (enabled: boolean) => void;
  mergeExpansion: (newNodes: GraphNode[], newEdges: GraphEdge[], newCounts: Record<string, number>, expandedNodeId: string, cappedCount: number) => void;
  setPendingExpansion: (nodeId: string | null) => void;
  setError: (code: string, message: string) => void;
  clearError: () => void;
}

export const useGraphStore = create<GraphStore>((set, get) => ({
  nodes: [],
  edges: [],
  annotations: [],
  layoutState: {},
  viewState: defaultViewState,
  progress: null,
  referenceMap: new Map(),
  expandedMethodNodeIds: new Set(),
  selectedMethodId: null,
  focusRootId: null,
  focusUpstreamIds: new Set(),
  focusExpandedIds: new Set(),
  focusBoundaryIds: new Set(),
  searchQuery: '',
  activeFocusLabel: '',
  followMode: false,
  neighborCounts: {},
  pendingExpansionNodeId: null,
  errorCode: null,
  errorMessage: null,

  setSnapshot(snapshot) {
    set({
      nodes: snapshot.nodes,
      edges: snapshot.edges,
      annotations: snapshot.annotations,
      layoutState: snapshot.layoutState,
      viewState: snapshot.viewState,
      progress: null,
      referenceMap: new Map(),
      expandedMethodNodeIds: new Set(),
      selectedMethodId: null,
      focusRootId: null,
      focusUpstreamIds: new Set(),
      focusExpandedIds: new Set(),
      focusBoundaryIds: new Set(),
      searchQuery: '',
      neighborCounts: snapshot.neighborCounts ?? {},
      pendingExpansionNodeId: null,
      errorCode: null,
      errorMessage: null,
    });
  },

  setGranularity(level) {
    set((s) => ({ viewState: { ...s.viewState, granularity: level } }));
  },

  setSelectedNodes(ids) {
    set((s) => ({ viewState: { ...s.viewState, selectedNodeIds: ids } }));
  },

  setReferences(nodeId, locations) {
    const { edges, nodes } = get();

    const refNodeIds = new Set<string>();
    for (const loc of locations) {
      for (const n of nodes) {
        if (
          hasLocation(n) &&
          loc.start.line >= n.range.start.line &&
          loc.end.line <= n.range.end.line
        ) {
          refNodeIds.add(n.id);
        }
      }
    }

    const highlightedEdgeIds = edges
      .filter(
        (e) =>
          e.sourceId === nodeId ||
          e.targetId === nodeId ||
          refNodeIds.has(e.sourceId) ||
          refNodeIds.has(e.targetId)
      )
      .map((e) => e.id);

    const newMap = new Map(get().referenceMap);
    newMap.set(nodeId, refNodeIds);

    set((s) => ({
      referenceMap: newMap,
      viewState: {
        ...s.viewState,
        selectedNodeIds: [nodeId],
        highlightedEdgeIds,
      },
    }));
  },

  clearHighlight() {
    set((s) => ({
      referenceMap: new Map(),
      viewState: {
        ...s.viewState,
        selectedNodeIds: [],
        highlightedEdgeIds: [],
      },
    }));
  },

  updateFilter(patch) {
    set((s) => ({
      viewState: {
        ...s.viewState,
        activeFilters: { ...s.viewState.activeFilters, ...patch },
      },
    }));
  },

  updateNodePosition(nodeId, pos) {
    set((s) => ({ layoutState: { ...s.layoutState, [nodeId]: pos } }));
  },

  setLayoutState(positions) {
    set((s) => ({ layoutState: { ...s.layoutState, ...positions } }));
  },

  setProgress(progress) {
    set({ progress });
  },

  toggleNodeMethodLevel(nodeId: string) {
    set((s) => {
      const next = new Set(s.expandedMethodNodeIds);
      if (next.has(nodeId)) next.delete(nodeId);
      else next.add(nodeId);
      return { expandedMethodNodeIds: next, selectedMethodId: null, layoutState: {} };
    });
  },

  selectMethod(methodId: string) {
    set({ selectedMethodId: methodId, expandedMethodNodeIds: new Set(), layoutState: {} });
  },

  clearMethodSelection() {
    set({ selectedMethodId: null, expandedMethodNodeIds: new Set(), layoutState: {} });
  },

  enterFocus(rootId, baseNodeIds) {
    const { edges } = get();
    const upstream = bfsUpstream(rootId, edges, baseNodeIds);
    set((s) => ({
      focusRootId: rootId,
      focusUpstreamIds: upstream,
      focusExpandedIds: new Set([rootId]),
      focusBoundaryIds: baseNodeIds,
      referenceMap: new Map(),
      viewState: {
        ...s.viewState,
        selectedNodeIds: [rootId],
        highlightedEdgeIds: [],
      },
    }));
  },

  expandFocusDownstream(nodeId) {
    set((s) => ({
      focusExpandedIds: new Set([...s.focusExpandedIds, nodeId]),
    }));
  },

  collapseFocusDownstream(nodeId) {
    set((s) => {
      const next = new Set(s.focusExpandedIds);
      next.delete(nodeId);
      return { focusExpandedIds: next };
    });
  },

  expandFocusAll() {
    set((s) => ({
      focusExpandedIds: new Set(s.focusBoundaryIds),
    }));
  },

  exitFocus() {
    set((s) => ({
      focusRootId: null,
      focusUpstreamIds: new Set(),
      focusExpandedIds: new Set(),
      focusBoundaryIds: new Set(),
      referenceMap: new Map(),
      viewState: {
        ...s.viewState,
        selectedNodeIds: [],
        highlightedEdgeIds: [],
      },
    }));
  },

  setSearchQuery(q) {
    set({ searchQuery: q });
  },

  setActiveFocusLabel(label) {
    set({ activeFocusLabel: label });
  },

  setFollowMode(enabled) {
    set({ followMode: enabled });
  },

  mergeExpansion(newNodes, newEdges, newCounts, expandedNodeId, cappedCount) {
    set((s) => {
      const existingIds = new Set(s.nodes.map((n) => n.id));
      const addedNodes = newNodes.filter((n) => !existingIds.has(n.id));

      const existingEdgeIds = new Set(s.edges.map((e) => e.id));
      const addedEdges = newEdges.filter((e) => !existingEdgeIds.has(e.id));

      // 新ノードを展開済みノードの右側に配置
      const parentPos = s.layoutState[expandedNodeId] ?? { x: 0, y: 0 };
      const newPositions: Record<string, { x: number; y: number }> = {};
      addedNodes.forEach((n, i) => {
        newPositions[n.id] = {
          x: parentPos.x + 300,
          y: parentPos.y + (i - (addedNodes.length - 1) / 2) * 110,
        };
      });

      const updatedCounts = {
        ...s.neighborCounts,
        ...newCounts,
        [expandedNodeId]: cappedCount,
      };

      return {
        nodes: [...s.nodes, ...addedNodes],
        edges: [...s.edges, ...addedEdges],
        layoutState: { ...s.layoutState, ...newPositions },
        neighborCounts: updatedCounts,
        pendingExpansionNodeId: null,
        progress: null,
      };
    });
  },

  setPendingExpansion(nodeId) {
    set({ pendingExpansionNodeId: nodeId });
  },

  setError(code, message) {
    set({ errorCode: code, errorMessage: message });
  },

  clearError() {
    set({ errorCode: null, errorMessage: null });
  },
}));
