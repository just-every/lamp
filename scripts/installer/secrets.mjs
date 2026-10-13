import {prepareSettings} from '@runeditrun/rer/adapter-settings';

// The root manifest is the sole declaration of generated native secrets. Base
// preserves existing private values and registers them before any command runs.
export async function nativeSecrets(root,store,directory,origin) {
 const context={root,store,input:{},manifest:store.setupManifest};
 if(!context.manifest)throw Error('The canonical setup manifest is required.');
 await prepareSettings(context,{
  origin:()=>origin,
  secrets:{file:`.seed/installer/${directory}/secrets.json`,format:'json',
   values:origin?{LAMP_LOCAL_ORIGIN:origin}:{},
  },
 });
 return context.vars;
}
