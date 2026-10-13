import { lobbyResponse } from './base/lobby';
import { claimedWhen, setupStateResponse } from './base/setup-state';
import { authOrigin } from './core/platform/auth/config';
import type { AppBindings } from './core/app/types';
import { identity } from './identity';

// Lamp's first-run record: /setup stores the readiness step `first-run` when the owner confirms.
const claimed = claimedWhen("SELECT 1 FROM setup_readiness WHERE step = 'first-run'");

// The app host's shared answers: GET /setup/state and the Lobby at /. The page host never reaches here; its / is the
// status page. The Lobby names the page the owner configured, read on the server.
export async function installedHomeResponse(request: Request, bindings: AppBindings): Promise<Response | null> {
  const env = { DB: bindings.DB, AUTH_ORIGIN: authOrigin(bindings) };
  const state = await setupStateResponse(request, env, claimed);
  if (state) return state;
  if (new URL(request.url).pathname !== '/') return null;
  const page = await bindings.DB.prepare("SELECT page_name FROM page_settings WHERE id = 'default'").first<{ page_name: string }>();
  return lobbyResponse(request, env, { ...identity, installedHome: 'lobby', deployment: page?.page_name ?? identity.deployment }, claimed);
}
