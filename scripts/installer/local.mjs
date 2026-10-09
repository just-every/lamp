import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {randomBytes} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {privateDirectory,readPrivateFile,writePrivateFile} from '../base-onboarding/private-files.mjs';
import {installationFailure} from '../base-onboarding/failures.mjs';
import {execute,stop,commandFailure} from './process.mjs';

async function availablePort(){const listener=createServer();await new Promise((resolve,reject)=>{listener.once('error',reject);listener.listen(0,'127.0.0.1',resolve);});const port=listener.address().port;await new Promise(resolve=>listener.close(resolve));return port;}
export async function startLocal(root,input,store,onApp,signal){
 if(process.version!=='v26.8.1')throw installationFailure('node_version',{version:'26.8.1'});
 const pnpm=(args,step)=>execute(root,'npm',['exec','--yes','--package=pnpm@8.15.6','--','pnpm',...args],signal,step);
 await store.step('Installing locked Lamp dependencies');await pnpm(['install','--frozen-lockfile'],'dependencies');
 await store.step('Building Lamp without provider credentials');await pnpm(['run','build'],'build');
 const directory=await privateDirectory(root,['.seed','installer','runtime']);
 let secrets;try{secrets=JSON.parse(await readPrivateFile(join(directory,'secrets.json')));}catch(error){if(error.code!=='ENOENT')throw error;secrets={LAMP_BOOTSTRAP_SECRET:randomBytes(32).toString('hex'),SUBSCRIBER_TOKEN_SECRET:randomBytes(32).toString('hex'),WEBHOOK_SIGNING_SECRET:randomBytes(32).toString('hex')};}
 secrets.MAIL_PROVIDER_API_KEY=input.mailApiKey;
 await writePrivateFile(join(directory,'secrets.json'),JSON.stringify(secrets));
 await writePrivateFile(join(directory,'.dev.vars'),Object.entries(secrets).map(([key,value])=>`${key}=${JSON.stringify(value)}`).join('\n')+'\n');
 const built=JSON.parse(await readFile(join(root,'dist/server/wrangler.json'),'utf8'));
 const server=join(root,'dist/server');
 const config={...built,name:'lamp-local-installer',main:resolve(server,built.main),vars:{LAMP_APP_HOST:'127.0.0.1',LAMP_PAGE_HOST:'127.0.0.1',MAIL_FROM_ADDRESS:input.mailFrom,MAIL_PROVIDER:input.mailProvider,RER_INSTALLATION_ID:'local-independent'},assets:{...built.assets,directory:resolve(server,built.assets.directory)},d1_databases:built.d1_databases.map(database=>({...database,migrations_dir:resolve(server,database.migrations_dir)}))};
 for(const key of ['configPath','userConfigPath','account_id','routes','env'])delete config[key];
 const configPath=join(directory,'wrangler.json');await writePrivateFile(configPath,JSON.stringify(config));
 const statePath=join(directory,'state');
 const migrationConfig=join(directory,'migrations.toml');
 const database=config.d1_databases[0];
 const bucket=config.r2_buckets[0];
 await writePrivateFile(migrationConfig,`name = \"lamp-local-installer\"\ncompatibility_date = \"2026-09-08\"\n[[d1_databases]]\nbinding = \"DB\"\ndatabase_name = ${JSON.stringify(database.database_name)}\ndatabase_id = ${JSON.stringify(database.database_id)}\nmigrations_dir = ${JSON.stringify(database.migrations_dir)}\n[[r2_buckets]]\nbinding = \"SNAPSHOTS\"\nbucket_name = ${JSON.stringify(bucket.bucket_name)}\n`);
 await store.step('Applying local migrations while preserving prior data');
 await execute(root,process.execPath,['node_modules/wrangler/bin/wrangler.js','d1','migrations','apply','DB','--local','--config',configPath,'--persist-to',statePath],signal,'setup');
 // Owner migrations retain their established ledger through the maintained command.
 await pnpm(['exec','node','scripts/installer/owner-migrations.mjs',migrationConfig,statePath],'setup');
 const port=await availablePort(),origin=`http://127.0.0.1:${port}`;
 const child=spawn(process.execPath,['node_modules/wrangler/bin/wrangler.js','dev','--local','--config',configPath,'--persist-to',statePath,'--ip','127.0.0.1','--port',String(port),'--inspector-port','0'],{cwd:root,stdio:'inherit',shell:false,detached:true});
 onApp(child);let spawnError;child.once('error',error=>{spawnError=error;});
 try{
  for(let attempt=0;attempt<120;attempt++){
   signal?.throwIfAborted();if(spawnError)throw commandFailure(spawnError,'node','start',signal);if(child.exitCode!==null)throw installationFailure('command_failed',{step:'start'});
   try{const response=await fetch(origin+'/health',{signal:AbortSignal.timeout(1000)});if(response.status===200)return {origin,secret:secrets.LAMP_BOOTSTRAP_SECRET};}catch{}
   await delay(250,undefined,{signal});
  }
  throw installationFailure('command_failed',{step:'start'});
 }catch(error){stop(child);throw error;}
}
