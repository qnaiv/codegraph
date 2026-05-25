/**
 * 受注（Order__c）に関するビジネスロジック
 * Account と Order__c / OrderItem__c を扱う
 * AccountService / NotificationService と連携
 */
public with sharing class OrderService extends BaseService {

    private AccountService accountService;
    private NotificationService notificationService;

    public OrderService() {
        super('OrderService');
        this.accountService = new AccountService();
        this.notificationService = new NotificationService();
    }

    /**
     * 新規 Order__c を作成し、作成後に注文確認通知を関係者へ送信する。
     * Account の存在確認を事前に AccountService 経由で行う。
     * @param accountId 注文元アカウント ID
     * @param status 注文ステータス（例: Draft / Confirmed）
     * @return 作成した Order__c レコード
     */
    @AuraEnabled
    public static Order__c createOrder(Id accountId, String status) {
        List<Account> accounts = AccountService.getActiveAccounts(null);
        Account acc = [SELECT Id, Name FROM Account WHERE Id = :accountId LIMIT 1];

        Order__c order = new Order__c(
            Account__c    = acc.Id,
            Status__c     = status,
            OrderDate__c  = Date.today()
        );
        insert order;

        NotificationService.sendOrderConfirmation(order.Id, accountId);

        return order;
    }

    /**
     * 注文明細を Order に紐づけて一括インサートする
     */
    public void addOrderItems(Id orderId, List<OrderItem__c> items) {
        for (OrderItem__c item : items) {
            item.Order__c = orderId;
        }
        insert items;
    }

    // アカウントに紐づく注文を注文日降順で取得する（明細サブクエリ付き）
    public List<Order__c> getOrdersByAccount(Id accountId) {
        return [
            SELECT Id, Name, Status__c, OrderDate__c, TotalAmount__c,
                   (SELECT Id, ProductName__c, Quantity__c, UnitPrice__c
                    FROM OrderItems__r)
            FROM Order__c
            WHERE Account__c = :accountId
            ORDER BY OrderDate__c DESC
        ];
    }

    /**
     * 注文をキャンセル状態に更新し、全明細を削除後に顧客へ通知する。
     * 複数の DML を含むため、呼び出し元でトランザクション管理が必要。
     */
    public void cancelOrder(Id orderId) {
        Order__c order = [SELECT Id, Status__c, Account__c FROM Order__c WHERE Id = :orderId LIMIT 1];
        order.Status__c = 'Cancelled';
        update order;

        List<OrderItem__c> items = [SELECT Id FROM OrderItem__c WHERE Order__c = :orderId];
        delete items;

        notificationService.sendBulkNotifications(
            new List<Id>{ order.Account__c },
            'Order Cancelled',
            'Your order has been cancelled.'
        );
    }

    /**
     * 非同期で注文ステータスを Processing に更新する。
     * 外部 API コールや長時間処理と組み合わせて使用する。
     */
    @Future
    public static void processOrderAsync(Id orderId) {
        Order__c order = [SELECT Id, Status__c, Account__c FROM Order__c WHERE Id = :orderId LIMIT 1];
        order.Status__c = 'Processing';
        update order;

        NotificationService.notifyAccountUpdate(order.Account__c, 'Order Processing');
    }
}
