import type { CommunicationOwner } from "../../incidents/ui/communication-owner";

/** Communication identities are shown only in operator documents. */
export function IncidentOwnerLabel({ owner, unowned }: { owner: CommunicationOwner; unowned: boolean }) {
  return unowned ? <span className="overdue-note"> · Unowned</span> : owner ? <span> · Communication owner: {owner.displayName}</span> : null;
}
