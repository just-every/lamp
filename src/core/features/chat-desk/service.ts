import type { ComponentsService } from '../components/service';
import { z } from 'zod';
import type { AppBindings } from '../../app/types';
import type { IncidentsService } from '../incidents/service';
import { createAuditLogRepository } from '../audit-log/repository';
import { createChatLinksRepository } from './links.repository';
import { createChatLinksService } from './links.service';
import { createDesk } from './desk';
const configuration = z.object({ SLACK_SIGNING_SECRET: z.string().min(1).optional(), BOT_FRAMEWORK_APP_ID: z.string().min(1).optional() });
export function createChatDeskService(bindings: AppBindings, incidents: IncidentsService, components: ComponentsService, settings: () => Promise<{ blockedTerms: string[]; friendlyLength: number }>) {
  const repository = createChatLinksRepository(bindings.DB);
  const audit = (operator: string, action: string, entity: string) => createAuditLogRepository(bindings.DB).chatDesk(operator, action, entity);
  return { config: configuration.parse(bindings), paused: bindings.EFFECTS_PAUSED === '1', repository, links: createChatLinksService(repository, audit), act: createDesk(incidents, components, repository, settings, audit) };
}
