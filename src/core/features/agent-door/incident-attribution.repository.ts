import type { NativeAttribution } from './provenance.repository';

/** Bounded native detail projection avoids one database read per history row. */
export async function readIncidentAgentAttributions(db:D1Database,ids:string[]):Promise<Map<string,NativeAttribution>> {
  const result=new Map<string,NativeAttribution>();
  const unique=[...new Set(ids)];
  for(let offset=0;offset<unique.length;offset+=80) {
    const batch=unique.slice(offset,offset+80);
    const rows=(await db.prepare(`SELECT p.entity_type AS entityType,p.entity_id AS entityId,p.agent_id AS agentId,p.agent_name AS agentName,p.operator_id AS sponsorId,
      CASE WHEN o.id IS NULL OR o.email='deleted-'||lower(o.id)||'@operator.invalid' THEN 'Erased operator · '||p.operator_id ELSE o.display_name END AS sponsorName,
      (SELECT json_group_array(json_object('id',json_extract(reviewer.value,'$.id'),'name',CASE WHEN person.id IS NULL OR person.email='deleted-'||lower(person.id)||'@operator.invalid' THEN 'Erased operator · '||json_extract(reviewer.value,'$.id') ELSE person.display_name END)) FROM json_each(p.approvers_json) reviewer LEFT JOIN oa_operators person ON person.id=json_extract(reviewer.value,'$.id')) AS approversJson
      FROM lamp_agent_attribution p LEFT JOIN oa_operators o ON o.id=p.operator_id
      WHERE p.entity_id IN (${batch.map(()=>'?').join(',')}) AND p.created_at=(SELECT max(newer.created_at) FROM lamp_agent_attribution newer WHERE newer.entity_type=p.entity_type AND newer.entity_id=p.entity_id)`)
      .bind(...batch).all<{entityType:string;entityId:string;agentId:string;agentName:string;sponsorId:string;sponsorName:string;approversJson:string}>()).results;
    for(const row of rows)result.set(`${row.entityType}:${row.entityId}`,{agent:{id:row.agentId,name:row.agentName},sponsor:{id:row.sponsorId,name:row.sponsorName},approvers:JSON.parse(row.approversJson),label:`${row.agentName} for ${row.sponsorName}`});
  }
  return result;
}
