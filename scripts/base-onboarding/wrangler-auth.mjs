import { readFile, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

export function assertProductionCloudflare(env) {
  for(const name of ['WRANGLER_API_ENVIRONMENT','CLOUDFLARE_API_ENVIRONMENT'])if(env[name]&&env[name]!=='production')throw Error('The selected Cloudflare environment is not supported by this installer.');
  for(const name of ['CLOUDFLARE_API_BASE_URL','CF_API_BASE_URL'])if(env[name]&&env[name].replace(/\/$/,'')!=='https://api.cloudflare.com/client/v4')throw Error('The selected Cloudflare API address is not supported by this installer.');
  if(env.CLOUDFLARE_COMPLIANCE_REGION)throw Error('The selected Cloudflare environment is not supported by this installer.');
}

/** Wrangler 4.45.4's actual credential-file layout; no login, refresh, or profile switching. */
export async function legacyWranglerCredentials(version, { env=process.env, home=homedir(), platform=process.platform, now=Date.now() }={}) {
  if (version !== '4.45.4') throw Error('This Wrangler version does not provide a supported credential reader.');
  assertProductionCloudflare(env);
  if (env.WRANGLER_PROFILE) throw Error('The selected Wrangler environment is not supported by the credential reader.');
  const legacy=join(home,'.wrangler');
  let directory;
  try { if((await stat(legacy)).isDirectory())directory=legacy; } catch(error) { if(error.code!=='ENOENT')throw error; }
  if(!directory){
    const base=env.XDG_CONFIG_HOME || (platform==='darwin'?join(home,'Library','Preferences'):platform==='win32'?join(env.APPDATA||join(home,'AppData','Roaming'),'xdg.config'):join(home,'.config'));
    directory=join(base,'.wrangler');
  }
  const text=await readFile(join(directory,'config','default.toml'),'utf8');
  if(text.length>65536)throw Error('Wrangler credential file is too large.');
  // Wrangler emits simple quoted TOML scalar values. Reject other encodings instead of guessing.
  const scalar=key=>{
    const matches=[...text.matchAll(new RegExp('^'+key+'\\s*=\\s*("[^"\\r\\n]*"|\'[^\'\\r\\n]*\')\\s*(?:#.*)?$','gm'))];
    if(matches.length!==1)return undefined;
    const value=matches[0][1];return value[0]==='"'?JSON.parse(value):value.slice(1,-1);
  };
  const token=scalar('oauth_token'),expires=Date.parse(scalar('expiration_time'));
  if(typeof token!=='string'||!token||/[\r\n]/.test(token)||!Number.isFinite(expires)||expires<=now)throw Error('Wrangler credentials are missing or expired.');
  return {type:'oauth',token};
}
export async function wranglerCredentials(root, env, run) {
  assertProductionCloudflare(env);
  const options={cwd:root,env:{...env,CI:'true',WRANGLER_SEND_METRICS:'false'}};
  try { return JSON.parse(await run('wrangler',['auth','token','--json'],options)); }
  catch {
    const version=(await run('wrangler',['--version'],options)).trim();
    return legacyWranglerCredentials(version,{env});
  }
}
