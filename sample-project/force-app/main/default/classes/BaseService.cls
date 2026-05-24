/**
 * サービス層の抽象基底クラス
 * IService を実装し、共通ロギング処理を提供する
 */
public abstract with sharing class BaseService implements IService {

    protected String serviceName;

    public BaseService(String name) {
        this.serviceName = name;
    }

    public void init() {
        System.debug('[' + serviceName + '] initialized');
    }

    public virtual Boolean validate(SObject record) {
        return record != null;
    }

    protected void logError(String message, Exception e) {
        System.debug(LoggingLevel.ERROR, '[' + serviceName + '] ' + message + ': ' + e.getMessage());
    }
}
