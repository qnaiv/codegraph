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

    @AuraEnabled
    public static Order__c createOrder(Id accountId, String status) {
        // AccountService でアカウント存在確認
        List<Account> accounts = AccountService.getActiveAccounts(null);
        Account acc = [SELECT Id, Name FROM Account WHERE Id = :accountId LIMIT 1];

        Order__c order = new Order__c(
            Account__c    = acc.Id,
            Status__c     = status,
            OrderDate__c  = Date.today()
        );
        insert order;

        // 注文確認通知を送信
        NotificationService.sendOrderConfirmation(order.Id, accountId);

        return order;
    }

    public void addOrderItems(Id orderId, List<OrderItem__c> items) {
        for (OrderItem__c item : items) {
            item.Order__c = orderId;
        }
        insert items;
    }

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

    public void cancelOrder(Id orderId) {
        Order__c order = [SELECT Id, Status__c, Account__c FROM Order__c WHERE Id = :orderId LIMIT 1];
        order.Status__c = 'Cancelled';
        update order;

        List<OrderItem__c> items = [SELECT Id FROM OrderItem__c WHERE Order__c = :orderId];
        delete items;

        // 関連 Contact に通知
        notificationService.sendBulkNotifications(
            new List<Id>{ order.Account__c },
            'Order Cancelled',
            'Your order has been cancelled.'
        );
    }

    @Future
    public static void processOrderAsync(Id orderId) {
        Order__c order = [SELECT Id, Status__c, Account__c FROM Order__c WHERE Id = :orderId LIMIT 1];
        order.Status__c = 'Processing';
        update order;

        NotificationService.notifyAccountUpdate(order.Account__c, 'Order Processing');
    }
}
