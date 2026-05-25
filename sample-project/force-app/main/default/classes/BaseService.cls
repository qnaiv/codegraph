/**
 * サービス層の抽象基底クラス
 * IService を実装し、共通ロギング処理を提供する
 */
public abstract with sharing class BaseService implements IService {

    protected String serviceName;

    public BaseService(String name) {
        this.serviceName = name;
    }

    /**
     * サービスを初期化し、起動ログを出力する
     */
    public void init() {
        System.debug('[' + serviceName + '] initialized');
    }

    /**
     * レコードが null でなければ有効とみなす（サブクラスでオーバーライド可能）
     */
    public virtual Boolean validate(SObject record) {
        return record != null;
    }

    // エラーをサービス名プレフィックス付きで ERROR レベルのデバッグログに記録する
    protected void logError(String message, Exception e) {
        System.debug(LoggingLevel.ERROR, '[' + serviceName + '] ' + message + ': ' + e.getMessage());
    }
}
