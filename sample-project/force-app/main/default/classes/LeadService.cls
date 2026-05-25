/**
 * リード（Lead）に関するビジネスロジック
 * インナークラスによるラッパー / フィルター / 列挙型パターンのデモ
 */
public with sharing class LeadService extends BaseService {

    /** 操作結果のラッパークラス */
    public class LeadResult {
        public Boolean success;
        public String message;
        public Lead record;

        public LeadResult(Boolean success, String message) {
            this.success = success;
            this.message = message;
        }
    }

    /** 検索条件を保持するフィルタークラス */
    public class LeadFilter {
        public String status;
        public String leadSource;
        public Integer maxResults;

        public LeadFilter() {
            this.maxResults = 50;
        }
    }

    /** コンバージョンステータスの列挙型 */
    public enum ConversionStatus {
        PENDING,
        CONVERTED,
        FAILED
    }

    public LeadService() {
        super('LeadService');
    }

    @AuraEnabled(cacheable=true)
    public static List<Lead> getLeads(LeadFilter filter) {
        return [
            SELECT Id, Name, Status, LeadSource, Company
            FROM Lead
            WHERE Status = :filter.status
            LIMIT :filter.maxResults
        ];
    }

    public static LeadResult convertLead(Id leadId) {
        Lead lead = [SELECT Id, Name FROM Lead WHERE Id = :leadId LIMIT 1];
        lead.Status = 'Closed - Converted';
        update lead;
        return new LeadResult(true, 'Converted: ' + lead.Name);
    }
}
