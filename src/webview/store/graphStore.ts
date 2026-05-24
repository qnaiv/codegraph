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

function bfsAll(rootId: string, edges: GraphEdge[], allowedIds: Set<string>): Set<string> {
  const visited = new Set<string>([rootId]);
  const queue = [rootId];
  while (queue.length > 0) {
    const cur = queue.shift()!;
    for (const e of edges) {
      const neighbor =
        e.sourceId === cur && !visited.has(e.targetId) ? e.targetId
        : e.targetId === cur && !visited.has(e.sourceId) ? e.sourceId
        : null;
      if (neighbor && allowedIds.has(neighbor)) {
        visited.add(neighbor);
        queue.push(neighbor);
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
  focusVisibleIds: Set<string>;
  focusBoundaryIds: Set<string>;
  searchQuery: string;

  setSnapshot: (snapshot: GraphSnapshot) => void;
  setGranularity: (level: GranularityLevel) => void;
  setSelectedNodes: (ids: string[]) => void;
  setReferences: (nodeId: string, locations: LSPRange[]) => void;
  clearHighlight: () => void;
  updateFilter: (patch: Partial<NodeFilter>) => void;
  updateNodePosition: (nodeId: string, pos: XYPosition) => void;
  setProgress: (progress: Progress) => void;
  enterFocus: (rootId: string, baseNodeIds: Set<string>) => void;
  collapseFocus: () => void;
  expandFocusNode: (nodeId: string) => void;
  exitFocus: () => void;
  setSearchQuery: (q: string) => void;
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
  focusVisibleIds: new Set(),
  focusBoundaryIds: new Set(),
  searchQuery: '',

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
      focusVisibleIds: new Set(),
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
    const visible = bfsAll(rootId, edges, baseNodeIds);
    set((s) => ({
      focusRootId: rootId,
      focusVisibleIds: visible,
      focusBoundaryIds: baseNodeIds,
      referenceMap: new Map(),
      viewState: {
        ...s.viewState,
        selectedNodeIds: [rootId],
        highlightedEdgeIds: [],
      },
    }));
  },

  collapseFocus() {
    const { focusRootId, edges, focusBoundaryIds } = get();
    if (!focusRootId) return;
    const visible = new Set<string>([focusRootId]);
    for (const e of edges) {
      if (e.sourceId === focusRootId && focusBoundaryIds.has(e.targetId)) visible.add(e.targetId);
      if (e.targetId === focusRootId && focusBoundaryIds.has(e.sourceId)) visible.add(e.sourceId);
    }
    set({ focusVisibleIds: visible });
  },

  expandFocusNode(nodeId) {
    const { edges, focusVisibleIds, focusBoundaryIds } = get();
    const newVisible = new Set(focusVisibleIds);
    for (const e of edges) {
      if (e.sourceId === nodeId && focusBoundaryIds.has(e.targetId)) newVisible.add(e.targetId);
      if (e.targetId === nodeId && focusBoundaryIds.has(e.sourceId)) newVisible.add(e.sourceId);
    }
    set({ focusVisibleIds: newVisible });
  },

  exitFocus() {
    set((s) => ({
      focusRootId: null,
      focusVisibleIds: new Set(),
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
}));
