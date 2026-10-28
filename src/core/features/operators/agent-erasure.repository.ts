/** Erasure keeps the existing opaque native reference, never a copied person's
 * name or a reusable queued principal. These statements join the native erase
 * receipt and run in its same atomic batch. Historical agent identity and real
 * outcomes remain; erasure does not pretend an already-sent message was recalled. */
const actionTables = ['incident_updates', 'incident_reports', 'maintenance_notices', 'component_notification_events', 'notification_outbox', 'social_posts'] as const;

function safeJson(value: string) { return `(CASE WHEN json_valid(${value}) THEN ${value} ELSE '{}' END)`; }
function namedArray(value: string, path: string, identifier = 'id') {
  return `CASE WHEN json_type(${value},'${path}')='array' THEN json_set(${value},'${path}',json((
    SELECT json_group_array(json(CASE WHEN json_extract(item.value,'$.${identifier}')=?1
      THEN json_set(item.value,'$.name',?2) ELSE item.value END)) FROM json_each(${value},'${path}') item
  ))) ELSE ${value} END`;
}
function actionMatches(value: string) {
  const source = safeJson(value);
  return `(json_extract(${source},'$.sponsor.id')=?1 OR json_extract(${source},'$.for.id')=?1 OR json_extract(${source},'$.person.id')=?1
    OR EXISTS(SELECT 1 FROM json_each(${source},'$.approvers') item WHERE json_extract(item.value,'$.id')=?1)
    OR EXISTS(SELECT 1 FROM json_each(${source},'$.approved_by') item WHERE json_extract(item.value,'$.id')=?1))`;
}
function scrubAction(value: string) {
  return `(WITH original(value) AS (SELECT ${safeJson(value)}), sponsor(value) AS (
    SELECT CASE WHEN json_extract(value,'$.sponsor.id')=?1 THEN
      json_remove(json_set(value,'$.sponsor.name',?2,'$.label',COALESCE(json_extract(value,'$.agent.name'),'Agent') || ' for ' || ?2),'$.invocation')
      ELSE value END FROM original
  ), paired(value) AS (
    SELECT CASE WHEN json_extract(value,'$.for.id')=?1 THEN
      json_set(value,'$.for.name',?2,'$.label',COALESCE(json_extract(value,'$.agent.name'),'Agent') || ' for ' || ?2)
      ELSE value END FROM sponsor
  ), person(value) AS (
    SELECT CASE WHEN json_extract(value,'$.person.id')=?1 THEN json_set(value,'$.person.name',?2) ELSE value END FROM paired
  ), consent(value) AS (
    SELECT CASE WHEN json_extract(value,'$.sponsor.id')=?1 AND json_type(value,'$.consent') IS NOT NULL
      THEN json_set(value,'$.consent',NULL) ELSE value END FROM person
  ), approvers(value) AS (SELECT ${namedArray('value', '$.approvers')} FROM consent),
  authority(value) AS (SELECT CASE WHEN EXISTS(SELECT 1 FROM json_each(value,'$.approvers') item WHERE json_extract(item.value,'$.id')=?1)
      THEN json_remove(value,'$.invocation') ELSE value END FROM approvers)
    SELECT ${namedArray('value', '$.approved_by')} FROM authority)`;
}
function scrubSaved(value: string) {
  return `(CASE WHEN json_extract(${safeJson(value)},'$.principal.person.id')=?1 THEN
    json_remove(json_set(${safeJson(value)},'$.principal.person.name',?2,
      '$.principal.person.email','deleted-' || lower(?1) || '@operator.invalid',
      '$.principal.person.active',json('false'),'$.principal.scopes',json('[]')),
      '$.principal.consent','$.principal.clientId','$.principal.nativeProof') ELSE ${value} END)`;
}
function html(value: string) {
  return `replace(replace(replace(replace(replace(${value},'&','&amp;'),'<','&lt;'),'>','&gt;'),'"','&quot;'),'''','&#39;')`;
}
function jsonFragment(value: string) { return `substr(json_quote(${value}),2,length(json_quote(${value}))-2)`; }

/** A person's copied attribution can also occur in a frozen provider envelope.
 * Replace complete prepared/approved labels, never arbitrary authored prose or
 * destinations. This executes before the source AgentAction copies are scrubbed. */
function scrubRendered(column: string, encoded: boolean) {
  const oldPrepared = `json_extract(value,'$.label')`;
  const newPrepared = `COALESCE(json_extract(value,'$.agent.name'),'Agent') || ' for ' || ?2`;
  const oldApproved = `'Approved by: ' || (SELECT group_concat(json_extract(item.value,'$.name'),', ') FROM json_each(value,'$.approvers') item)`;
  const newApproved = `'Approved by: ' || (SELECT group_concat(CASE WHEN json_extract(item.value,'$.id')=?1 THEN ?2 ELSE json_extract(item.value,'$.name') END,', ') FROM json_each(value,'$.approvers') item)`;
  const convert = (value: string) => encoded ? jsonFragment(value) : value;
  return `(WITH RECURSIVE actions(value) AS (${actionTables.map(table => `SELECT agent_action_json FROM ${table} WHERE json_valid(agent_action_json)`).join(' UNION ALL ')}),
    labels(old,new) AS (
      SELECT ${oldPrepared},${newPrepared} FROM actions WHERE json_extract(value,'$.sponsor.id')=?1
      UNION SELECT ${oldApproved},${newApproved} FROM actions WHERE EXISTS(SELECT 1 FROM json_each(value,'$.approvers') item WHERE json_extract(item.value,'$.id')=?1)
      UNION SELECT replace(${oldApproved},'Approved by: ','Approved by '),replace(${newApproved},'Approved by: ','Approved by ') FROM actions WHERE EXISTS(SELECT 1 FROM json_each(value,'$.approvers') item WHERE json_extract(item.value,'$.id')=?1)
    ), replacements(old,new) AS (
      SELECT ${convert('old')},${convert('new')} FROM labels WHERE old IS NOT NULL AND old<>'' AND old<>new
      ${encoded ? `UNION SELECT ${convert(html('old'))},${convert(html('new'))} FROM labels WHERE old IS NOT NULL AND old<>'' AND old<>new` : ''}
    ), ordered AS (SELECT row_number() OVER(ORDER BY old,new) AS n,old,new FROM replacements),
    rendered(n,value) AS (SELECT 0,${column} UNION ALL SELECT r.n+1,replace(r.value,o.old,o.new) FROM rendered r JOIN ordered o ON o.n=r.n+1)
    SELECT value FROM rendered ORDER BY n DESC LIMIT 1)`;
}

export function agentOperatorErasureStatements(db: D1Database, input: { id: string; actor: string; receipt: string; now: string }): D1PreparedStatement[] {
  const anonymous = `Erased operator · ${input.id}`;
  const refusal = JSON.stringify({ outcome: 'refused', code: 'sponsor_erased', decision: null });
  const witness = `EXISTS(SELECT 1 FROM audit_entries WHERE id=?3 AND entity_type='operator' AND entity_id=?1 AND action='deleted' AND operator_id=?4) AND ?5 IS NOT NULL AND ?6 IS NOT NULL`;
  const statement = (sql: string) => db.prepare(sql).bind(input.id, anonymous, input.receipt, input.actor, input.now, refusal);
  const statements: D1PreparedStatement[] = [];
  for (const table of ['notification_deliveries', 'component_notification_deliveries'] as const) {
    statements.push(statement(`UPDATE ${table} SET mail_payload_json=${scrubRendered('mail_payload_json', true)} WHERE mail_payload_json IS NOT NULL AND ${witness}`));
  }
  statements.push(statement(`UPDATE social_posts SET text=${scrubRendered('text', false)},body=${scrubRendered('body', true)} WHERE (text IS NOT NULL OR body IS NOT NULL) AND ${witness}`));
  for (const table of actionTables) {
    statements.push(statement(`UPDATE ${table} SET agent_action_json=${scrubAction('agent_action_json')} WHERE agent_action_json IS NOT NULL AND json_valid(agent_action_json) AND ${actionMatches('agent_action_json')} AND ${witness}`));
  }
  statements.push(
    statement(`UPDATE audit_entries SET payload_json=json_set(payload_json,'$.actor',json(${scrubAction("json_extract(payload_json,'$.actor')")})),updated_at=?5 WHERE json_valid(payload_json) AND json_type(payload_json,'$.actor')='object' AND ${actionMatches("json_extract(payload_json,'$.actor')")} AND ${witness}`),
    statement(`UPDATE lamp_agent_jobs SET state=CASE WHEN state='pending' THEN 'refused' ELSE state END,
      result_json=CASE WHEN state='pending' THEN ?6 ELSE json_object('outcome',state,'erased_sponsor',json('true')) END,
      args_json='{}',principal_json=json_remove(json_set(principal_json,'$.scopes',json('[]')),'$.consent','$.clientId','$.nativeProof'),updated_at=?5
      WHERE json_valid(principal_json) AND json_extract(principal_json,'$.person.id')=?1 AND ${witness}`),
    statement(`UPDATE agent_door_calls SET outcome=CASE WHEN agent IN(SELECT id FROM agent_door_agents WHERE sponsor=?1) THEN ?6
      ELSE json_object('outcome','refused','code','person_erased','decision',NULL) END
      WHERE (agent IN(SELECT id FROM agent_door_agents WHERE sponsor=?1)
        OR EXISTS(SELECT 1 FROM json_tree(${safeJson('outcome')}) field WHERE field.key IN('id','person') AND field.value=?1)) AND ${witness}`),
    statement(`UPDATE agent_door_agents SET sponsor_name=?2,revoked=1 WHERE sponsor=?1 AND ${witness}`),
    statement(`UPDATE agent_door_audit SET row=${scrubAction('row')} WHERE json_valid(row) AND ${actionMatches('row')} AND ${witness}`),
    statement(`UPDATE agent_door_events SET event=json_set(${scrubAction('event')},'$.actor',json(${scrubAction("json_extract(event,'$.actor')")})) WHERE json_valid(event) AND json_type(event,'$.actor')='object' AND (${actionMatches('event')} OR ${actionMatches("json_extract(event,'$.actor')")}) AND ${witness}`),
    statement(`UPDATE agent_door_approvals SET state=CASE WHEN state IN('pending','executing') AND json_extract(saved,'$.principal.person.id')=?1 THEN 'refused' ELSE state END,
      result=CASE WHEN state IN('pending','executing') AND json_extract(saved,'$.principal.person.id')=?1 THEN ?6
        WHEN json_valid(result) AND json_type(result,'$.receipt.prepared_by')='object' THEN
          json_set(json_remove(result,'$.result'),'$.receipt.prepared_by',json(${scrubAction("json_extract(result,'$.receipt.prepared_by')")}))
        WHEN json_extract(saved,'$.principal.person.id')=?1 AND json_valid(result) THEN json_remove(result,'$.result') ELSE result END,
      saved=${scrubSaved('saved')},approvals=json_extract(${namedArray("json_object('marks',json(approvals))", '$.marks', 'person')},'$.marks'),version=version+1
      WHERE json_valid(saved) AND (json_extract(saved,'$.principal.person.id')=?1 OR EXISTS(SELECT 1 FROM json_each(approvals) mark WHERE json_extract(mark.value,'$.person')=?1)) AND ${witness}`),
    statement(`UPDATE agent_door_reviews SET saved=${scrubSaved('saved')} WHERE json_valid(saved) AND json_extract(saved,'$.principal.person.id')=?1 AND ${witness}`),
    // Signed Business settings are cached authority, not editable prose. Drop the
    // whole cached envelope and retain its revision so only a newer signed roster
    // can apply again. Other current people retain their native session access.
    statement(`UPDATE bs_settings SET document=NULL,token='',owner_id=CASE WHEN EXISTS(SELECT 1 FROM oa_bootstrap WHERE claim_id=?1) THEN NULL ELSE owner_id END
      WHERE (EXISTS(SELECT 1 FROM oa_bootstrap WHERE claim_id=?1) OR EXISTS(SELECT 1 FROM bs_team WHERE operator_id=?1)) AND ${witness}`),
    statement(`UPDATE bs_team SET email='deleted-' || lower(?1) || '@operator.invalid',business_id=NULL,business_role=NULL,invite=0,state='inactive' WHERE operator_id=?1 AND ${witness}`),
  );
  return statements;
}
