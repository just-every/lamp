// The guides on /auth/settings/identity for the providers Settings › Sign-in does not set up: Microsoft Entra and
// Run Edit Run Auth. Google and Okta are set up in the app. Each guide says exactly what to copy where, with the
// installation's own addresses; a provider this page cannot finish says so and what would.

export const escapeHtml = (value: string) => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');

export function copyBlock(id: string, text: string, label: string) {
  return `<div class="copy-block"><pre id="${id}"><code>${escapeHtml(text)}</code></pre><button type="button" class="copy-button" data-copy="${id}">${escapeHtml(label)}</button></div>`;
}

export interface GuideInput { origin: string; local: boolean; identityProvider?: string }

const deployCommand = 'rer deploy --environment production --env-file "$HOME/.config/lamp/production.env"';

function enableStep(provider: string, account: string) {
  return `<li>Invite each person from <a href="/app/settings">Settings → Operators</a> with ${account}. Then tick <strong>Allow provider sign-in</strong> above and save. Having a ${provider} account alone never grants access.</li>`;
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
