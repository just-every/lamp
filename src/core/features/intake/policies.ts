export interface AlertIntakePolicy {
  createsDraft(input: { sourceId: string; deduplicationKey: string; recovered: boolean }): boolean;
}

export const defaultAlertIntakePolicy: AlertIntakePolicy = {
  createsDraft: ({ recovered }) => !recovered,
};
