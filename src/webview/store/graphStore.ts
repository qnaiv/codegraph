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

/** nodeId → set of referencing nodeIds derived from REFERENCES_RESULT */
type ReferenceMap = Map<string, Set<string>>;

interface GraphStore {
  nodes: GraphNode[];
  edges: GraphEdge[];
  annotations: Annotation[];
  layoutState: Record<string, XYPosition>;
  viewState: ViewState;
  progress: Progress | null;
  referenceMap: ReferenceMap;
  showMethodLevel: boolean;

  setSnapshot: (snapshot: GraphSnapshot) => void;
  setGranularity: (level: GranularityLevel) => void;
  setSelectedNodes: (ids: string[]) => void;
  setReferences: (nodeId: string, locations: LSPRange[]) => void;
  clearHighlight: () => void;
  updateFilter: (patch: Partial<NodeFilter>) => void;
  updateNodePosition: (nodeId: string, pos: XYPosition) => void;
  setProgress: (progress: Progress) => void;
  toggleMethodLevel: () => void;
}

export const useGraphStore = create<GraphStore>((set, get) => ({
  nodes: [],
  edges: [],
  annotations: [],
  layoutState: {},
  viewState: defaultViewState,
  progress: null,
  referenceMap: new Map(),
  showMethodLevel: false,

  setSnapshot(snapshot) {
    set({
      nodes: snapshot.nodes,
      edges: snapshot.edges,
      annotations: snapshot.annotations,
      layoutState: snapshot.layoutState,
      viewState: snapshot.viewState,
      progress: null,
      referenceMap: new Map(),
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

    // Find which nodeIds appear in the reference locations
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

    // Highlight edges that touch the selected node or a referencing node
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

  toggleMethodLevel() {
    set((s) => ({
      showMethodLevel: !s.showMethodLevel,
      layoutState: {},  // force Dagre re-layout with new container sizes
    }));
  },
}));
