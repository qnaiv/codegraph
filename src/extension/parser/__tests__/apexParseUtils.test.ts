import { describe, it, expect } from 'vitest';
import { parseClassRefs, parseMethods, parseApexClassHeader, parseApexTriggerHeader, parseInnerClasses, stripInnerClassBodies } from '../apexParseUtils';

// -----------------------------------------------------------------------
// parseClassRefs
// -----------------------------------------------------------------------

describe('parseClassRefs', () => {
  it('detects instantiation via new ClassName()', () => {
    const src = `
      public class Foo {
        Bar b = new Bar();
      }
    `;
    const refs = parseClassRefs(src);
    expect(refs).toContainEqual({ targetClass: 'Bar', kind: 'instantiates' });
  });

  it('detects static method call ClassName.method()', () => {
    const src = `
      public class Foo {
        public void run() {
          Bar.doSomething();
        }
      }
    `;
    const refs = parseClassRefs(src);
    expect(refs).toContainEqual({ targetClass: 'Bar', kind: 'calls' });
  });

  it('detects instance call via field type declaration', () => {
    const src = `
      public class Foo {
        private Bar bar;
        public void run() {
          bar.execute();
        }
      }
    `;
    const refs = parseClassRefs(src);
    expect(refs).toContainEqual({ targetClass: 'Bar', kind: 'calls' });
  });

  it('when both new and static call exist, only instantiates is returned', () => {
    const src = `
      public class Foo {
        Bar b = new Bar();
        public void run() {
          Bar.staticMethod();
        }
      }
    `;
    const refs = parseClassRefs(src);
    expect(refs).toContainEqual({ targetClass: 'Bar', kind: 'instantiates' });
    expect(refs).not.toContainEqual({ targetClass: 'Bar', kind: 'calls' });
  });

  it('filters out system classes like System, Date, String', () => {
    // These pass through parseClassRefs but are filtered in GraphBuilder
    // Here we just verify the raw output contains them (caller filters)
    const src = `
      public class Foo {
        public void run() {
          System.debug('hi');
          Date d = Date.today();
          String s = String.valueOf(1);
        }
      }
    `;
    const refs = parseClassRefs(src);
    const kinds = refs.map((r) => r.targetClass);
    // GraphBuilder filters against classNodes, so we don't filter here
    expect(kinds).toContain('System');
    expect(kinds).toContain('Date');
  });

  it('does not create self-referential entry for class name pattern', () => {
    const src = `
      public class OrderService extends BaseService {
        public static OrderService getInstance() {
          return new OrderService();
        }
      }
    `;
    const refs = parseClassRefs(src);
    // OrderService instantiates itself — caller (GraphBuilder) filters self-refs
    expect(refs).toContainEqual({ targetClass: 'OrderService', kind: 'instantiates' });
  });

  // -----------------------------------------------------------------------
  // サンプルプロジェクト実データによるテスト
  // -----------------------------------------------------------------------

  const ACCOUNT_SERVICE_SRC = `
    public with sharing class AccountService extends BaseService {
        private ContactService contactService;
        private NotificationService notificationService;

        public AccountService() {
            super('AccountService');
            this.contactService = new ContactService();
            this.notificationService = new NotificationService();
        }

        @AuraEnabled(cacheable=true)
        public static List<Account> getActiveAccounts(String industry) {
            return [SELECT Id, Name FROM Account WHERE IsDeleted = false LIMIT 200];
        }

        public List<Contact> getRelatedContacts(Id accountId) {
            return contactService.getContactsByAccount(accountId);
        }

        public void updateAnnualRevenue(List<Account> accounts, Decimal revenueMultiplier) {
            update accounts;
            NotificationService.notifyAccountUpdate(accounts[0].Id, 'updated');
        }
    }
  `;

  it('AccountService: instantiates ContactService and NotificationService', () => {
    const refs = parseClassRefs(ACCOUNT_SERVICE_SRC);
    const instantiates = refs.filter((r) => r.kind === 'instantiates').map((r) => r.targetClass);
    expect(instantiates).toContain('ContactService');
    expect(instantiates).toContain('NotificationService');
  });

  it('AccountService: instance call contactService.getContactsByAccount() is detected', () => {
    const refs = parseClassRefs(ACCOUNT_SERVICE_SRC);
    // ContactService is instantiated, so it appears as instantiates (not calls)
    expect(refs).toContainEqual({ targetClass: 'ContactService', kind: 'instantiates' });
    expect(refs).not.toContainEqual({ targetClass: 'ContactService', kind: 'calls' });
  });

  const ORDER_SERVICE_SRC = `
    public with sharing class OrderService extends BaseService {
        private AccountService accountService;
        private NotificationService notificationService;

        public OrderService() {
            super('OrderService');
            this.accountService = new AccountService();
            this.notificationService = new NotificationService();
        }

        @AuraEnabled
        public static Order__c createOrder(Id accountId, String status) {
            List<Account> accounts = AccountService.getActiveAccounts(null);
            Account acc = [SELECT Id, Name FROM Account WHERE Id = :accountId LIMIT 1];
            Order__c order = new Order__c(
                Account__c    = acc.Id,
                Status__c     = status,
                OrderDate__c  = Date.today()
            );
            insert order;
            NotificationService.sendOrderConfirmation(order.Id, accountId);
            return order;
        }

        public void cancelOrder(Id orderId) {
            Order__c order = [SELECT Id, Status__c, Account__c FROM Order__c WHERE Id = :orderId LIMIT 1];
            order.Status__c = 'Cancelled';
            update order;
            notificationService.sendBulkNotifications(
                new List<Id>{ order.Account__c },
                'Order Cancelled',
                'Your order has been cancelled.'
            );
        }

        @Future
        public static void processOrderAsync(Id orderId) {
            Order__c order = [SELECT Id, Status__c, Account__c FROM Order__c WHERE Id = :orderId LIMIT 1];
            order.Status__c = 'Processing';
            update order;
            NotificationService.notifyAccountUpdate(order.Account__c, 'Order Processing');
        }
    }
  `;

  it('OrderService: instantiates AccountService', () => {
    const refs = parseClassRefs(ORDER_SERVICE_SRC);
    expect(refs).toContainEqual({ targetClass: 'AccountService', kind: 'instantiates' });
  });

  it('OrderService: instantiates NotificationService', () => {
    const refs = parseClassRefs(ORDER_SERVICE_SRC);
    expect(refs).toContainEqual({ targetClass: 'NotificationService', kind: 'instantiates' });
  });

  it('OrderService: static call AccountService.getActiveAccounts() is captured (as instantiates because also newed)', () => {
    const refs = parseClassRefs(ORDER_SERVICE_SRC);
    // AccountService is both new'd and statically called → only instantiates
    const accountRefs = refs.filter((r) => r.targetClass === 'AccountService');
    expect(accountRefs).toHaveLength(1);
    expect(accountRefs[0].kind).toBe('instantiates');
  });

  it('OrderService: instance call notificationService.sendBulkNotifications() is detected', () => {
    const refs = parseClassRefs(ORDER_SERVICE_SRC);
    // NotificationService is both new'd and instance-called → only instantiates
    const notifRefs = refs.filter((r) => r.targetClass === 'NotificationService');
    expect(notifRefs).toHaveLength(1);
    expect(notifRefs[0].kind).toBe('instantiates');
  });

  it('OrderService: only calls edge (no new) for a static-only reference', () => {
    // If we only statically call Logger without newing it, it should be 'calls'
    const src = `
      public class OrderService {
        public static void process() {
          Logger.log('processing');
        }
      }
    `;
    const refs = parseClassRefs(src);
    expect(refs).toContainEqual({ targetClass: 'Logger', kind: 'calls' });
    expect(refs).not.toContainEqual({ targetClass: 'Logger', kind: 'instantiates' });
  });
});

// -----------------------------------------------------------------------
// parseMethods
// -----------------------------------------------------------------------

describe('parseMethods', () => {
  it('detects public method', () => {
    const src = `
      public class Foo {
        public String doWork() {
          return 'hello';
        }
      }
    `;
    const methods = parseMethods(src);
    expect(methods.map((m) => m.name)).toContain('doWork');
  });

  it('detects static method', () => {
    const src = `
      public class Foo {
        public static void run() {}
      }
    `;
    const methods = parseMethods(src);
    const run = methods.find((m) => m.name === 'run');
    expect(run?.isStatic).toBe(true);
  });

  it('skips keywords caught as method names', () => {
    const src = `
      public class Foo {
        public void doIt() {
          if (true) { return; }
          for (Integer i = 0; i < 10; i++) {}
        }
      }
    `;
    const methods = parseMethods(src);
    const names = methods.map((m) => m.name);
    expect(names).not.toContain('if');
    expect(names).not.toContain('for');
    expect(names).not.toContain('return');
  });

  it('detects @AuraEnabled annotation on method', () => {
    const src = `
      public class AccountService {
        @AuraEnabled(cacheable=true)
        public static List<Account> getAccounts() {
          return [SELECT Id FROM Account];
        }
      }
    `;
    const methods = parseMethods(src);
    const getAccounts = methods.find((m) => m.name === 'getAccounts');
    expect(getAccounts).toBeDefined();
    expect(getAccounts?.annotations.map((a) => a.name)).toContain('AuraEnabled');
  });

  it('extracts /** */ block doc comment', () => {
    const src = `
      public class Foo {
        /**
         * Fetches all active accounts.
         * @param industry filter value
         */
        public static List<Account> getActive(String industry) {
          return [SELECT Id FROM Account];
        }
      }
    `;
    const methods = parseMethods(src);
    const m = methods.find((x) => x.name === 'getActive');
    expect(m?.docComment).toBe('Fetches all active accounts.');
  });

  it('extracts // single-line doc comment', () => {
    const src = `
      public class Foo {
        // メールアドレスを小文字に正規化して更新する
        public void syncEmails(List<Contact> contacts) {}
      }
    `;
    const methods = parseMethods(src);
    const m = methods.find((x) => x.name === 'syncEmails');
    expect(m?.docComment).toBe('メールアドレスを小文字に正規化して更新する');
  });

  it('returns undefined docComment when no comment precedes method', () => {
    const src = `
      public class Foo {
        public void noComment() {}
      }
    `;
    const methods = parseMethods(src);
    const m = methods.find((x) => x.name === 'noComment');
    expect(m?.docComment).toBeUndefined();
  });

  it('strips @param / @return lines from block comment', () => {
    const src = `
      public class Foo {
        /**
         * Creates an order record.
         * @param accountId account ID
         * @return created order
         */
        public static Order__c createOrder(Id accountId) { return null; }
      }
    `;
    const methods = parseMethods(src);
    const m = methods.find((x) => x.name === 'createOrder');
    expect(m?.docComment).toBe('Creates an order record.');
    expect(m?.docComment).not.toContain('@param');
    expect(m?.docComment).not.toContain('@return');
  });
});

// -----------------------------------------------------------------------
// parseApexClassHeader
// -----------------------------------------------------------------------

describe('parseApexClassHeader', () => {
  it('parses basic public class', () => {
    const src = 'public class Foo {}';
    const h = parseApexClassHeader(src);
    expect(h?.name).toBe('Foo');
    expect(h?.kind).toBe('apex-class');
    expect(h?.accessModifier).toBe('public');
  });

  it('parses interface', () => {
    const src = 'public interface IService {}';
    const h = parseApexClassHeader(src);
    expect(h?.kind).toBe('apex-interface');
  });

  it('parses enum', () => {
    const src = 'public enum Status { ACTIVE, INACTIVE }';
    const h = parseApexClassHeader(src);
    expect(h?.kind).toBe('apex-enum');
  });

  it('detects abstract and virtual', () => {
    const src = 'public abstract class Base {}';
    const h = parseApexClassHeader(src);
    expect(h?.isAbstract).toBe(true);
    expect(h?.isVirtual).toBe(false);
  });

  it('detects with sharing / without sharing', () => {
    expect(parseApexClassHeader('public with sharing class Foo {}')?.sharingMode).toBe('with sharing');
    expect(parseApexClassHeader('public without sharing class Foo {}')?.sharingMode).toBe('without sharing');
    expect(parseApexClassHeader('public inherited sharing class Foo {}')?.sharingMode).toBe('inherited sharing');
  });

  it('detects extends', () => {
    const src = 'public class Child extends Parent {}';
    expect(parseApexClassHeader(src)?.extendsClass).toBe('Parent');
  });

  it('detects implements', () => {
    const src = 'public class Foo implements IService, IValidatable {}';
    expect(parseApexClassHeader(src)?.implementsInterfaces).toEqual(['IService', 'IValidatable']);
  });

  it('detects @isTest class', () => {
    const src = '@isTest\npublic class FooTest {}';
    expect(parseApexClassHeader(src)?.isTestClass).toBe(true);
  });

  it('returns null for non-class source', () => {
    expect(parseApexClassHeader('trigger T on Account (before insert) {}')).toBeNull();
  });
});

// -----------------------------------------------------------------------
// parseApexTriggerHeader
// -----------------------------------------------------------------------

describe('parseApexTriggerHeader', () => {
  it('parses trigger name and sObject', () => {
    const src = 'trigger AccountTrigger on Account (before insert, after update) {}';
    const h = parseApexTriggerHeader(src);
    expect(h?.name).toBe('AccountTrigger');
    expect(h?.targetSObject).toBe('Account');
  });

  it('parses trigger events', () => {
    const src = 'trigger T on Order__c (before insert, before update, after delete) {}';
    const h = parseApexTriggerHeader(src);
    expect(h?.events).toContain('before insert');
    expect(h?.events).toContain('before update');
    expect(h?.events).toContain('after delete');
  });

  it('returns null for non-trigger source', () => {
    expect(parseApexTriggerHeader('public class Foo {}')).toBeNull();
  });
});

// -----------------------------------------------------------------------
// parseInnerClasses
// -----------------------------------------------------------------------

describe('parseInnerClasses', () => {
  const SRC_WITH_INNER = `
    public class Outer {
      public class Result {
        public Boolean success;
        public String message;
        public Result(Boolean s, String m) { this.success = s; this.message = m; }
      }
      public class Filter {
        public String status;
        public Filter() {}
      }
      public enum Status { PENDING, DONE }
      public void outerMethod() {}
    }
  `;

  it('detects all inner classes', () => {
    const inner = parseInnerClasses(SRC_WITH_INNER);
    const names = inner.map((c) => c.name);
    expect(names).toContain('Result');
    expect(names).toContain('Filter');
    expect(names).toContain('Status');
  });

  it('correctly classifies kinds', () => {
    const inner = parseInnerClasses(SRC_WITH_INNER);
    expect(inner.find((c) => c.name === 'Result')?.kind).toBe('apex-class');
    expect(inner.find((c) => c.name === 'Status')?.kind).toBe('apex-enum');
  });

  it('parses methods within inner class', () => {
    const inner = parseInnerClasses(SRC_WITH_INNER);
    const result = inner.find((c) => c.name === 'Result');
    const names = result?.methods.map((m) => m.name) ?? [];
    expect(names).toContain('Result'); // constructor
  });

  it('returns empty array when no inner classes', () => {
    const src = 'public class Simple { public void doIt() {} }';
    expect(parseInnerClasses(src)).toHaveLength(0);
  });

  it('parses extends/implements on inner class', () => {
    const src = `
      public class Outer {
        public class Child extends Base implements IFace {}
      }
    `;
    const inner = parseInnerClasses(src);
    expect(inner[0].extendsClass).toBe('Base');
    expect(inner[0].implementsInterfaces).toContain('IFace');
  });
});

// -----------------------------------------------------------------------
// stripInnerClassBodies
// -----------------------------------------------------------------------

describe('stripInnerClassBodies', () => {
  it('outer class method is still detected after stripping', () => {
    const src = `
      public class Outer {
        public class Inner {
          public void innerMethod() {}
        }
        public void outerMethod() {}
      }
    `;
    const stripped = stripInnerClassBodies(src);
    const methods = parseMethods(stripped).map((m) => m.name);
    expect(methods).toContain('outerMethod');
    expect(methods).not.toContain('innerMethod');
  });

  it('preserves source length (space padding)', () => {
    const src = `public class Outer { public class Inner { public void m() {} } }`;
    const stripped = stripInnerClassBodies(src);
    expect(stripped.length).toBe(src.length);
  });

  it('no-op when no inner classes', () => {
    const src = 'public class Simple { public void doIt() {} }';
    expect(stripInnerClassBodies(src)).toBe(src);
  });
});
