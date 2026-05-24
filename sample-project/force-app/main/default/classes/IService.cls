/**
 * サービス層の基底インターフェース
 */
public interface IService {
    void init();
    Boolean validate(SObject record);
}
