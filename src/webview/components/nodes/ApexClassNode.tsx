import React, { memo } from 'react';
import { Handle, Position, NodeProps } from '@xyflow/react';
import { ApexClassNode as ApexClassNodeData } from '../../../shared/types';

interface ApexClassNodeProps extends NodeProps {
  data: {
    graphNode: ApexClassNodeData;
    isHighlighted?: boolean;
    isDimmed?: boolean;
    onOpenFile?: () => void;
    onExpandDownstream?: () => void;
    onCollapseDownstream?: () => void;
  };
}

const KIND_ICON: Record<ApexClassNodeData['kind'], string> = {
  'apex-class': '{}',
  'apex-interface': '«I»',
  'apex-enum': '«E»',
};

const ANNOTATION_ICONS: Record<string, string> = {
  AuraEnabled: '⚡',
  InvocableMethod: '🔗',
  Future: '⏳',
  Schedulable: '📅',
  Batchable: '📦',
  isTest: '🧪',
};

export const ApexClassNodeComponent = memo(function ApexClassNodeComponent({
  data,
}: ApexClassNodeProps) {
  const { graphNode: node, isDimmed, onOpenFile, onExpandDownstream, onCollapseDownstream } = data;

  const soqlCount = node.methods.reduce((n, m) => n + m.soqlQueries.length, 0);
  const dmlCount = node.methods.reduce((n, m) => n + m.dmlOperations.length, 0);

  const annotationIcons = node.annotations
    .map((a) => ANNOTATION_ICONS[a.name])
    .filter(Boolean)
    .join(' ');

  const borderColor = node.kind === 'apex-interface'
    ? '#7ec8e3'
    : node.kind === 'apex-enum'
      ? '#a8d8a8'
      : '#4a90d9';

  return (
    <>
      <Handle type="target" position={Position.Top} style={{ background: borderColor }} />
      <div
        style={{
          position: 'relative',
          background: '#1a2f4a',
          border: `1.5px solid ${borderColor}`,
          borderRadius: 8,
          padding: '6px 10px',
          minWidth: 160,
          opacity: isDimmed ? 0.2 : 1,
          transition: 'opacity 0.2s',
          cursor: 'default',
        }}
      >
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
          <span style={{ fontFamily: 'monospace', fontSize: 10, color: borderColor, flexShrink: 0 }}>
            {KIND_ICON[node.kind]}
          </span>
          <span
            onClick={onOpenFile}
            title="ダブルクリックでファイルを開く"
            style={{
              color: '#cce4f7',
              fontSize: 12,
              fontWeight: 600,
              cursor: 'pointer',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {node.label}
          </span>
          {annotationIcons && (
            <span style={{ fontSize: 10, flexShrink: 0 }}>{annotationIcons}</span>
          )}
        </div>

        {/* Badges */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
          {node.methods.length > 0 && (
            <Badge color="#4a90d9" text={`${node.methods.length} methods`} />
          )}
          {soqlCount > 0 && <Badge color="#4a9d4a" text={`${soqlCount} SOQL`} />}
          {dmlCount > 0 && <Badge color="#e8a020" text={`${dmlCount} DML`} />}
          {node.sharingMode && (
            <Badge color="#888" text={node.sharingMode} />
          )}
          {node.accessModifier === 'global' && (
            <Badge color="#9d4a9d" text="global" />
          )}
        </div>

        {/* +/- buttons: float just below the card, outside it, near the source handle */}
        {(onExpandDownstream || onCollapseDownstream) && (
          <ExpandCollapseButtons
            color={borderColor}
            onExpand={onExpandDownstream}
            onCollapse={onCollapseDownstream}
          />
        )}
      </div>
      <Handle type="source" position={Position.Bottom} style={{ background: borderColor }} />
    </>
  );
});

function ExpandCollapseButtons({
  color,
  onExpand,
  onCollapse,
}: {
  color: string;
  onExpand?: () => void;
  onCollapse?: () => void;
}) {
  return (
    <div style={{
      position: 'absolute',
      top: '100%',
      left: '50%',
      transform: 'translateX(-50%)',
      paddingTop: 3,
      display: 'flex',
      gap: 4,
      zIndex: 10,
    }}>
      {onExpand && (
        <button
          onClick={(e) => { e.stopPropagation(); onExpand(); }}
          title="下位ノードを1ホップ展開"
          style={{
            background: '#0a0c14',
            border: `1px solid ${color}88`,
            color,
            fontSize: 11,
            fontWeight: 700,
            padding: '0px 6px',
            borderRadius: 3,
            cursor: 'pointer',
            lineHeight: 1.6,
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
            background: '#0a0c14',
            border: '1px solid #cc444488',
            color: '#cc6666',
            fontSize: 11,
            fontWeight: 700,
            padding: '0px 6px',
            borderRadius: 3,
            cursor: 'pointer',
            lineHeight: 1.6,
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
        whiteSpace: 'nowrap',
      }}
    >
      {text}
    </span>
  );
}
