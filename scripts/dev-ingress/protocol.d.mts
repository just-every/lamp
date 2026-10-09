export const proofHeader: string;
export function isForwardingHeader(name: string): boolean;
export function proofPayload(method: string, url: string, host: string | null, origin: string | null, fetchSite: string | null, stamp?: string | null): string;
