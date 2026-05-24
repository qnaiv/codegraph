/**
 * 受注（Order__c）に関するビジネスロジック
 * Account と Order__c / OrderItem__c を扱う
 */
public with sharing class OrderService extends BaseService {

    public OrderService() {
        super('OrderService');
    }

    @AuraEnabled
    public static Order__c createOrder(Id accountId, String status) {
        Account acc = [SELECT Id, Name FROM Account WHERE Id = :accountId LIMIT 1];

        Order__c order = new Order__c(
            Account__c    = acc.Id,
            Status__c     = status,
            OrderDate__c  = Date.today()
        );
        insert order;
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
        Order__c order = [SELECT Id, Status__c FROM Order__c WHERE Id = :orderId LIMIT 1];
        order.Status__c = 'Cancelled';
        update order;

        List<OrderItem__c> items = [SELECT Id FROM OrderItem__c WHERE Order__c = :orderId];
        delete items;
    }

    @Future
    public static void processOrderAsync(Id orderId) {
        Order__c order = [SELECT Id, Status__c, Account__c FROM Order__c WHERE Id = :orderId LIMIT 1];
        order.Status__c = 'Processing';
        update order;
    }
}
