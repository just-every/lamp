/** Stable event seams for subscriber lifecycle facts. */
export interface SubscriberLifecycleEvent {
  subscriberId: string;
  channel: "email" | "webhook";
  occurredAt: string;
  reason?: string;
}

export interface SubscriberEvents {
  subscriberConfirmed(event: SubscriberLifecycleEvent): Promise<void>;
  subscriberDeactivated(event: SubscriberLifecycleEvent): Promise<void>;
}

export const defaultSubscriberEvents: SubscriberEvents = {
  async subscriberConfirmed() {},
  async subscriberDeactivated() {},
};
