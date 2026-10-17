import { DeliveryService } from "../../../../modules/integrations/core/delivery.ts";
import { D1SqlDatabase } from "../../../../modules/integrations/core/database.ts";
import { IntegrationsRepository } from "../../../../modules/integrations/core/repository.ts";
import { SLACK_WEBHOOK_PROTOCOL } from "../../../../modules/integrations/slack/protocol.ts";
import { createLampSlackProtocol } from "../channels/slack";
import { renderLampSlackMessage } from "../channels/slack-message";
import { openUrl, sealingSecrets } from "../channels/sealing";
import { createTeamsProtocol, TEAMS_WEBHOOK_PROTOCOL } from "../channels/teams";
import { teamsTestCard } from "../channels/messages";
import { createChannelTransport } from "../channels/transport";

export function maintenanceChannelStatements(db:D1Database,input:{eventId:string;componentIds:string[];queuedAt:string;recipientScope:"eligible"|"previous";previousEventIds:string[]}) {
  if(!input.componentIds.length)return [];
  const slots=input.componentIds.map(()=>"?").join(",");
  const previous=input.previousEventIds.map(()=>"?").join(",")||"NULL";
  return [db.prepare(`INSERT OR IGNORE INTO maintenance_channel_posts(id,notice_id,destination_id,queued_at)
    SELECT ?||'.'||d.id,?,d.id,? FROM channel_destinations d WHERE d.removed_at IS NULL
    AND EXISTS(SELECT 1 FROM maintenance_notices WHERE id=?) AND ${input.recipientScope==="previous"?`EXISTS(SELECT 1 FROM maintenance_channel_posts p WHERE p.destination_id=d.id AND p.notice_id IN (${previous}))`:`((d.selection_mode='all' AND EXISTS(SELECT 1 FROM components c WHERE c.id IN (${slots}) AND c.internal=0)) OR (d.selection_mode='selected' AND EXISTS(SELECT 1 FROM channel_destination_components s JOIN components c ON c.id=s.component_id WHERE s.destination_id=d.id AND s.component_id IN (${slots}) AND c.internal=0)))`}`)
    .bind(input.eventId,input.eventId,input.queuedAt,input.eventId,...(input.recipientScope==="previous"?input.previousEventIds:[...input.componentIds,...input.componentIds]))];
}
export function createMaintenanceChannelDispatch(db:D1Database,options:{effectsPaused?:boolean;webhookSecret?:string;developmentReceiver?:string;unavailable?:string|null}) {
  const resolve=async(id:string)=>{const row=await db.prepare("SELECT sealed_url AS sealedUrl FROM channel_destinations WHERE id=? AND removed_at IS NULL").bind(id).first<{sealedUrl:string}>();if(!row)throw new Error("Channel unavailable");return openUrl(row.sealedUrl,id,sealingSecrets(options.webhookSecret));};
  const service=new DeliveryService({repository:new IntegrationsRepository(new D1SqlDatabase(db as never),"lamp-channels"),transport:createChannelTransport({developmentReceiver:options.developmentReceiver}),protocols:[createLampSlackProtocol(resolve),createTeamsProtocol(resolve)]});
  return async()=>{
    if(options.effectsPaused||options.unavailable)return;
    const posts=(await db.prepare(`SELECT p.id,p.destination_id AS destinationId,d.kind,n.body FROM maintenance_channel_posts p JOIN channel_destinations d ON d.id=p.destination_id JOIN maintenance_notices n ON n.id=p.notice_id WHERE d.removed_at IS NULL AND NOT EXISTS(SELECT 1 FROM integration_deliveries x WHERE x.namespace='lamp-channels' AND x.id=p.id) ORDER BY p.queued_at,p.id LIMIT 25`).all<{id:string;destinationId:string;kind:string;body:string}>()).results;
    for(const post of posts)await service.enqueue({id:post.id,tenant:"lamp-channels",destinationId:post.destinationId,event:"maintenance.notice",protocol:post.kind==="slack"?SLACK_WEBHOOK_PROTOCOL:TEAMS_WEBHOOK_PROTOCOL,body:post.kind==="slack"?JSON.stringify(renderLampSlackMessage("Maintenance update",[post.body])):teamsTestCard(post.body)});
    return service.dispatchDue(25);
  };
}
