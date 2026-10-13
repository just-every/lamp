import {installationFailure} from '@runeditrun/rer/failures';

// Native boundary checks, before receipts, dependencies, migrations or requests.
// SETUP schema 1 cannot express these limits yet; this does not change its model.
export function nativeInputProblems(input) {
 const problems=[];
 const text=(key,value,limit)=>{
  if(typeof value!=='string'||!value.trim()||value.trim().length>limit)
   problems.push(`${key}: enter 1–${limit} characters`);
 };
 if(!['local','remote'].includes(input.target))problems.push('target: choose On this computer or Online for your team');
 text('OWNER_DISPLAY_NAME',input.displayName,120);
 text('LAMP_PAGE_NAME',input.pageName,120);
 text('LAMP_PAGE_TAGLINE',input.tagline,280);
 if(typeof input.ownerEmail!=='string'||!/^\S+@[^\s@]+\.[^\s@]+$/.test(input.ownerEmail))problems.push('SETUP_OPERATOR_EMAIL: enter a valid email address');
 try {
  if(typeof input.timezone!=='string'||input.timezone.length>100)throw Error();
  new Intl.DateTimeFormat('en',{timeZone:input.timezone});
 }catch{problems.push('LAMP_PAGE_TIMEZONE: enter a valid IANA timezone');}
 return problems;
}

export async function validateNativeInput(input,store) {
 const problems=nativeInputProblems(input);
 if(!problems.length)return;
 // Only field names and fixed instructions reach the shared diagnostic sinks.
 await store.step(`Correct setup answers before starting: ${problems.join('; ')}.`);
 throw installationFailure('command_failed',{step:'setup'});
}

/** Native checks over setup answers named as in rer-setup.json. */
export function validateAnswers(answers,store) {
 return validateNativeInput({target:answers.target??'local',ownerEmail:answers.SETUP_OPERATOR_EMAIL,displayName:answers.OWNER_DISPLAY_NAME,pageName:answers.LAMP_PAGE_NAME,tagline:answers.LAMP_PAGE_TAGLINE,timezone:answers.LAMP_PAGE_TIMEZONE},store);
}
