// Combined Extension - People Scraper (adapted from original People Analyzer)
// Namespaced ping action: ping_people_scraper
(function(){
  if(window.__LINKEDIN_PEOPLE_SCRAPER__){ console.log('ℹ️ People scraper already initialized (Combined)'); return; }
  window.__LINKEDIN_PEOPLE_SCRAPER__ = true;
  console.log('✅ LinkedIn People Scraper Loaded (Combined)');

  const DEBUG_VERBOSE = false;
  const xpaths = {
    name: [".//div[@class='mb1']//a//span[@aria-hidden='true']", ".//div[@class='mb1']//a", ".//a[contains(@href,'/in/')][@data-view-name][1]", ".//a[@data-view-name='search-result-lockup-title'][1]", ".//a[contains(@href,'/in/')][1]"],
    profileUrl: [".//div[@class='mb1']//a", ".//a[contains(@href,'/in/')][@data-view-name][1]", ".//a[@data-view-name='search-result-lockup-title'][1]", ".//a[contains(@href,'/in/')][1]"],
    jobTitle: [".//div[@class='mb1']/div[2]", ".//a[@data-view-name='search-result-lockup-title']/ancestor::p[1]/following-sibling::p[1]", ".//a[contains(@href,'/in/')]/ancestor::p[1]/following-sibling::p[1]", ".//p[1][contains(@class,'t-14') and contains(@class,'t-black')]"] ,
    location: [".//div[@class='mb1']/div[3]", ".//a[@data-view-name='search-result-lockup-title']/ancestor::p[1]/following-sibling::p[2]", ".//a[contains(@href,'/in/')]/ancestor::p[1]/following-sibling::p[2]", ".//p[contains(@class,'entity-result__secondary-subtitle')]"] ,
    currentTitle: [".//p[starts-with(normalize-space(.), 'Current:')]", ".//p[contains(normalize-space(.), 'Current:')]"] ,
    followers: [".//a[contains(translate(., 'FOLLOWERS', 'followers'),'followers')]", ".//p[contains(translate(., 'FOLLOWERS', 'followers'),'followers')]/a", ".//p[contains(translate(., 'FOLLOWERS', 'followers'),'followers')]", ".//span[contains(translate(., 'FOLLOWERS', 'followers'),'followers')]", ".//a[contains(text(),'followers')]"]
  };
  const containerXPaths = ["//ul[@role='list']/li[.//div[@class='mb1']//a]", "//div[@componentkey and .//a[@data-view-name='search-result-lockup-title']]", "//div[@componentkey and .//a[contains(@href,'/in/')]]", "//li[contains(@class,'reusable-search__result-container')][.//a[contains(@href,'/in/')]]", "//li[.//a[contains(@href,'/in/')]][contains(@class,'search')]", "//li[.//a[contains(@href,'/in/')]]"];  

  const state = { cancelled:false, seenIds:new Set(), collected:[], iterations:0, lastProgress:0, limit:0 };
  const sleep = ms=> new Promise(r=>setTimeout(r,ms));
  const hashString = str=>{ let h=0,i=0; while(i<str.length){ h=(h<<5)-h+str.charCodeAt(i++)|0; } return 'p_'+(h>>>0).toString(16); };

  function firstCandidateText(list, ctx){ for(const xp of list){ try { const v=document.evaluate(xp, ctx, null, XPathResult.STRING_TYPE, null).stringValue.trim(); if(v) return v; } catch(_){} } return ''; }
  function firstCandidateHref(list, ctx){ for(const xp of list){ try { const n=document.evaluate(xp, ctx, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue; if(n && n.href) return n.href; } catch(_){} } return ''; }
  function buildContainersFromAnchors(max=50){ const snap=document.evaluate("//a[contains(@href,'/in/')]/ancestor::li[1]", document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null); const arr=[]; const seen=new Set(); for(let i=0;i<snap.snapshotLength && arr.length<max;i++){ const li=snap.snapshotItem(i); if(li && !seen.has(li)){ seen.add(li); arr.push(li); } } return arr; }
  function findAllContainers(){ for(const xp of containerXPaths){ const snap=document.evaluate(xp, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null); if(snap.snapshotLength){ const out=[]; for(let i=0;i<snap.snapshotLength;i++) out.push(snap.snapshotItem(i)); return {nodes:out, xp, fallback:false}; } } const fallback=buildContainersFromAnchors(); if(fallback.length) return {nodes:fallback, xp:'fallback_anchor_li', fallback:true}; return {nodes:[], xp:null, fallback:false}; }

  function extractPerson(node){ const name=firstCandidateText(xpaths.name,node); const profileUrl=firstCandidateHref(xpaths.profileUrl,node); const jobTitle=firstCandidateText(xpaths.jobTitle,node); const location=firstCandidateText(xpaths.location,node); const currentTitle=firstCandidateText(xpaths.currentTitle,node); const followers=firstCandidateText(xpaths.followers,node); let status='offline'; try { const ft=(node.innerText||'').toLowerCase(); if(ft.includes('status is online')) status='online'; else if(ft.includes('status is reachable')) status='reachable'; } catch(_){}
  if(!(name||jobTitle||profileUrl||location||currentTitle)) return null; const internalId=hashString([name,profileUrl,jobTitle,location,currentTitle].join('|')); const statusObservedAt=new Date().toISOString(); const record={internalId,name,profileUrl,jobTitle,location,currentTitle,followers,status,statusObservedAt}; chrome.runtime.sendMessage({ action:'real_time_person_data', target:'people', data:{ name, profileUrl, jobTitle, location, currentTitle, followers, status, statusObservedAt } },()=>{}); return record; }

  function scrapeStatic(limit){ const {nodes,xp,fallback}=findAllContainers(); if(nodes.length===0){ console.warn('❌ No containers found during static scrape'); } else { console.log(`📦 Using container XPath: ${xp} (fallback=${fallback}) count=${nodes.length}`); } const people=[]; for(const n of nodes){ if(people.length>=limit) break; const p=extractPerson(n); if(p) people.push(p); } return people.map(({internalId,...rest})=>rest); }
  function scrapeNew(limitRemaining){ const {nodes}=findAllContainers(); const batch=[]; for(const n of nodes){ if(batch.length>=limitRemaining) break; if(n.getAttribute('data-li-scraped')==='1') continue; const p=extractPerson(n); n.setAttribute('data-li-scraped','1'); if(p){ batch.push(p); chrome.runtime.sendMessage({ action:'real_time_new_person', target:'people', person:{...p, internalId:undefined} },()=>{}); } } return batch; }

  async function autoPaginate(limit, waitMs){ state.cancelled=false; state.seenIds.clear(); state.collected=[]; state.iterations=0; state.limit=limit; const base=waitMs||1600; let emptyStreak=0; while(!state.cancelled && state.collected.length<limit){ const before=state.collected.length; const newP=scrapeNew(limit-state.collected.length); for(const p of newP){ if(!state.seenIds.has(p.internalId)){ state.seenIds.add(p.internalId); state.collected.push(p); if(state.collected.length>=limit) break; } } const gained=state.collected.length-before; emptyStreak = gained===0 ? emptyStreak+1 : 0; maybeProgress(); if(state.collected.length>=limit) break; if(emptyStreak>=5){ console.warn('🛑 Stopping after 5 empty iterations.'); break; } clickNext(); window.scrollBy({top:600, behavior:'smooth'}); await sleep(base*0.5); window.scrollTo({top:document.documentElement.scrollHeight, behavior:'smooth'}); await sleep(base*0.5); state.iterations++; }
    if(state.cancelled) chrome.runtime.sendMessage({ action:'scrape_cancelled', target:'people' },()=>{}); return state.collected.slice(0,limit).map(({internalId,...r})=>r); }

  function clickNext(){ try { const btn = document.querySelector('button.artdeco-pagination__button--next:not([disabled])') || document.querySelector('button[aria-label="Next"]:not([disabled])') || document.querySelector('button[aria-label="Next page"]:not([disabled])') || document.querySelector('button[data-testid="pagination-control-next-btn"]:not([disabled])'); if(btn){ btn.click(); return true; } } catch(_){} return false; }
  function maybeProgress(){ const now=Date.now(); if(now-state.lastProgress>700){ chrome.runtime.sendMessage({ action:'scrape_progress', target:'people', mode:'auto', count:state.collected.length, limit:state.limit, iterations:state.iterations },()=>{}); state.lastProgress=now; } }

  chrome.runtime.onMessage.addListener((req, sender, sendResponse)=>{
    try {
      if(req.target !== 'people') return; // ignore unrelated messages
      switch(req.action){
        case 'ping_people_scraper': sendResponse({ ok:true, loaded:true, people:true }); return;
        case 'scrape_people': { const data = scrapeStatic(req.limit||50); sendResponse({ ok:true, mode:'static', people:data, count:data.length }); return; }
        case 'auto_scrape_people': { const limit=req.limit||50; (async()=>{ try { const res=await autoPaginate(limit, (req.options && req.options.waitMs)||1600); sendResponse({ ok:true, mode:'auto', people:res, count:res.length, cancelled:state.cancelled }); } catch(e){ sendResponse({ ok:false, error:e.message }); } })(); return true; }
        case 'cancel_scrape_people': state.cancelled=true; sendResponse({ ok:true, cancelling:true }); return;
      }
    } catch(e){ try { sendResponse({ ok:false, error:e.message }); } catch(_){} }
    return false;
  });
})();
