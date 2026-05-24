@isTest
private class AccountServiceTest {

    @TestSetup
    static void makeData() {
        Account acc = new Account(Name = 'Test Account', Industry = 'Technology');
        insert acc;

        Contact con = new Contact(
            FirstName   = 'Test',
            LastName    = 'User',
            AccountId   = acc.Id,
            Email       = 'test@example.com'
        );
        insert con;
    }

    @isTest
    static void testGetActiveAccounts() {
        Test.startTest();
        List<Account> results = AccountService.getActiveAccounts('Technology');
        Test.stopTest();

        System.assertNotEquals(0, results.size(), 'Should return at least one account');
    }

    @isTest
    static void testGetAccountWithContacts() {
        Account acc = [SELECT Id FROM Account LIMIT 1];

        Test.startTest();
        Account result = AccountService.getAccountWithContacts(acc.Id);
        Test.stopTest();

        System.assertNotEquals(null, result);
        System.assertEquals(1, result.Contacts.size());
    }

    @isTest
    static void testUpdateAnnualRevenue() {
        Account acc = [SELECT Id FROM Account LIMIT 1];
        acc.AnnualRevenue = 1000000;
        update acc;

        AccountService svc = new AccountService();
        Test.startTest();
        svc.updateAnnualRevenue(new List<Account>{ acc }, 1.1);
        Test.stopTest();

        Account updated = [SELECT AnnualRevenue FROM Account WHERE Id = :acc.Id];
        System.assertEquals(1100000, updated.AnnualRevenue);
    }
}
