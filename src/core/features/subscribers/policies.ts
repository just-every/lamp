export interface SubscriberConfirmationPolicy {
  readonly id: "subscriber.confirmation.v1";
  requiresConfirmation(): boolean;
}

export const defaultSubscriberConfirmationPolicy: SubscriberConfirmationPolicy = {
  id: "subscriber.confirmation.v1",
  requiresConfirmation: () => true,
};
