export interface FollowUp {
  id: string;
  kind: string;
  title: string;
  owner: { id: string; displayName: string } | null;
  dueAt: string;
  stopCondition: string;
  failure: { state: "failed"; message: string; occurredAt: string } | null;
  link: string;
  occurrence: string;
}

export interface FollowUpRow {
  id: string; kind: string; title: string;
  owner_id: string | null; owner_name: string | null;
  due_at: string; stop_condition: string;
  failure_message: string | null; failure_at: string | null;
  link: string; occurrence: string;
}
