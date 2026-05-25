import React, { memo } from 'react';
import { Handle, Position, NodeProps } from '@xyflow/react';
import { ApexClassNode as ApexClassNodeData, ApexMethodNode } from '../../../shared/types';

const MAX_METHOD_SCROLL_H = 280; // must match CodeGraphCanvas.tsx

interface ApexClassNodeProps extends NodeProps {
  data: {
    graphNode: ApexClassNodeData;
    isHighlighted?: boolean;
    isDimmed?: boolean;
    onOpenFile?: () => void;
    isContainer?: boolean;
    isCalleeClass?: boolean;
    calleeMethodIds?: Set<string> | null;
    selectedMethodId?: string | null;
    onExpandDownstream?: () => void;
    onCollapseDownstream?: () => void;
    onToggleMethodLevel?: () => void;
    onMethodClick?: (methodId: string) => void;
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
  const {
    graphNode: node,
    isDimmed,
    onOpenFile,
    isContainer,
    isCalleeClass,
    calleeMethodIds,
    selectedMethodId,
    onExpandDownstream,
    onCollapseDownstream,
    onToggleMethodLevel,
    onMethodClick,
  } = data;

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

  if (isContainer) {
    const publicMethods = node.methods.filter((m) => m.accessModifier !== 'private');
    const visibleMethods: ApexMethodNode[] = (isCalleeClass && calleeMethodIds)
      ? publicMethods.filter((m) => calleeMethodIds.has(m.id))
      : publicMethods;

    return (
      <>
        <Handle type="target" position={Position.Left} style={{ background: borderColor, top: 28 }} />
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
          <div style={{ padding: '6px 10px 6px', borderBottom: `1px solid ${borderColor}22` }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontFamily: 'monospace', fontSize: 10, color: borderColor, flexShrink: 0 }}>
                {KIND_ICON[node.kind]}
              </span>
              <span
                onDoubleClick={onOpenFile}
                title="ダブルクリックでファイルを開く"
                style={{
                  color: '#cce4f7',
                  fontSize: 12,
                  fontWeight: 700,
                  cursor: 'default',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  flex: 1,
                  minWidth: 0,
                }}
              >
                {node.label}
              </span>
              {annotationIcons && (
                <span style={{ fontSize: 10, flexShrink: 0 }}>{annotationIcons}</span>
              )}
              {onToggleMethodLevel && (
                <button
                  onClick={(e) => { e.stopPropagation(); onToggleMethodLevel(); }}
                  title="クラスレベルに折りたたむ"
                  style={{
                    background: 'none',
                    border: `1px solid ${borderColor}66`,
                    color: borderColor,
                    fontSize: 10,
                    lineHeight: 1,
                    padding: '1px 4px',
                    borderRadius: 3,
                    cursor: 'pointer',
                    flexShrink: 0,
                  }}
                >
                  −
                </button>
              )}
            </div>
            {node.sharingMode && (
              <div style={{ marginTop: 2 }}>
                <Badge color="#667788" text={node.sharingMode} />
              </div>
            )}
          </div>

          {/* Method list: scrollable HTML */}
          {visibleMethods.length > 0 && (
            <div
              className="nowheel"
              onMouseDown={(e) => e.stopPropagation()}
              style={{ overflowY: 'auto', maxHeight: MAX_METHOD_SCROLL_H }}
            >
              {visibleMethods.map((m) => (
                <MethodRow
                  key={m.id}
                  method={m}
                  isSelected={selectedMethodId === m.id}
                  detail={selectedMethodId !== null && selectedMethodId !== undefined}
                  borderColor={borderColor}
                  onClick={onMethodClick}
                />
              ))}
            </div>
          )}
        </div>
        <Handle type="source" position={Position.Right} style={{ background: borderColor, top: 28 }} />
      </>
    );
  }

  // Normal (class-level) mode
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
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
          <span style={{ fontFamily: 'monospace', fontSize: 10, color: borderColor, flexShrink: 0 }}>
            {KIND_ICON[node.kind]}
          </span>
          <span
            style={{
              color: '#cce4f7',
              fontSize: 12,
              fontWeight: 600,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              flex: 1,
              minWidth: 0,
            }}
          >
            {node.label}
          </span>
          {annotationIcons && (
            <span style={{ fontSize: 10, flexShrink: 0 }}>{annotationIcons}</span>
          )}
          {onToggleMethodLevel && node.methods.length > 0 && (
            <button
              onClick={(e) => { e.stopPropagation(); onToggleMethodLevel(); }}
              title="メソッドレベルに展開"
              style={{
                background: 'none',
                border: `1px solid ${borderColor}66`,
                color: borderColor,
                fontSize: 10,
                lineHeight: 1,
                padding: '1px 4px',
                borderRadius: 3,
                cursor: 'pointer',
                flexShrink: 0,
              }}
            >
              ≡
            </button>
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

function MethodRow({
  method,
  isSelected,
  detail,
  borderColor,
  onClick,
}: {
  method: ApexMethodNode;
  isSelected: boolean;
  detail: boolean;
  borderColor: string;
  onClick?: (methodId: string) => void;
}) {
  const annIcons = method.annotations.map((a) => ANNOTATION_ICONS[a.name]).filter(Boolean).join(' ');
  const doc = method.docComment?.trim();
  const docTruncated = doc && doc.length > 55 ? `${doc.slice(0, 52)}…` : doc;

  return (
    <div
      onClick={(e) => { e.stopPropagation(); onClick?.(method.id); }}
      style={{
        padding: detail ? '4px 8px' : '2px 8px',
        cursor: onClick ? 'pointer' : 'default',
        borderLeft: isSelected ? `3px solid ${borderColor}` : '3px solid transparent',
        background: isSelected ? `${borderColor}22` : 'transparent',
        minHeight: detail ? 38 : 22,
        boxSizing: 'border-box',
      }}
    >
      {/* Method name row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        {method.isStatic && (
          <span style={{ color: '#888', fontSize: 9, flexShrink: 0 }}>S</span>
        )}
        <span
          style={{
            color: isSelected ? '#cce4f7' : '#aabbcc',
            fontSize: 11,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            flex: 1,
            minWidth: 0,
          }}
        >
          {method.label}
        </span>
        {annIcons && (
          <span style={{ fontSize: 9, flexShrink: 0 }}>{annIcons}</span>
        )}
        {method.soqlQueries.length > 0 && (
          <span style={{ color: '#4a9d4a', fontSize: 9, flexShrink: 0 }}>S{method.soqlQueries.length}</span>
        )}
        {method.dmlOperations.length > 0 && (
          <span style={{ color: '#e8a020', fontSize: 9, flexShrink: 0 }}>D{method.dmlOperations.length}</span>
        )}
      </div>

      {/* Doc comment — only in detail (focus) mode */}
      {detail && docTruncated && (
        <div
          title={doc && doc.length > 55 ? doc : undefined}
          style={{
            marginTop: 2,
            color: '#556677',
            fontSize: 9,
            lineHeight: '12px',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {docTruncated}
        </div>
      )}
    </div>
  );
}

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
