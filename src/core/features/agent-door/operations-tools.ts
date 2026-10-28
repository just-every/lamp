import type { AppBindings } from '../../app/types';
import type { AppServices } from '../../app/services';
import type { ToolDefinition } from '../../../base/modules/agent-door/index.ts';
import { maintenanceTools } from './maintenance-tools';
import { componentTools } from './component-tools';
import { configurationTools } from './configuration-tools';

export { readMaintenance } from './maintenance-tools';

export function operationsTools(bindings: AppBindings, services: AppServices): ToolDefinition[] {
  return [...maintenanceTools(bindings, services), ...componentTools(bindings, services), ...configurationTools(bindings, services)];
}
