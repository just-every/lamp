import type { IdentityProviderConfig } from '@runeditrun/rer/modules/operator-auth';

import { authGuide, escapeHtml, googleGuide, guideScript, microsoftGuide, oktaGuide } from './identity-provider-guides';

const css = `.lamp-identity{display:grid;gap:12px;margin-top:24px;line-height:1.5}.lamp-identity ol{display:grid;gap:12px;padding-left:20px}.lamp-identity code{overflow-wrap:anywhere}.lamp-identity .copy-block{display:grid;gap:8px;justify-items:start;margin-top:8px}.lamp-identity pre{box-sizing:border-box;width:100%;margin:0;padding:10px 12px;border:1px solid rgb(0 0 0/.12);border-radius:10px;white-space:pre-wrap;overflow-wrap:anywhere;font-size:13px}.lamp-identity .copy-button{width:auto;min-height:36px;padding:6px 14px;border-radius:999px;border:1px solid currentColor;background:none;color:inherit;font:inherit;cursor:pointer}.lamp-identity .notice{padding:8px 12px;border-left:3px solid currentColor}.lamp-identity summary{min-height:24px;cursor:pointer;font-weight:600}`;

async function cspHash(text: string) {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
  return `'sha256-${btoa(String.fromCharCode(...digest))}'`;
}

/** Enrich Base's authorized identity settings page; its form, headers and JSON API stay native.
 * The page states whether a provider is set up and walks the owner through each one end to end. */
export async function identitySettingsPage(response: Response, input: { origin: string; providers?: IdentityProviderConfig[]; identityProvider?: string; local: boolean; saved: boolean }): Promise<Response> {
  if (response.status !== 200 || !response.headers.get('content-type')?.includes('text/html')) return response;
  const providers = input.providers ?? [];
  const configured = providers.length > 0 || Boolean(input.identityProvider);
  const presetNames: Record<string, string> = { google: 'Google', microsoft: 'Microsoft Entra', okta: 'Okta', auth: 'Auth' };
  const names = [...providers.map(provider => provider.label ?? presetNames[provider.preset ?? ''] ?? provider.id), ...(input.identityProvider ? ['Auth'] : [])].join(', ');
  const status = configured
      ? `<p class="notice" role="status">Set up on this installation: ${escapeHtml(names)}. Tick the box above and save to let invited people use it.</p>`
      : '<p class="notice" role="status">No sign-in provider is set up on this installation yet, so this setting has no effect. Choose a provider below and follow its steps. Email sign-in links keep working either way.</p>';
  const saved = input.saved ? `<p class="notice" role="status">Saved.${configured ? ' Check it with the sign-in test below.' : ' No provider is set up yet, so nobody can sign in with one until you finish the steps below.'}</p>` : '';
  const guide = { origin: input.origin, local: input.local, identityProvider: input.identityProvider };
  const test = `<p>Keep this window signed in. In a private browser window, open <a href="/signin" target="_blank" rel="noreferrer">${escapeHtml(input.origin)}/signin</a>.</p>`;
  const body = `${googleGuide(guide, !configured)}${oktaGuide(guide)}${microsoftGuide()}${authGuide(guide)}
    <h2>Test sign-in</h2>${test}
    <p>Choose <strong>Continue with</strong> your provider as an invited person. Success: you land in the Lamp workspace as that person. No provider button means the settings lines or deploy step did not take effect; a refusal after the provider usually means the redirect URI does not match exactly, or the person is not invited (for Okta, or their user ID and email are not paired).</p>`;
  const section = `<style>${css}</style><section class="lamp-identity" aria-labelledby="lamp-identity-title"><h2 id="lamp-identity-title">Sign in with Google, Okta or Run Edit Run Auth</h2>${saved || status}${body}</section><script>${guideScript}</script>`;
  // Base's page allows only hashed inline style; admit exactly these two blocks, and the
  // Auth link buttons' same-origin requests.
  const headers = new Headers(response.headers);
  const policy = headers.get('Content-Security-Policy');
  if (policy) headers.set('Content-Security-Policy', `${policy.replace("style-src ", `style-src ${await cspHash(css)} `)}; script-src ${await cspHash(guideScript)}; connect-src 'self'`);
  response = new Response(response.body, { status: response.status, statusText: response.statusText, headers });
  return new HTMLRewriter().on('main', {
    element(element) { element.append(section, { html: true }); },
  }).transform(response);
}
