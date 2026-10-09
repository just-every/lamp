import * as model from './ui/seed.mjs';
import { install } from './install.mjs';
export function createSeed() {
 return {product:model.product.name,branding:model.branding,model,browserModule:'scripts/installer/ui/seed.mjs',background:'scripts/installer/ui/background.svg',features:model.features,
 defaults:()=>({target:'local',timezone:Intl.DateTimeFormat().resolvedOptions().timeZone,mailProvider:'resend'}),
 validateInput(input){
  for(const key of model.requiredKeys(input))if(!model.fields[key].valid(input[key]))throw Error(`Provide a valid ${model.fields[key].label.toLowerCase()}.`);
  return Object.fromEntries(Object.keys(model.fields).filter(key=>typeof input[key]==='string').map(key=>[key,input[key].trim()]));
 },install};
}
