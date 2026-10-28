import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { chromium } from "playwright";
import { AxeBuilder } from "@axe-core/playwright";
import { operatorHydrated } from "./operator-hydrated.mjs";
import { overviewTimeFlow } from "./overview-time-flow.mjs";
import { subscriberLimitSourceFiles } from "./subscriber-limits-flow.mjs";

/** Capacity population is an explicit fixture prerequisite. Stop this test's
 * native process before changing its persisted store and restart that process. */
async function populate(runtime,start,count) {
  await runtime.stop();
  const at=new Date().toISOString();
  const sql=`WITH RECURSIVE sequence(n) AS (SELECT ${start} UNION ALL SELECT n+1 FROM sequence WHERE n<${start+count-1})
    INSERT INTO subscribers(id,channel,destination,state,selection_mode,token_hash,created_at,updated_at)
    SELECT '01JLIMIT' || printf('%018d',n),'email','synthetic-lamp-limit-' || n || '@example.test','active','all','synthetic-lamp-limit-token-' || n,'${at}','${at}' FROM sequence`;
  execFileSync("pnpm",["exec","wrangler","d1","execute","DB","--local","--persist-to",runtime.state,"--config","wrangler.jsonc","--command",sql],{env:runtime.env,stdio:"pipe"});
  await runtime.start();
}
async function prove(page,width,name,hydrationErrors) {
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,`${name} fits ${width}`);
  const result=await new AxeBuilder({page}).include("main").withTags(["wcag2a","wcag2aa","wcag21aa","wcag22aa"]).analyze();
  assert.deepEqual(result.violations.filter(row=>["serious","critical"].includes(row.impact)).map(row=>row.id),[],`${name} axe ${width}`);
  assert.deepEqual(hydrationErrors,[],`${name} hydration ${width}`);
  if(process.env.LAMP_BROWSER_EVIDENCE){await mkdir(process.env.LAMP_BROWSER_EVIDENCE,{recursive:true});await page.screenshot({path:join(process.env.LAMP_BROWSER_EVIDENCE,`${name}-${width}.png`),fullPage:true});}
}
function watch(page) {
  const errors=[];
  page.on("console",message=>{if(/hydration|did not match|server rendered/i.test(message.text()))errors.push(message.text());});
  page.on("pageerror",error=>{if(/hydration|did not match|server rendered/i.test(error.message))errors.push(error.message);});
  return errors;
}
export async function subscriberLimitsBrowserFlow({runtime,origin,publicOrigin,cookie}) {
  await populate(runtime,1,24_900);
  const browser=await chromium.launch({headless:true,args:["--use-mock-keychain","--password-store=basic"]});
  const auth=async options=>{
    const context=await browser.newContext(options);
    await context.addCookies(cookie.split("; ").filter(Boolean).map(pair=>{const split=pair.indexOf("=");return{name:pair.slice(0,split),value:pair.slice(split+1),url:origin};}));
    return context;
  };
  try {
    for(const width of [1440,390]) {
      const context=await auth({viewport:{width,height:960}}),page=await context.newPage(),errors=watch(page);
      try {
        await page.goto(`${origin}/app/subscribers`);await operatorHydrated(page);
        await page.getByRole("region",{name:"Subscriber capacity",exact:true}).getByText("24,900 / 25,000",{exact:true}).first().waitFor();
        const intake=page.getByRole("region",{name:"Import and export subscribers",exact:true});
        const csv="email\r\n"+Array.from({length:300},(_,index)=>`synthetic-lamp-browser-limit-${width}-${index}@example.test\r\n`).join("");
        await intake.getByLabel("CSV contents",{exact:true}).fill(csv);
        const preview=page.waitForResponse(response=>new URL(response.url()).pathname.endsWith("/subscribers/import/preview"));
        await intake.getByRole("button",{name:"Dry run CSV",exact:true}).click();
        const response=await preview;assert.equal(response.status(),200);assert.equal((await response.json()).counts.refused,200);
        await intake.getByText(/over the 25,000 limit by 200/u).waitFor();
        assert.equal(await intake.getByRole("button",{name:"Create pending subscriptions",exact:true}).isDisabled(),true);
        await prove(page,width,"subscriber-capacity-excess",errors);
        await page.goto(`${origin}/app/move-in`);await operatorHydrated(page);
        const files=subscriberLimitSourceFiles(300).map(file=>({name:file.name,mimeType:"application/json",buffer:Buffer.from(file.text)}));
        await page.getByLabel("Saved responses",{exact:true}).setInputFiles(files);
        const planned=page.waitForResponse(response=>new URL(response.url()).pathname.endsWith("/api/operator/import/plan"));
        await page.getByRole("button",{name:"Run dry run",exact:true}).click();
        const plan=await planned;assert.equal(plan.status(),200);assert.equal((await plan.json()).report.counts.subscriber.rejected,200);
        await page.getByText(/over the 25,000 limit by 200/u).waitFor();
        await page.getByRole("checkbox",{name:"I reviewed what changes, is skipped or is refused.",exact:true}).check();
        assert.equal(await page.getByRole("button",{name:"Import",exact:true}).isDisabled(),true);
        await prove(page,width,"move-in-capacity-excess",errors);
      } finally {await context.close();}
    }
    await populate(runtime,24_901,100);
    const boundaryContext=await auth({viewport:{width:1440,height:960}});
    try {await overviewTimeFlow({context:boundaryContext,origin,publicOrigin});}
    finally {await boundaryContext.close();}
    for(const width of [1440,390]) {
      const context=await auth({viewport:{width,height:960}}),page=await context.newPage(),errors=watch(page);
      try {
        await page.goto(`${origin}/app`);await operatorHydrated(page);
        const followups=page.getByRole("region",{name:"Follow-ups",exact:true});
        await followups.getByRole("link",{name:/All channels subscriptions are full/u}).waitFor();
        await prove(page,width,"follow-ups-capacity-full",errors);
      } finally {await context.close();}
      let scriptFreeHtml;
      for(const javaScriptEnabled of [false,true]) {
        const publicContext=await browser.newContext({viewport:{width,height:960},javaScriptEnabled}),publicPage=await publicContext.newPage();
        const publicErrors=watch(publicPage);
        try {
          await publicPage.goto(publicOrigin);
          await publicPage.getByLabel("Email address",{exact:true}).fill(`synthetic-lamp-full-browser-${width}@example.test`);
          const denied=publicPage.waitForResponse(response=>new URL(response.url()).pathname==="/subscribe"&&response.request().method()==="POST");
          await publicPage.getByRole("button",{name:"Subscribe",exact:true}).click();
          const response=await denied;assert.equal(response.status(),409);
          const html=await response.text();
          await publicPage.getByText(/cannot take new subscriptions on that channel right now/u).waitFor();
          await publicPage.getByRole("link",{name:"Atom feed",exact:true}).waitFor();
          await publicPage.getByRole("link",{name:"RSS feed",exact:true}).waitFor();
          if(javaScriptEnabled) {
            assert.equal(html,scriptFreeHtml,"the accessibility probe uses the identical server-generated script-free refusal document");
            await prove(publicPage,width,"subscribe-capacity-full",publicErrors);
          } else {
            scriptFreeHtml=html;
            assert.equal(await publicPage.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,`script-free refusal fits ${width}`);
            if(process.env.LAMP_BROWSER_EVIDENCE){await mkdir(process.env.LAMP_BROWSER_EVIDENCE,{recursive:true});await publicPage.screenshot({path:join(process.env.LAMP_BROWSER_EVIDENCE,`subscribe-capacity-full-no-script-${width}.png`),fullPage:true});}
          }
        } finally {await publicContext.close();}
      }
    }
  } finally {await browser.close();}
}
