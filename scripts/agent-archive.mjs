// Historical attribution travels; retained agent execution authority does not.
export const agentTransientTables = ['lamp_agent_jobs', 'agent_door_state', 'agent_door_calls', 'agent_door_approvals', 'agent_door_reviews', 'agent_door_usage'];
export function agentArchiveRow(table, row) {
  if (table === 'agent_door_agents') return { ...row, revoked: 1 };
  if (typeof row.agent_action_json !== 'string') return row;
  const action = JSON.parse(row.agent_action_json);
  delete action.invocation;
  return { ...row, agent_action_json: JSON.stringify(action) };
}
