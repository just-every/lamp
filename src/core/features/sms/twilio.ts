export interface TwilioConfig { accountSid?: string; authToken?: string; fromNumber?: string; messagingService?: string }
export function twilioConfigured(config: TwilioConfig): boolean {
  return Boolean(config.accountSid && config.authToken && (config.fromNumber || config.messagingService));
}
function base64(bytes: Uint8Array) { return btoa(String.fromCharCode(...bytes)); }
export async function verifyTwilioSignature(secret: string | undefined, url: string, params: URLSearchParams, signature: string | null) {
  if (!secret || !signature) return false;
  const unique = [...new Set(params.keys())].sort();
  let signed = url;
  for (const key of unique) for (const value of [...new Set(params.getAll(key))].sort()) signed += key + value;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), {name:"HMAC",hash:"SHA-1"}, false, ["sign"]);
  const expected = base64(new Uint8Array(await crypto.subtle.sign("HMAC",key,new TextEncoder().encode(signed))));
  if (expected.length !== signature.length) return false;
  let different = 0;
  for (let i=0; i<expected.length; i++) different |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  return different === 0;
}
export async function sendTwilio(config: TwilioConfig, input: {to:string;body:string;statusCallback?:string}) {
  if (!twilioConfigured(config)) throw new Error("SMS sending is not configured.");
  const form = new URLSearchParams({To:input.to, Body:input.body});
  if (config.messagingService) form.set("MessagingServiceSid",config.messagingService);
  else form.set("From",config.fromNumber!);
  if (input.statusCallback) form.set("StatusCallback",input.statusCallback);
  const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(config.accountSid!)}/Messages.json`, {
    method:"POST", redirect:"manual", headers:{"Content-Type":"application/x-www-form-urlencoded",Authorization:`Basic ${btoa(`${config.accountSid}:${config.authToken}`)}`}, body:form.toString(),
  });
  if (!response.ok) throw new Error(`Twilio refused the SMS (HTTP ${response.status}).`);
  const result = await response.json() as {sid?:unknown};
  if (typeof result.sid !== "string" || !result.sid) throw new Error("Twilio did not return a message receipt.");
  return result.sid;
}
