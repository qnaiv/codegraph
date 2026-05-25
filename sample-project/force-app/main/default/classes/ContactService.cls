/**
 * Contact に関するビジネスロジック
 */
public with sharing class ContactService extends BaseService {

    public ContactService() {
        super('ContactService');
    }

    /**
     * Account に紐づく Contact を姓・名の昇順で返す
     * @param accountId 対象 Account ID
     * @return Contact リスト
     */
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

    /**
     * Contact を一括インサートする。
     * DML 例外が発生した場合はエラーをログに記録した上で再スローする。
     */
    public void createContacts(List<Contact> contacts) {
        try {
            insert contacts;
        } catch (DmlException e) {
            logError('Failed to insert contacts', e);
            throw e;
        }
    }

    // メールアドレスを小文字に正規化してから一括更新する
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

    /**
     * 姓が空でない Contact のみ有効とみなす
     */
    public override Boolean validate(SObject record) {
        Contact c = (Contact) record;
        return c != null && String.isNotBlank(c.LastName);
    }
}
