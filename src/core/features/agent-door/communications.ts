import { z } from 'zod';
import { ToolRefusal } from '../../../../modules/agent-door/index.ts';
import type { ApprovalSummary, ClassAndFacts, JsonSchema, JsonSchemaObject, ToolContext, ToolDefinition } from '../../../../modules/agent-door/types.ts';
import type { ClassId } from '../../../../modules/agent-door/policy/catalogue.ts';
import type { AppServices } from '../../app/services';
import type { AppBindings } from '../../app/types';
import { notificationOrigin } from '../../app/mail';
import { createQueueDispatcher } from '../../platform/jobs';
import { ulidSchema } from '../../shared/ids';
import { createFollowUpsRepository } from '../overview/follow-ups/repository';
import { createFollowUpRetryRepository } from '../overview/follow-ups/retry.repository';
import { createFollowUpsService } from '../overview/follow-ups/service';
import { storedPreferences } from '../subscribers/preferences';
import { subscriberAddSchema } from '../subscribers/intake-schema';
import type { AlertSourceView } from '../intake/service';
import { createCommunicationRepository } from './communications.repository';
import { deliveryProjection, subscriberProjection } from './communication-resources';

const empty = z.object({}).strict();
const identifier = z.object({ id: ulidSchema }).strict();
const standard = (measure = 1): ClassAndFacts[] => [{class: 'standard', facts: {measure}}];
const external = (measure: number): ClassAndFacts[] => measure > 0 ? [{class: 'external', facts: {measure, counterparty: 'known'}}] : standard(0);
const object = {type:'object',additionalProperties:true} as const;
const records = {type:'array',items:object} as const;
const boolean = {type:'boolean'} as const;
const string = {type:'string'} as const;
const resultSchema = (properties:Record<string,JsonSchema>,required=Object.keys(properties)):JsonSchemaObject => ({type:'object',properties,required,additionalProperties:false});
const communicationOutputs:Record<string,JsonSchemaObject> = {
  'lamp.subscribers.read':resultSchema({subscribers:records,capacity:records,batches:records,pendingBatches:records}),
  'lamp.subscribers.add':resultSchema({subscriber:object,created:boolean,confirmationSent:boolean}),
  'lamp.subscribers.invite':resultSchema({batchId:string,sent:{type:'integer',minimum:0},remaining:{type:'integer',minimum:0}}),
  'lamp.subscribers.remove':resultSchema({erased:boolean,id:string}),
  'lamp.followups.read':resultSchema({followUps:records}),
  'lamp.followups.dismiss':resultSchema({dismissed:boolean,id:string}),
  'lamp.followups.retry':resultSchema({queued:boolean,id:string}),
  'lamp.deliveries.read':resultSchema({deliveries:records}),
  'lamp.intake.read':resultSchema({sources:records,receipts:records}),
  'lamp.intake.update':resultSchema({source:object}),
  'lamp.channels.read':resultSchema({channels:records,posts:records}),
  'lamp.channels.update':resultSchema({channel:object}),
  'lamp.channels.test':resultSchema({sent:boolean,message:string}),
  'lamp.social.read':resultSchema({accounts:records,posts:records,postByDefault:boolean,unavailable:{type:['string','null']}}),
  'lamp.ai.read':resultSchema({configured:boolean,unavailable:{type:['string','null']}}),
  'lamp.ai.suggest':resultSchema({suggestion:object,brief:object}),
  'lamp.ai.check':resultSchema({ok:boolean,message:string}),
};

type Definition<S extends z.ZodObject> = {
  name: string; title: string; description: string; scope: string; input: S;
  classes: ClassId[]; clauses: string[]; readOnly: boolean;
  run(args: z.output<S>, ctx: ToolContext): Promise<unknown>;
  classify?(args: z.output<S>, ctx: ToolContext): Promise<ClassAndFacts[]> | ClassAndFacts[];
  summary?(args: z.output<S>, ctx: ToolContext): Promise<ApprovalSummary> | ApprovalSummary;
  revision?(args: z.output<S>, ctx: ToolContext): Promise<string | number | null>;
  authority?(args: z.output<S>, ctx: ToolContext): Promise<{subject: string; widens: boolean} | null>;
  revisionType?: 'integer' | 'number' | 'string';
  resource?(result: unknown): Array<{uri: string; name: string}>;
};
function checked<S extends z.ZodObject>(schema: S, args: Record<string, unknown>): z.output<S> {
  const result = schema.safeParse(args);
  if (!result.success) throw new ToolRefusal('invalid_arguments');
  return result.data;
}
/** Recheck current native admission before reading, classification and execution. */
function define<S extends z.ZodObject>(definition: Definition<S>, allowed: (id: string) => Promise<boolean>): ToolDefinition {
  const {input, resource, ...metadata} = definition;
  const admit = async (ctx: ToolContext) => {if (!await allowed(ctx.person.id)) throw new ToolRefusal('unauthenticated');};
  return {
    ...metadata, untrusted:true,
    inputSchema: z.toJSONSchema(input) as JsonSchemaObject, outputSchema:communicationOutputs[metadata.name]!,
    async classify(args, ctx) {await admit(ctx); return definition.classify ? definition.classify(checked(input, args), ctx) : standard();},
    ...(definition.summary ? {summary: async (args: Record<string,unknown>,ctx:ToolContext) => {await admit(ctx); return definition.summary!(checked(input,args),ctx);}} : {}),
    ...(definition.revision ? {revision: async (args:Record<string,unknown>,ctx:ToolContext) => {await admit(ctx); return definition.revision!(checked(input,args),ctx);}} : {}),
    ...(definition.authority ? {authority: async (args:Record<string,unknown>,ctx:ToolContext) => {await admit(ctx); return definition.authority!(checked(input,args),ctx);}} : {}),
    async run(args, ctx) {await admit(ctx); const result = await definition.run(checked(input,args),ctx); return {result,...(resource ? {resources:resource(result)} : {})};},
  };
}
function sourceProjection(source: AlertSourceView) {const {token:_token,...view}=source; return view;}

export function createCommunicationTools(services: AppServices, bindings: AppBindings): ToolDefinition[] {
  const repository=createCommunicationRepository(bindings.DB);
  const tool=<S extends z.ZodObject>(definition:Definition<S>)=>define(definition,repository.activeOperator);
  const followUps=createFollowUpsService(createFollowUpsRepository(bindings.DB),createFollowUpRetryRepository(bindings.DB));
  const source=async(id:string)=>{const row=(await services.intake.listSources()).find(value=>value.id===id);if(!row)throw new ToolRefusal('not_found');return row;};
  const channel=async(id:string)=>{const row=(await services.channels.list()).find(value=>value.id===id);if(!row)throw new ToolRefusal('not_found');return row;};
  const invitation=async(id:string)=>{const plan=await repository.invitationPlan(id);if(!plan)throw new ToolRefusal('not_found');return plan;};
  const outbound=()=>{if(bindings.EFFECTS_PAUSED==='1')throw new ToolRefusal('effects_paused');};
  const inputFollowUp=z.object({id:z.string().min(1).max(256),occurrence:z.string().min(1).max(4096)}).strict();
  const subscriberAdd=z.object({
    channel:z.enum(['email','webhook','sms']),email:z.email().max(320).optional(),phone:z.string().max(32).optional(),
    destination:z.url().max(2048).optional(),contactEmail:z.email().max(320).optional(),componentIds:z.array(ulidSchema).max(200),
    webhookFormat:z.enum(['lamp','statuspage']).optional(),eventKinds:z.array(z.enum(['incidents','maintenance','components'])).max(3).optional(),
    minimumImpact:z.literal('Partially unavailable').nullable().optional(),
  }).strict();
  const parsedAdd=(args:z.output<typeof subscriberAdd>)=>{const result=subscriberAddSchema.safeParse(args);if(!result.success)throw new ToolRefusal('invalid_arguments');return result.data;};
  return [tool({
    name:'lamp.subscribers.read',title:'Read subscriber consent',scope:'lamp.subscribers.read',
    description:'Read native subscription state, selected components, capacity and pending invitation batches without tokens or webhook capability paths.',
    input:z.object({id:ulidSchema.optional(),limit:z.number().int().min(1).max(100).optional(),offset:z.number().int().min(0).max(1_000_000_000).optional()}).strict(),
    readOnly:true,classes:['standard'],clauses:['SUB-001','SUB-017','SUB-020'],
    async run(args,ctx){const row=args.id?await repository.subscribers.findSubscriber(args.id):null;if(args.id&&!row)throw new ToolRefusal('not_found');const batches=await services.subscribers.intake.batches(ctx.person.id);return {subscribers:row?[subscriberProjection({...row,componentSelections:await repository.subscribers.listComponents(row.id),preferences:storedPreferences(row),addedBy:await repository.subscribers.intake.addedBy(row.id)})]:(await services.subscribers.list(args.limit??100,args.offset??0)).map(subscriberProjection),capacity:await services.subscribers.getLimits(),batches,pendingBatches:batches.filter(batch=>batch.remaining>0)};},
  }),tool({
    name:'lamp.subscribers.add',title:'Add a pending subscriber',scope:'lamp.subscribers.write',
    description:'Use native intake to add an email, SMS or webhook subscriber and request its confirmation. Existing subscriptions remain unchanged; this never fabricates consent.',
    input:subscriberAdd,readOnly:false,classes:['standard','external'],clauses:['SUB-001','SUB-013','SUB-017','SUB-020'],
    async classify(args){
      const input=parsedAdd(args), address=input.channel==='email'?input.email:input.channel==='sms'?input.phone:input.destination;
      const existing=await repository.subscribers.findSubscriberByDestination(address);
      if(existing && (input.channel!=='sms'||existing.state==='active'))return standard(0);
      const recipient=input.channel==='email'?input.email:input.channel==='sms'?input.phone:input.contactEmail;
      if(!await repository.confirmationAllowed(recipient,input.channel))return standard(1);
      return [{class:'external',facts:{measure:1,counterparty:existing?'known':'new'}}];
    },
    summary(args){const input=parsedAdd(args);const recipient=input.channel==='email'?input.email:input.channel==='sms'?input.phone:input.contactEmail;return {target:{name:`${input.channel} subscription awaiting recipient confirmation`},recipients:[recipient],items:input.componentIds};},
    async run(args,ctx){outbound();const result=await services.subscribers.intake.add(parsedAdd(args),ctx.person.id,await notificationOrigin(bindings));ctx.emit('subscriber.changed',`lamp://subscribers/${result.subscriber.id}`);return {created:result.created,confirmationSent:result.confirmationSent,subscriber:subscriberProjection(result.subscriber)};},
    resource(result){const value=result as {subscriber:{id:string}};return [{uri:`lamp://subscribers/${value.subscriber.id}`,name:'Pending subscriber'}];},
  }),tool({
    name:'lamp.subscribers.invite',title:'Invite a pending imported batch',scope:'lamp.subscribers.write',
    description:'Request confirmations for the current eligible pending native import batch. Import itself sends nothing; each native claim permits one invitation and never confirms a subscription.',
    input:z.object({batchId:ulidSchema}).strict(),readOnly:false,classes:['standard','external'],clauses:['SUB-017','MOVE-002'],revisionType:'string',
    async revision(args){return (await invitation(args.batchId)).revision;},
    async classify(args){return external((await invitation(args.batchId)).recipients.length);},
    async summary(args){const plan=await invitation(args.batchId);return {target:{id:plan.batchId,name:'Pending imported subscriber invitations'},recipients:plan.recipients,items:plan.subscriberIds};},
    async run(args,ctx){outbound();const plan=await invitation(args.batchId);const result=await services.subscribers.intake.sendInvitations(args.batchId,ctx.person.id,await notificationOrigin(bindings),ctx.actor.label,plan.subscriberIds);for(const id of plan.subscriberIds)ctx.emit('subscriber.invitation-requested',`lamp://subscribers/${id}`);return {batchId:args.batchId,...result};},
  }),tool({
    name:'lamp.subscribers.remove',title:'Erase a subscriber',scope:'lamp.subscribers.write',
    description:'Use native erasure to remove a subscriber destination, revoke its tokens and retain anonymized history.',
    input:identifier,readOnly:false,classes:['destructive'],clauses:['SUB-011','BASE-DATA-003'],revisionType:'string',
    async revision(args){return (await repository.subscribers.findSubscriber(args.id))?.updatedAt??null;},
    classify:()=>[{class:'destructive',facts:{measure:1}}],summary:args=>({target:{id:args.id,name:'Subscriber destination and consent credentials'}}),
    async run(args,ctx){if(!await services.subscribers.deleteSubscriber(args.id,ctx.person.id))throw new ToolRefusal('not_found');ctx.emit('subscriber.erased',`lamp://subscribers/${args.id}`);return {erased:true,id:args.id};},
  }),tool({
    name:'lamp.followups.read',title:'Read native follow-ups',scope:'lamp.followups.read',
    description:'Read retained due and failed obligations without retrying, sending or performing recovery checks.',input:empty,readOnly:true,classes:['standard'],clauses:['AUTO-003'],
    async run(){return {followUps:await followUps.list()};},
  }),tool({
    name:'lamp.followups.dismiss',title:'Dismiss one failed occurrence',scope:'lamp.followups.write',
    description:'Dismiss the exact failed native follow-up occurrence with a reason; later failures remain independently visible.',
    input:inputFollowUp.extend({reason:z.string().trim().min(1).max(1000)}).strict(),readOnly:false,classes:['standard'],clauses:['AUTO-003'],revisionType:'string',
    async revision(args){return (await followUps.list()).find(row=>row.id===args.id)?.occurrence??null;},
    summary:args=>({target:{id:args.id,name:'Failed follow-up occurrence'},items:[args.occurrence,args.reason]}),
    async run(args,ctx){if(!await followUps.dismiss(args,ctx.person.id))throw new ToolRefusal('revision_conflict');ctx.emit('followup.dismissed',`lamp://followups/${encodeURIComponent(args.id)}`);return {dismissed:true,id:args.id};},
  }),tool({
    name:'lamp.followups.retry',title:'Retry an unfinished native notification',scope:'lamp.followups.write',
    description:'Submit the exact unfinished native dispatch to its existing durable consumer. Accepted, completed and uncertain provider work is never reopened.',
    input:inputFollowUp,readOnly:false,classes:['external'],clauses:['AUTO-003','NOTIFY-003'],revisionType:'string',
    async revision(args){return (await followUps.list()).find(row=>row.id===args.id)?.occurrence??null;},
    async classify(args){return [{class:'external',facts:{measure:(await repository.retryRecipients(args.id)).length,counterparty:'known'}}];},
    async summary(args){return {target:{id:args.id,name:'Unfinished notification dispatch'},recipients:await repository.retryRecipients(args.id),items:[args.occurrence]};},
    async run(args,ctx){outbound();const result=await followUps.retry(args,ctx.person.id,createQueueDispatcher(bindings.JOBS));if(result==='stale')throw new ToolRefusal('revision_conflict');if(result==='queue-failed')throw new ToolRefusal('queue_unavailable');ctx.emit('followup.retry-requested',`lamp://followups/${encodeURIComponent(args.id)}`);return {queued:true,id:args.id};},
  }),tool({
    name:'lamp.deliveries.read',title:'Read actual delivery outcomes',scope:'lamp.deliveries.read',
    description:'Read native outbox/provider facts without frozen messages, endpoint capabilities or raw provider error text. Provider acceptance is separate from delivery and human readership.',
    input:z.object({id:z.string().min(1).max(512).optional(),incidentUpdateId:ulidSchema.optional(),limit:z.number().int().min(1).max(100).optional(),offset:z.number().int().min(0).max(1_000_000_000).optional()}).strict(),
    readOnly:true,classes:['standard'],clauses:['NOTIFY-003','NOTIFY-004','NOTIFY-015','NOTIFY-018'],
    async run(args){const rows=await services.deliveries.list(args);if(args.id&&!rows.length)throw new ToolRefusal('not_found');return {deliveries:rows.map(deliveryProjection)};},
  }),tool({
    name:'lamp.intake.read',title:'Read connected alert sources',scope:'lamp.intake.read',
    description:'Read redacted source configuration and accepted receipt metadata. Provider/customer text is untrusted; source tokens and raw authenticated payloads are excluded.',
    input:z.object({id:ulidSchema.optional(),limit:z.number().int().min(1).max(250).optional()}).strict(),readOnly:true,classes:['standard'],clauses:['INTAKE-001','INTAKE-002'],
    async run(args){return {sources:(args.id?[await source(args.id)]:await services.intake.listSources()).map(sourceProjection),receipts:await services.intake.listReceipts(args.limit??100)};},
  }),tool({
    name:'lamp.intake.update',title:'Update an existing alert source',scope:'lamp.intake.write',
    description:'Update an existing native source name, component mappings and JSON paths while preserving its current credential. First connection and secret rotation retain their native person screen.',
    input:z.object({id:ulidSchema,name:z.string().trim().min(1).max(120).optional(),componentId:ulidSchema.optional(),deduplicationPath:z.string().min(1).max(250).optional(),titlePath:z.string().min(1).max(250).optional(),statePath:z.string().min(1).max(250).optional(),recoveredValue:z.string().min(1).max(100).optional(),monitorMappings:z.array(z.object({monitorId:z.string().min(1).max(200),componentId:ulidSchema}).strict()).max(200).optional()}).strict(),
    readOnly:false,classes:['standard','live','security'],clauses:['INTAKE-001','INTAKE-002','AUTO-001'],revisionType:'string',
    async revision(args){return (await source(args.id)).updatedAt;},
    async authority(args){const current=await source(args.id);const before=new Set([...(current.componentId?[current.componentId]:[]),...(current.monitorMappings??[]).map(row=>row.componentId)]);const after=new Set([...(args.componentId?[args.componentId]:current.componentId?[current.componentId]:[]),...(args.monitorMappings??current.monitorMappings??[]).map(row=>row.componentId)]);return {subject:current.id,widens:[...after].some(id=>!before.has(id))};},
    async classify(args){const current=await source(args.id);if(!current.webhookConnected)throw new ToolRefusal('native_setup_required');const changed=Object.keys(args).filter(key=>key!=='id'&&key!=='name'&&JSON.stringify(args[key as keyof typeof args])!==JSON.stringify(current[key as keyof typeof current]));if(!changed.length)return standard();const facts:ClassAndFacts[]=[{class:'live',facts:{measure:1,service:'alert intake'}}];if(changed.some(key=>['componentId','monitorMappings'].includes(key)))facts.push({class:'security',facts:{measure:1,setting:`${current.name}: authenticated alert mapping`}});return facts;},
    async summary(args){const current=await source(args.id);return {target:{id:current.id,name:current.name},items:[JSON.stringify({current:{name:current.name,componentId:current.componentId,monitorMappings:current.monitorMappings,deduplicationPath:current.deduplicationPath,titlePath:current.titlePath,statePath:current.statePath,recoveredValue:current.recoveredValue},proposed:args})]};},
    async run(args,ctx){const current=await source(args.id);if(!current.webhookConnected)throw new ToolRefusal('native_setup_required');const {id:_id,...changes}=args;const input={name:current.name,preset:current.preset??undefined,credentialKind:current.credentialKind,closeAlertOnResolve:current.closeAlertOnResolve,monitorMappings:current.monitorMappings,labelMatchers:current.labelMatchers,componentId:current.componentId??undefined,timestampHeader:current.timestampHeader,signatureHeader:current.signatureHeader,deduplicationPath:current.deduplicationPath,titlePath:current.titlePath,statePath:current.statePath,recoveredValue:current.recoveredValue,...changes};const saved=await services.intake.saveSource(input,ctx.person.id,args.id);ctx.emit('intake.source-changed',`lamp://intake/${saved.id}`);return {source:sourceProjection(saved)};},
  }),tool({
    name:'lamp.channels.read',title:'Read connected channels',scope:'lamp.channels.read',description:'Read connected Slack/Teams channel names, component selections and native delivery log without sealed webhook URLs.',input:empty,readOnly:true,classes:['standard'],clauses:['NOTIFY-011','NOTIFY-012','NOTIFY-016'],
    async run(){return {channels:await services.channels.list(),posts:await services.channels.log()};},
  }),tool({
    name:'lamp.channels.update',title:'Set a channel operator-alert preference',scope:'lamp.channels.write',
    description:'Enable or disable private operational alerts for one already connected operator-managed channel. Subscriber-owned channels cannot acquire operator authority.',
    input:z.object({id:ulidSchema,operatorAlerts:z.boolean()}).strict(),readOnly:false,classes:['standard','access'],clauses:['NOTIFY-016'],revisionType:'string',
    async revision(args){return JSON.stringify(await channel(args.id));},
    async authority(args){const current=await channel(args.id);return {subject:current.id,widens:args.operatorAlerts&&!current.operatorAlerts};},
    async classify(args){const current=await channel(args.id);if(!current.operatorManaged)throw new ToolRefusal('not_found');return current.operatorAlerts===args.operatorAlerts?standard(0):[{class:'access',facts:{measure:1,direction:args.operatorAlerts?'widens':'narrows'}}];},
    async summary(args){return {target:{id:args.id,name:(await channel(args.id)).name},items:[args.operatorAlerts?'Enable private operator alerts':'Disable private operator alerts']};},
    async run(args,ctx){const current=await channel(args.id);if(!current.operatorManaged)throw new ToolRefusal('not_found');if(!await services.channels.setOperatorAlerts(args.id,args.operatorAlerts,ctx.person.id))throw new ToolRefusal('not_found');ctx.emit('channel.changed',`lamp://channels/${args.id}`);return {channel:await channel(args.id)};},
  }),tool({
    name:'lamp.channels.test',title:'Send a named channel test',scope:'lamp.channels.write',
    description:'Send one clearly labelled Slack/Teams test to the existing native channel. A provider acceptance is not proof a person read it.',input:identifier,readOnly:false,classes:['external'],clauses:['NOTIFY-011','NOTIFY-012'],
    async classify(args){await channel(args.id);return [{class:'external',facts:{measure:1,counterparty:'known'}}];},
    async summary(args){const current=await channel(args.id);return {target:{id:current.id,name:current.name},recipients:[current.name],items:['Test post; no incident publication']};},
    async run(args,ctx){outbound();const result=await services.channels.sendTest(args.id,ctx.actor.label);if(!result)throw new ToolRefusal('not_found');ctx.emit('channel.test-requested',`lamp://channels/${args.id}`);return result;},
  }),tool({
    name:'lamp.social.read',title:'Read social publication truth',scope:'lamp.social.read',
    description:'Read configured X, Bluesky and Mastodon metadata and actual attempts. Social sends are selected on the exact native incident or maintenance publication.',input:empty,readOnly:true,classes:['standard'],clauses:['INTEG-002'],async run(){return services.social.list();},
  }),tool({
    name:'lamp.ai.read',title:'Read AI availability',scope:'lamp.ai.read',description:'Read native configured provider availability without contacting a model or claiming a successful check.',input:empty,readOnly:true,classes:['standard'],clauses:['DRAFT-001','DRAFT-003'],async run(){return {configured:services.ai.configured(),unavailable:services.ai.unavailable};},
  }),tool({
    name:'lamp.ai.suggest',title:'Request a cited update suggestion',scope:'lamp.ai.write',
    description:'Send the native model-free incident brief to the configured provider for a cited suggestion. Internal notes remain excluded; this neither saves nor publishes the result.',input:identifier,readOnly:false,classes:['external'],clauses:['DRAFT-001','DRAFT-003','DRAFT-004'],
    async classify(args){if(!services.ai.configured())throw new ToolRefusal('provider_unavailable');if(!await services.briefs.get(args.id))throw new ToolRefusal('not_found');return [{class:'external',facts:{measure:1,counterparty:'known'}}];},
    summary:args=>({target:{id:args.id,name:'Native incident brief'},recipients:['Configured OpenAI-compatible provider'],items:['Public update evidence and cited suggestion; no internal notes']}),
    async run(args){outbound();const result=await services.ai.suggest(args.id);if(!result)throw new ToolRefusal('not_found');return result;},
  }),tool({
    name:'lamp.ai.check',title:'Check the configured AI connection',scope:'lamp.ai.write',
    description:'Send the native fictional connection-check brief to the configured provider. No installation or incident data is sent.',input:empty,readOnly:false,classes:['external'],clauses:['DRAFT-003'],
    classify(){if(!services.ai.configured())throw new ToolRefusal('provider_unavailable');return [{class:'external',facts:{measure:1,counterparty:'known'}}];},
    summary:()=>({target:{name:'AI connection check'},recipients:['Configured OpenAI-compatible provider'],items:['Fictional CHECK-1 brief; no installation data']}),async run(){outbound();return services.ai.check();},
  })];
}
