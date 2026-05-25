import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import {
  parseClassRefs,
  parseApexClassHeader,
  parseApexTriggerHeader,
  parseMethods,
  parseInnerClasses,
  stripInnerClassBodies,
} from '../apexParseUtils';

// -----------------------------------------------------------------------
// 実際のサンプルファイルを使った統合テスト
// apexParseUtils が本番と同じ入力で正しく動作するかを確認する
// -----------------------------------------------------------------------

const SAMPLE_DIR = path.resolve(__dirname, '../../../../sample-project/force-app/main/default/classes');
const TRIGGER_DIR = path.resolve(__dirname, '../../../../sample-project/force-app/main/default/triggers');

function readSample(dir: string, name: string): string {
  return fs.readFileSync(path.join(dir, name), 'utf8');
}

const KNOWN_CLASSES = new Set([
  'IService', 'BaseService', 'AccountService', 'ContactService',
  'OrderService', 'NotificationService', 'AccountServiceTest',
]);

function filterKnownClasses(refs: ReturnType<typeof parseClassRefs>) {
  return refs.filter((r) => KNOWN_CLASSES.has(r.targetClass));
}

describe('Integration: parseClassRefs on actual sample files', () => {
  it('OrderService → AccountService (instantiates)', () => {
    const src = readSample(SAMPLE_DIR, 'OrderService.cls');
    const refs = filterKnownClasses(parseClassRefs(src));
    expect(refs).toContainEqual({ targetClass: 'AccountService', kind: 'instantiates' });
  });

  it('OrderService → NotificationService (instantiates)', () => {
    const src = readSample(SAMPLE_DIR, 'OrderService.cls');
    const refs = filterKnownClasses(parseClassRefs(src));
    expect(refs).toContainEqual({ targetClass: 'NotificationService', kind: 'instantiates' });
  });

  it('OrderService has no refs to ContactService or IService', () => {
    const src = readSample(SAMPLE_DIR, 'OrderService.cls');
    const refs = filterKnownClasses(parseClassRefs(src));
    const names = refs.map((r) => r.targetClass);
    expect(names).not.toContain('ContactService');
    expect(names).not.toContain('IService');
  });

  it('AccountService → ContactService (instantiates)', () => {
    const src = readSample(SAMPLE_DIR, 'AccountService.cls');
    const refs = filterKnownClasses(parseClassRefs(src));
    expect(refs).toContainEqual({ targetClass: 'ContactService', kind: 'instantiates' });
  });

  it('AccountService → NotificationService (instantiates)', () => {
    const src = readSample(SAMPLE_DIR, 'AccountService.cls');
    const refs = filterKnownClasses(parseClassRefs(src));
    expect(refs).toContainEqual({ targetClass: 'NotificationService', kind: 'instantiates' });
  });

  it('BaseService has no class refs to other sample classes', () => {
    const src = readSample(SAMPLE_DIR, 'BaseService.cls');
    const refs = filterKnownClasses(parseClassRefs(src));
    expect(refs).toHaveLength(0);
  });

  it('NotificationService has no class refs to other sample classes', () => {
    const src = readSample(SAMPLE_DIR, 'NotificationService.cls');
    const refs = filterKnownClasses(parseClassRefs(src));
    expect(refs).toHaveLength(0);
  });
});

describe('Integration: parseApexClassHeader on actual sample files', () => {
  it('OrderService: extends BaseService', () => {
    const src = readSample(SAMPLE_DIR, 'OrderService.cls');
    const h = parseApexClassHeader(src);
    expect(h?.name).toBe('OrderService');
    expect(h?.extendsClass).toBe('BaseService');
    expect(h?.kind).toBe('apex-class');
  });

  it('AccountService: extends BaseService, with sharing', () => {
    const src = readSample(SAMPLE_DIR, 'AccountService.cls');
    const h = parseApexClassHeader(src);
    expect(h?.name).toBe('AccountService');
    expect(h?.extendsClass).toBe('BaseService');
    expect(h?.sharingMode).toBe('with sharing');
  });

  it('IService: is an interface', () => {
    const src = readSample(SAMPLE_DIR, 'IService.cls');
    const h = parseApexClassHeader(src);
    expect(h?.kind).toBe('apex-interface');
  });

  it('BaseService: is abstract, implements IService', () => {
    const src = readSample(SAMPLE_DIR, 'BaseService.cls');
    const h = parseApexClassHeader(src);
    expect(h?.isAbstract).toBe(true);
    expect(h?.implementsInterfaces).toContain('IService');
  });

  it('AccountServiceTest: is test class', () => {
    const src = readSample(SAMPLE_DIR, 'AccountServiceTest.cls');
    const h = parseApexClassHeader(src);
    expect(h?.isTestClass).toBe(true);
  });

  it('NotificationService: is a regular class with sharing', () => {
    const src = readSample(SAMPLE_DIR, 'NotificationService.cls');
    const h = parseApexClassHeader(src);
    expect(h?.name).toBe('NotificationService');
    expect(h?.kind).toBe('apex-class');
  });
});

describe('Integration: parseMethods on actual sample files', () => {
  it('AccountService: has getActiveAccounts (static, @AuraEnabled)', () => {
    const src = readSample(SAMPLE_DIR, 'AccountService.cls');
    const methods = parseMethods(src);
    const m = methods.find((x) => x.name === 'getActiveAccounts');
    expect(m).toBeDefined();
    expect(m?.isStatic).toBe(true);
    expect(m?.annotations.map((a) => a.name)).toContain('AuraEnabled');
  });

  it('OrderService: has processOrderAsync (@Future)', () => {
    const src = readSample(SAMPLE_DIR, 'OrderService.cls');
    const methods = parseMethods(src);
    const m = methods.find((x) => x.name === 'processOrderAsync');
    expect(m).toBeDefined();
    expect(m?.isStatic).toBe(true);
    expect(m?.annotations.map((a) => a.name)).toContain('Future');
  });
});

describe('Integration: parseInnerClasses on actual sample files', () => {
  it('AccountService: detects AccountSummary and AccountTier', () => {
    const src = readSample(SAMPLE_DIR, 'AccountService.cls');
    const names = parseInnerClasses(src).map((c) => c.name);
    expect(names).toContain('AccountSummary');
    expect(names).toContain('AccountTier');
  });

  it('AccountService: AccountTier is an enum', () => {
    const src = readSample(SAMPLE_DIR, 'AccountService.cls');
    const inner = parseInnerClasses(src);
    expect(inner.find((c) => c.name === 'AccountTier')?.kind).toBe('apex-enum');
  });

  it('AccountService: AccountSummary has a constructor', () => {
    const src = readSample(SAMPLE_DIR, 'AccountService.cls');
    const inner = parseInnerClasses(src);
    const summary = inner.find((c) => c.name === 'AccountSummary');
    expect(summary?.methods.map((m) => m.name)).toContain('AccountSummary');
  });

  it('OrderService: detects OrderResult and OrderStatus', () => {
    const src = readSample(SAMPLE_DIR, 'OrderService.cls');
    const names = parseInnerClasses(src).map((c) => c.name);
    expect(names).toContain('OrderResult');
    expect(names).toContain('OrderStatus');
  });

  it('LeadService: detects LeadResult, LeadFilter, ConversionStatus', () => {
    const src = readSample(SAMPLE_DIR, 'LeadService.cls');
    const names = parseInnerClasses(src).map((c) => c.name);
    expect(names).toContain('LeadResult');
    expect(names).toContain('LeadFilter');
    expect(names).toContain('ConversionStatus');
  });

  it('LeadService: ConversionStatus is an enum', () => {
    const src = readSample(SAMPLE_DIR, 'LeadService.cls');
    const inner = parseInnerClasses(src);
    expect(inner.find((c) => c.name === 'ConversionStatus')?.kind).toBe('apex-enum');
  });

  it('BaseService: no inner classes', () => {
    const src = readSample(SAMPLE_DIR, 'BaseService.cls');
    expect(parseInnerClasses(src)).toHaveLength(0);
  });

  it('AccountService outer methods do not include inner class constructors', () => {
    const src = readSample(SAMPLE_DIR, 'AccountService.cls');
    const outerMethods = parseMethods(stripInnerClassBodies(src)).map((m) => m.name);
    // AccountSummary のコンストラクタはアウタークラスのメソッド一覧に出ない
    expect(outerMethods).not.toContain('AccountSummary');
    // アウタークラスのメソッドは引き続き検出される
    expect(outerMethods).toContain('getActiveAccounts');
    expect(outerMethods).toContain('updateAnnualRevenue');
  });

  it('OrderService outer methods do not include inner class constructors', () => {
    const src = readSample(SAMPLE_DIR, 'OrderService.cls');
    const outerMethods = parseMethods(stripInnerClassBodies(src)).map((m) => m.name);
    expect(outerMethods).not.toContain('OrderResult');
    expect(outerMethods).toContain('createOrder');
    expect(outerMethods).toContain('cancelOrder');
  });
});

describe('Integration: parseApexTriggerHeader on actual trigger files', () => {
  it('OrderTrigger: fires on Order__c', () => {
    const src = readSample(TRIGGER_DIR, 'OrderTrigger.trigger');
    const h = parseApexTriggerHeader(src);
    expect(h?.name).toBe('OrderTrigger');
    expect(h?.targetSObject).toBe('Order__c');
    expect(h?.events).toContain('after insert');
    expect(h?.events).toContain('after update');
    expect(h?.events).toContain('before delete');
  });

  it('AccountTrigger: fires on Account', () => {
    const src = readSample(TRIGGER_DIR, 'AccountTrigger.trigger');
    const h = parseApexTriggerHeader(src);
    expect(h?.name).toBe('AccountTrigger');
    expect(h?.targetSObject).toBe('Account');
  });
});
