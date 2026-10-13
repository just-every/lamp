import {hostLamp} from './hosting.mjs';
import {adapter} from './local.mjs';
import {validateAnswers} from './validation.mjs';

// The browser installer: Online hosting runs Lamp's Cloudflare pipeline; a
// local trial is the same lifecycle as `rer setup`.
export async function install(root,input,store,onApp,signal){
 await validateAnswers(input,store);
 if(input.target==='remote'){
  await hostLamp({root,input,store,signal});
  await store.phase('complete');
  return;
 }
 return adapter.install(root,input,store,onApp,signal);
}
