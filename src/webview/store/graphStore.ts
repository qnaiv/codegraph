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
  focusRootId: string | null;
  focusUpstreamIds: Set<string>;
  focusExpandedIds: Set<string>;
  focusBoundaryIds: Set<string>;
  searchQuery: string;

  // オンデマンドスキャン状態
  activeFocusLabel: string;
  scanDepth: 1 | 2 | 3;
  isPinned: boolean;

  setSnapshot: (snapshot: GraphSnapshot) => void;
  setGranularity: (level: GranularityLevel) => void;
  setSelectedNodes: (ids: string[]) => void;
  setReferences: (nodeId: string, locations: LSPRange[]) => void;
  clearHighlight: () => void;
  updateFilter: (patch: Partial<NodeFilter>) => void;
  updateNodePosition: (nodeId: string, pos: XYPosition) => void;
  setProgress: (progress: Progress) => void;
  enterFocus: (rootId: string, baseNodeIds: Set<string>) => void;
  expandFocusDownstream: (nodeId: string) => void;
  collapseFocusDownstream: (nodeId: string) => void;
  expandFocusAll: () => void;
  exitFocus: () => void;
  setSearchQuery: (q: string) => void;
  setActiveFocusLabel: (label: string) => void;
  setScanDepth: (d: 1 | 2 | 3) => void;
  setIsPinned: (pinned: boolean) => void;
}

export const useGraphStore = create<GraphStore>((set, get) => ({
  nodes: [],
  edges: [],
  annotations: [],
  layoutState: {},
  viewState: defaultViewState,
  progress: null,
  referenceMap: new Map(),
  focusRootId: null,
  focusUpstreamIds: new Set(),
  focusExpandedIds: new Set(),
  focusBoundaryIds: new Set(),
  searchQuery: '',
  activeFocusLabel: '',
  scanDepth: 2,
  isPinned: false,

  setSnapshot(snapshot) {
    set({
      nodes: snapshot.nodes,
      edges: snapshot.edges,
      annotations: snapshot.annotations,
      layoutState: snapshot.layoutState,
      viewState: snapshot.viewState,
      progress: null,
      referenceMap: new Map(),
      focusRootId: null,
      focusUpstreamIds: new Set(),
      focusExpandedIds: new Set(),
      focusBoundaryIds: new Set(),
      searchQuery: '',
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

  setProgress(progress) {
    set({ progress });
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

  setScanDepth(d) {
    set({ scanDepth: d });
  },

  setIsPinned(pinned) {
    set({ isPinned: pinned });
  },
}));
