export const product = {name:'Lamp',slugPrefix:'lamp'};
export const branding = {...product,accent:'#163c60'};
export const features = {hosting:true,github:false,artwork:false,localTrialWithoutEmail:true};
export const readySummary = draft => draft.target === 'local'
 ? `${draft.LAMP_PAGE_NAME} will run on this computer. Open it with a native one-use sign-in link; no mail provider key is needed. Rer dev opens signed in with one click.`
 : `Deploy ${draft.LAMP_PAGE_NAME} to your Cloudflare account. Before Start, use Edit to complete Online page settings and Online mail settings, and supply an API token in Hosting & connections. Native setup preserves existing owners.`;

if(typeof document!=='undefined'){
 const style=document.createElement('style');
 style.textContent='.scene{background-color:#164661}.panel .target-choice:has(input:checked){background:#edf5fd;border-color:#163c60}.panel .primary{background:#163c60}';
 document.head.append(style);
}
