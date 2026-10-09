// Credentials remain in memory and are invalidated when their declared identity scope changes.
export function createSecretVault({fields,secretScopes={}}){
 let values={},scopes={};
 const readiness=draft=>Object.fromEntries(Object.keys(secretScopes).map(key=>[key,Boolean(values[key]&&secretScopes[key].every(field=>scopes[key]?.[field]===draft[field]))]));
 return {
  readiness(draft){return {...readiness(draft),scopes:structuredClone(scopes),ownerEmail:draft.email,accountId:draft.accountId,emailProvider:draft.emailProvider,emailAccountId:draft.emailAccountId};},
  set(input,draft){
   if(!input||typeof input!=='object'||Array.isArray(input))throw Error('Provide a JSON object through secure stdin.');
   for(const [key,value] of Object.entries(input))if(!Object.hasOwn(secretScopes,key)||typeof value!=='string'||value.length>4096||!fields[key]?.valid(value))throw Error('Secure input contains an unsupported or invalid credential.');
   for(const [key,value] of Object.entries(input)){values[key]=value;scopes[key]=Object.fromEntries(secretScopes[key].map(field=>[field,draft[field]]));}
  },
  merge(input,draft){const effective={...draft,...input,emailProvider:input.emailConfiguration?.provider??draft.emailProvider,emailAccountId:input.emailConfiguration?.accountId??draft.emailAccountId};const ready=readiness(effective),merged={...input};for(const key of Object.keys(secretScopes))if(!merged[key]&&ready[key])merged[key]=values[key];if(input.emailConfiguration)merged.emailConfiguration={...input.emailConfiguration,apiKey:input.emailConfiguration.apiKey||merged.emailApiKey};return merged;},
  clear(){values={};scopes={};}
 };
}
