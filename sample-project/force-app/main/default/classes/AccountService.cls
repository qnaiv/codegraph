/**
 * Account に関するビジネスロジック
 * SOQL・DML・ContactService / NotificationService との連携を含む
 */
public with sharing class AccountService extends BaseService {

    /** Account の集計情報をまとめる DTO クラス */
    public class AccountSummary {
        public String name;
        public Decimal annualRevenue;
        public Integer contactCount;

        public AccountSummary(String name, Decimal revenue) {
            this.name = name;
            this.annualRevenue = revenue;
            this.contactCount = 0;
        }
    }

    /** Account の顧客ランクを示す列挙型 */
    public enum AccountTier {
        STANDARD,
        PREMIUM,
        ENTERPRISE
    }

    private ContactService contactService;
    private NotificationService notificationService;

    // コンストラクタ：依存サービスをインスタンス化して保持する
    public AccountService() {
        super('AccountService');
        this.contactService = new ContactService();
        this.notificationService = new NotificationService();
    }

    /**
     * Active な Account を業界でフィルタして最大200件取得する。
     * industry が null の場合は全件を返す。
     * @param industry 業界名（null 可）
     * @return アカウントリスト（Name 昇順）
     */
    @AuraEnabled(cacheable=true)
    public static List<Account> getActiveAccounts(String industry) {
        return [
            SELECT Id, Name, Industry, AnnualRevenue, OwnerId
            FROM Account
            WHERE IsDeleted = false
              AND (Industry = :industry OR :industry = null)
            ORDER BY Name
            LIMIT 200
        ];
    }

    /**
     * 指定 Account ID に紐づく Contact サブクエリを含む Account を1件取得する
     * @param accountId 取得対象の Account ID
     */
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

    /**
     * Account リストを AccountSummary に変換して返す。
     * @param accounts 変換対象の Account リスト
     * @return AccountSummary リスト
     */
    public static List<AccountSummary> toSummaries(List<Account> accounts) {
        List<AccountSummary> result = new List<AccountSummary>();
        for (Account acc : accounts) {
            result.add(new AccountSummary(acc.Name, acc.AnnualRevenue));
        }
        return result;
    }

    /**
     * 年間収益を指定倍率で更新し、完了後に NotificationService で変更通知を送信する
     */
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
            NotificationService.notifyAccountUpdate(toUpdate[0].Id, 'AnnualRevenue updated');
        }
    }

    // アカウントを一括削除（無効化）する。削除前に権限チェックを行うこと
    public void deactivateAccounts(Set<Id> accountIds) {
        List<Account> accounts = [
            SELECT Id, Name FROM Account WHERE Id IN :accountIds
        ];
        delete accounts;
    }

    // コメントなし：関連 Contact を ContactService 経由で取得するだけの委譲メソッド
    public List<Contact> getRelatedContacts(Id accountId) {
        return contactService.getContactsByAccount(accountId);
    }

    /**
     * フロー・プロセスビルダーからアーカイブ操作を呼び出すための InvocableMethod。
     * 対象アカウントを物理削除するため運用上は十分な注意が必要。取り消し不可。
     * @param accountIds アーカイブ対象の Account ID リスト
     */
    @InvocableMethod(label='Archive Account')
    public static void archiveAccounts(List<Id> accountIds) {
        List<Account> accounts = [SELECT Id FROM Account WHERE Id IN :accountIds];
        delete accounts;
    }

    /**
     * Account の全体レポートを生成し、5 ホップの連携処理で末端アーカイブまで実行する。
     * Contact → Lead → Order → Notification → Report の順に委譲する。
     * @param accountId 対象 Account ID
     */
    @AuraEnabled
    public static String generateFullReport(Id accountId) {
        Account acc = [SELECT Id, Name, Industry, AnnualRevenue FROM Account WHERE Id = :accountId LIMIT 1];
        ContactService cs = new ContactService();
        return cs.enrichWithLeadData(accountId, acc.Name);
    }
}
