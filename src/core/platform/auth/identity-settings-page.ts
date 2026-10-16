import type { IdentityProviderConfig } from '@runeditrun/rer/modules/operator-auth';

const escapeHtml = (value: string) => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');

function randomSecret() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

function copyBlock(id: string, text: string, label: string) {
  return `<div class="copy-block"><pre id="${id}"><code>${escapeHtml(text)}</code></pre><button type="button" class="copy-button" data-copy="${id}">${escapeHtml(label)}</button></div>`;
}

// Copy buttons need no framework: the page is Base's server-rendered settings document.
const copyJs = `document.addEventListener('click',async e=>{const b=e.target.closest('[data-copy]');if(!b)return;try{await navigator.clipboard.writeText(document.getElementById(b.dataset.copy).textContent);b.textContent='Copied';}catch{b.textContent='Select and copy the text';}});`;
const css = `.lamp-identity{display:grid;gap:12px;margin-top:24px;line-height:1.5}.lamp-identity ol{display:grid;gap:12px;padding-left:20px}.lamp-identity code{overflow-wrap:anywhere}.lamp-identity .copy-block{display:grid;gap:8px;justify-items:start;margin-top:8px}.lamp-identity pre{box-sizing:border-box;width:100%;margin:0;padding:10px 12px;border:1px solid rgb(0 0 0/.12);border-radius:10px;white-space:pre-wrap;overflow-wrap:anywhere;font-size:13px}.lamp-identity .copy-button{width:auto;min-height:36px;padding:6px 14px;border-radius:999px;border:1px solid currentColor;background:none;color:inherit;font:inherit;cursor:pointer}.lamp-identity .notice{padding:8px 12px;border-left:3px solid currentColor}`;

/** Enrich Base's authorized identity settings page; its form, headers and JSON API stay native.
 * The page states whether a provider is set up and walks the owner through Google end to end. */
async function cspHash(text: string) {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
  return `'sha256-${btoa(String.fromCharCode(...digest))}'`;
}

export async function identitySettingsPage(response: Response, input: { origin: string; providers?: IdentityProviderConfig[]; linkedAuth: boolean; local: boolean; saved: boolean }): Promise<Response> {
  if (response.status !== 200 || !response.headers.get('content-type')?.includes('text/html')) return response;
  const providers = input.providers ?? [];
  const configured = providers.length > 0 || input.linkedAuth;
  const presetNames: Record<string, string> = { google: 'Google', microsoft: 'Microsoft Entra', okta: 'Okta', auth: 'Auth' };
  const names = [...providers.map(provider => provider.label ?? presetNames[provider.preset ?? ''] ?? provider.id), ...(input.linkedAuth ? ['Auth'] : [])].join(', ');
  const callback = `${input.origin}/auth/oidc/google/callback`;
  const lines = `AUTH_PROVIDERS=[{"id":"google","preset":"google","clientId":"PASTE-CLIENT-ID","tokenAuthMethod":"client_secret_basic","clientSecret":"PASTE-CLIENT-SECRET"}]\nOIDC_TRANSACTION_SECRET=${randomSecret()}`;
  const deploy = 'rer deploy --environment production --env-file "$HOME/.config/lamp/production.env"';
  const status = configured
      ? `<p class="notice" role="status">Set up on this installation: ${escapeHtml(names)}. Tick the box above and save to let invited people use it.</p>`
      : '<p class="notice" role="status">No sign-in provider is set up on this installation yet, so this setting has no effect. Follow the steps below for Google. Email sign-in links keep working either way.</p>';
  const saved = input.saved ? `<p class="notice" role="status">Saved.${configured ? ' Check it with the sign-in test below.' : ' No provider is set up yet, so nobody can sign in with one until you finish the steps below.'}</p>` : '';
  const guide = `<details${configured ? '' : ' open'}><summary>Set up Google sign-in</summary><ol>
      <li>Open <a href="https://console.cloud.google.com/apis/credentials" target="_blank" rel="noreferrer">Google Cloud credentials</a> and choose <strong>Create credentials → OAuth client ID</strong>. Choose <strong>Web application</strong>. If Google asks, set up the consent screen first.</li>
      <li>Under <strong>Authorized redirect URIs</strong>, add this exact address, then choose <strong>Create</strong>:${copyBlock('lamp-google-callback', callback, 'Copy the redirect URI')}</li>
      <li>${input.local ? 'Stop <code>rer dev</code>. Add these two lines to the <code>.dev.vars</code> file in your Lamp folder' : 'Add these two lines to the private settings file you deploy Lamp with'}, replacing PASTE-CLIENT-ID and PASTE-CLIENT-SECRET with the values Google shows. The second line is a fresh random secret for this installation; keep it private.${copyBlock('lamp-google-settings', lines, 'Copy the two lines')}</li>
      <li>${input.local ? 'Start <code>rer dev</code> again.' : `Deploy again from your Lamp folder, with your own environment name and file:${copyBlock('lamp-google-deploy', deploy, 'Copy the deploy command')}`} This page then says Google is set up.</li>
      <li>Invite each person from <a href="/app/settings">Settings → Operators</a> with their Google email address. Then tick <strong>Allow provider sign-in</strong> above and save. A Google account alone never grants access.</li>
    </ol></details>
    <h2>Test sign-in</h2>
    ${input.local ? '<p>On this computer, rer signs you in only with its RER_OPEN link, so test provider sign-in on a hosted installation of Lamp. There:</p>' : ''}
    <p>Keep this window signed in. In a private browser window, open <a href="/signin" target="_blank" rel="noreferrer">${escapeHtml(input.origin)}/signin</a> and choose <strong>Continue with Google</strong> as an invited person. Success: you land in the Lamp workspace as that person. No Google button means the settings lines or deploy step did not take effect; a refusal after Google usually means the redirect URI does not match exactly or the person is not invited.</p>
    <p>Microsoft Entra, Okta and Run Edit Run’s Auth also work, but each needs extra steps this page cannot do for you (a tenant or issuer, and for Microsoft and Okta each person’s provider ID). Follow the <a href="/docs/operators-and-sign-in#optional-single-sign-on">sign-in guide</a> for those.</p>`;
  const section = `<style>${css}</style><section class="lamp-identity" aria-labelledby="lamp-identity-title"><h2 id="lamp-identity-title">Sign in with Google, Microsoft or Okta</h2>${saved || status}${guide}</section><script>${copyJs}</script>`;
  // Base's page allows only hashed inline style; admit exactly these two blocks.
  const headers = new Headers(response.headers);
  const policy = headers.get('Content-Security-Policy');
  if (policy) headers.set('Content-Security-Policy', `${policy.replace("style-src ", `style-src ${await cspHash(css)} `)}; script-src ${await cspHash(copyJs)}`);
  response = new Response(response.body, { status: response.status, statusText: response.statusText, headers });
  return new HTMLRewriter().on('main', {
    element(element) { element.append(section, { html: true }); },
  }).transform(response);
}
