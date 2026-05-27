import { SOQLQuery, DMLOperation, LSPRange } from '../../shared/types';

// Lightweight regex-based extractor (avoids ANTLR startup cost per file for MVP)
// Covers the common patterns: [SELECT ... FROM Object WHERE ...]
const SOQL_RE = /\[\s*SELECT\s+([\s\S]+?)\s+FROM\s+(\w+)([\s\S]*?)\]/gi;
const SUBQUERY_RE = /\(\s*SELECT\s+[\s\S]+?\s+FROM\s+(\w+)[\s\S]*?\)/gi;

const DML_RE =
  /\b(insert|update|upsert|delete|undelete|merge)\s+(\w+)/gi;

function lineOf(source: string, index: number): number {
  return source.slice(0, index).split('\n').length - 1;
}

export function extractSOQL(source: string): SOQLQuery[] {
  const queries: SOQLQuery[] = [];
  let m: RegExpExecArray | null;

  SOQL_RE.lastIndex = 0;
  while ((m = SOQL_RE.exec(source)) !== null) {
    const raw = m[0];
    const fieldsRaw = m[1];
    const fromObject = m[2];
    const line = lineOf(source, m.index);

    const fields = fieldsRaw
      .split(',')
      .map((f) => f.trim().split(/\s+/)[0])
      .filter(Boolean);

    const additionalObjects: string[] = [];
    SUBQUERY_RE.lastIndex = 0;
    let sub: RegExpExecArray | null;
    while ((sub = SUBQUERY_RE.exec(raw)) !== null) {
      additionalObjects.push(sub[1]);
    }

    const hasSubquery = additionalObjects.length > 0;

    const range: LSPRange = {
      start: { line, character: 0 },
      end: { line, character: raw.length },
    };

    queries.push({ raw, fromObject, additionalObjects, fields, hasSubquery, range });
  }

  return queries;
}

// Non-SObject types that should not be treated as DML targets
const APEX_NON_SOBJECT = new Set([
  'String', 'Integer', 'Long', 'Double', 'Decimal', 'Boolean',
  'Date', 'DateTime', 'Time', 'Blob', 'Id', 'Object',
  'List', 'Set', 'Map', 'Exception', 'System', 'Database',
  'Schema', 'ApexPages', 'PageReference',
]);

/**
 * Build a variable-name → SObject-type map from declarations in the source.
 * Handles:
 *   List<Account> accounts = ...
 *   Account acc = ...
 *   Account[] recs = ...
 */
function buildVarTypeMap(source: string): Map<string, string> {
  const map = new Map<string, string>();

  // List<TypeName> varName
  const listRe = /\bList\s*<\s*([A-Z]\w*)\s*>\s+([a-z_]\w*)\b/g;
  let lm: RegExpExecArray | null;
  while ((lm = listRe.exec(source)) !== null) {
    map.set(lm[2], lm[1]);
  }

  // TypeName varName  (direct variable, e.g. "Account acc =")
  const directRe = /\b([A-Z]\w*)\s+([a-z_]\w*)\s*(?=[=;{,])/g;
  let dm: RegExpExecArray | null;
  while ((dm = directRe.exec(source)) !== null) {
    if (!map.has(dm[2])) {
      map.set(dm[2], dm[1]);
    }
  }

  return map;
}

export function extractDML(source: string): DMLOperation[] {
  const ops: DMLOperation[] = [];
  const varTypeMap = buildVarTypeMap(source);
  let m: RegExpExecArray | null;

  DML_RE.lastIndex = 0;
  while ((m = DML_RE.exec(source)) !== null) {
    const type = m[1].toLowerCase() as DMLOperation['type'];
    let targetType = m[2];

    // Resolve lowercase variable names to their declared SObject types
    if (/^[a-z]/.test(targetType)) {
      const resolved = varTypeMap.get(targetType);
      if (resolved && !APEX_NON_SOBJECT.has(resolved)) {
        targetType = resolved;
      }
      // If still unresolved (starts with lowercase), keep original for badge counting
      // but it won't match any SObject node (filtered below)
    }

    const line = lineOf(source, m.index);

    const range: LSPRange = {
      start: { line, character: m.index - source.lastIndexOf('\n', m.index) - 1 },
      end: { line, character: 0 },
    };

    ops.push({ type, targetType, range });
  }

  return ops;
}
