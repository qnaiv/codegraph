/**
 * レポートアーカイブサービス（5 ホップ連携の末端）
 * Task を使ってレポートを保存・記録する。
 */
public with sharing class ReportService extends BaseService {

    public ReportService() {
        super('ReportService');
    }

    /**
     * レポートを Task レコードとして保存する（5 ホップ連携の最終ステップ）
     * @param accountId 対象 Account ID
     * @param reportData レポート内容
     * @param recipientCount 配信先数
     */
    public void archive(Id accountId, String reportData, Integer recipientCount) {
        Task reportTask = new Task(
            WhatId      = accountId,
            Subject     = 'Report Archived',
            Description = reportData + ' | Recipients: ' + recipientCount,
            Status      = 'Completed',
            ActivityDate = Date.today()
        );
        insert reportTask;
    }

    /**
     * 過去のアーカイブ済みレポートを取得する
     */
    @AuraEnabled(cacheable=true)
    public static List<Task> getArchivedReports(Id accountId) {
        return [
            SELECT Id, Subject, Description, ActivityDate, CreatedDate
            FROM Task
            WHERE WhatId = :accountId AND Subject = 'Report Archived'
            ORDER BY CreatedDate DESC
            LIMIT 20
        ];
    }

    public override Boolean validate(SObject record) {
        return record != null && record.Id != null;
    }
}
