import React, { memo } from 'react';
import { Handle, Position, NodeProps } from '@xyflow/react';
import { SObjectNode as SObjectNodeData } from '../../../shared/types';

interface SObjectNodeProps extends NodeProps {
  data: {
    graphNode: SObjectNodeData;
    isDimmed?: boolean;
    onExpandDownstream?: () => void;
    onCollapseDownstream?: () => void;
  };
}

function objectIcon(node: SObjectNodeData): string {
  if (node.isCustomMetadata) return '🔧';
  if (node.isCustom) return '📦';
  return '🗄️';
}

export const SObjectNodeComponent = memo(function SObjectNodeComponent({
  data,
}: SObjectNodeProps) {
  const { graphNode: node, isDimmed, onExpandDownstream, onCollapseDownstream } = data;

  const lookupCount = node.fields.filter(
    (f) => f.fieldType === 'Lookup' || f.fieldType === 'MasterDetail'
  ).length;

  return (
    <>
      <Handle type="target" position={Position.Top} style={{ background: '#4a9d4a' }} />
      <div
        style={{
          background: '#1a3a1a',
          border: '1.5px solid #4a9d4a',
          borderRadius: 8,
          padding: '6px 10px',
          minWidth: 140,
          opacity: isDimmed ? 0.2 : 1,
          transition: 'opacity 0.2s',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
          <span style={{ fontSize: 14, flexShrink: 0 }}>{objectIcon(node)}</span>
          <span style={{ color: '#ccf0cc', fontSize: 12, fontWeight: 600 }}>
            {node.label}
          </span>
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
          {node.fields.length > 0 && (
            <Badge color="#4a9d4a" text={`${node.fields.length} fields`} />
          )}
          {lookupCount > 0 && (
            <Badge color="#7ec8e3" text={`${lookupCount} lookups`} />
          )}
          {node.isCustom && <Badge color="#a8d8a8" text="custom" />}
          {node.isCustomMetadata && <Badge color="#d8c87a" text="mdt" />}
        </div>
        {(onExpandDownstream || onCollapseDownstream) && (
          <ExpandCollapseButtons
            onExpand={onExpandDownstream}
            onCollapse={onCollapseDownstream}
          />
        )}
      </div>
      <Handle type="source" position={Position.Bottom} style={{ background: '#4a9d4a' }} />
    </>
  );
});

function ExpandCollapseButtons({
  onExpand,
  onCollapse,
}: {
  onExpand?: () => void;
  onCollapse?: () => void;
}) {
  return (
    <div style={{ marginTop: 4, display: 'flex', gap: 4 }}>
      {onExpand && (
        <button
          onClick={(e) => { e.stopPropagation(); onExpand(); }}
          title="下位ノードを1ホップ展開"
          style={{
            background: '#1a3a1a',
            border: '1px solid #4a9d4a66',
            color: '#4a9d4a',
            fontSize: 11,
            fontWeight: 700,
            padding: '1px 7px',
            borderRadius: 3,
            cursor: 'pointer',
            lineHeight: 1.4,
          }}
        >
          +
        </button>
      )}
      {onCollapse && (
        <button
          onClick={(e) => { e.stopPropagation(); onCollapse(); }}
          title="下位ノードを折りたたむ"
          style={{
            background: '#3a1a1a',
            border: '1px solid #cc444466',
            color: '#cc6666',
            fontSize: 11,
            fontWeight: 700,
            padding: '1px 7px',
            borderRadius: 3,
            cursor: 'pointer',
            lineHeight: 1.4,
          }}
        >
          −
        </button>
      )}
    </div>
  );
}

function Badge({ color, text }: { color: string; text: string }) {
  return (
    <span
      style={{
        background: `${color}22`,
        border: `1px solid ${color}66`,
        color,
        fontSize: 9,
        padding: '1px 5px',
        borderRadius: 3,
      }}
    >
      {text}
    </span>
  );
}
