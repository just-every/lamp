export { createLampAuth } from '../../src/core/platform/auth';
export { requireOperator, registerOperatorRoutes } from '../../src/core/features/operators/routes';
export { createComponentRepository } from '../../src/core/features/components/repository';
export { createComponentsService } from '../../src/core/features/components/service';
export { registerComponentRoutes } from '../../src/core/features/components/routes';
export { createSubscriberRepository, createSubscribersService, registerSubscriberRoutes } from '../../src/core/features/subscribers';
export { createStatuspageImportService, registerStatuspageImportRoutes } from '../../src/core/features/statuspage-import';
export { withDevIdentity } from '@runeditrun/rer/modules/operator-auth/dev';
export { authConfig } from '../../src/core/platform/auth/config';
export { createAuthHandler } from '@runeditrun/rer/modules/operator-auth';

export { registerAuditLogRoutes } from '../../src/core/features/audit-log/routes';
export { createAuditLogRepository } from '../../src/core/features/audit-log/repository';
