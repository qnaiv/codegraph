import React, { memo } from 'react';
import { EdgeProps, getBezierPath, EdgeLabelRenderer, BaseEdge } from '@xyflow/react';
import { EdgeKind } from '../../../shared/types';

const EDGE_STYLES: Record<EdgeKind, { stroke: string; strokeDasharray?: string; label: string }> = {
  inherits:          { stroke: '#4a90d9', label: 'extends' },
  implements:        { stroke: '#7ec8e3', strokeDasharray: '5 3', label: 'implements' },
  calls:             { stroke: '#bb88ff', label: 'calls' },
  'soql-references': { stroke: '#4a9d4a', strokeDasharray: '6 3', label: 'SOQL' },
  'dml-insert':      { stroke: '#e8a020', label: 'insert' },
  'dml-update':      { stroke: '#d4c820', label: 'update' },
  'dml-delete':      { stroke: '#e03030', label: 'delete' },
  'field-lookup':    { stroke: '#556677', strokeDasharray: '3 3', label: 'lookup' },
  instantiates:      { stroke: '#44ccbb', strokeDasharray: '4 2', label: 'new' },
  'trigger-on':      { stroke: '#9d4a9d', label: 'trigger' },
  'annotation-attach': { stroke: '#555555', strokeDasharray: '2 4', label: '' },
};

export const CodeGraphEdgeComponent = memo(function CodeGraphEdgeComponent(props: EdgeProps) {
  const {
    id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data,
  } = props;

  const d = data as Record<string, unknown> | undefined;
  const kind = (d?.['kind'] as EdgeKind | undefined) ?? 'calls';
  const isHighlighted = Boolean(d?.['isHighlighted']);
  const isDimmed = Boolean(d?.['isDimmed']);

  const style = EDGE_STYLES[kind];
  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition,
  });

  const opacity = isDimmed ? 0.08 : 0.85;

  return (
    <>
      <BaseEdge
        id={id}
        path={edgePath}
        style={{
          stroke: style.stroke,
          strokeDasharray: style.strokeDasharray,
          opacity,
          strokeWidth: isHighlighted ? 2.5 : 1.5,
        }}
      />
      {style.label && (
        <EdgeLabelRenderer>
          <div
            style={{
              position: 'absolute',
              transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
              fontSize: 9,
              color: style.stroke,
              opacity,
              pointerEvents: 'none',
              background: 'rgba(10,12,20,0.75)',
              padding: '1px 4px',
              borderRadius: 3,
            }}
          >
            {style.label}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
});
