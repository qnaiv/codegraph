trigger OrderTrigger on Order__c (after insert, after update, before delete) {

    OrderService svc = new OrderService();

    if (Trigger.isAfter && Trigger.isInsert) {
        for (Order__c order : Trigger.new) {
            OrderService.processOrderAsync(order.Id);
        }
    }

    if (Trigger.isAfter && Trigger.isUpdate) {
        for (Order__c order : Trigger.new) {
            Order__c old = Trigger.oldMap.get(order.Id);
            if (order.Status__c != old.Status__c) {
                System.debug('Order status changed: ' + old.Status__c + ' → ' + order.Status__c);
            }
        }
    }

    if (Trigger.isBefore && Trigger.isDelete) {
        for (Order__c order : Trigger.old) {
            if (order.Status__c == 'Processing') {
                order.addError('処理中の受注は削除できません');
            }
        }
    }
}
