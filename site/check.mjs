import {chromium} from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath,pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const base=process.env.SITE_URL||'http://127.0.0.1:4173/';
const screenshotDir=path.join(root,'test-results');
await fs.mkdir(screenshotDir,{recursive:true});
let executablePath=process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE||chromium.executablePath();
try{await fs.access(executablePath);}catch{
  const cache=path.join(os.homedir(),'Library/Caches/ms-playwright');
  const candidates=(await fs.readdir(cache)).filter(x=>/^chromium-\d+$/.test(x)).sort((a,b)=>Number(b.split('-')[1])-Number(a.split('-')[1]));
  assert(candidates.length,'Install Chromium with npx playwright install chromium');
  executablePath=path.join(cache,candidates[0],'chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing');
}
const browser=await chromium.launch({executablePath,headless:true});
const context=await browser.newContext({viewport:{width:1440,height:1000},acceptDownloads:true});
await context.grantPermissions(['clipboard-read','clipboard-write'],{origin:new URL(base).origin});
const page=await context.newPage();
const errors=[];page.on('pageerror',e=>errors.push(e.message));
try{
  await page.goto(base,{waitUntil:'networkidle'});
  assert.equal(await page.locator('.demo-card:visible').count(),5);
  await page.screenshot({path:path.join(screenshotDir,'desktop.png'),fullPage:true});
  for(const id of ['banker','treasury','fraud','gateway','marketplace','foundation','models','testing','start']){
    await page.goto(base+'#/'+id);
    await page.locator(`[data-page="${id}"]`).waitFor({state:'visible'});
    assert.equal(await page.locator('[data-page]:visible').count(),1);
    assert(await page.locator(`[data-page="${id}"] .prose`).innerText());
  }
  await page.goto(base+'#/banker');
  await page.locator('[data-copy-prompt="banker"]').click();
  assert((await page.evaluate(()=>navigator.clipboard.readText())).includes('Build demo 01'));
  await page.locator('[data-page="banker"] .copy-code').first().click();
  assert((await page.evaluate(()=>navigator.clipboard.readText())).includes('cards'));
  await page.screenshot({path:path.join(screenshotDir,'guide.png'),fullPage:false});
  await page.locator('.search-trigger').click();
  await page.locator('#site-search').fill('confirmation');
  assert(await page.locator('.search-result').count()>0);
  await page.locator('.search-result').first().click();
  assert.equal(await page.locator('.search-dialog').isVisible(),false);
  const [download]=await Promise.all([page.waitForEvent('download'),page.locator('.topbar-download').click()]);
  assert.equal(download.suggestedFilename(),'banking-ai-playbook.html');
  await download.saveAs(path.join(screenshotDir,'downloaded-playbook.html'));
  const content=await fs.readFile(path.join(screenshotDir,'downloaded-playbook.html'),'utf8');
  assert(content.includes('data:application/json;base64,'));
  assert(!content.includes('src="assets/app.js"'));
  const links=await page.locator('a[href^="downloads/"]').evaluateAll(nodes=>[...new Set(nodes.map(n=>n.getAttribute('href')))]);
  for(const href of links){const response=await context.request.get(new URL(href,base).href);assert.equal(response.status(),200,href);}
  const standalonePage=await context.newPage();
  await standalonePage.goto(new URL('downloads/banking-ai-playbook.html',base).href);
  const [standaloneDownload]=await Promise.all([standalonePage.waitForEvent('download'),standalonePage.locator('.topbar-download').click()]);
  assert.equal(standaloneDownload.suggestedFilename(),'banking-ai-playbook.html');
  await standalonePage.close();
  await page.setViewportSize({width:390,height:844});
  await page.goto(base+'#/overview');
  await page.locator('[data-page="overview"]').waitFor({state:'visible'});
  await page.evaluate(()=>window.scrollTo({top:0,behavior:'instant'}));
  await page.screenshot({path:path.join(screenshotDir,'mobile.png'),fullPage:true,animations:'disabled'});
  await page.locator('.mobile-menu').click();
  await page.locator('[data-nav="models"]').click();
  await page.locator('[data-page="models"]').waitFor({state:'visible'});
  assert.equal(await page.locator('.mobile-menu').getAttribute('aria-expanded'),'false');
  for(const id of ['overview','banker','foundation','models','marketplace']){
    await page.goto(base+'#/'+id);
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Mobile overflow: '+id);
  }
  const offline=await context.newPage();
  offline.on('pageerror',e=>errors.push(e.message));
  await context.setOffline(true);
  await offline.goto(pathToFileURL(path.join(screenshotDir,'downloaded-playbook.html')).href);
  assert.equal(await offline.locator('.demo-card:visible').count(),5);
  await offline.locator('[data-nav="banker"]').click();
  await offline.locator('[data-page="banker"]').waitFor({state:'visible'});
  await offline.locator('.search-trigger').click();
  await offline.locator('#site-search').fill('Ollama');
  assert(await offline.locator('.search-result').count()>0);
  await offline.locator('.dialog-close').click();
  const [offlineDownload]=await Promise.all([offline.waitForEvent('download'),offline.locator('[data-page="banker"] a[download="01-ai-banker.postman_collection.json"]').first().click()]);
  assert.equal(offlineDownload.suggestedFilename(),'01-ai-banker.postman_collection.json');
  await offlineDownload.saveAs(path.join(screenshotDir,'offline-collection.json'));
  const collection=JSON.parse(await fs.readFile(path.join(screenshotDir,'offline-collection.json'),'utf8'));
  assert.equal(collection.item.length,16);
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({passed:true,views:10,downloadLinks:links.length,checks:['desktop navigation','search','code/prompt clipboard','HTML download','all download links','mobile navigation and overflow','offline navigation and search','offline Postman download'],browserErrors:errors},null,2));
}finally{await browser.close();}
