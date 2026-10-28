import type { ResourceDefinition } from '../../../../modules/agent-door/types.ts';
import type { AppServices } from '../../app/services';
import type { AppBindings } from '../../app/types';
import type { SubscriberView } from '../subscribers/service';
import type { StoredSubscriber } from '../subscribers/repository';
import { storedPreferences } from '../subscribers/preferences';
import type { DeliveryRow } from '../deliveries/repository';
import { createCommunicationRepository } from './communications.repository';

/** Webhook paths are capability-bearing in several supported providers. Only
 * their public origin is evidence returned to an application agent. */
export function destinationLabel(channel: string, value: string | null) {
  if (!value) return null;
  if (channel !== 'webhook' && channel !== 'slack' && channel !== 'teams') return value;
  try { return new URL(value).origin; } catch { return '[destination unavailable]'; }
}

export function subscriberProjection(row: StoredSubscriber | SubscriberView) {
  return {
    id: row.id, channel: row.channel, destination: destinationLabel(row.channel, row.destination),
    contactEmail: row.contactEmail, state: row.state, selectionMode: row.selectionMode,
    deactivationReason: row.deactivationReason, deactivatedAt: row.deactivatedAt,
    createdAt: row.createdAt, updatedAt: row.updatedAt,
    ...('componentSelections' in row ? { componentIds: row.componentSelections.map(selection => selection.componentId), preferences: row.preferences, addedBy: row.addedBy } : {}),
  };
}

/** Delivery diagnostics are native facts; raw provider exceptions and frozen
 * mail envelopes can contain capabilities and are never application resources. */
export function deliveryProjection(row: DeliveryRow) {
  return {
    id: row.id, subscriberId: row.subscriberId, channel: row.channel,
    destination: destinationLabel(row.channel, row.destination), subscriberState: row.subscriberState,
    outcome: row.outcome, queuedAt: row.queuedAt, outcomeAt: row.outcomeAt,
    providerAcceptedAt: row.providerAcceptedAt, acceptingProvider: row.acceptingProvider,
    providerOutcome: row.providerOutcome ?? null, incidentUpdateId: row.incidentUpdateId,
    maintenanceId: row.maintenanceId, maintenanceReference: row.maintenanceReference,
    maintenanceTitle: row.maintenanceTitle, maintenanceNoticeKind: row.maintenanceNoticeKind,
    incidentReference: row.incidentReference, incidentTitle: row.incidentTitle,
    localCaptured: row.localCapturedAt !== null,
  };
}

export function createCommunicationResources(services: AppServices, bindings: AppBindings): ResourceDefinition[] {
  const repository = createCommunicationRepository(bindings.DB);
  const classify: ResourceDefinition['classify'] = () => [{class: 'standard', facts: {measure: 1}}];
  return [{
    uriTemplate: 'lamp://imports/{id}/report', name: 'Retained native import report', scope: 'lamp.access.read',
    description: 'Read-only native Move in report and cutover accounting. Import apply, undo and invitations retain their explicit doors.',
    classes: ['standard', 'sensitive'],
    classify(record) {
      const json = record.json as {report:{items:Array<{outcome:string;name:string}>}};
      return json.report.items.some(item => item.outcome === 'kept-private' && item.name.trim())
        ? [{class:'standard',facts:{measure:1}},{class:'sensitive',facts:{measure:1,kind:'protected import accounting'}}]
        : [{class:'standard',facts:{measure:1}}];
    },
    async read(uri, ctx) {
      if (!await repository.activeOperator(ctx.person.id)) return null;
      const id = /^lamp:\/\/imports\/([^/?#]+)\/report$/.exec(uri)?.[1];
      if (!id) return null;
      try { return {json:await services.statuspageImport.readAgentReport(decodeURIComponent(id),ctx.person.id),untrusted:true}; }
      catch { return null; }
    },
  }, {
    uriTemplate: 'lamp://subscribers/{id}', name: 'Subscriber consent and delivery selection', scope: 'lamp.subscribers.read',
    description: 'Native subscription state and selected components. No subscription tokens or webhook capability path.',
    classes: ['standard'], classify,
    async read(uri, ctx) {
      if (!await repository.activeOperator(ctx.person.id)) return null;
      const id = /^lamp:\/\/subscribers\/([^/?#]+)$/.exec(uri)?.[1];
      if (!id) return null;
      const row = await repository.subscribers.findSubscriber(id);
      if (!row) return null;
      const view={...row,componentSelections:await repository.subscribers.listComponents(row.id),preferences:storedPreferences(row),addedBy:await repository.subscribers.intake.addedBy(row.id)};
      return {json:subscriberProjection(view),untrusted:true};
    },
  }, {
    uriTemplate: 'lamp://deliveries/{id}', name: 'Native delivery outcome', scope: 'lamp.deliveries.read',
    description: 'Queued, provider-accepted and observed delivery facts remain distinct; no receipt proves readership.',
    classes: ['standard'], classify,
    async read(uri, ctx) {
      if (!await repository.activeOperator(ctx.person.id)) return null;
      const id = /^lamp:\/\/deliveries\/([^/?#]+)$/.exec(uri)?.[1];
      if (!id) return null;
      const row = (await services.deliveries.list({id, limit: 1}))[0];
      return row ? { json: deliveryProjection(row), untrusted: true } : null;
    },
  }];
}
