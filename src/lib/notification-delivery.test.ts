import { beforeEach, describe, expect, it } from 'vitest';
import { notificationDeliverySummary, recordNotificationDelivery } from './notification-delivery';

beforeEach(() => localStorage.clear());

describe('notification delivery audit', () => {
  it('records outcomes without persisting the alert key or patient data', async () => {
    await recordNotificationDelivery('overdue:26110001', 'delivered');
    await recordNotificationDelivery('overdue:26110001', 'acknowledged');
    const raw = localStorage.getItem('pathomitra_notification_delivery_v1') ?? '';
    expect(raw).not.toContain('26110001');
    expect(raw).not.toContain('overdue:');
    expect(notificationDeliverySummary()).toEqual({ delivered: 1, failed: 0, acknowledged: 1 });
  });

  it('keeps the local audit bounded', async () => {
    for (let index = 0; index < 210; index += 1)
      await recordNotificationDelivery(`synthetic-${index}`, 'failed');
    const records = JSON.parse(
      localStorage.getItem('pathomitra_notification_delivery_v1') ?? '[]',
    ) as unknown[];
    expect(records).toHaveLength(200);
  });
});
