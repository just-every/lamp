import { readFile } from 'node:fs/promises';
export function validateAnswers(input,{fields,safeKeys}) {
 if(!input||typeof input!=='object'||Array.isArray(input))throw Error('Provide a JSON object of known nonsecret answers.');
 const answers={};
 for(const [key,value] of Object.entries(input)){
  if(!safeKeys.includes(key))throw Error('Only supported nonsecret answer fields are accepted. Use the secure stdin path for credentials.');
  if(typeof value!=='string'||value.length>2048)throw Error('Answers must be strings within the field limits.');
  if(value!==''&&!fields[key].valid(value))throw Error(`Invalid ${(fields[key].label||key).toLowerCase()}.`);
  if(value&&['allowedOrigin','appOrigin'].includes(key)){const url=new URL(value);if(url.username||url.password||url.search||url.hash)throw Error('Website addresses cannot contain credentials, query strings or fragments.');answers[key]=url.origin;}else answers[key]=value;
 }
 for(const [key,mode] of [['prefix','prefixMode'],['appOrigin','addressMode']])if(safeKeys.includes(mode)&&answers[key]&&!Object.hasOwn(answers,mode))answers[mode]='custom';
 return answers;
}
export async function readAnswers(path,model){const text=await readFile(path,'utf8');if(text.length>16000)throw Error('The answers file is too large.');let value;try{value=JSON.parse(text)}catch{throw Error('The answers file must contain valid JSON.')}return validateAnswers(value,model)}
export async function readSecrets(stream){let text='';for await(const chunk of stream){text+=chunk;if(text.length>16000)throw Error('Secure input is too large.')}try{return JSON.parse(text)}catch{throw Error('Secure stdin must contain a JSON object.')}}
