import { z } from 'zod';
import type { AppBindings } from '../../app/types';
import type { AppServices } from '../../app/services';
import { pageSettingsSchema } from '../../shared/schemas';
import { metricPatchSchema } from '../metrics/schema';
import { createMetricsRepository } from '../metrics/repository';
import { type ToolDefinition, type ClassAndFacts, ToolRefusal } from '../../../base/modules/agent-door/index.ts';
import { jsonInput, recordOutput, required, nativeFailure, changed, standard, live, publicDisclosure } from './operations-schema';

const metricInput = z.object({ id: z.string().min(1), patch: metricPatchSchema }).strict();
const pageInput = z.object({ settings: pageSettingsSchema }).strict();

export function configurationTools(bindings: AppBindings, services: AppServices): ToolDefinition[] {
  const metrics = createMetricsRepository(bindings.DB);
  const getMetric = async (id: string) => required(await metrics.get(id));
  const metricProtectedChange = (patch: z.infer<typeof metricPatchSchema>) => ['credentials', 'endpoint', 'region', 'query', 'accountId'].some(key => Object.hasOwn(patch, key));
  const getPage = async () => required(await services.pageSettings.get());
  const origins = async (args: Record<string, unknown>) => {
    const { settings } = pageInput.parse(args), current = await getPage();
    const previous = current.widgetAllowedOrigins, next = settings.widgetAllowedOrigins ?? previous;
    // Empty is the native unbounded embed allow-list. Treat it as a widening.
    const widens = previous.length > 0 && (next.length === 0 || next.some(origin => !previous.includes(origin)));
    return { current, settings, previous, next, widens, changed: JSON.stringify(previous) !== JSON.stringify(next) };
  };
  return [{
    name: 'lamp.metrics.update', title: 'Update public metric', description: 'Update an existing native public metric configuration using its current version and current Owner/Admin authority. Metric configuration and supplied values never establish recovery.',
    scope: 'lamp:access', readOnly: false, inputSchema: jsonInput(metricInput), outputSchema: recordOutput('metric'), classes: ['external', 'live', 'access', 'security'], clauses: ['UPTIME-008', 'TEAM-003'],
    revisionType: 'integer', revision: async args => (await getMetric(metricInput.parse(args).id)).version,
    authority: async args => { const { id, patch } = metricInput.parse(args), current = await getMetric(id); return metricProtectedChange(patch) ? { subject: `metric:${current.id}`, widens: patch.credentials !== null && (patch.credentials !== undefined || Object.hasOwn(patch, 'endpoint') || Object.hasOwn(patch, 'query') || Object.hasOwn(patch, 'accountId')) } : null; },
    classify: async (args, ctx) => {
      const { id, patch } = metricInput.parse(args), current = await getMetric(id);
      if (!await services.metrics.authorize(ctx.person.id)) throw new ToolRefusal('forbidden');
      const result: ClassAndFacts[] = [publicDisclosure(), live('public status-page metric')];
      if (metricProtectedChange(patch)) {
        result.push({ class: 'security', facts: { measure: 1, setting: `metric ${current.provider} provider definition` } });
        if (patch.credentials !== undefined) result.push({ class: 'access', facts: { measure: 1, direction: patch.credentials === null ? 'narrows' : 'widens' } });
      }
      return result;
    },
    summary: async args => { const { id, patch } = metricInput.parse(args), current = await getMetric(id); return { target: { id, name: current.name }, recipients: ['Public status page'], items: [`Provider: ${current.provider}`, `Native revision: ${current.version}`, ...Object.entries(patch).map(([key, value]) => key === 'credentials' ? `Provider credential: ${value === null ? 'remove' : 'replace (secret hidden)'}` : `${key}: ${JSON.stringify(value)}`), 'This configuration change does not prove observed recovery.'] }; },
    run: async (args, ctx) => { try { const { id, patch } = metricInput.parse(args); if (!await services.metrics.authorize(ctx.person.id)) throw new ToolRefusal('forbidden'); const current = await getMetric(id), metric = required(await services.metrics.update(id, patch, ctx.person.id, current.version)); changed(ctx, 'metric.updated', `lamp://metrics/${id}`, { id }); return { result: { metric } }; } catch (error) { return nativeFailure(error); } },
  }, {
    name: 'lamp.page.update', title: 'Update page settings', description: 'Apply the native page settings validation and publication lifecycle. Server detects actual public-page changes and protective widget-origin allow-list changes; AI tone and wording settings remain private.',
    scope: 'lamp:access', readOnly: false, inputSchema: jsonInput(pageInput), outputSchema: recordOutput('settings'), classes: ['standard', 'external', 'live', 'access', 'security'], clauses: ['PAGE-001', 'PAGE-005', 'PAGE-011', 'PAGE-012', 'UPDATE-011', 'NOTIFY-019'],
    revisionType: 'string', revision: async () => (await getPage()).updatedAt,
    authority: async args => { const check = await origins(args); return check.changed ? { subject: 'page:default:widget', widens: check.widens } : null; },
    classify: async args => {
      const check = await origins(args);
      const publicFields = ['pageName', 'tagline', 'accentColor', 'timezone', 'hostname', 'footerCreditEnabled', 'template', 'widgetAppearance'];
      const proposed = check.settings as Record<string, unknown>, current = check.current as unknown as Record<string, unknown>;
      const publicChanged = publicFields.some(key => proposed[key] !== undefined && JSON.stringify(proposed[key]) !== JSON.stringify(current[key]));
      const senderChanged = ['mailFromAddress', 'emailBranding'].some(key => proposed[key] !== undefined && JSON.stringify(proposed[key]) !== JSON.stringify(current[key]));
      const result: ClassAndFacts[] = publicChanged ? [publicDisclosure(), live('public status page')] : senderChanged ? [live('status-page notification sender')] : [standard()];
      if (check.changed) result.push({ class: 'access', facts: { measure: Math.max(check.previous.length, check.next.length, 1), direction: check.widens ? 'widens' : 'narrows' } }, { class: 'security', facts: { measure: 1, setting: 'widget origin allow-list' } });
      return result;
    },
    summary: async args => { const check = await origins(args); return { target: { id: 'default', name: check.current.pageName }, recipients: ['Public status page and configured notification sender'], items: [`Native revision: ${check.current.updatedAt}`, ...Object.entries(check.settings).map(([key, value]) => `${key}: ${JSON.stringify(value)}`)] }; },
    run: async (args, ctx) => { try { const check = await origins(args), settings = required(await services.pageSettings.update(check.settings, check.current.updatedAt)); changed(ctx, 'page.updated', 'lamp://page/default', { id: 'default' }); return { result: { settings } }; } catch (error) { return nativeFailure(error); } },
  }];
}
