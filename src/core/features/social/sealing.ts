import { openUrl, sealUrl, sealingSecrets } from "../channels/sealing";
// Bind this credential to its account and to the social feature, separate from
// channel webhook URLs. Rotations use the same retained-key policy.
export const sealCredential=(value:string,id:string,secret:string|undefined)=>sealUrl(value,`social:${id}`,sealingSecrets(secret));
export const openCredential=(value:string,id:string,secret:string|undefined)=>openUrl(value,`social:${id}`,sealingSecrets(secret));
