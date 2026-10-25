import { importLimits } from "../statuspage-import/source";
import { SubscriberIntakeError, subscriberAddSchema, type IntakeDecision, type IntakeRow } from "./intake-schema";
import { webhookFormatSchema } from "./webhook-format";

const headersAllowed=new Set(["email","phone","webhook_url","contact_email","components","language","webhook_format"]);

function records(csv:string):string[][] {
  if(new TextEncoder().encode(csv).byteLength>importLimits.maxBytes) throw new SubscriberIntakeError("The CSV exceeds 8 MiB.",413);
  const rows:string[][]=[]; let row:string[]=[],field="",quoted=false,closed=false,recordStart=0;
  const input=csv.replace(/^\uFEFF/u,"");
  const finish=(end:number)=>{
    row.push(field);
    if(new TextEncoder().encode(input.slice(recordStart,end)).byteLength>importLimits.maxRecordBytes) throw new SubscriberIntakeError("A CSV record exceeds 512 KiB.");
    rows.push(row);row=[];field="";closed=false;
    if(rows.length>importLimits.maxCsvRows+1) throw new SubscriberIntakeError("The CSV exceeds 5000 subscriber rows.");
  };
  for(let index=0;index<input.length;index++) {
    const char=input[index]!;
    if(quoted) {
      if(char==='"'&&input[index+1]==='"'){field+='"';index++;}
      else if(char==='"'){quoted=false;closed=true;} else field+=char;
    } else if(char===","){row.push(field);field="";closed=false;}
    else if(char==="\r"||char==="\n"){finish(index);if(char==="\r"&&input[index+1]==="\n")index++;recordStart=index+1;}
    else if(char==='"'&&!field&&!closed)quoted=true;
    else {if(char==='"'||closed)throw new SubscriberIntakeError("The CSV contains an invalid quoted field.");field+=char;}
  }
  if(quoted)throw new SubscriberIntakeError("The CSV contains an unclosed quoted field.");
  if(field||row.length||closed)finish(input.length);
  return rows;
}

export function parseSubscriberCsv(csv:string):{valid:IntakeRow[];decisions:IntakeDecision[]} {
  const rows=records(csv),headers=rows.shift()?.map(value=>value.trim().toLowerCase().replaceAll(" ","_"))??[];
  if(!headers.some(value=>["email","phone","webhook_url"].includes(value))||new Set(headers).size!==headers.length||headers.some(value=>!headersAllowed.has(value)))throw new SubscriberIntakeError("Use unique CSV headers: email, phone, webhook_url, contact_email, components, language, webhook_format.");
  if(!rows.length)throw new SubscriberIntakeError("Choose a CSV containing subscriber rows.");
  const valid:IntakeRow[]=[],decisions:IntakeDecision[]=[],seen=new Set<string>();
  rows.forEach((cells,index)=>{
    const row=index+2;
    const refuse=(reason:string)=>decisions.push({row,outcome:"refused",reason});
    if(cells.length!==headers.length){refuse("The number of cells does not match the header.");return;}
    const value=Object.fromEntries(headers.map((header,column)=>[header,cells[column]!.trim()]));
    if(value.language&&value.language!=="en"){refuse("Only English (en) is available (I18N-001).");return;}
    if([value.email,value.phone,value.webhook_url].filter(Boolean).length!==1){refuse("Choose exactly one email address, phone number or webhook URL.");return;}
    if((value.email||value.phone)&&value.webhook_format){refuse("Webhook format applies only to webhook subscribers.");return;}
    if(value.webhook_format&&!webhookFormatSchema.safeParse(value.webhook_format).success){refuse("Choose Lamp or Statuspage as the webhook format.");return;}
    const componentIds=value.components?value.components.split(/[;,]/u).map(id=>id.trim()).filter(Boolean):[];
    const parsed=subscriberAddSchema.safeParse(value.phone?{channel:"sms",phone:value.phone,componentIds}:value.email?{channel:"email",email:value.email,componentIds}:{channel:"webhook",destination:value.webhook_url,contactEmail:value.contact_email??"",componentIds,...(value.webhook_format?{webhookFormat:value.webhook_format}:{})});
    if(!parsed.success){refuse("The destination, contact address or component identifiers are invalid.");return;}
    const item=parsed.data,destination=item.channel==="email"?item.email:item.channel==="sms"?item.phone:item.destination;
    if(seen.has(destination)){decisions.push({row,outcome:"skipped",reason:"This destination occurs earlier in the file."});return;}
    seen.add(destination);
    valid.push({row,channel:item.channel,destination,contactEmail:item.channel==="webhook"?item.contactEmail:null,componentIds:item.componentIds,...(item.channel==="webhook"?{webhookFormat:item.webhookFormat}:{})});
    decisions.push({row,outcome:"created",reason:null});
  });
  return {valid,decisions};
}

export function subscriberCsvCell(value:unknown):string {
  const text=String(value??"");
  const safe=/^[\s\u0000-\u001f]*[=+\-@]/u.test(text)||/^[\t\r\n]/u.test(text)?`'${text}`:text;
  return `"${safe.replaceAll('"','""')}"`;
}
