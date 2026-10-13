// This entry exists only for Vite serve. Production always uses src/server.ts.
import worker from './server';
import { withDevIdentity } from '@runeditrun/rer/modules/operator-auth/dev';
import { authConfig } from './core/platform/auth/config';
import type { AppBindings } from './core/app/types';
export { SnapshotCache } from './server';
export default withDevIdentity<AppBindings,typeof worker>(worker,{
  bindings:env=>({...env,AUTH_ORIGIN:env.RER_DEV_ORIGIN||env.AUTH_ORIGIN||env.LAMP_LOCAL_ORIGIN,AUTH_LOCAL:'true'}),
  config:authConfig,
});
