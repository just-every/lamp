// Activity is session-only: a restarted process must not imply work is still running.
const topics = Object.freeze({workspace:'workspace details',owner:'owner details',hosting:'hosting details',email:'email setup',setup:'setup details'});
const phases = Object.freeze({checking:'Checking',needs_input:'Needs your input for',complete:'Finished checking'});
const fields = new Set(['target','ownerName','email','name','allowedOrigin','primaryColor','accountId','prefix','appOrigin','emailProvider','emailFrom','emailAccountId','prefixMode','addressMode']);
export function validateAgentActivity(input) {
 if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(key=>!['phase','topic'].includes(key))||!Object.hasOwn(phases,input.phase)||!Object.hasOwn(topics,input.topic))throw Error('Choose a supported activity phase and topic.');
 return {phase:input.phase,topic:input.topic};
}
export function createActivity(state,allowedFields=[...fields]) {
 const accepted=new Set(allowedFields);
 state.activity=[];state.agent={mode:'manual',attached:false,attachedAt:null,lastSeenAt:null};let sequence=0;
 const attach=()=>{const at=new Date().toISOString();state.agent={mode:'connected',attached:true,attachedAt:state.agent.attachedAt||at,lastSeenAt:at};};
 const append=(source,phase,topic,message,keys)=>{
  const previous=state.activity.at(-1);
  if(previous?.source===source&&previous.phase===phase&&previous.topic===topic&&previous.message===message&&JSON.stringify(previous.keys)===JSON.stringify(keys))return previous;
  const entry={id:++sequence,at:new Date().toISOString(),source,phase,topic,message,...(keys?{keys}: {})};
  state.activity.push(entry);state.activity=state.activity.slice(-24);return entry;
 };
 return {
  agent(input){const {phase,topic}=validateAgentActivity(input);attach();return append('agent',phase,topic,`${phases[phase]} ${topics[topic]}.`);},
  filled(keys){const safe=keys.filter(key=>accepted.has(key));if(safe.length){attach();return append('agent','filled','setup',`Updated ${safe.length} setup ${safe.length===1?'field':'fields'}.`,safe);}},
  secrets(){attach();return append('agent','filled','credentials','Supplied credentials securely for the current setup details.');},
  provider(provider,status){
   if(!['cloudflare','github'].includes(provider))return;
   const name=provider==='cloudflare'?'Cloudflare':'GitHub';
   const states={starting:['checking',`Starting ${name} sign-in.`],awaiting_browser:['needs_input',`Complete ${name} sign-in in your browser.`],refreshing:['checking',`Checking ${name} connection.`],connected:['complete',`${name} connection confirmed.`],auth_required:['needs_input',`${name} sign-in is required.`],not_installed:['needs_input',`${name} command-line tool is required.`],failed:['failed',`${name} connection was not confirmed.`],cancelled:['failed',`${name} sign-in was cancelled.`]};
   const entry=states[status];if(entry)return append('provider',entry[0],provider,entry[1]);
  },
  step(message){return append('installer','checking','installation',message);},
  phase(phase){if(phase==='complete')return append('installer','complete','installation','Installation completed.');if(phase==='failed')return append('installer','failed','installation','Installation stopped. Review the installation details.');},
 };
}
