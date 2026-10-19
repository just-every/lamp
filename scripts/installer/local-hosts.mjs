import {parseEnv} from 'node:util';
import {readSettings} from '@runeditrun/rer/adapter-settings';
import {writePrivateFile} from '@runeditrun/rer/private-files';

// Both Lamp surfaces share a port but need distinct hostnames. Keep the app
// on rer's selected origin, including an explicit localhost launch.
export async function localHosts(context) {
 const appHost=new URL(context.origin).hostname;
 const hosts={LAMP_APP_HOST:appHost,LAMP_PAGE_HOST:appHost==='localhost'?'status.localhost':'localhost'};
 const saved=await readSettings(context.root,{file:'.dev.vars'});
 let text=saved.text??'';
 for(const [key,value] of Object.entries(hosts)) {
  if(saved.values[key]===value)continue;
  const assignment=new RegExp(`^[\\t ]*(?:export[\\t ]+)?${key}[\\t ]*=[^\\r\\n]*(?:\\r?\\n|$)`,'gm');
  text=Object.hasOwn(saved.values,key)?text.replace(assignment,`${key}=${value}\n`):text.replace(/\n*$/,'\n')+`${key}=${value}\n`;
 }
 const updated=parseEnv(text);
 if(Object.entries(hosts).some(([key,value])=>updated[key]!==value)||Object.entries(saved.values).some(([key,value])=>!Object.hasOwn(hosts,key)&&updated[key]!==value))
  throw Error('Could not align local Lamp hostnames without changing other settings. Put LAMP_APP_HOST and LAMP_PAGE_HOST on their own lines, then run rer dev again.');
 if(text!==saved.text)await writePrivateFile(saved.path,text);
 Object.assign(context.vars,hosts);
}
