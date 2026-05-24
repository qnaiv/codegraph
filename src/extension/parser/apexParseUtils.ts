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
    });
  }
  return methods;
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
