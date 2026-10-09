import {installationReceipt} from './receipt.mjs';
import {bootstrapOwner} from './bootstrap.mjs';
import {startLocal} from './local.mjs';
export async function install(root,input,store,onApp,signal){
 const receipt=await installationReceipt(root,input);
 const target=input.target==='local'?await startLocal(root,input,store,onApp,signal):{origin:input.appOrigin,secret:input.bootstrapSecret};
 await store.step('Checking native owner setup and preserving existing ownership');
 await bootstrapOwner(target.origin,input,target.secret,signal);
 const health=await fetch(new URL('/health',target.origin),{signal,redirect:'error'});
 if(health.status!==200)throw Error('Lamp did not become healthy after owner setup.');
 store.state.appUrl=new URL('/signin',target.origin).href;
 await store.step('Lamp is ready for native email sign-in');
 await receipt.complete();
 await store.phase('complete');
}
