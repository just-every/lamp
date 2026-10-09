export const proofHeader = 'x-lamp-dev-ingress';

export function isForwardingHeader(name) {
  return name === 'forwarded' || name.startsWith('x-forwarded-')
    || name.startsWith('x-original-') || name === 'x-real-ip'
    || name === 'true-client-ip' || name.startsWith('cf-')
    || name.startsWith('mf-') || name.startsWith('__vite_') || name.startsWith('x-lamp-dev-');
}

export function proofPayload(method, url, host, origin, fetchSite, stamp = null) {
  return JSON.stringify([method, url, host, origin, fetchSite, stamp]);
}
