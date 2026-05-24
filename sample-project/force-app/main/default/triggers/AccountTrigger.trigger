trigger AccountTrigger on Account (before insert, before update, after insert, after update) {

    AccountService svc = new AccountService();

    if (Trigger.isBefore) {
        if (Trigger.isInsert) {
            for (Account acc : Trigger.new) {
                if (!svc.validate(acc)) {
                    acc.addError('Account validation failed');
                }
            }
        }
        if (Trigger.isUpdate) {
            for (Account acc : Trigger.new) {
                Account old = Trigger.oldMap.get(acc.Id);
                if (acc.AnnualRevenue != old.AnnualRevenue) {
                    System.debug('Revenue changed for: ' + acc.Name);
                }
            }
        }
    }

    if (Trigger.isAfter) {
        if (Trigger.isInsert) {
            svc.init();
        }
    }
}
