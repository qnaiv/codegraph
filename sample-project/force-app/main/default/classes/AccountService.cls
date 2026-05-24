/**
 * Account に関するビジネスロジック
 * SOQL・DML・ContactService との連携を含む
 */
public with sharing class AccountService extends BaseService {

    private ContactService contactService;

    public AccountService() {
        super('AccountService');
        this.contactService = new ContactService();
    }

    @AuraEnabled(cacheable=true)
    public static List<Account> getActiveAccounts(String industry) {
        return [
            SELECT Id, Name, Industry, AnnualRevenue, OwnerId
            FROM Account
            WHERE IsDeleted = false
              AND Industry = :industry
            ORDER BY Name
            LIMIT 200
        ];
    }

    @AuraEnabled
    public static Account getAccountWithContacts(Id accountId) {
        return [
            SELECT Id, Name, Phone, BillingCity,
                   (SELECT Id, FirstName, LastName, Email FROM Contacts)
            FROM Account
            WHERE Id = :accountId
            LIMIT 1
        ];
    }

    public void updateAnnualRevenue(List<Account> accounts, Decimal revenueMultiplier) {
        List<Account> toUpdate = new List<Account>();
        for (Account acc : accounts) {
            if (acc.AnnualRevenue != null) {
                acc.AnnualRevenue = acc.AnnualRevenue * revenueMultiplier;
                toUpdate.add(acc);
            }
        }
        if (!toUpdate.isEmpty()) {
            update toUpdate;
        }
    }

    public void deactivateAccounts(Set<Id> accountIds) {
        List<Account> accounts = [
            SELECT Id, Name FROM Account WHERE Id IN :accountIds
        ];
        delete accounts;
    }

    public List<Contact> getRelatedContacts(Id accountId) {
        return contactService.getContactsByAccount(accountId);
    }

    @InvocableMethod(label='Archive Account')
    public static void archiveAccounts(List<Id> accountIds) {
        List<Account> accounts = [SELECT Id FROM Account WHERE Id IN :accountIds];
        delete accounts;
    }
}
