/** Stable event seams for durable delivery outcomes. */
export interface DeliverySubscriberDeactivatedEvent {
  subscriberId: string;
  channel: "email" | "webhook";
  occurredAt: string;
  reason: string;
}

export interface NotificationFailedEvent {
  deliveryId: string;
  subscriberId: string;
  notificationEventId: string;
  failedAt: string;
}

export interface DeliveryEvents {
  subscriberDeactivated(event: DeliverySubscriberDeactivatedEvent): Promise<void>;
  notificationFailed(event: NotificationFailedEvent): Promise<void>;
}

export const defaultDeliveryEvents: DeliveryEvents = {
  async subscriberDeactivated() {},
  async notificationFailed() {},
};
