import { ApexAnnotation, TriggerEvent } from '../../shared/types';

// -----------------------------------------------------------------------
// 型定義（vscode 非依存）
// -----------------------------------------------------------------------

export interface ParsedApexMethodInfo {
  name: string;
  returnType: string;
  isStatic: boolean;
  accessModifier: 'public' | 'private' | 'global' | 'protected';
  annotations: ApexAnnotation[];
  docComment?: string;
}

export interface ParsedClassRef {
  targetClass: string;
  kind: 'instantiates' | 'calls';
}

export interface ParsedClassHeader {
  name: string;
  kind: 'apex-class' | 'apex-interface' | 'apex-enum';
  accessModifier: 'public' | 'private' | 'global' | 'protected';
  isAbstract: boolean;
  isVirtual: boolean;
  isTestClass: boolean;
  sharingMode?: 'with sharing' | 'without sharing' | 'inherited sharing';
  extendsClass?: string;
  implementsInterfaces: string[];
  annotations: ApexAnnotation[];
}

export interface ParsedTriggerHeader {
  name: string;
  targetSObject: string;
  events: TriggerEvent[];
}

// -----------------------------------------------------------------------
// 正規表現
// -----------------------------------------------------------------------

const ANNOTATION_RE = /@(\w+)(?:\s*\([^)]*\))?/g;
const CLASS_HEADER_RE =
  /(global|public|private|protected)?\s+(abstract\s+|virtual\s+)?(with\s+sharing\s+|without\s+sharing\s+|inherited\s+sharing\s+)?(class|interface|enum)\s+(\w+)/i;
const EXTENDS_RE = /\bextends\s+(\w+)/i;
const IMPLEMENTS_RE = /\bimplements\s+([\w\s,]+?)(?:\s*(?:extends|{|$))/i;
const TRIGGER_RE = /\btrigger\s+(\w+)\s+on\s+(\w+)\s*\(([^)]+)\)/i;
const METHOD_RE =
  /^\s*(?:@\w+(?:\s*\([^)]*\))?\s*)*(global|public|private|protected|webservice)?\s+(static\s+)?((?:[\w<>[\]]+\s+)+)(\w+)\s*\([^)]*\)\s*(?:\{|;)/gm;

// クラス間参照検出
const NEW_CLASS_RE = /\bnew\s+([A-Z]\w*)\s*[(<]/g;
const STATIC_CALL_RE = /\b([A-Z]\w*)\.(?:[a-z_]\w*)\s*\(/g;
// フィールド・ローカル変数の型宣言: TypeName varName (= ; { , [)
const TYPE_DECL_RE = /\b([A-Z]\w*)\s+([a-z_]\w*)\s*(?:=|;|\{|,|\[)/g;

const EVENT_MAP: Record<string, TriggerEvent> = {
  'before insert': 'before insert',
  'before update': 'before update',
  'before delete': 'before delete',
  'after insert':  'after insert',
  'after update':  'after update',
  'after delete':  'after delete',
  'after undelete': 'after undelete',
};

// -----------------------------------------------------------------------
// パース関数（純粋、vscode 非依存）
// -----------------------------------------------------------------------

export function parseAnnotations(source: string, upToIndex: number): ApexAnnotation[] {
  const block = source.slice(Math.max(0, upToIndex - 400), upToIndex);
  const anns: ApexAnnotation[] = [];
  ANNOTATION_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = ANNOTATION_RE.exec(block)) !== null) {
    anns.push({ name: m[1] });
  }
  return anns;
}

export function parseMethods(source: string): ParsedApexMethodInfo[] {
  const methods: ParsedApexMethodInfo[] = [];
  const seen = new Set<string>();
  METHOD_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = METHOD_RE.exec(source)) !== null) {
    const name = m[4];
    if (/^(class|interface|enum|trigger|if|for|while|catch|return|new|this|super)$/i.test(name)) continue;
    if (seen.has(name)) continue;
    seen.add(name);

    const rawAccess = (m[1] ?? 'private').toLowerCase();
    const accessModifier = (['public', 'private', 'global', 'protected'].includes(rawAccess)
      ? rawAccess
      : 'private') as ParsedApexMethodInfo['accessModifier'];

    // アノテーションは METHOD_RE のマッチテキスト先頭に含まれるため m[0] から抽出する
    // (parseAnnotations の「直前400文字」ではマッチ先頭のアノテーションを捕捉できない)
    methods.push({
      name,
      returnType: (m[3] ?? '').trim().split(/\s+/).pop() ?? '',
      isStatic: /\bstatic\b/i.test(m[2] ?? ''),
      accessModifier,
      annotations: parseAnnotationsFromText(m[0]),
      docComment: extractDocComment(source, m.index),
    });
  }
  return methods;
}

/**
 * Extract the doc comment (/** *\/ or //-lines) immediately preceding a method.
 * Returns undefined when no comment is found.
 */
function extractDocComment(source: string, methodStartIndex: number): string | undefined {
  const lookback = source.slice(Math.max(0, methodStartIndex - 800), methodStartIndex);

  // Look for the last /** ... */ block comment
  const blockRe = /\/\*\*([\s\S]*?)\*\//g;
  let lastBlock: { index: number; content: string; end: number } | null = null;
  let bm: RegExpExecArray | null;
  while ((bm = blockRe.exec(lookback)) !== null) {
    lastBlock = { index: bm.index, content: bm[1], end: bm.index + bm[0].length };
  }

  if (lastBlock) {
    const afterComment = lookback.slice(lastBlock.end);
    // Only whitespace and annotations are allowed between the comment and the method
    if (/^[\s@\w(),.[\]"']*$/.test(afterComment)) {
      const text = lastBlock.content
        .split('\n')
        .map((l) => l.replace(/^\s*\*\s?/, '').trim())
        .filter((l) => l.length > 0 && !l.startsWith('@'))
        .join(' ')
        .trim();
      return text || undefined;
    }
  }

  // Fall back to consecutive // comment lines immediately before the method
  const lines = lookback.trimEnd().split('\n');
  const collected: string[] = [];
  for (let i = lines.length - 1; i >= 0; i--) {
    const trimmed = lines[i].trim();
    if (trimmed.startsWith('//')) {
      collected.unshift(trimmed.slice(2).trim());
    } else if (trimmed === '' || /^@\w+/.test(trimmed)) {
      continue; // blank lines or annotations: keep looking upward
    } else {
      break;
    }
  }

  const text = collected.join(' ').trim();
  return text || undefined;
}

function parseAnnotationsFromText(text: string): ApexAnnotation[] {
  const anns: ApexAnnotation[] = [];
  const re = /@(\w+)(?:\s*\([^)]*\))?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    anns.push({ name: m[1] });
  }
  return anns;
}

/**
 * Apex ソース内の他クラスへの参照を3パターンで抽出する:
 *   1. `new ClassName(` / `new ClassName<` → instantiates
 *   2. `ClassName.method(` (大文字始まり = 静的呼び出し) → calls
 *   3. `TypeName varName` 型宣言 + `varName.method(` → calls (インスタンス経由)
 *
 * GraphBuilder 側で classNodes セットと照合し、非クラスの参照は除外する。
 * instantiates と calls が同じクラスを指す場合は instantiates を優先する。
 */
export function parseClassRefs(source: string): ParsedClassRef[] {
  const instantiates = new Set<string>();
  const calls = new Set<string>();
  let m: RegExpExecArray | null;

  // パターン1: new ClassName( または new ClassName<
  NEW_CLASS_RE.lastIndex = 0;
  while ((m = NEW_CLASS_RE.exec(source)) !== null) {
    instantiates.add(m[1]);
  }

  // パターン2: ClassName.method( — 静的メソッド呼び出し
  STATIC_CALL_RE.lastIndex = 0;
  while ((m = STATIC_CALL_RE.exec(source)) !== null) {
    calls.add(m[1]);
  }

  // パターン3: TypeName varName + varName.method( — インスタンス経由呼び出し
  const typeVarMap = new Map<string, string>(); // varName → TypeName
  TYPE_DECL_RE.lastIndex = 0;
  while ((m = TYPE_DECL_RE.exec(source)) !== null) {
    typeVarMap.set(m[2], m[1]);
  }
  for (const [varName, typeName] of typeVarMap) {
    const escaped = varName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (new RegExp(`\\b${escaped}\\.(?:[a-z_]\\w*)\\s*\\(`).test(source)) {
      calls.add(typeName);
    }
  }

  const refs: ParsedClassRef[] = [];
  for (const cls of instantiates) {
    refs.push({ targetClass: cls, kind: 'instantiates' });
  }
  // instantiates と重複するものは除外（instantiates で既に表現されているため）
  for (const cls of calls) {
    if (!instantiates.has(cls)) {
      refs.push({ targetClass: cls, kind: 'calls' });
    }
  }
  return refs;
}

export interface CrossClassCall {
  targetClass: string;
  targetMethod: string;
}

export interface MethodCallsResult {
  methodName: string;
  crossClassCalls: CrossClassCall[];
  intraClassCalls: string[];
}

/**
 * Apex ソース内の各メソッドが呼び出しているメソッドを解析する。
 * - crossClassCalls: ClassName.methodName( パターン（静的・インスタンス変数経由）
 * - intraClassCalls: 同一クラス内のメソッド呼び出し（ownMethodNames と照合）
 */
export function extractMethodCalls(
  source: string,
  ownMethodNames: ReadonlySet<string>,
): MethodCallsResult[] {
  const results: MethodCallsResult[] = [];

  // Pre-scan the full source for type declarations so class-level fields
  // (e.g. `private ContactService contactService;`) are available as a base
  // type map for every method body, not just local variable declarations.
  const classFieldTypeMap = new Map<string, string>();
  const fieldDeclRe = /\b([A-Z]\w*)\s+([a-z_]\w*)\s*(?:[=;{,[])/g;
  let fd: RegExpExecArray | null;
  while ((fd = fieldDeclRe.exec(source)) !== null) {
    classFieldTypeMap.set(fd[2], fd[1]);
  }

  const re = new RegExp(METHOD_RE.source, 'gm');
  const seen = new Set<string>();
  let m: RegExpExecArray | null;

  while ((m = re.exec(source)) !== null) {
    const name = m[4];
    if (/^(class|interface|enum|trigger|if|for|while|catch|return|new|this|super)$/i.test(name)) continue;
    if (seen.has(name)) continue;
    seen.add(name);

    if (m[0].trimEnd().endsWith(';')) continue; // abstract / interface method

    const bodyStart = m.index + m[0].length;
    let depth = 1;
    let i = bodyStart;
    while (i < source.length && depth > 0) {
      if (source[i] === '{') depth++;
      else if (source[i] === '}') depth--;
      i++;
    }
    const body = source.slice(bodyStart, i - 1);

    const crossClassCalls: CrossClassCall[] = [];

    // Static-style calls: ClassName.method( where ClassName starts with uppercase
    const crossRe = /\b([A-Z]\w*)\.([a-z_]\w*)\s*\(/g;
    let cc: RegExpExecArray | null;
    while ((cc = crossRe.exec(body)) !== null) {
      crossClassCalls.push({ targetClass: cc[1], targetMethod: cc[2] });
    }

    // Instance calls: seed with class-level fields, then add method-local declarations
    const typeDeclRe = /\b([A-Z]\w*)\s+([a-z_]\w*)\s*(?:[=;{,[])/g;
    const localTypeMap = new Map(classFieldTypeMap); // includes class-level fields
    let td: RegExpExecArray | null;
    while ((td = typeDeclRe.exec(body)) !== null) {
      localTypeMap.set(td[2], td[1]); // local vars override same-named fields
    }
    // Also extract from method parameters (TypeName param, ...)
    const paramMatch = m[0].match(/\(([^)]*)\)/);
    if (paramMatch) {
      const paramRe = /\b([A-Z]\w*)\s+([a-z_]\w*)/g;
      let pm: RegExpExecArray | null;
      while ((pm = paramRe.exec(paramMatch[1])) !== null) {
        localTypeMap.set(pm[2], pm[1]);
      }
    }
    for (const [varName, typeName] of localTypeMap) {
      const escaped = varName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const instCallRe = new RegExp(`\\b${escaped}\\.([a-z_]\\w*)\\s*\\(`, 'g');
      let ic: RegExpExecArray | null;
      while ((ic = instCallRe.exec(body)) !== null) {
        crossClassCalls.push({ targetClass: typeName, targetMethod: ic[1] });
      }
    }

    const intraClassCalls: string[] = [];
    for (const mn of ownMethodNames) {
      if (mn === name) continue;
      const esc = mn.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      if (new RegExp(`\\b${esc}\\s*\\(`).test(body)) {
        intraClassCalls.push(mn);
      }
    }

    results.push({ methodName: name, crossClassCalls, intraClassCalls });
  }

  return results;
}

export function parseApexClassHeader(source: string): ParsedClassHeader | null {
  const headerMatch = CLASS_HEADER_RE.exec(source);
  if (!headerMatch) return null;

  const rawAccess = (headerMatch[1] ?? 'public').toLowerCase();
  const accessModifier = (['public', 'private', 'global', 'protected'].includes(rawAccess)
    ? rawAccess
    : 'public') as ParsedClassHeader['accessModifier'];

  const kindRaw = headerMatch[4].toLowerCase();
  const kind: ParsedClassHeader['kind'] =
    kindRaw === 'interface' ? 'apex-interface'
    : kindRaw === 'enum'    ? 'apex-enum'
    : 'apex-class';

  const rawSharing = (headerMatch[3] ?? '').trim().toLowerCase();
  const sharingMode = rawSharing.startsWith('without') ? 'without sharing'
    : rawSharing.startsWith('inherited') ? 'inherited sharing'
    : rawSharing.startsWith('with')      ? 'with sharing'
    : undefined;

  const extendsMatch = EXTENDS_RE.exec(source);
  const implementsMatch = IMPLEMENTS_RE.exec(source);

  const annotations = parseAnnotations(source, headerMatch.index);
  const isTestClass = annotations.some((a) => /^isTest$/i.test(a.name)) ||
    /\btestmethod\b/i.test(source);

  return {
    name: headerMatch[5],
    kind,
    accessModifier,
    isAbstract: /\babstract\b/i.test(headerMatch[2] ?? ''),
    isVirtual:  /\bvirtual\b/i.test(headerMatch[2] ?? ''),
    isTestClass,
    sharingMode,
    extendsClass: extendsMatch?.[1],
    implementsInterfaces: implementsMatch
      ? implementsMatch[1].split(',').map((s) => s.trim()).filter(Boolean)
      : [],
    annotations,
  };
}

export function parseApexTriggerHeader(source: string): ParsedTriggerHeader | null {
  const m = TRIGGER_RE.exec(source);
  if (!m) return null;
  const events: TriggerEvent[] = m[3]
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter((e): e is TriggerEvent => e in EVENT_MAP)
    .map((e) => EVENT_MAP[e]);
  return { name: m[1], targetSObject: m[2], events };
}
