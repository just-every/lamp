// The step-by-step guides on /auth/settings/identity, one per provider. Each says
// exactly what to copy where, with the installation's own addresses, and how to
// check it worked; a provider this page cannot finish says so and what would.

export const escapeHtml = (value: string) => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');

export function copyBlock(id: string, text: string, label: string) {
  return `<div class="copy-block"><pre id="${id}"><code>${escapeHtml(text)}</code></pre><button type="button" class="copy-button" data-copy="${id}">${escapeHtml(label)}</button></div>`;
}

function randomSecret() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

export interface GuideInput { origin: string; local: boolean; identityProvider?: string }

const deployCommand = 'rer deploy --environment production --env-file "$HOME/.config/lamp/production.env"';

function settingsStep(input: GuideInput, id: string, lines: string, placeholders: string) {
  return `<li>${input.local ? 'Stop <code>rer dev</code>. Add these two lines to the <code>.dev.vars</code> file in your Lamp folder' : 'Add these two lines to the private settings file you deploy Lamp with'}, replacing ${placeholders}. The second line is a fresh random secret for this installation; keep it private. If the file already has an <code>AUTH_PROVIDERS</code> line, put the entry between its <code>[ ]</code> after a comma instead, and keep its <code>OIDC_TRANSACTION_SECRET</code> line.${copyBlock(id, lines, 'Copy the two lines')}</li>`;
}

function deployStep(input: GuideInput, id: string, provider: string) {
  return `<li>${input.local ? 'Start <code>rer dev</code> again.' : `Deploy again from your Lamp folder, with your own environment name and file:${copyBlock(id, deployCommand, 'Copy the deploy command')}`} This page then says ${provider} is set up. A redeploy keeps every signed-in session and subscriber link.</li>`;
}

function enableStep(provider: string, account: string) {
  return `<li>Invite each person from <a href="/app/settings">Settings → Operators</a> with ${account}. Then tick <strong>Allow provider sign-in</strong> above and save. Having a ${provider} account alone never grants access.</li>`;
}

export function googleGuide(input: GuideInput, open: boolean) {
  const lines = `AUTH_PROVIDERS=[{"id":"google","preset":"google","clientId":"PASTE-CLIENT-ID","tokenAuthMethod":"client_secret_basic","clientSecret":"PASTE-CLIENT-SECRET"}]\nOIDC_TRANSACTION_SECRET=${randomSecret()}`;
  return `<details${open ? ' open' : ''}><summary>Set up Google sign-in</summary><ol>
      <li>Open <a href="https://console.cloud.google.com/apis/credentials" target="_blank" rel="noreferrer">Google Cloud credentials</a> and choose <strong>Create credentials → OAuth client ID</strong>. Choose <strong>Web application</strong>. If Google asks, set up the consent screen first.</li>
      <li>Under <strong>Authorized redirect URIs</strong>, add this exact address, then choose <strong>Create</strong>:${copyBlock('lamp-google-callback', `${input.origin}/auth/oidc/google/callback`, 'Copy the redirect URI')}</li>
      ${settingsStep(input, 'lamp-google-settings', lines, 'PASTE-CLIENT-ID and PASTE-CLIENT-SECRET with the values Google shows')}
      ${deployStep(input, 'lamp-google-deploy', 'Google')}
      ${enableStep('Google', 'their Google email address')}
    </ol></details>`;
}

export function oktaGuide(input: GuideInput) {
  const lines = `AUTH_PROVIDERS=[{"id":"okta","preset":"okta","issuer":"https://PASTE-OKTA-DOMAIN","clientId":"PASTE-CLIENT-ID","tokenAuthMethod":"client_secret_basic","clientSecret":"PASTE-CLIENT-SECRET","subjectEmails":{"PASTE-OKTA-USER-ID":"PASTE-THEIR-LAMP-EMAIL"}}]\nOIDC_TRANSACTION_SECRET=${randomSecret()}`;
  return `<details><summary>Set up Okta sign-in</summary><ol>
      <li>In the Okta Admin Console, open <strong>Applications → Applications → Create App Integration</strong>. Choose <strong>OIDC - OpenID Connect</strong> and <strong>Web Application</strong>, then <strong>Next</strong>.</li>
      <li>Under <strong>Sign-in redirect URIs</strong>, replace the example with this exact address. Under <strong>Assignments</strong>, choose the people who will use Lamp, then <strong>Save</strong>:${copyBlock('lamp-okta-callback', `${input.origin}/auth/oidc/okta/callback`, 'Copy the redirect URI')}</li>
      <li>On the app's <strong>General</strong> tab, keep <strong>Client authentication</strong> as <strong>Client secret</strong>, and copy the <strong>Client ID</strong> and <strong>Client secret</strong>. Your Okta domain is shown in the menu under your name at the top right, such as <code>acme.okta.com</code>.</li>
      <li>Lamp links each person by their Okta user ID, never by an email Okta reports. For each person, open <strong>Directory → People</strong> and choose them: their user ID is the last part of the browser address, after <code>/profile/view/</code>, and starts with <code>00u</code>. For more than one person, add more <code>"user-id":"email"</code> pairs inside <code>subjectEmails</code>, separated by commas.</li>
      ${settingsStep(input, 'lamp-okta-settings', lines, 'PASTE-OKTA-DOMAIN, PASTE-CLIENT-ID and PASTE-CLIENT-SECRET with the values above, and PASTE-OKTA-USER-ID and PASTE-THEIR-LAMP-EMAIL with one person\'s user ID and the email you invite them with')}
      ${deployStep(input, 'lamp-okta-deploy', 'Okta')}
      ${enableStep('Okta', 'the same email you paired with their user ID')}
    </ol></details>`;
}

export function microsoftGuide() {
  return `<details><summary>Microsoft Entra sign-in</summary>
      <p class="notice">This installation cannot set up Microsoft Entra from this page. Lamp links each Microsoft person by the sign-in ID Microsoft issues to this one app, and Microsoft shows that ID only inside a sign-in, never in the Entra admin center, so there is nothing here for you to copy it from. What would make it work: a Lamp version that shows a refused person their ID to send you. Until then, use Google, Okta or email sign-in links, which work for every invited person.</p>
    </details>`;
}

export function authGuide(input: GuideInput) {
  const provider = input.identityProvider;
  const callbacks = [`${input.origin}/.well-known/rer-link/callback`, `${input.origin}/auth/oidc/auth/callback`, `${input.origin}/auth/oidc/auth/logout`].join('\n');
  const first = provider
    ? `<li>This installation names <code>${escapeHtml(provider)}</code> as its Auth installation.</li>`
    : `<li>Add this line to the private settings file you deploy Lamp with, replacing the address with your Auth installation's own address, and deploy again:${copyBlock('lamp-auth-setting', 'IDENTITY_PROVIDER=https://auth.example.com', 'Copy the line')}${copyBlock('lamp-auth-deploy', deployCommand, 'Copy the deploy command')}</li>`;
  return `<details><summary>Set up Run Edit Run Auth sign-in</summary>${input.local ? '<p class="notice">Linking an Auth installation needs this Lamp on its public address. Follow these steps on your hosted Lamp.</p>' : ''}<ol>
      ${first}
      <li>Open <a href="/app/settings">Settings → Operators</a>, choose <strong>Confirm my identity</strong> and follow the email it sends, in this browser.</li>
      <li>Send the Auth owner this Lamp's address and these three exact addresses to approve for it:${copyBlock('lamp-auth-callbacks', `${input.origin}\n${callbacks}`, 'Copy the addresses')}</li>
      <li>${provider ? `Start the link. Lamp then waits ten minutes for the Auth owner to finish it in Auth:<p><button type="button" class="copy-button" data-auth-link="${escapeHtml(provider)}">Start the link</button></p>` : 'After the deploy, this step offers a button that starts the link; Lamp then waits ten minutes for the Auth owner to finish it in Auth.'}<p role="status" data-auth-result></p></li>
      <li>Check the link: <button type="button" class="copy-button" data-auth-status>Check the Auth link</button> It says <strong>Linked</strong> when Auth has finished. Lamp creates its own key; nothing else is pasted.</li>
      ${enableStep('Auth', 'the email their Auth account uses')}
    </ol></details>`;
}

// Copy buttons and the two Auth link calls need no framework: the page is Base's
// server-rendered settings document, and these are same-origin requests with its session.
export const guideScript = `document.addEventListener('click',async e=>{const b=e.target.closest('[data-copy],[data-auth-link],[data-auth-status]');if(!b)return;const out=document.querySelector('[data-auth-result]');
if(b.dataset.copy){try{await navigator.clipboard.writeText(document.getElementById(b.dataset.copy).textContent);b.textContent='Copied';}catch{b.textContent='Select and copy the text';}return;}
try{if(b.dataset.authLink){const r=await fetch('/auth/dependencies/relink',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({interface:'oidc-provider@1',issuer:b.dataset.authLink})});const j=await r.json().catch(()=>({}));out.textContent=j.pending?'Waiting for the Auth owner to finish the link in Auth (ten minutes).':'Lamp refused to start the link ('+(j.error||r.status)+'). Confirm your identity first, then try again.';}
else{const r=await fetch('/auth/dependencies/status');const j=await r.json().catch(()=>({}));out.textContent=j.linked?'Linked.':j.needsRelink?'The link needs approving again: start the link once more.':'Not linked yet.';}}catch{out.textContent='The request did not reach Lamp. Check your connection and try again.';}});`;
