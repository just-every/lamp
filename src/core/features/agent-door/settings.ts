import { createBusinessSettings as sharedBusinessSettings } from '../../../../modules/business-settings/index.ts';
import type { AppBindings } from '../../app/types';
import type { AppServices } from '../../app/services';
import { createLampBusinessTeam } from './identity-team';

/** The shared module owns signed settings and their durable Business IDs. */
export function createBusinessSettings(services: AppServices, bindings: AppBindings) {
  const settings = sharedBusinessSettings({db: bindings.DB, trust: bindings.RER_BUSINESS_TRUST,
    // `operator` selects native owner invitation defaults. Existing product
    // roles stay authoritative and never become Business policy roles.
    business: {settings: 1, values: ['display_name', 'owner_name', 'brand_color', 'logo', 'timezone'], team: {roles: {admin: 'operator', member: 'operator'}}},
    team: createLampBusinessTeam(services, bindings)});
  return {...settings, async handle(request: Request) {
    const response = await settings.handle(request);
    if (!response || response.ok || !response.headers.get('content-type')?.includes('application/json')) return response;
    const value = await response.json() as Record<string, unknown>;
    if (!('error' in value)) return Response.json(value, {status: response.status, headers: response.headers});
    const {error, ...fields} = value;
    return Response.json({code: error, ...fields}, {status: response.status, headers: response.headers});
  }};
}
