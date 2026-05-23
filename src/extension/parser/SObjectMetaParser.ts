import * as vscode from 'vscode';
import { XMLParser } from 'fast-xml-parser';
import { SObjectNode, SObjectFieldNode, SalesforceFieldType } from '../../shared/types';

interface RawField {
  fullName?: string;
  label?: string;
  type?: string;
  referenceTo?: string | string[];
  relationshipName?: string;
  required?: boolean | string;
  externalId?: boolean | string;
}

interface RawObject {
  CustomObject?: {
    fields?: RawField | RawField[];
    recordTypes?: unknown;
  };
}

const parser = new XMLParser({ ignoreAttributes: false, parseAttributeValue: true });

export async function parseSObjectMeta(uri: vscode.Uri): Promise<SObjectNode | null> {
  try {
    const bytes = await vscode.workspace.fs.readFile(uri);
    const xml = Buffer.from(bytes).toString('utf8');
    const raw = parser.parse(xml) as RawObject;
    const obj = raw.CustomObject;
    if (!obj) return null;

    const fileName = uri.fsPath.replace(/\\/g, '/').split('/').pop() ?? '';
    // e.g. "MyObject__c.object-meta.xml" → "MyObject__c"
    const apiName = fileName.replace(/\.object-meta\.xml$/, '');

    const isCustom = apiName.endsWith('__c');
    const isCustomMetadata = apiName.endsWith('__mdt');

    const rawFields = obj.fields
      ? Array.isArray(obj.fields)
        ? obj.fields
        : [obj.fields]
      : [];

    const fields: SObjectFieldNode[] = rawFields
      .filter((f) => f.fullName)
      .map((f): SObjectFieldNode => {
        const referenceTo = f.referenceTo
          ? Array.isArray(f.referenceTo)
            ? f.referenceTo
            : [String(f.referenceTo)]
          : undefined;

        return {
          id: `field:${apiName}.${f.fullName}`,
          kind: 'sobject-field',
          label: f.fullName!,
          apiName: f.fullName!,
          parentSObjectId: `sobject:${apiName}`,
          fieldType: (f.type as SalesforceFieldType) ?? 'Text',
          referenceTo,
          relationshipName: f.relationshipName,
          required: f.required === true || f.required === 'true',
          externalId: f.externalId === true || f.externalId === 'true',
        };
      });

    const recordTypes = obj.recordTypes
      ? Array.isArray(obj.recordTypes)
        ? (obj.recordTypes as Array<{ fullName?: string }>).map((r) => r.fullName ?? '')
        : []
      : [];

    return {
      id: `sobject:${apiName}`,
      kind: 'sobject',
      label: apiName,
      isCustom,
      isCustomMetadata,
      uri: uri.toString(),
      fields,
      recordTypes: recordTypes.filter(Boolean),
    };
  } catch {
    return null;
  }
}

export async function parseSObjectDirectory(workspaceRoot: string): Promise<SObjectNode[]> {
  const files = await vscode.workspace.findFiles(
    new vscode.RelativePattern(workspaceRoot, '**/*.object-meta.xml'),
    '**/node_modules/**'
  );

  const results = await Promise.all(files.map(parseSObjectMeta));
  return results.filter((n): n is SObjectNode => n !== null);
}
