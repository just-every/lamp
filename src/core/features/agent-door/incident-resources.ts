import type { AppServices } from '../../app/services';
import type { AppBindings } from '../../app/types';
import type { ClassAndFacts, ResourceDefinition } from '../../../../modules/agent-door/types.ts';
import { componentReadClasses, incidentReadClasses, incidentVersion } from './incidents';
import type { IncidentView } from '../incidents/service';
import { createIncidentDoorRepository } from './incident-native.repository';
const standard = (): ClassAndFacts[] => [{ class: 'standard', facts: { measure: 1 } }];
export function createIncidentResources(services: AppServices, bindings: AppBindings): ResourceDefinition[] {
    const repository = createIncidentDoorRepository(bindings.DB);
    const match = (uri: string, pattern: RegExp) => { try {
        return pattern.exec(uri)?.slice(1).map(decodeURIComponent) ?? null;
    }
    catch {
        return null;
    } };
    return [
        { uriTemplate: 'lamp://components/{id}', name: 'Component', description: 'Native component and private operator note; outside text is untrusted.', scope: 'lamp.components.read', classes: ['standard', 'sensitive'], classify: record => componentReadClasses((record.json as {
                component: {
                    note?: string;
                };
            }).component), async read(uri, ctx) { const values = match(uri, /^lamp:\/\/components\/([^/]+)$/); if (!values)
                return null; const value = await services.components.get(values[0]); if (!value || (ctx.clientId && value.internal))
                return null; const component = ctx.clientId ? { ...value, note: '' } : value; return { json: { component }, untrusted: true }; } },
        { uriTemplate: 'lamp://incidents/{id}', name: 'Incident', description: 'Current native incident, saved version and private notes.', scope: 'lamp.incidents.read', classes: ['standard', 'sensitive'], classify: record => incidentReadClasses((record.json as {
                incident: IncidentView;
            }).incident), async read(uri) { const values = match(uri, /^lamp:\/\/incidents\/([^/]+)$/); if (!values)
                return null; const incident = await services.incidents.get(values[0]); return incident ? { json: { incident, version: incidentVersion(incident) }, untrusted: true } : null; } },
        { uriTemplate: 'lamp://incidents/{id}/brief', name: 'Incident brief', description: 'Cited native brief excludes internal notes.', scope: 'lamp.incidents.brief', classes: ['standard'], classify: standard, async read(uri) { const values = match(uri, /^lamp:\/\/incidents\/([^/]+)\/brief$/); if (!values)
                return null; const brief = await services.briefs.get(values[0]); return brief ? { json: { brief }, untrusted: true } : null; } },
        { uriTemplate: 'lamp://incidents/{id}/recovery', name: 'Recovery evidence', description: 'Stored recovery evidence; reading performs no monitor network check.', scope: 'lamp.recovery.read', classes: ['standard'], classify: standard, async read(uri) { const values = match(uri, /^lamp:\/\/incidents\/([^/]+)\/recovery$/); if (!values)
                return null; const recovery = await services.incidents.recoveryCheck(values[0]); return recovery ? { json: { recovery }, untrusted: true } : null; } },
        { uriTemplate: 'lamp://incidents/{id}/draft/{version}', name: 'Saved incident draft', description: 'Only the exact current acknowledged native draft is readable.', scope: 'lamp.incidents.read', classes: ['standard'], classify: standard, async read(uri) { const values = match(uri, /^lamp:\/\/incidents\/([^/]+)\/draft\/([^/]+)$/); if (!values)
                return null; const incident = await services.incidents.get(values[0]); return incident?.draft && incidentVersion(incident) === values[1] ? { json: { draft: incident.draft, version: incidentVersion(incident) }, untrusted: true } : null; } },
        { uriTemplate: 'lamp://reports/{id}', name: 'Post-incident report', description: 'Native saved report with explicit public/private lifecycle.', scope: 'lamp.reports.read', classes: ['standard'], classify: standard, async read(uri) { const values = match(uri, /^lamp:\/\/reports\/([^/]+)$/); if (!values)
                return null; const report = await repository.report(values[0]); return report ? { json: { report }, untrusted: true } : null; } },
    ];
}
