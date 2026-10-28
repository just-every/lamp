import { createOperatorAuth, createAuthHandler, createSignInHandler, type AuthConfig, type NativeAccountsAdapter, type NativeProofPersistence, type CompletedSession } from '../index.mjs';
import { createEmailLinkLifecycle, type EmailLinkPersistence } from '../identity/email-link/index.mjs';
import { createAdmission, createOidcProviders } from '../identity/index.mjs';
import { requireEditorOwner, accountsAdapter } from '../accounts/index.mjs';
import { createDependencies, type NativeDependencyAuthority } from '../../dependencies/index.mjs';
import type { Database } from '../index.mjs';

declare const db: Database;
declare const accounts: NativeAccountsAdapter<'workspace-owner' | 'operator' | 'contact'>;
declare const proofs: NativeProofPersistence<'workspace-owner' | 'operator' | 'contact'>;
declare const mail: import('../index.mjs').MailSender;
const config: AuthConfig = { origin:'https://app.example', OWNER_EMAIL:'owner@example.com', SESSION_SECRET:'from-worker-secret-not-source', providers:[{
  id:'incumbent',preset:'legacy-rs256',issuer:'https://login.example',clientId:'client',clientSecret:'from-secret',tokenAuthMethod:'client_secret_post',
  redirectUri:'https://app.example/api/auth/identity/callback',endpointPins:{authorization:'https://login.example/authorize',token:'https://login.example/token',jwks:'https://login.example/jwks'},
}] };
const auth=createOperatorAuth({db,config,accounts,proofs,mailSender:mail,clientIp:()=> '192.0.2.1'});
const admission=createAdmission({accounts:accountsAdapter(accounts),config});
createOidcProviders({db,admission,config:{origin:config.origin,transactionSecret:'from-transaction-secret',providers:config.providers??[]},clientIp:()=> '192.0.2.1'});
requireEditorOwner({request:new Request(config.origin),getSession:auth.getSession,accounts});
createAuthHandler(auth);createSignInHandler(auth);createDependencies({db,origin:config.origin,name:'Native',auth});
const refusedSetup:Promise<never>=auth.authorizeDependencySetup(new Request(config.origin),{token:'setup'});
void refusedSetup;
const approvalContribution:NativeDependencyAuthority<'workspace-owner'>['approvalFence']=({pending,now})=>({sql:'native_current_owner_session(?,?,?,?)',args:[pending.approved_by,pending.approved_session,pending.approved_version,now]});
const linkedContribution:NativeDependencyAuthority<'workspace-owner'>['linkedStatements']=({pending})=>[db.prepare('UPDATE native_setup SET complete=1 WHERE attempt_id=?').bind(pending.attempt_id)];
void approvalContribution;void linkedContribution;
const session=await auth.getSession(new Request(config.origin));
const role:'workspace-owner'|'operator'|'contact'|undefined=session?.operator.role;
const completed:CompletedSession<'workspace-owner'|'operator'|'contact'>=await auth.createIdentityAdmission({issuer:'https://login.example'})(new Request(config.origin),{issuer:'https://login.example',subject:'sub',email:'operator@example.com',emailVerified:true});
void completed;void role;
// @ts-expect-error Native injection is a pair, never a silent partial opt-in.
createOperatorAuth({db,config,accounts,clientIp:()=> '192.0.2.1'});
// Standalone lifecycle accepts the same public config with ordinary defaults.
declare const persistence: EmailLinkPersistence<'contact'>;
const email=createEmailLinkLifecycle({config,persistence,mailSender:mail,clientIp:()=> '192.0.2.1',hash:async()=> 'keyed-digest'});
await email.requestMagicLink(new Request(config.origin),{email:'contact@example.com'});
await email.requireStepUp(new Request(config.origin),'export');

// Direct vetoes require native revocation authority, while the role stays native.
const vetoOptions={config,mailSender:mail,clientIp:()=> '192.0.2.1',hash:async()=> 'keyed-digest'};
createEmailLinkLifecycle({...vetoOptions,persistence:{...persistence,revokeSession:async()=>{}},hooks:{afterConfirm({operator}){const role:'contact'=operator.role;void role;}}});
// @ts-expect-error A supplied veto must have durable session revocation authority.
createEmailLinkLifecycle({...vetoOptions,persistence,hooks:{afterConfirm(){throw new Error('refused');}}});
// @ts-expect-error A composed callback must not silently replace a direct veto.
createEmailLinkLifecycle({...vetoOptions,persistence:{...persistence,revokeSession:async()=>{}},hooks:{afterConfirm(){}},afterConfirm:async(_request,completed)=>completed});
