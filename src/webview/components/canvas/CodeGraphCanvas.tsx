import React, { useCallback } from 'react';
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

// --- Test nodes used until Phase 1 wires up real data ---
const TEST_NODES: Node[] = [
  {
    id: 'cls:AccountService',
    type: 'default',
    position: { x: 100, y: 100 },
    data: { label: 'AccountService' },
    style: { background: '#1e3a5f', color: '#e8f4fd', border: '1px solid #4a90d9', borderRadius: 8 },
  },
  {
    id: 'cls:ContactService',
    type: 'default',
    position: { x: 400, y: 100 },
    data: { label: 'ContactService' },
    style: { background: '#1e3a5f', color: '#e8f4fd', border: '1px solid #4a90d9', borderRadius: 8 },
  },
  {
    id: 'sobject:Account',
    type: 'default',
    position: { x: 100, y: 300 },
    data: { label: '📦 Account' },
    style: { background: '#1e3a1e', color: '#e8fde8', border: '1px solid #4a9d4a', borderRadius: 8 },
  },
  {
    id: 'sobject:Contact',
    type: 'default',
    position: { x: 400, y: 300 },
    data: { label: '📦 Contact' },
    style: { background: '#1e3a1e', color: '#e8fde8', border: '1px solid #4a9d4a', borderRadius: 8 },
  },
  {
    id: 'trigger:AccountTrigger',
    type: 'default',
    position: { x: 250, y: 500 },
    data: { label: '⚡ AccountTrigger' },
    style: { background: '#3a1e3a', color: '#fde8fd', border: '1px solid #9d4a9d', borderRadius: 8 },
  },
];

const TEST_EDGES: Edge[] = [
  { id: 'e1', source: 'cls:AccountService', target: 'sobject:Account', label: 'SOQL', animated: true },
  { id: 'e2', source: 'cls:ContactService', target: 'sobject:Contact', label: 'DML', animated: true },
  { id: 'e3', source: 'trigger:AccountTrigger', target: 'sobject:Account', label: 'trigger-on' },
  { id: 'e4', source: 'sobject:Contact', target: 'sobject:Account', label: 'Lookup', style: { strokeDasharray: '4' } },
];

export function CodeGraphCanvas() {
  const { viewState } = useGraphStore();
  const [nodes, setNodes] = React.useState<Node[]>(TEST_NODES);
  const [edges, setEdges] = React.useState<Edge[]>(TEST_EDGES);

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => setNodes((nds) => applyNodeChanges(changes, nds)),
    []
  );
  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) => setEdges((eds) => applyEdgeChanges(changes, eds)),
    []
  );

  const onNodeClick = useCallback(
    (_: React.MouseEvent, node: Node) => {
      postMessage({ type: 'GET_REFERENCES', payload: { nodeId: node.id } });
    },
    []
  );

  const onPaneClick = useCallback(() => {
    useGraphStore.getState().clearHighlight();
  }, []);

  return (
    <div style={{ width: '100%', height: '100vh' }}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={onNodeClick}
        onPaneClick={onPaneClick}
        fitView
        colorMode="dark"
      >
        <Background />
        <Controls />
        <MiniMap
          nodeColor={(node) => {
            if (node.id.startsWith('sobject:')) return '#4a9d4a';
            if (node.id.startsWith('trigger:')) return '#9d4a9d';
            return '#4a90d9';
          }}
        />
      </ReactFlow>

      {viewState.activeFilters.hideTestClasses && (
        <div style={{
          position: 'absolute', bottom: 12, left: 12,
          background: 'rgba(0,0,0,0.6)', color: '#888', fontSize: 11,
          padding: '4px 8px', borderRadius: 4, pointerEvents: 'none',
        }}>
          テストクラス非表示
        </div>
      )}
    </div>
  );
}
