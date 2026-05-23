import React, { memo } from 'react';
import { Handle, Position, NodeProps } from '@xyflow/react';
import { ApexTriggerNode as ApexTriggerNodeData, TriggerEvent } from '../../../shared/types';

interface ApexTriggerNodeProps extends NodeProps {
  data: {
    graphNode: ApexTriggerNodeData;
    isDimmed?: boolean;
    onOpenFile?: () => void;
  };
}

const EVENT_COLOR: Record<string, string> = {
  before: '#e8a020',
  after: '#4a90d9',
};

function eventColor(event: TriggerEvent): string {
  return event.startsWith('before') ? EVENT_COLOR.before : EVENT_COLOR.after;
}

export const ApexTriggerNodeComponent = memo(function ApexTriggerNodeComponent({
  data,
}: ApexTriggerNodeProps) {
  const { graphNode: node, isDimmed, onOpenFile } = data;

  return (
    <>
      <Handle type="target" position={Position.Top} style={{ background: '#9d4a9d' }} />
      <div
        style={{
          background: '#2e1a4a',
          border: '1.5px solid #9d4a9d',
          borderRadius: 8,
          padding: '6px 10px',
          minWidth: 160,
          opacity: isDimmed ? 0.2 : 1,
          transition: 'opacity 0.2s',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
          <span style={{ fontSize: 14 }}>⚡</span>
          <span
            onClick={onOpenFile}
            title="ダブルクリックでファイルを開く"
            style={{ color: '#f0ccf7', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}
          >
            {node.label}
          </span>
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
          {node.events.map((ev) => (
            <span
              key={ev}
              style={{
                background: `${eventColor(ev)}22`,
                border: `1px solid ${eventColor(ev)}66`,
                color: eventColor(ev),
                fontSize: 9,
                padding: '1px 5px',
                borderRadius: 3,
                whiteSpace: 'nowrap',
              }}
            >
              {ev}
            </span>
          ))}
        </div>
      </div>
      <Handle type="source" position={Position.Bottom} style={{ background: '#9d4a9d' }} />
    </>
  );
});
