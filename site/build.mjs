import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { Marked } from 'marked';
import hljs from 'highlight.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'docs');
const repo = 'https://github.com/Sreenivas-Sadhu-Prabhakara/apigee-bank-ai-demos';
const esc = (s = '') => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const slug = s => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const icon = (name, size = 20) => {
  const shapes = {
    arrow: '<path d="M5 12h14m-6-6 6 6-6 6"/>',
    search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4 4"/>',
    download: '<path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>',
    grid: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
    layers: '<path d="m12 3 10 5-10 5L2 8l10-5Zm-10 9 10 5 10-5M2 16l10 5 10-5"/>',
    chip: '<rect x="6" y="6" width="12" height="12" rx="2"/><path d="M9 1v5m6-5v5M9 18v5m6-5v5M1 9h5m-5 6h5M18 9h5m-5 6h5"/>',
    terminal: '<path d="m4 6 6 6-6 6m9 0h7"/>',
    book: '<path d="M12 5C8 2 4 3 2 4v16c4-2 7-1 10 1 3-2 6-3 10-1V4c-2-1-6-2-10 1Zm0 0v16"/>',
    menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
    external: '<path d="M14 3h7v7m0-7L10 14M10 3H3v18h18v-7"/>',
    shield: '<path d="M12 2 3 6v6c0 5 9 10 9 10s9-5 9-10V6l-9-4Z"/><path d="m8 12 3 3 5-6"/>',
    copy: '<rect x="8" y="8" width="12" height="13" rx="2"/><path d="M16 8V3H3v13h5"/>',
    chevron: '<path d="m9 5 7 7-7 7"/>',
    github: '<path d="M9 20c-5 1-5-2-7-2m14 4v-4c0-1 .2-2-.5-3 3-.3 6-1.5 6-6A5 5 0 0 0 20 5c.2-1 0-2-1-3-2 0-3 1-4 1a14 14 0 0 0-6 0C8 3 7 2 5 2c-1 1-1.2 2-1 3a5 5 0 0 0-1.5 4c0 4.5 3 5.7 6 6-.7 1-.5 2-.5 3v4"/>',
  };
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${shapes[name] || shapes.book}</svg>`;
};

const pages = [
  {id:'banker',file:'01-ai-banker.md',number:'01',title:'The AI banker',subtitle:'A lost card. One conversation. A controlled outcome.',category:'Customer experience',color:'mint',effort:'Medium',time:'5-minute demo',description:'Turn a lost-card request into a confirmed freeze and an evidence-backed dispute draft.',capability:'Governed banking tools',proof:'A read-only agent cannot freeze a card.',model:'Qwen · JSON planning'},
  {id:'treasury',file:'02-treasury-copilot.md',number:'02',title:'Treasury copilot',subtitle:'Explore a cash-flow scenario. See the numbers change.',category:'Corporate banking',color:'blue',effort:'Medium',time:'5-minute demo',description:'Stress-test Friday’s payroll, calculate the shortfall, and prepare funding for human approval.',capability:'API orchestration & approvals',proof:'Two different people must approve the proposal.',model:'Qwen + Gemma'},
  {id:'fraud',file:'03-fraud-investigator.md',number:'03',title:'Fraud investigator',subtitle:'Every finding has evidence. Every action has a boundary.',category:'Risk & operations',color:'rose',effort:'Medium–high',time:'5-minute demo',description:'Build a cited investigation brief, screen a malicious note, and demonstrate independent export controls.',capability:'Screening & authorization',proof:'A forbidden export fails independently of the model.',model:'Gemma · grounded briefs'},
  {id:'gateway',file:'04-bank-wide-ai-gateway.md',number:'04',title:'The bank-wide AI gateway',subtitle:'Make model access measurable, resilient, and governed.',category:'Engineering platform',color:'amber',effort:'Medium',time:'5-minute demo',description:'Route three applications across models, inject an upstream failure, and enforce an app’s token allowance.',capability:'Routing, fallback & token quotas',proof:'One app reaches its limit. The others keep working.',model:'Qwen ↔ Gemma'},
  {id:'marketplace',file:'05-agent-marketplace.md',number:'05',title:'Agent marketplace',subtitle:'Give each partner exactly the tools it is entitled to use.',category:'Partner ecosystem',color:'violet',effort:'Medium–high',time:'5-minute demo',description:'Connect two accounting agents to the same bank and let them discover different MCP capabilities.',capability:'MCP discovery & API products',proof:'A hidden tool is also denied when called directly.',model:'Qwen · MCP client orchestration'},
  {id:'foundation',file:'SHARED_PLATFORM.md',title:'Shared platform',subtitle:'The common contracts behind all five demos.',category:'Build foundation',icon:'layers',description:'Architecture, identity, mock services, persistence, and deployment.'},
  {id:'models',file:'LOCAL_LLM.md',title:'Local Qwen & Gemma',subtitle:'Use the models already running on your Mac Studio.',category:'Local inference',icon:'chip',description:'Ollama setup, JSON planning, token accounting, and the Apigee bridge.'},
  {id:'testing',file:'postman/README.md',title:'Postman & curl',subtitle:'Prove each workflow at the API boundary first.',category:'Test assets',icon:'terminal',description:'Six importable collections, 93 requests, and repeatable synthetic sessions.'},
  {id:'start',file:'README.md',title:'Start building',subtitle:'A practical handoff from idea to implementation.',category:'Implementation pack',icon:'book',description:'Build order, deliverables, operating modes, and the Opus 5 kickoff prompt.'},
];
const byFile = new Map(pages.map(p=>[p.file,p.id]));
const sourceFiles = pages.map(p=>p.file);
const postmanFiles = (await fs.readdir(path.join(root,'postman'))).filter(f=>f.endsWith('.json')).sort();
await fs.mkdir(path.join(out,'assets'), {recursive:true});
await fs.mkdir(path.join(out,'downloads','postman'), {recursive:true});
for(const file of [...sourceFiles,...postmanFiles.map(f=>'postman/'+f)]) {
  await fs.mkdir(path.dirname(path.join(out,'downloads',file)), {recursive:true});
  await fs.copyFile(path.join(root,file),path.join(out,'downloads',file));
}
await fs.copyFile(path.join(root,'site','styles.css'),path.join(out,'assets','styles.css'));
await fs.copyFile(path.join(root,'site','app.js'),path.join(out,'assets','app.js'));
await fs.writeFile(path.join(out,'.nojekyll'),'');
execFileSync('zip',['-q','-j',path.join(out,'downloads','implementation-guides.zip'),...sourceFiles.filter(f=>!f.startsWith('postman/')).map(f=>path.join(root,f))]);
execFileSync('zip',['-q','-j',path.join(out,'downloads','postman-collections.zip'),...postmanFiles.map(f=>path.join(root,'postman',f))]);

const architecture = () => `<div class="architecture" role="img" aria-label="The user application calls Apigee, which governs access to synthetic bank APIs, local Qwen and Gemma models, and optional Model Armor screening. Bank and application state is stored in PostgreSQL; activity feeds an evidence panel.">
  <div class="arch-client"><span class="arch-icon">${icon('terminal',23)}</span><strong>Your application</strong><small>Postman · curl · agent UI</small><span class="arch-sub">Identity + bounded agent loop</span></div>
  <span class="arch-connector">${icon('arrow',25)}</span>
  <div class="arch-gateway"><span class="arch-icon">${icon('shield',27)}</span><strong>Apigee</strong><small>Authentication · permissions<br>Routing · quotas · observability</small><span class="arch-pill">Policy enforcement</span></div>
  <span class="arch-connector">${icon('arrow',25)}</span>
  <div class="arch-targets"><div><span class="dot mint-dot"></span><span><strong>Banking APIs</strong><small>Stateful synthetic services</small></span></div><div><span class="dot blue-dot"></span><span><strong>Qwen + Gemma</strong><small>Local inference via Ollama</small></span></div><div><span class="dot rose-dot"></span><span><strong>Model Armor</strong><small>Optional cloud screening</small></span></div></div>
  <div class="arch-foot">PostgreSQL stores domain state and approvals <span>·</span> The evidence panel shows actual requests and decisions</div>
</div>`;

const searchRecords=[];
const promptMap={};
let documents='';
for(const page of pages){
  const markdown=await fs.readFile(path.join(root,page.file),'utf8');
  const toc=[];const used=new Map();
  const md = new Marked({gfm:true,breaks:false});
  md.use({renderer:{
    heading({tokens,depth}){
      const title=this.parser.parseInline(tokens);const plain=title.replace(/<[^>]+>/g,'');
      const base=slug(plain);const n=used.get(base)||0;used.set(base,n+1);
      const id=base+(n?'-'+n:'');
      if(depth===1)return '';
      if(depth===2)toc.push({id,title:plain});
      return `<h${depth} id="${page.id}--${id}">${title}<a class="heading-anchor" href="#/${page.id}/${id}" aria-label="Link to ${esc(plain)}">#</a></h${depth}>`;
    },
    code({text,lang}){
      const language=(lang||'text').split(/\s/)[0];
      if(language==='mermaid')return architecture();
      const highlighted=hljs.getLanguage(language)?hljs.highlight(text,{language,ignoreIllegals:true}).value:esc(text);
      return `<div class="code-block"><div class="code-toolbar"><span>${esc(language)}</span><button class="copy-code" type="button" aria-label="Copy ${esc(language)} code">${icon('copy',14)}<span>Copy</span></button></div><pre><code class="hljs language-${esc(language)}">${highlighted}</code></pre></div>`;
    },
    link({href,title,tokens}){
      let target=href;let extra='';
      if(!/^(https?:|mailto:|#)/.test(href)){
        const [file,anchor]=href.split('#');
        const resolved=path.posix.normalize(path.posix.join(path.posix.dirname(page.file),file));
        if(byFile.has(resolved))target='#/'+byFile.get(resolved)+(anchor?'/'+anchor:'');
        else {target='downloads/'+resolved;extra=' download';}
      }else if(/^https?:/.test(href)){extra=' target="_blank" rel="noopener noreferrer"';}
      return `<a href="${esc(target)}"${extra}${title?` title="${esc(title)}"`:''}>${this.parser.parseInline(tokens)}</a>`;
    }
  }});
  const content=md.parse(markdown).replace(/<table>/g,'<div class="table-scroll" tabindex="0" role="region" aria-label="Scrollable data table"><table>').replace(/<\/table>/g,'</table></div>');
  const prompts=[...markdown.matchAll(/```text\n([\s\S]*?)```/g)];
  if(prompts.length && !['foundation','testing'].includes(page.id))promptMap[page.id]=prompts.at(-1)[1].trim();
  const sections=markdown.split(/(?=^## )/m);
  for(const [i,section] of sections.entries()){
    const heading=section.match(/^## (.+)$/m)?.[1];
    searchRecords.push({page:page.id,title:page.title,heading:heading||page.subtitle,anchor:heading?slug(heading):'',text:section.replace(/```[\s\S]*?```/g,' ').replace(/[#*`|]/g,' ').replace(/\[([^\]]+)\]\([^)]+\)/g,'$1').replace(/\s+/g,' ').trim()});
  }
  documents+=`<section class="page guide-page" data-page="${page.id}" hidden>
    <div class="guide-heading"><div class="eyebrow">${page.number?`USE CASE ${page.number} <span>/</span> `:''}${esc(page.category)}</div><h1>${esc(page.title)}</h1><p>${esc(page.subtitle)}</p><div class="guide-actions"><a class="button secondary compact" href="downloads/${page.file}" download>${icon('download',15)} Download Markdown</a>${promptMap[page.id]?`<button class="button secondary compact" data-copy-prompt="${page.id}">${icon('copy',15)} Copy build prompt</button>`:''}${page.number?`<a class="text-link" href="downloads/postman/${postmanFiles.find(f=>f.startsWith(page.number+'-'))}" download>Postman collection ${icon('arrow',15)}</a>`:''}</div></div>
    <div class="guide-layout"><article class="prose">${content}</article><aside class="contents" aria-label="On this page"><div>ON THIS PAGE</div><nav>${toc.map(t=>`<a href="#/${page.id}/${t.id}">${esc(t.title.replace(/^\d+\. /,''))}</a>`).join('')}</nav><a class="contents-back" href="#/overview">${icon('grid',15)} All five demos</a></aside></div>
  </section>`;
}

const cards=pages.filter(p=>p.number).map(p=>`<a class="demo-card ${p.color}" href="#/${p.id}"><div class="demo-number">${p.number}</div><div class="demo-card-main"><div class="demo-category">${esc(p.category)}${p.id==='banker'?'<span class="recommended">Recommended first build</span>':''}</div><h3>${esc(p.title)}</h3><p>${esc(p.description)}</p><div class="demo-tags"><span>${esc(p.capability)}</span><span>${esc(p.effort)} effort</span></div></div><span class="demo-card-arrow">${icon('arrow',22)}</span></a>`).join('');
const postmanCards=postmanFiles.filter(f=>f.includes('collection')).map(f=>{const index=f.slice(0,2);const name=index==='00'?'Local Ollama checks':pages.find(p=>p.number===index)?.title;return `<a class="download-item" href="downloads/postman/${f}" download><span><small>COLLECTION ${index}</small><strong>${esc(name)}</strong></span>${icon('download',18)}</a>`;}).join('');
const data=JSON.stringify({pages:pages.map(({id,title,category})=>({id,title,category})),search:searchRecords,prompts:promptMap}).replaceAll('<', String.fromCharCode(92) + 'u003c');
const html=`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Banking AI Playbook — Apigee, Qwen & Gemma</title><meta name="description" content="Five practical banking AI demos with Apigee governance, local Qwen and Gemma inference, stateful mock APIs, and 93 Postman requests."><meta name="theme-color" content="#112b32"><link rel="icon" href="assets/favicon.svg" type="image/svg+xml"><link rel="stylesheet" href="assets/styles.css"><script src="assets/app.js" defer></script></head>
<body><a class="skip-link" href="#main">Skip to content</a>
<aside class="sidebar" id="sidebar"><a class="brand" href="#/overview" aria-label="Banking AI Playbook home"><span class="brand-symbol">${icon('layers',23)}</span><span>Banking AI<small>THE IMPLEMENTATION PLAYBOOK</small></span></a>
<button class="search-trigger" type="button">${icon('search',16)}<span>Search the playbook</span><kbd>⌘ K</kbd></button>
<nav class="main-nav" aria-label="Main navigation"><a href="#/overview" data-nav="overview">${icon('grid',18)} Overview</a><div class="nav-label">FIVE POSSIBILITIES</div>${pages.filter(p=>p.number).map(p=>`<a href="#/${p.id}" data-nav="${p.id}"><span class="nav-number">${p.number}</span>${esc(p.title)}</a>`).join('')}<div class="nav-label">BUILD & TEST</div>${pages.filter(p=>!p.number).map(p=>`<a href="#/${p.id}" data-nav="${p.id}">${icon(p.icon,18)}${esc(p.title)}</a>`).join('')}</nav>
<div class="sidebar-bottom"><div class="sidebar-models"><span class="status-dot"></span> Qwen + Gemma<small>Local inference. Governed access.</small></div><a href="${repo}" target="_blank" rel="noopener noreferrer">${icon('github',17)} View repository ${icon('external',13)}</a></div></aside>
<div class="nav-scrim" hidden></div><div class="workspace"><header class="topbar"><div class="topbar-left"><button class="mobile-menu icon-button" aria-label="Open navigation" aria-controls="sidebar" aria-expanded="false">${icon('menu')}</button><span class="breadcrumb">Playbook <span>/</span> <strong id="current-page">Overview</strong></span></div><div class="topbar-right"><span class="version-label">EDITION 01 <span>·</span> SEPT 2026</span><a class="topbar-download" href="downloads/implementation-guides.zip" download>${icon('download',16)}<span>Get the guides</span></a></div></header>
<main id="main" tabindex="-1"><section class="page overview-page" data-page="overview">
<div class="hero"><div class="hero-content"><div class="hero-eyebrow"><span></span> APIGEE × LOCAL AI</div><h1>Banking AI.<br>From possibility<br><em>to implementation.</em></h1><p>Five demos that make the art of possible tangible. Real model inference, synthetic banking APIs, and governance you can see working.</p><div class="hero-buttons"><a class="button primary" href="#/banker">Explore the first demo ${icon('arrow',18)}</a><a class="hero-secondary" href="#/start">How to use this playbook ${icon('chevron',15)}</a></div></div>
<div class="hero-visual" aria-hidden="true"><div class="orbital orbital-one"></div><div class="orbital orbital-two"></div><div class="orbital orbital-three"></div><div class="orbit-node node-q">Q<span>QWEN</span></div><div class="orbit-node node-g">G<span>GEMMA</span></div><div class="gateway-symbol">${icon('shield',54)}<span>APIGEE</span></div><div class="orbit-label label-bank"><span class="status-dot"></span> Banking APIs</div><div class="orbit-label label-policy">AUTH · ROUTE · GOVERN</div></div>
<div class="hero-stats"><div><strong>05</strong><span>Banking use cases</span></div><div><strong>93</strong><span>Postman requests</span></div><div><strong>02</strong><span>Local model families</span></div><div class="hero-stat-note">Designed for<br><b>engineering leadership</b></div></div></div>
<div class="intro-strip"><span class="intro-icon">${icon('book',21)}</span><p><strong>A blueprint you can build.</strong> Architecture, mock API contracts, curl examples, and Opus 5 build prompts for every demo.</p><a href="#/start">Start here ${icon('arrow',16)}</a></div>
<section class="overview-section" aria-labelledby="demos-title"><div class="section-heading"><div><div class="eyebrow">THE DEMO COLLECTION</div><h2 id="demos-title">Five ways to show what’s next.</h2></div><span class="section-note">Choose a business story.<br>Make the controls visible.</span></div><div class="demo-grid">${cards}</div></section>
<section class="overview-section architecture-section" aria-labelledby="architecture-title"><div class="section-heading"><div><div class="eyebrow">THE SHARED FOUNDATION</div><h2 id="architecture-title">One gateway. A connected experience.</h2></div><a class="text-link" href="#/foundation">Explore the architecture ${icon('arrow',16)}</a></div>${architecture()}<div class="architecture-notes"><div><b>Banking services</b><span>Mocked, stateful, and resettable. Every action is testable without an LLM.</span></div><div><b>Local intelligence</b><span>Qwen plans validated actions. Gemma explains returned evidence.</span></div><div><b>Visible governance</b><span>Inspect the request, the decision, and the component that enforced it.</span></div></div></section>
<section class="overview-section build-section" aria-labelledby="build-title"><div class="section-heading"><div><div class="eyebrow">FROM SPEC TO DEMO</div><h2 id="build-title">Build in three clear steps.</h2></div></div><div class="build-steps"><a href="#/foundation"><span>01 / FOUNDATION</span><h3>Make the APIs work.</h3><p>Seed synthetic data and prove the happy path and permission boundaries with Postman.</p>${icon('arrow',19)}</a><a href="#/models"><span>02 / INTELLIGENCE</span><h3>Connect local models.</h3><p>Use your installed Qwen and Gemma through a validated, bounded application loop.</p>${icon('arrow',19)}</a><a href="#/start"><span>03 / PRESENTATION</span><h3>Show the outcome.</h3><p>Connect Apigee, add the experience, and demonstrate a deliberate failure case.</p>${icon('arrow',19)}</a></div></section>
<section class="download-section" aria-labelledby="downloads-title"><div class="download-heading"><div><div class="eyebrow">READY FOR YOUR WORKBENCH</div><h2 id="downloads-title">Take the playbook with you.</h2><p>Import the collections. Hand the guides to Opus 5.<br>Build and test one complete workflow at a time.</p></div><div class="download-actions"><a class="button dark" href="downloads/implementation-guides.zip" download>${icon('download',17)} All Markdown guides</a><a class="button secondary" href="downloads/postman-collections.zip" download>${icon('download',17)} All Postman assets</a></div></div><div class="download-grid">${postmanCards}</div><div class="download-footer"><a href="downloads/postman/local.postman_environment.json" download>Download the Postman environment ${icon('arrow',15)}</a><a href="#/testing">Setup instructions ${icon('arrow',15)}</a></div></section>
<div class="scope-note">${icon('shield',19)}<p><strong>Implementation guides, with an honest boundary.</strong> These are build specifications, not deployed banking applications. The banking data is synthetic. Local model smoke checks passed; the banking workflows still need implementation and verification.</p></div>
</section>${documents}</main>
<footer class="site-footer"><span>Banking AI Playbook <span>·</span> Apigee + Qwen + Gemma</span><a href="${repo}" target="_blank" rel="noopener noreferrer">Source on GitHub ${icon('external',12)}</a></footer></div>
<dialog class="search-dialog" aria-labelledby="search-title"><div class="search-dialog-input">${icon('search',22)}<label class="sr-only" id="search-title" for="site-search">Search the implementation playbook</label><input id="site-search" placeholder="Search use cases, endpoints, or build steps…" autocomplete="off" type="search"><button class="dialog-close" aria-label="Close search">Esc</button></div><div class="search-results" role="region" aria-live="polite"></div><div class="search-footer">Search across all five guides and the shared foundation.</div></dialog>
<div class="toast" role="status" aria-live="polite"></div><script type="application/json" id="playbook-data">${data}</script></body></html>`;
const liveHtml = html
  .replace('class="topbar-download" href="downloads/implementation-guides.zip"', 'class="topbar-download" href="downloads/banking-ai-playbook.html" data-download-html')
  .replace('<span>Get the guides</span>', '<span>Download HTML</span>')
  .replace('<div class="download-actions">', '<div class="download-actions"><a class="button primary" href="downloads/banking-ai-playbook.html" data-download-html download>Download offline HTML '+icon('download',17)+'</a>');
await fs.writeFile(path.join(out,'index.html'),liveHtml);

// The downloadable edition carries its styles, application code, and all test
// assets inside one file. It works without a server or CDN.
let standalone = liveHtml
  .replace('<link rel="stylesheet" href="assets/styles.css">', '<style>'+await fs.readFile(path.join(root,'site','styles.css'),'utf8')+'</style>')
  .replace('<script src="assets/app.js" defer></script>', '')
  .replace('<link rel="icon" href="assets/favicon.svg" type="image/svg+xml">', '')
  .replace('</body>', '<script>'+await fs.readFile(path.join(root,'site','app.js'),'utf8')+'</script></body>');
const mime={'.md':'text/markdown','.json':'application/json','.zip':'application/zip'};
const downloadAnchors=[...standalone.matchAll(/<a\b[^>]*\bhref="(downloads\/[^"]+)"[^>]*>/g)];
for(const [tag,href] of downloadAnchors){
  if(href==='downloads/banking-ai-playbook.html'){
    standalone=standalone.replace(tag,tag.replace(href,'#/overview'));
    continue;
  }
  const bytes=await fs.readFile(path.join(out,href));
  const dataUrl=`data:${mime[path.extname(href)]||'application/octet-stream'};base64,${bytes.toString('base64')}`;
  const replacement=tag.replace(href,dataUrl).replace(/\sdownload(?:="[^"]*")?(?=[\s>])/,'')
    .replace(/>$/,` download="${path.basename(href)}">`);
  standalone=standalone.replace(tag,replacement);
}
await fs.writeFile(path.join(out,'downloads','banking-ai-playbook.html'),standalone);
await fs.writeFile(path.join(out,'assets','favicon.svg'),'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><rect width="40" height="40" rx="10" fill="#112b32"/><path d="m20 9 12 6-12 6-12-6 12-6Zm-12 12 12 6 12-6M8 27l12 6 12-6" fill="none" stroke="#b9ebc5" stroke-width="2" stroke-linejoin="round"/></svg>');
console.log(`Built ${pages.length + 1} views, ${searchRecords.length} searchable sections, ${postmanFiles.length} Postman assets, and two download bundles.`);
