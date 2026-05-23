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

interface Progress {
  stage: string;
  percent: number;
}

interface GraphStore {
  // Data
  nodes: GraphNode[];
  edges: GraphEdge[];
  annotations: Annotation[];
  layoutState: Record<string, XYPosition>;
  viewState: ViewState;
  progress: Progress | null;

  // Actions
  setSnapshot: (snapshot: GraphSnapshot) => void;
  setGranularity: (level: GranularityLevel) => void;
  setSelectedNodes: (ids: string[]) => void;
  setReferences: (nodeId: string, locations: LSPRange[]) => void;
  clearHighlight: () => void;
  updateFilter: (patch: Partial<NodeFilter>) => void;
  updateNodePosition: (nodeId: string, pos: XYPosition) => void;
  setProgress: (progress: Progress) => void;
}

export const useGraphStore = create<GraphStore>((set, get) => ({
  nodes: [],
  edges: [],
  annotations: [],
  layoutState: {},
  viewState: defaultViewState,
  progress: null,

  setSnapshot(snapshot) {
    set({
      nodes: snapshot.nodes,
      edges: snapshot.edges,
      annotations: snapshot.annotations,
      layoutState: snapshot.layoutState,
      viewState: snapshot.viewState,
      progress: null,
    });
  },

  setGranularity(level) {
    set((s) => ({
      viewState: { ...s.viewState, granularity: level },
    }));
  },

  setSelectedNodes(ids) {
    set((s) => ({
      viewState: { ...s.viewState, selectedNodeIds: ids },
    }));
  },

  setReferences(_nodeId, _locations) {
    // Phase 1: derive highlightedEdgeIds from locations and current edges
    const { edges } = get();
    const highlighted = edges.map((e) => e.id); // placeholder; refined in Phase 1
    set((s) => ({
      viewState: { ...s.viewState, highlightedEdgeIds: highlighted },
    }));
  },

  clearHighlight() {
    set((s) => ({
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
    set((s) => ({
      layoutState: { ...s.layoutState, [nodeId]: pos },
    }));
  },

  setProgress(progress) {
    set({ progress });
  },
}));
