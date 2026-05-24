import * as vscode from 'vscode';
import * as path from 'path';
import { ApexAnnotation, TriggerEvent } from '../../shared/types';

export interface ParsedApexClass {
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
  methods: ParsedApexMethod[];
  referencedClasses: ParsedClassRef[];
  uri: vscode.Uri;
  source: string;
}

export interface ParsedApexTrigger {
  name: string;
  targetSObject: string;
  events: TriggerEvent[];
  uri: vscode.Uri;
  source: string;
}

export interface ParsedApexMethod {
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

// -----------------------------------------------------------------------
// Apex class / interface / enum ヘッダー抽出
// -----------------------------------------------------------------------
const ANNOTATION_RE = /@(\w+)(?:\s*\([^)]*\))?/g;
// アノテーション + 修飾子 + (class|interface|enum) + 名前
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
// フィールド・ローカル変数型宣言: TypeName varName (= ; { , [)
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

function parseAnnotations(source: string, upToIndex: number): ApexAnnotation[] {
  const block = source.slice(Math.max(0, upToIndex - 400), upToIndex);
  const anns: ApexAnnotation[] = [];
  ANNOTATION_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = ANNOTATION_RE.exec(block)) !== null) {
    anns.push({ name: m[1] });
  }
  return anns;
}

function parseMethods(source: string): ParsedApexMethod[] {
  const methods: ParsedApexMethod[] = [];
  const seen = new Set<string>();
  METHOD_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = METHOD_RE.exec(source)) !== null) {
    const name = m[4];
    // skip class/trigger/interface keywords caught as method names
    if (/^(class|interface|enum|trigger|if|for|while|catch|return|new|this|super)$/i.test(name)) continue;
    if (seen.has(name)) continue;
    seen.add(name);

    const rawAccess = (m[1] ?? 'private').toLowerCase();
    const accessModifier = (['public', 'private', 'global', 'protected'].includes(rawAccess)
      ? rawAccess
      : 'private') as ParsedApexMethod['accessModifier'];

    methods.push({
      name,
      returnType: (m[3] ?? '').trim().split(/\s+/).pop() ?? '',
      isStatic: /\bstatic\b/i.test(m[2] ?? ''),
      accessModifier,
      annotations: parseAnnotations(source, m.index),
    });
  }
  return methods;
}

// ソースからクラス間参照を抽出する
// - new ClassName( → instantiates
// - ClassName.method( (静的呼び出し) → calls
// - TypeName varName 宣言 + varName.method( → calls
// GraphBuilder 側でクラス名セットと照合して絞り込む
function parseClassRefs(source: string): ParsedClassRef[] {
  const instantiates = new Set<string>();
  const calls = new Set<string>();
  let m: RegExpExecArray | null;

  // new ClassName( or new ClassName<
  NEW_CLASS_RE.lastIndex = 0;
  while ((m = NEW_CLASS_RE.exec(source)) !== null) {
    instantiates.add(m[1]);
  }

  // ClassName.method( — 静的メソッド呼び出し
  STATIC_CALL_RE.lastIndex = 0;
  while ((m = STATIC_CALL_RE.exec(source)) !== null) {
    calls.add(m[1]);
  }

  // フィールド/ローカル変数宣言からインスタンス呼び出しを検出
  // TypeName varName → varName.method( のパターン
  const typeVarMap = new Map<string, string>(); // varName → TypeName
  TYPE_DECL_RE.lastIndex = 0;
  while ((m = TYPE_DECL_RE.exec(source)) !== null) {
    typeVarMap.set(m[2], m[1]);
  }
  for (const [varName, typeName] of typeVarMap) {
    // varName.lowercase_method( がソース中に存在すれば参照あり
    const escaped = varName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (new RegExp(`\\b${escaped}\\.(?:[a-z_]\\w*)\\s*\\(`).test(source)) {
      calls.add(typeName);
    }
  }

  const refs: ParsedClassRef[] = [];
  for (const cls of instantiates) {
    refs.push({ targetClass: cls, kind: 'instantiates' });
  }
  // instantiates と重複しない calls のみ追加
  for (const cls of calls) {
    if (!instantiates.has(cls)) {
      refs.push({ targetClass: cls, kind: 'calls' });
    }
  }
  return refs;
}

export function parseApexSource(uri: vscode.Uri, source: string): ParsedApexClass | ParsedApexTrigger | null {
  const isTrigger = uri.fsPath.endsWith('.trigger');

  if (isTrigger) {
    const m = TRIGGER_RE.exec(source);
    if (!m) return null;
    const events: TriggerEvent[] = m[3]
      .split(',')
      .map((e) => e.trim().toLowerCase())
      .filter((e): e is TriggerEvent => e in EVENT_MAP)
      .map((e) => EVENT_MAP[e]);
    return { name: m[1], targetSObject: m[2], events, uri, source };
  }

  const headerMatch = CLASS_HEADER_RE.exec(source);
  if (!headerMatch) return null;

  const rawAccess = (headerMatch[1] ?? 'public').toLowerCase();
  const accessModifier = (['public', 'private', 'global', 'protected'].includes(rawAccess)
    ? rawAccess
    : 'public') as ParsedApexClass['accessModifier'];

  const kindRaw = headerMatch[4].toLowerCase();
  const kind: ParsedApexClass['kind'] =
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

  const name = headerMatch[5];
  const annotations = parseAnnotations(source, headerMatch.index);
  const isTestClass = annotations.some((a) => /^isTest$/i.test(a.name)) ||
    /\btestmethod\b/i.test(source);

  return {
    name,
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
    methods: parseMethods(source),
    referencedClasses: parseClassRefs(source),
    uri,
    source,
  };
}

export async function parseApexDirectory(workspaceRoot: string): Promise<{
  classes: Map<string, ParsedApexClass>;
  triggers: ParsedApexTrigger[];
}> {
  const files = await vscode.workspace.findFiles(
    new vscode.RelativePattern(workspaceRoot, '**/*.{cls,trigger}'),
    '**/node_modules/**'
  );

  const classes = new Map<string, ParsedApexClass>();
  const triggers: ParsedApexTrigger[] = [];

  await Promise.all(
    files.map(async (uri) => {
      try {
        const bytes = await vscode.workspace.fs.readFile(uri);
        const source = Buffer.from(bytes).toString('utf8');
        const parsed = parseApexSource(uri, source);
        if (!parsed) return;

        if ('targetSObject' in parsed) {
          triggers.push(parsed);
        } else {
          classes.set(parsed.name, parsed);
        }
      } catch {
        // skip unreadable files
      }
    })
  );

  // If a file name differs from the class name inside it, add the filename-based entry too
  for (const [, cls] of classes) {
    const baseName = path.basename(cls.uri.fsPath, path.extname(cls.uri.fsPath));
    if (!classes.has(baseName)) {
      classes.set(baseName, { ...cls, name: baseName });
    }
  }

  return { classes, triggers };
}
