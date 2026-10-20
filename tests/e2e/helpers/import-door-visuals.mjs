import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';
import { devKey } from '../../helpers/dev-key.mjs';

/** Optional local screenshots from the same real Worker journey. */
export async function captureImportDoor({cookies,source,jobId,origin,directory,revoked=false}) {
  await mkdir(directory,{recursive:true});
  const browser=await chromium.launch({headless:true,args:['--use-mock-keychain','--password-store=basic']});
  try {
    const context=await browser.newContext({extraHTTPHeaders:{'x-rer-dev-key':devKey}});
    await context.addCookies(cookies.map(cookie=>({...cookie,url:origin})));
    const page=await context.newPage();
    for(const width of [1440,390]) {
      await page.setViewportSize({width,height:width===1440?1000:844});
      await page.goto(`${origin}/app/settings`);
      await page.getByRole('link',{name:'Your data',exact:true}).click();
      const row=page.locator('summary').filter({hasText:'Business imports'});
      await row.waitFor();
      await page.getByText(`Business imports · ${revoked?'Off':'On'}`,{exact:true}).waitFor();
      await row.scrollIntoViewIfNeeded();
      await page.screenshot({path:`${directory}/${revoked?'revoked':source}-settings-row-${width}.png`});
      await row.click();
      const toggle=page.getByRole('checkbox',{name:'Allow Business imports'});
      try { await toggle.waitFor(); }
      catch(error) {
        await page.screenshot({path:`${directory}/settings-failed-${width}.png`});
        console.error(`Settings browser URL: ${page.url()}; ${await page.locator('body').innerText()}`);
        throw error;
      }
      await page.waitForFunction(()=> {
        const input=[...document.querySelectorAll('input[type="checkbox"]')].find(input=>input.closest('label')?.textContent.includes('Allow Business imports'));
        return input && !input.disabled;
      });
      if(revoked) {
        assert.equal(await toggle.isChecked(),false);
        await page.getByText('Permanently revoked:',{exact:false}).waitFor();
        await toggle.scrollIntoViewIfNeeded();
        await page.screenshot({path:`${directory}/settings-revoked-${width}.png`});
        await page.goto(`${origin}/app/move-in`);
        const jobs = page.locator('.move-in-jobs li');
        await jobs.first().waitFor();
        for (const job of await jobs.allTextContents()) assert.match(job, /· undone ·/, 'every visible import is undone');
        await page.getByRole('heading',{name:'Your imports'}).scrollIntoViewIfNeeded();
        await page.screenshot({path:`${directory}/history-undone-${width}.png`,fullPage:true});
        continue;
      }
      assert.equal(await toggle.isChecked(),true);
      await toggle.uncheck();
      await page.getByRole('status').filter({hasText:'Business imports disabled.'}).waitFor();
      await toggle.scrollIntoViewIfNeeded();
      await page.screenshot({path:`${directory}/${source}-settings-off-${width}.png`});
      await toggle.check();
      await page.getByRole('status').filter({hasText:'Business imports enabled.'}).waitFor();
      await page.screenshot({path:`${directory}/${source}-settings-on-${width}.png`});
      await page.goto(`${origin}/app/move-in`);
      if(source==='sorry') await page.getByRole('combobox',{name:'Source',exact:true}).selectOption('sorry');
      const job = page.locator('.move-in-jobs li').filter({has:page.locator(`a[href="/app/cutover?job=${encodeURIComponent(jobId)}"]`)});
      await job.getByText('approved via Business by',{exact:false}).waitFor();
      await page.getByRole('heading',{name:'Your imports'}).scrollIntoViewIfNeeded();
      await page.screenshot({path:`${directory}/${source}-history-${width}.png`});
      await page.goto(`${origin}/app/cutover?job=${encodeURIComponent(jobId)}`);
      await page.getByRole('heading',{name:'Confirmation invitations'}).waitFor();
      await page.getByRole('heading',{name:'Confirmation invitations'}).scrollIntoViewIfNeeded();
      assert.equal(await page.getByRole('button',{name:'Send invitations',exact:true}).isDisabled(),true);
      await page.screenshot({path:`${directory}/${source}-cutover-${width}.png`});
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),'no horizontal page overflow');
    }
    await context.close();
  } finally {await browser.close();}
}
