export const OPERATOR_ROLES = ['owner', 'admin', 'communicator', 'responder', 'viewer'] as const;
export type OperatorRole = typeof OPERATOR_ROLES[number];
export const managesTeam = (role: OperatorRole) => role === 'owner' || role === 'admin';
export const publishes = (role: OperatorRole) => managesTeam(role) || role === 'communicator';
export const drafts = (role: OperatorRole) => publishes(role) || role === 'responder';

/** Explicit operational doors; new configuration and unknown writes stay closed. */
export function allowsOperatorRequest(role: OperatorRole, method: string, pathname: string): boolean {
  const path = pathname.replace(/^\/api\/app/, '');
  if (managesTeam(role)) return true;
  if (path === '/session/signout' && method === 'POST') return true;
  if (['GET', 'HEAD', 'OPTIONS'].includes(method)) {
    if (/^\/(?:operators|audit-log|management-tokens|mail-settings|sms-settings|social|channels|website|statuspage-import|import-door|page-export)(?:\/|$)/.test(path)) return false;
    return /^\/(?:session|page-settings|overview|components|component-groups|incidents|incident-templates|maintenance|reports|ai|subscribers|subscriber-reporting|communication-performance|availability|deliveries|intake|metrics|chat-links|embed)(?:\/|$)/.test(path);
  }
  if (/^\/chat-links(?:\/[^/]+)?$/.test(path)) return method === 'DELETE' || drafts(role);
  if (!drafts(role)) return false;
  if (method === 'POST' && ['/incidents', '/incidents/preview'].includes(path)) return true;
  if (/^\/incidents\/[^/]+\/(?:draft|draft\/preview|draft\/correction|notes|ai-suggestion|report\/draft|report|components\/preview|templates\/[^/]+\/apply)$/.test(path)) return ['POST', 'PUT'].includes(method);
  if (!publishes(role)) return false;
  return (method === 'POST' && /^\/incidents\/[^/]+\/(?:publish|draft\/(?:schedule|review)|components|owner\/take-over|report\/(?:publish|waive))$/.test(path))
    || (method === 'DELETE' && /^\/incidents\/[^/]+(?:\/components\/[^/]+)?$/.test(path))
    || (method === 'PUT' && /^\/incidents\/[^/]+\/(?:owner|impact)$/.test(path))
    || (method === 'POST' && (path === '/maintenance' || /^\/maintenance\/[^/]+\/(?:start|complete|cancel)$/.test(path)))
    || (method === 'PUT' && /^\/maintenance\/[^/]+\/window$/.test(path))
    || /^\/subscribers(?:\/|$)/.test(path)
    || (method === 'PUT' && /^\/components\/[^/]+\/(?:standing-claim|history\/[^/]+\/correction)$/.test(path))
    || (method === 'POST' && /^\/overview\/follow-ups\/(?:dismiss|retry)$/.test(path));
}
