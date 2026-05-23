import { GraphNode, GraphEdge, GraphSnapshot, XYPosition } from '../../shared/types';

export class GraphStore {
  private snapshot: GraphSnapshot | null = null;
  private nodeIndex = new Map<string, GraphNode>();
  private edgeIndex = new Map<string, GraphEdge>();

  /** uri+line → nodeId, used for reference lookup */
  private locationIndex = new Map<string, string>();

  setSnapshot(snapshot: GraphSnapshot) {
    this.snapshot = snapshot;
    this.nodeIndex.clear();
    this.edgeIndex.clear();
    this.locationIndex.clear();

    for (const node of snapshot.nodes) {
      this.nodeIndex.set(node.id, node);
      if ('uri' in node && 'range' in node && node.uri && node.range) {
        this.locationIndex.set(locationKey(node.uri, node.range.start.line), node.id);
      }
    }

    for (const edge of snapshot.edges) {
      this.edgeIndex.set(edge.id, edge);
    }
  }

  getSnapshot(): GraphSnapshot | null {
    return this.snapshot;
  }

  getNode(id: string): GraphNode | undefined {
    return this.nodeIndex.get(id);
  }

  resolveLocationToNodeId(uri: string, line: number): string | undefined {
    return this.locationIndex.get(locationKey(uri, line));
  }

  updateLayout(positions: Record<string, XYPosition>) {
    if (!this.snapshot) return;
    this.snapshot = {
      ...this.snapshot,
      layoutState: { ...this.snapshot.layoutState, ...positions },
    };
  }
}

function locationKey(uri: string | undefined, line: number): string {
  return `${uri ?? ''}:${line}`;
}
