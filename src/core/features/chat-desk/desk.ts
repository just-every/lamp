import type { ComponentsService } from '../components/service';
import type { IncidentsService } from '../incidents/service';
import { draftFromIncident } from '../incidents/draft';
import { checkUpdateWording } from '../incidents/wording-checks';
import type { ChatLinksRepository } from './links.repository';
import type { DeskAction } from './actions';
import { digest, randomCode } from './links.service';
export function createDesk(incidents: IncidentsService, components: ComponentsService, repository: ChatLinksRepository,
  settings: () => Promise<{ blockedTerms: string[]; friendlyLength: number }>,
  audit: (operator: string, action: string, entity: string) => Promise<void>) {
  async function editor(incidentId: string) {
    const incident = await incidents.get(incidentId);
    if (!incident) throw new Error('Incident not found.');
    const update = draftFromIncident(incident);
    return { incidentId, version: `${incident.draft?.id ?? '-'}:${incident.updates.length}`, editor: { update, components: (await components.list()).map(component => ({ id: component.id, name: component.name, state: update.componentChanges?.find(change => change.componentId === component.id)?.state ?? incident.components.find(claim => claim.componentId === component.id)?.state ?? null })) } };
  }
  return async (action: DeskAction, operator: string) => {
    if (action.action === 'open') {
      const incident = await incidents.create(action, operator);
      return { ...await editor(incident.id), message: 'Private incident draft opened.' };
    }
    if (action.action === 'edit') return { ...await editor(action.incidentId), message: 'Edit the incident update.' };
    const incident = await incidents.get(action.incidentId);
    if (!incident) throw new Error('Incident not found.');
    const version = `${incident.draft?.id ?? '-'}:${incident.updates.length}`;
    if (action.version !== version) throw new Error('The draft changed. Open the current incident in the operator app.');
    switch (action.action) {
      case 'attach':
        for (const component of action.components) await incidents.previewComponentChange(incident.id, { action: 'attach', ...component });
        // Stage every attachment together: public states change only with Publish.
        await incidents.saveDraft(incident.id, { ...draftFromIncident(incident), componentChanges: [...draftFromIncident(incident).componentChanges ?? [], ...action.components] }, operator, version);
        break;
      case 'save': await incidents.saveDraft(incident.id, action.update, operator, version); break;
      case 'review': if (!await incidents.review(incident.id, operator, version)) throw new Error('A different operator must review the saved draft.'); break;
      case 'preview': {
        const update = draftFromIncident(incident), preview = await incidents.preview(incident.id, update);
        if (!preview) throw new Error('The draft could not be previewed.');
        const { affectedAudience, customerImpact, whatStillWorks, details } = update;
        const findings = checkUpdateWording({ affectedAudience, customerImpact, whatStillWorks, details }, await settings());
        const previewCode = randomCode();
        await repository.preview(operator, incident.id, version, await digest(previewCode), Date.now() + 600_000);
        return { incidentId: incident.id, version, preview, findings, publish: { action: 'publish' as const, incidentId: incident.id, version, previewCode } };
      }
      case 'publish': {
        if (!await repository.consumePreview(operator, incident.id, version, await digest(action.previewCode), Date.now())) throw new Error('Preview this saved draft before publishing.');
        const update = await incidents.publish(incident.id, operator, { channels: [], expectedVersion: version });
        if (!update) throw new Error('A saved draft is required.');
        await audit(operator, 'published', update.id);
        await incidents.finishPublication(update);
        return { ...await editor(incident.id), updateId: update.id, message: 'Incident update published.' };
      }
    }
    return { ...await editor(incident.id), message: 'Private draft saved. Preview it before publishing.' };
  };
}
