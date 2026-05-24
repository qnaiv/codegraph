import React, { memo } from 'react';
import { Handle, Position, NodeProps } from '@xyflow/react';
import { ApexClassNode as ApexClassNodeData } from '../../../shared/types';

interface ApexClassNodeProps extends NodeProps {
  data: {
    graphNode: ApexClassNodeData;
    isHighlighted?: boolean;
    isDimmed?: boolean;
    onOpenFile?: () => void;
    isContainer?: boolean;
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
  const { graphNode: node, isDimmed, onOpenFile, isContainer } = data;

  const borderColor = node.kind === 'apex-interface'
    ? '#7ec8e3'
    : node.kind === 'apex-enum'
      ? '#a8d8a8'
      : '#4a90d9';

  const annotationIcons = node.annotations
    .map((a) => ANNOTATION_ICONS[a.name])
    .filter(Boolean)
    .join(' ');

  if (isContainer) {
    return (
      <>
        <Handle type="target" position={Position.Left}  style={{ background: borderColor, top: 28 }} />
        <div
          style={{
            width: '100%',
            height: '100%',
            background: `${borderColor}0a`,
            border: `1.5px dashed ${borderColor}66`,
            borderRadius: 8,
            opacity: isDimmed ? 0.2 : 1,
            transition: 'opacity 0.2s',
            boxSizing: 'border-box',
          }}
        >
          {/* Class header */}
          <div
            style={{
              padding: '6px 10px 6px',
              borderBottom: `1px solid ${borderColor}22`,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontFamily: 'monospace', fontSize: 10, color: borderColor, flexShrink: 0 }}>
                {KIND_ICON[node.kind]}
              </span>
              <span
                onClick={onOpenFile}
                title="クリックでファイルを開く"
                style={{
                  color: '#cce4f7',
                  fontSize: 12,
                  fontWeight: 700,
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
            {node.sharingMode && (
              <div style={{ marginTop: 2 }}>
                <Badge color="#667788" text={node.sharingMode} />
              </div>
            )}
          </div>
          {/* Method area: React Flow renders child nodes here */}
        </div>
        <Handle type="source" position={Position.Right} style={{ background: borderColor, top: 28 }} />
      </>
    );
  }

  // Normal (class-level) mode
  const soqlCount = node.methods.reduce((n, m) => n + m.soqlQueries.length, 0);
  const dmlCount  = node.methods.reduce((n, m) => n + m.dmlOperations.length, 0);

  return (
    <>
      <Handle type="target" position={Position.Top} style={{ background: borderColor }} />
      <div
        style={{
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

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
          {node.methods.length > 0 && (
            <Badge color="#4a90d9" text={`${node.methods.length} methods`} />
          )}
          {soqlCount > 0 && <Badge color="#4a9d4a" text={`${soqlCount} SOQL`} />}
          {dmlCount  > 0 && <Badge color="#e8a020" text={`${dmlCount} DML`}  />}
          {node.sharingMode && (
            <Badge color="#888" text={node.sharingMode} />
          )}
          {node.accessModifier === 'global' && (
            <Badge color="#9d4a9d" text="global" />
          )}
        </div>
      </div>
      <Handle type="source" position={Position.Bottom} style={{ background: borderColor }} />
    </>
  );
});

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
