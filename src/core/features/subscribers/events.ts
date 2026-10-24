/** Stable event seams for subscriber lifecycle facts. */
export interface SubscriberLifecycleEvent {
  subscriberId: string;
  channel: "email" | "webhook" | "slack" | "teams";
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
