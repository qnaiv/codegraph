/**
 * 通知送信サービス
 * AccountService / OrderService から呼び出される共有ユーティリティ
 */
public with sharing class NotificationService extends BaseService {

    public NotificationService() {
        super('NotificationService');
    }

    /**
     * 注文確認を Account に紐づく Contact 全員（最大10件）へ送信する
     * @param orderId 注文 ID
     * @param accountId 対象 Account ID
     */
    @AuraEnabled
    public static void sendOrderConfirmation(Id orderId, Id accountId) {
        List<Contact> contacts = [
            SELECT Id, Email, FirstName
            FROM Contact
            WHERE AccountId = :accountId AND IsDeleted = false
            LIMIT 10
        ];

        for (Contact c : contacts) {
            System.debug('Sending order confirmation to: ' + c.Email + ' for order: ' + orderId);
        }
    }

    // アカウント変更をデバッグログに記録する（本番では外部通知サービスへの連携に置き換え想定）
    public static void notifyAccountUpdate(Id accountId, String changeType) {
        System.debug('Account ' + accountId + ' changed: ' + changeType);
    }

    /**
     * 複数の受信者に同一件名・本文の通知をまとめて送信する
     */
    public static void sendBulkNotifications(List<Id> recipientIds, String subject, String body) {
        for (Id recipientId : recipientIds) {
            System.debug('Notifying ' + recipientId + ': ' + subject);
        }
    }

    /**
     * レポートをアカウントの Contact 全員へ配信し、アーカイブを ReportService へ委譲する。
     * @param accountId 対象 Account ID
     * @param reportData レポート内容
     */
    public static void distributeReport(Id accountId, String reportData) {
        List<Contact> recipients = [
            SELECT Id FROM Contact
            WHERE AccountId = :accountId AND Email != null
            LIMIT 10
        ];
        ReportService rs = new ReportService();
        rs.archive(accountId, reportData, recipients.size());
    }

    public override Boolean validate(SObject record) {
        return record != null && record.Id != null;
    }
}
