/** Management credentials carry the same live issuer fence into native writes. */
export interface SubscriberWriteAuthority { sql: string; params: (string | number | null)[] }
