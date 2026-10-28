import type { AgentAction } from "../incidents/agent-action";
import type { ComponentState } from "../../shared/domain";

/** Stable event seam for `component.status.changed.v1`. */
export interface ComponentStatusChangedEvent {
  agentAction?: AgentAction;
  componentId: string;
  previousState: ComponentState;
  state: ComponentState;
  changedAt: string;
  cause: "standing-claim" | "incident" | "maintenance" | "correction";
}

export interface ComponentEvents {
  componentStatusChanged(event: ComponentStatusChangedEvent): Promise<void>;
}

export const defaultComponentEvents: ComponentEvents = {
  async componentStatusChanged() {},
};
