/**
 * Contact に関するビジネスロジック
 */
public with sharing class ContactService extends BaseService {

    public ContactService() {
        super('ContactService');
    }

    @AuraEnabled(cacheable=true)
    public static List<Contact> getContactsByAccount(Id accountId) {
        return [
            SELECT Id, FirstName, LastName, Email, Phone, Title
            FROM Contact
            WHERE AccountId = :accountId
              AND IsDeleted = false
            ORDER BY LastName, FirstName
        ];
    }

    public void createContacts(List<Contact> contacts) {
        try {
            insert contacts;
        } catch (DmlException e) {
            logError('Failed to insert contacts', e);
            throw e;
        }
    }

    public void syncContactEmails(List<Contact> contacts) {
        List<Contact> toUpdate = new List<Contact>();
        for (Contact c : contacts) {
            if (String.isNotBlank(c.Email)) {
                c.Email = c.Email.toLowerCase();
                toUpdate.add(c);
            }
        }
        if (!toUpdate.isEmpty()) {
            update toUpdate;
        }
    }

    public void removeContacts(List<Contact> contacts) {
        delete contacts;
    }

    public override Boolean validate(SObject record) {
        Contact c = (Contact) record;
        return c != null && String.isNotBlank(c.LastName);
    }
}
