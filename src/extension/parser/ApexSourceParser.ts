import * as vscode from 'vscode';
import * as path from 'path';
import { ApexAnnotation, TriggerEvent } from '../../shared/types';
import {
  ParsedApexMethodInfo,
  ParsedClassRef,
  ParsedInnerClass,
  parseAnnotations,
  parseMethods,
  parseClassRefs,
  parseApexClassHeader,
  parseApexTriggerHeader,
  parseInnerClasses,
  stripInnerClassBodies,
} from './apexParseUtils';

export { ParsedClassRef, ParsedInnerClass };

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
  methods: ParsedApexMethodInfo[];
  referencedClasses: ParsedClassRef[];
  innerClasses: ParsedInnerClass[];
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

// ParsedApexMethod は ParsedApexMethodInfo の別名として公開（後方互換）
export type ParsedApexMethod = ParsedApexMethodInfo;

export function parseApexSource(uri: vscode.Uri, source: string): ParsedApexClass | ParsedApexTrigger | null {
  const isTrigger = uri.fsPath.endsWith('.trigger');

  if (isTrigger) {
    const header = parseApexTriggerHeader(source);
    if (!header) return null;
    return { ...header, uri, source };
  }

  const header = parseApexClassHeader(source);
  if (!header) return null;

  const innerClasses = parseInnerClasses(source);
  const strippedSource = innerClasses.length > 0 ? stripInnerClassBodies(source) : source;

  return {
    ...header,
    methods: parseMethods(strippedSource),
    referencedClasses: parseClassRefs(strippedSource),
    innerClasses,
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

// re-export for consumers that import from this module
export { parseAnnotations, parseMethods, parseClassRefs, parseInnerClasses, stripInnerClassBodies };
