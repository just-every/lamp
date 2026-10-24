import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";
import AxeBuilder from "@axe-core/playwright";
import { operatorHydrated } from "./operator-hydrated.mjs";
export async function metricsBrowserFlow({api,post,component,origin,cookie}) {
  const target=await component("synthetic-lamp-60");
  const browser=await chromium.launch({headless:true,args:["--use-mock-keychain","--password-store=basic"]});
  try {
    const context=await browser.newContext();await context.addCookies(cookie.split("; ").map(pair=>({name:pair.slice(0,pair.indexOf("=")),value:pair.slice(pair.indexOf("=")+1),url:origin})));
    const page=await context.newPage(),errors=[];page.on("pageerror",error=>errors.push(error.message));page.on("console",message=>{if(message.type()==="error"&&/hydrat|did not match|server rendered/i.test(message.text()))errors.push(message.text());});
    if(process.env.LAMP_SCREENSHOTS)await mkdir(process.env.LAMP_SCREENSHOTS,{recursive:true});
    const list=async()=>{const result=await api(`/api/app/metrics?componentId=${target.id}`);assert.equal(result.status,200,result.text);return result.body.metrics;};
    async function openComponent(){await page.goto(origin+"/app/components");await operatorHydrated(page);await page.locator("article.component-row").filter({has:page.getByText(target.name,{exact:true})}).getByRole("button",{name:"Edit component",exact:true}).click();return page.getByRole("dialog",{name:target.name,exact:true});}
    for(const width of [1440,390]) {
      await page.setViewportSize({width,height:width===390?844:1000});
      let dialog=await openComponent(),panel=dialog.getByRole("region",{name:"Public performance metrics",exact:true});
      await panel.getByRole("button",{name:"Add metric",exact:true}).click();let form=panel.getByRole("form",{name:"Add public metric",exact:true});await form.getByLabel("Metric name",{exact:true}).fill("synthetic-lamp-61");await form.getByRole("button",{name:"Add metric",exact:true}).click();
      let editor=panel.getByRole("region",{name:"Edit metric synthetic-lamp-61",exact:true});await editor.getByLabel("Metric push address",{exact:true}).waitFor();
      const push=(await list()).find(row=>row.name==="synthetic-lamp-61");assert.ok(push);assert.equal(await editor.getByLabel("Metric push address",{exact:true}).inputValue(),`/api/app/metrics/${push.id}/points`);await audit("component-push",dialog);
      await editor.getByLabel("Metric name",{exact:true}).fill("synthetic-lamp-62");await dialog.getByRole("button",{name:"Close component panel",exact:true}).click();await dialog.waitFor({state:"hidden"});assert.equal((await list()).find(row=>row.id===push.id).name,"synthetic-lamp-62","closing the component panel flushes its ordinary metric edit");
      await page.reload();await operatorHydrated(page);dialog=await openComponent();panel=dialog.getByRole("region",{name:"Public performance metrics",exact:true});await panel.getByRole("button",{name:"Edit metric",exact:true}).click();assert.equal(await panel.getByLabel("Metric name",{exact:true}).inputValue(),"synthetic-lamp-62");await audit("component-saved",dialog);await dialog.getByRole("button",{name:"Close component panel",exact:true}).click();assert.equal((await api(`/api/app/metrics/${push.id}`,{method:"DELETE"})).status,200);
      for(const [index,provider] of ["datadog","newrelic","pingdom","uptime"].entries()) {
        const result=await post("/api/app/intake/sources",{name:`synthetic-lamp-${64+index}`,preset:provider,credentialKind:"bearer-token",...(provider==="uptime"?{monitorMappings:[{monitorId:"synthetic-lamp-68",componentId:target.id}]}:{componentId:target.id})});assert.equal(result.status,201,result.text);const source=result.body.source;
        if(provider==="newrelic") {
          await page.goto(origin+"/app/alerts");await operatorHydrated(page);await page.getByRole("button",{name:`Edit ${source.name}`,exact:true}).click();const sourceForm=page.locator("section.tool-form");await sourceForm.getByLabel("Entity names",{exact:true}).fill("synthetic-lamp-51");await sourceForm.getByRole("button",{name:"Close",exact:true}).click();await page.reload();await operatorHydrated(page);await page.getByRole("button",{name:`Edit ${source.name}`,exact:true}).click();assert.equal(await sourceForm.getByLabel("Entity names",{exact:true}).inputValue(),"synthetic-lamp-51");await audit("newrelic-entities",sourceForm);
        }
        dialog=await openComponent();panel=dialog.getByRole("region",{name:"Public performance metrics",exact:true});await panel.getByRole("button",{name:"Add metric",exact:true}).click();form=panel.getByRole("form",{name:"Add public metric",exact:true});await form.getByLabel("Metric feed",{exact:true}).selectOption(provider==="uptime"?`${source.id}/synthetic-lamp-68`:source.id);await form.getByLabel("Metric name",{exact:true}).fill(`synthetic-lamp-${70+index}`);
        if(provider!=="uptime")await form.getByLabel(provider==="pingdom"?"Pingdom check ID":"Metric query",{exact:true}).fill(provider==="datadog"?"avg:synthetic.metric{*}":provider==="newrelic"?"SELECT average(duration) AS value FROM Transaction":"123");
        if(provider==="newrelic"){await form.getByLabel("New Relic account ID",{exact:true}).fill("123");await form.getByLabel("Unit",{exact:true}).fill("s");}
        await form.getByRole("button",{name:"Add metric",exact:true}).click();editor=panel.getByRole("region",{name:`Edit metric synthetic-lamp-${70+index}`,exact:true});await editor.getByLabel("Metric name",{exact:true}).waitFor();
        if(provider!=="uptime") {await editor.getByLabel(provider==="datadog"?"Datadog API key":"Read-only API key",{exact:true}).fill(`synthetic-lamp-${80+index}`);if(provider==="datadog")await editor.getByLabel("Read-only application key",{exact:true}).fill("synthetic-lamp-84");await editor.getByRole("button",{name:"Save read-only key",exact:true}).click();await editor.getByText("Read-only key connected.",{exact:false}).waitFor();}
        await audit(`${provider}-configured`,dialog);await dialog.getByRole("button",{name:"Close component panel",exact:true}).click();await page.reload();await operatorHydrated(page);dialog=await openComponent();panel=dialog.getByRole("region",{name:"Public performance metrics",exact:true});await panel.getByRole("button",{name:"Edit metric",exact:true}).click();editor=panel.getByRole("region",{name:`Edit metric synthetic-lamp-${70+index}`,exact:true});assert.equal((await list()).find(row=>row.sourceId===source.id).connected,true);
        if(provider!=="uptime")assert.equal(await editor.getByLabel(provider==="datadog"?"Datadog API key":"Read-only API key",{exact:true}).inputValue(),"","sealed keys are never loaded into the owner form");
        await audit(`${provider}-saved`,dialog);await dialog.getByRole("button",{name:"Close component panel",exact:true}).click();assert.equal((await api(`/api/app/intake/sources/${source.id}`,{method:"DELETE"})).status,200);assert.ok(!(await list()).some(row=>row.sourceId===source.id),"source removal removes its metric connection");
      }
      dialog=await openComponent();panel=dialog.getByRole("region",{name:"Public performance metrics",exact:true});await panel.getByRole("button",{name:"Add metric",exact:true}).click();form=panel.getByRole("form",{name:"Add public metric",exact:true});await form.getByLabel("Metric feed",{exact:true}).selectOption("prometheus");await form.getByLabel("Metric name",{exact:true}).fill("synthetic-lamp-85");await form.getByLabel("Metric query",{exact:true}).fill("avg(synthetic_latency)");await form.getByLabel("Prometheus endpoint",{exact:true}).fill("https://synthetic-lamp-86.example.test");await form.getByRole("button",{name:"Add metric",exact:true}).click();editor=panel.getByRole("region",{name:"Edit metric synthetic-lamp-85",exact:true});await editor.getByLabel("Read-only API key",{exact:true}).fill("synthetic-lamp-87");await editor.getByRole("button",{name:"Save read-only key",exact:true}).click();await editor.getByText("Read-only key connected.",{exact:false}).waitFor();await audit("prometheus-configured",dialog);await dialog.getByRole("button",{name:"Close component panel",exact:true}).click();
      for(const metric of await list())assert.equal((await api(`/api/app/metrics/${metric.id}`,{method:"DELETE"})).status,200);
    }
    assert.deepEqual(errors,[],"metrics setup has no hydration mismatch or page error");await context.close();
    async function audit(name,scope) {
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`${name}: owner page has no overflow`);assert.ok(await scope.evaluate(element=>element.scrollWidth<=element.clientWidth+1),`${name}: the panel has no horizontal overflow`);
      assert.deepEqual(await scope.locator("button").evaluateAll(buttons=>buttons.filter(button=>button.scrollWidth>button.clientWidth+1).map(button=>button.textContent.trim())),[],`${name}: every control label fits`);
      const axe=await new AxeBuilder({page}).withTags(["wcag2a","wcag2aa","wcag21a","wcag21aa","wcag22aa"]).analyze();assert.deepEqual(axe.violations.filter(v=>["serious","critical"].includes(v.impact)).map(v=>({id:v.id,nodes:v.nodes.map(n=>n.target)})),[],`${name}: no serious axe finding`);
      if(process.env.LAMP_SCREENSHOTS)await scope.screenshot({path:`${process.env.LAMP_SCREENSHOTS}/${page.viewportSize().width}-metrics-${name}.png`});
    }
  }finally{await browser.close();}
}
