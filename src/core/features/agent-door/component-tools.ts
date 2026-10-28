import { z } from 'zod';
import type { AppBindings } from '../../app/types';
import type { AppServices } from '../../app/services';
import type { ComponentView } from '../components/service';
import { componentSchema, componentUpdateSchema, componentStandingClaimSchema } from '../../shared/schemas';
import { ToolRefusal, type ToolDefinition, type ClassAndFacts } from '../../../base/modules/agent-door/index.ts';
import { jsonInput, emptyInput, idInput, recordOutput, required, nativeFailure, changed, standard, live, publicDisclosure } from './operations-schema';

const updateInput = z.object({ id: z.string().min(1), component: componentUpdateSchema }).strict();
const claimInput = idInput.extend({ state: componentStandingClaimSchema.shape.state }).strict();
const output = recordOutput('component');
const sensitive = (components: ComponentView[]): ClassAndFacts[] => components.some(component => component.internal) ? [{ class: 'sensitive', facts: { measure: components.filter(component => component.internal).length, kind: 'private component evidence' } }] : [];

export function componentTools(_bindings: AppBindings, services: AppServices): ToolDefinition[] {
  const get = async (id: string) => required(await services.components.get(id));
  const describe = (record: ComponentView) => ({ uri: `lamp://components/${record.id}`, name: record.name });
  return [{
    name: 'lamp.components.list', title: 'List components', description: 'Read native component catalogue and currently effective competing claims. Internal records remain protected private evidence.',
    scope: 'lamp:read', readOnly: true, inputSchema: jsonInput(emptyInput), outputSchema: { type: 'object', properties: { components: { type: 'array', items: { type: 'object' } }, groups: { type: 'array', items: { type: 'object' } } }, required: ['components', 'groups'], additionalProperties: false },
    classes: ['standard', 'sensitive'], clauses: ['COMP-001', 'COMP-006', 'COMP-009'], untrusted: true,
    classify: async () => { const records = await services.components.list(); return [standard(), ...sensitive(records)]; },
    run: async () => ({ result: { components: await services.components.list(), groups: await services.components.listGroups() } }),
  }, {
    name: 'lamp.components.read', title: 'Read component', description: 'Read the current native component and claim-derived public state. This never measures recovery or runs a check.',
    scope: 'lamp:read', readOnly: true, inputSchema: jsonInput(idInput), outputSchema: output, classes: ['standard', 'sensitive'], clauses: ['COMP-001', 'COMP-006'], untrusted: true,
    classify: async args => { const record = await get(idInput.parse(args).id); return [standard(), ...sensitive([record])]; },
    run: async args => { const component = await get(idInput.parse(args).id); return { result: { component }, resources: [describe(component)] }; },
  }, {
    name: 'lamp.components.create', title: 'Create component', description: 'Create a real native component. A non-internal component changes the published catalogue; its initial Operational claim is a configured state, never measured recovery.',
    scope: 'lamp:publish', readOnly: false, inputSchema: jsonInput(componentSchema), outputSchema: output, classes: ['standard', 'external', 'live', 'sensitive'], clauses: ['COMP-001', 'COMP-006', 'COMP-009', 'TEAM-003'], untrusted: true,
    classify: args => { const input = componentSchema.parse(args); return input.internal ? [standard(), { class: 'sensitive', facts: { measure: 1, kind: 'private component evidence' } }] : [publicDisclosure(), live('status-page component catalogue')]; },
    summary: args => { const input = componentSchema.parse(args); return { target: { name: input.name }, recipients: input.internal ? [] : ['Public status page'], items: [`Description: ${input.description}`, `Note: ${input.note}`, `Internal: ${input.internal}`, `Region: ${input.region ?? ''}`, 'Initial configured claim: Operational'] }; },
    run: async (args, ctx) => { try { const component = await services.components.create(componentSchema.parse(args), ctx.person.id); changed(ctx, 'component.created', describe(component).uri, { id: component.id }); return { result: { component }, resources: [describe(component)] }; } catch (error) { return nativeFailure(error); } },
  }, {
    name: 'lamp.components.update', title: 'Update component', description: 'Edit the real native component at its current revision. Server compares current and proposed visibility; private-to-public changes retain access and security classification.',
    scope: 'lamp:publish', readOnly: false, inputSchema: jsonInput(updateInput), outputSchema: output, classes: ['standard', 'external', 'live', 'access', 'security', 'sensitive'], clauses: ['COMP-001', 'COMP-006', 'COMP-009', 'COMP-010', 'TEAM-003'], untrusted: true,
    revisionType: 'string', revision: async args => (await get(updateInput.parse(args).id)).updatedAt,
    authority: async args => { const input = updateInput.parse(args), before = await get(input.id); return before.internal !== input.component.internal ? { subject: `component:${before.id}`, widens: before.internal && !input.component.internal } : null; },
    classify: async args => {
      const input = updateInput.parse(args), before = await get(input.id), after = { ...before, ...input.component };
      const result: ClassAndFacts[] = before.internal && after.internal ? [standard()] : [publicDisclosure(), live('status-page component catalogue')];
      if (before.internal !== after.internal) result.push({ class: 'access', facts: { measure: 1, direction: before.internal ? 'widens' : 'narrows' } }, { class: 'security', facts: { measure: 1, setting: 'component public visibility' } });
      return [...result, ...sensitive([after])];
    },
    summary: async args => { const input = updateInput.parse(args), record = await get(input.id); return { target: { id: record.id, name: record.name }, recipients: record.internal && input.component.internal ? [] : ['Public status page'], items: [`Revision: ${record.updatedAt}`, `Current visibility: ${record.internal ? 'internal' : 'public'}`, ...Object.entries(input.component).map(([key, value]) => `${key}: ${JSON.stringify(value)}`)] }; },
    run: async (args, ctx) => { try { const input = updateInput.parse(args), before = await get(input.id), component = await services.components.update(input.id, input.component, before.updatedAt); if (!component) throw new ToolRefusal('revision_conflict'); changed(ctx, 'component.updated', describe(component).uri, { id: component.id }); return { result: { component }, resources: [describe(component)] }; } catch (error) { return nativeFailure(error); } },
  }, {
    name: 'lamp.claims.update', title: 'Set standing component claim', description: 'Change or clear a native standing claim. Other incident or maintenance claims still determine the most severe public state. A configured claim is not measured recovery.',
    scope: 'lamp:publish', readOnly: false, inputSchema: jsonInput(claimInput), outputSchema: output, classes: ['standard', 'external', 'live', 'sensitive'], clauses: ['COMP-001', 'COMP-006', 'TEAM-003'], untrusted: true,
    revisionType: 'string', revision: async args => { const component = await get(claimInput.parse(args).id); return JSON.stringify([component.updatedAt, component.standingClaimState, component.publicState]); },
    classify: async args => { const component = await get(claimInput.parse(args).id); return component.internal ? [standard(), ...sensitive([component])] : [publicDisclosure(), live('status-page component state')]; },
    summary: async args => { const input = claimInput.parse(args), component = await get(input.id); return { target: { id: component.id, name: component.name }, recipients: component.internal ? [] : ['Public status page and eligible component webhook subscribers'], items: [`Standing claim: ${component.standingClaimState ?? 'none'} → ${input.state ?? 'none'}`, `Effective state before change: ${component.publicState}`, 'Competing incident and maintenance claims retain their precedence.'] }; },
    run: async (args, ctx) => { try { const input = claimInput.parse(args), component = required(await services.components.setStandingClaim(input.id, input.state, ctx.person.id)); changed(ctx, 'component.claim.changed', describe(component).uri, { id: component.id, state: component.publicState }); return { result: { component }, resources: [describe(component)] }; } catch (error) { return nativeFailure(error); } },
  }];
}
