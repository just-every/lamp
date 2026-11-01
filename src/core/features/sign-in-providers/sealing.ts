import { openUrl, sealUrl, sealingSecrets } from "../channels/sealing";

// A provider's client secret is bound to its registration (`sign-in:<id>`) and to
// this feature, separate from channel addresses and social tokens. Rotations use
// the same retained-key policy: the first listed secret seals, any may open.
export const sealSecret = (value: string, id: string, secret: string | undefined) => sealUrl(value, `sign-in:${id}`, sealingSecrets(secret));
export const openSecret = (value: string, id: string, secret: string | undefined) => openUrl(value, `sign-in:${id}`, sealingSecrets(secret));
