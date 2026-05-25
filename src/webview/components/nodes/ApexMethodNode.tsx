import React, { memo } from 'react';
import { Handle, Position, NodeProps } from '@xyflow/react';
import { ApexMethodNode as ApexMethodNodeData } from '../../../shared/types';

interface ApexMethodNodeProps extends NodeProps {
  data: {
    graphNode: ApexMethodNodeData;
  };
}

const ANNOTATION_ICONS: Record<string, string> = {
  AuraEnabled:     '⚡',
  InvocableMethod: '🔗',
  Future:          '⏳',
  Schedulable:     '📅',
  Batchable:       '📦',
  RemoteAction:    '🌐',
  TestSetup:       '🔧',
};

export const ApexMethodNodeComponent = memo(function ApexMethodNodeComponent({
  data,
}: ApexMethodNodeProps) {
  const { graphNode: method } = data;

  const annotationIcons = method.annotations
    .map((a) => ANNOTATION_ICONS[a.name])
    .filter(Boolean)
    .join(' ');

  const soqlCount = method.soqlQueries.length;
  const dmlCount  = method.dmlOperations.length;

  return (
    <>
      <Handle type="target" position={Position.Left}  style={{ opacity: 0, width: 6, height: 6 }} />
      <div
        style={{
          background: '#0f1a28',
          border: '1px solid #1e3450',
          borderRadius: 5,
          padding: '4px 8px',
          width: 182,
          cursor: 'default',
          userSelect: 'none',
        }}
      >
        {/* Method name row */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 2 }}>
          {annotationIcons && (
            <span style={{ fontSize: 9, flexShrink: 0 }}>{annotationIcons}</span>
          )}
          <span
            style={{
              color: '#a8cce8',
              fontSize: 11,
              fontWeight: 600,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {method.label}
          </span>
          {method.isStatic && (
            <span style={{ color: '#556677', fontSize: 9, flexShrink: 0 }}>static</span>
          )}
        </div>

        {/* Modifier + return type */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
          <span style={{ color: '#3a5570', fontSize: 9 }}>{method.accessModifier}</span>
          {method.returnType && (
            <span style={{ color: '#3a5570', fontSize: 9 }}>· {method.returnType}</span>
          )}
          {soqlCount > 0 && <SmallBadge color="#4a9d4a" text={`${soqlCount} SOQL`} />}
          {dmlCount  > 0 && <SmallBadge color="#e8a020" text={`${dmlCount} DML`}  />}
        </div>
      </div>
      <Handle type="source" position={Position.Right} style={{ opacity: 0, width: 6, height: 6 }} />
    </>
  );
});

function SmallBadge({ color, text }: { color: string; text: string }) {
  return (
    <span
      style={{
        background: `${color}22`,
        border: `1px solid ${color}55`,
        color,
        fontSize: 8,
        padding: '0px 4px',
        borderRadius: 2,
        whiteSpace: 'nowrap',
      }}
    >
      {text}
    </span>
  );
}
