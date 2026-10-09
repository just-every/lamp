import type { DeliveryChannel } from "../../shared/domain";

export interface NotificationEventsPolicy {
  readonly id: "notification.events.v1";
  channelsForIncidentUpdate(): readonly DeliveryChannel[];
}

export const defaultNotificationEventsPolicy: NotificationEventsPolicy = {
  id: "notification.events.v1",
  channelsForIncidentUpdate: () => ["email", "webhook"],
};
