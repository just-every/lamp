import {readFile,readdir,realpath} from 'node:fs/promises';
import {resolve,relative,sep} from 'node:path';
import {createHash} from 'node:crypto';
export async function deploymentSpec(root, {publicVariableNames=[],secretNames=[],optionalSecretNames=[],extraMigrationDirectories=[],migrationPrefix='',healthPath='/health',providerEffects=[],surfaces,initialSetup,recovery}) {
 const server=resolve(root,'dist/server');
 const config=JSON.parse(await readFile(resolve(server,'wrangler.json'),'utf8'));
 for(const field of ['kv_namespaces','services','vectorize','hyperdrive','analytics_engine_datasets','dispatch_namespaces','mtls_certificates','send_email','workflows','pipelines','secrets_store_secrets','artifacts','ratelimits','ai','browser','images','ai_search','ai_search_namespaces','agent_memory','vpc_services','vpc_networks','worker_loaders']){const value=config[field];if(value&&(Array.isArray(value)?value.length:typeof value==='object'?Object.keys(value).length:true))throw new Error(`Unsupported deployment binding: ${field}`);}
 if((config.durable_objects?.bindings??[]).some(binding=>binding.script_name||binding.environment))throw new Error('External Durable Object bindings require an explicit delivery contract');
 if(config.logfwdr?.bindings?.length)throw new Error('Unsupported log forwarding bindings');
 if(config.unsafe?.bindings?.length)throw new Error('Unsupported unsafe deployment bindings');
 for(const migration of config.migrations??[])if(Object.keys(migration).some(key=>!['tag','new_sqlite_classes','new_classes','deleted_classes','renamed_classes','transferred_classes'].includes(key)))throw new Error('Unsupported Durable Object migration');
 const resources=[...(config.d1_databases??[]).map(x=>({kind:'d1',binding:x.binding})),...(config.r2_buckets??[]).map(x=>({kind:'r2',binding:x.binding})),...(config.queues?.producers??[]).map(x=>({kind:'queue',binding:x.binding}))];
 const migrations=[];
 const directories=[...(config.d1_databases??[]).map(x=>({binding:x.binding,path:resolve(server,x.migrations_dir),prefix:migrationPrefix})),...extraMigrationDirectories];
 const rootPath=await realpath(root);
 for(const directory of directories){
  let path;try{path=await realpath(directory.path)}catch(error){if(error.code==='ENOENT'&&directory.optional)continue;throw error}
  const within=relative(rootPath,path);if(within==='..'||within.startsWith('..'+sep)||within.startsWith(sep))throw new Error('Migration directory escapes candidate source');
  // Match the source migration collector: locale collation can reverse CREATE/ALTER order.
  for(const file of (await readdir(path,{withFileTypes:true})).sort((a,b)=>a.name<b.name?-1:a.name>b.name?1:0)){
   if(!file.name.endsWith('.sql'))continue;
   if(!file.isFile()||!/^[\w.-]+\.sql$/.test(file.name))throw new Error('Migration must be a regular SQL file');
   const sql=await readFile(resolve(path,file.name),'utf8');
   migrations.push({binding:directory.binding,name:(directory.prefix??'')+file.name,sha256:createHash('sha256').update(sql).digest('hex'),sql});
  }
 }
 if(new Set(migrations.map(x=>x.binding+'/'+x.name)).size!==migrations.length)throw new Error('Duplicate migration identity');
 const publicVariables={};
 for(const [key,value] of Object.entries(config.vars??{})){
  if(!publicVariableNames.includes(key))throw new Error(`Undeclared public build variable: ${key}`);
  if(typeof value!=='string')throw new Error(`Public variable must be a string: ${key}`);
  publicVariables[key]=value;
 }
 const queueBinding=name=>{const producer=(config.queues?.producers??[]).find(x=>x.queue===name);if(!producer)throw new Error('Queue consumer must reference declared producer binding');return producer.binding};
 const queueConsumers=(config.queues?.consumers??[]).map(x=>({binding:queueBinding(x.queue),maxBatchSize:x.max_batch_size??10,maxBatchTimeout:x.max_batch_timeout??5,maxRetries:x.max_retries??3,...(x.dead_letter_queue?{deadLetterBinding:queueBinding(x.dead_letter_queue)}:{})}));
 return {schema:1,providerEffects,...(surfaces?{surfaces}:{}),...(initialSetup?{initialSetup}:{}),resources,migrations,compatibilityDate:config.compatibility_date,compatibilityFlags:config.compatibility_flags??[],durableObjects:(config.durable_objects?.bindings??[]).map(x=>({binding:x.name,className:x.class_name})),durableObjectMigrations:(config.migrations??[]).map(x=>({tag:x.tag,newSqliteClasses:x.new_sqlite_classes??[],...(x.new_classes?{newClasses:x.new_classes}:{}),...(x.deleted_classes?{deletedClasses:x.deleted_classes}:{}),...(x.renamed_classes?{renamedClasses:x.renamed_classes}:{}),...(x.transferred_classes?{transferredClasses:x.transferred_classes.map(y=>({from:y.from,fromScript:y.from_script,to:y.to}))}:{})})),publicVariables,secretNames,optionalSecretNames,schedules:config.triggers?.crons??[],queueConsumers,healthPath,recovery};
}
