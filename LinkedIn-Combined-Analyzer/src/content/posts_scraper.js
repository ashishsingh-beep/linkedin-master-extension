// Combined Extension - Posts Scraper (sourced from original Post Analyzer)
// Namespaced ping action: ping_posts_scraper

(function(){
  if (window.__LINKEDIN_POST_SCRAPER_LOADED__) {
    console.log("ℹ️ LinkedIn Post Scraper already initialized");
    return;
  }
  window.__LINKEDIN_POST_SCRAPER_LOADED__ = true;
  console.log("✅ LinkedIn Post Scraper Loaded (Combined)");

  const xpaths = {
    authorName: ".//div[contains(@class, 'update-components-actor__meta')]//span[contains(@class,'update-components-actor__title')]//span[@dir='ltr']/span[@aria-hidden='true']",
    authorUrl: ".//div[contains(@class, 'update-components-actor__meta')]//a[contains(@class,'update-components-actor__meta-link')]",
    authorTitle: ".//div[contains(@class, 'update-components-actor__meta')]//span[contains(@class,'update-components-actor__description')]",
    postContent: ".//div[contains(@class, 'update-components-text') and contains(@class, 'update-components-update-v2__commentary')]",
  };

  function getText(xpath, context) { const r = document.evaluate(xpath, context, null, XPathResult.STRING_TYPE, null); return r.stringValue.trim(); }
  function getHref(xpath, context) { const r = document.evaluate(xpath, context, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null); return r.singleNodeValue ? r.singleNodeValue.href : ""; }
  function safe(fn, ...args){ try { return fn(...args); } catch { return null; } }
  function hashString(str){ let h=0,i=0; while(i<str.length){ h=(h<<5)-h+str.charCodeAt(i++)|0; } return 'p_'+(h>>>0).toString(16); }
  function sleep(ms){ return new Promise(r=>setTimeout(r,ms)); }

  function extractPost(node){
    const authorName = safe(getText, xpaths.authorName, node) || null;
    const authorUrl = safe(getHref, xpaths.authorUrl, node) || null;
    const authorTitle = safe(getText, xpaths.authorTitle, node) || null;
    const postContent = safe(getText, xpaths.postContent, node) || null;
    const internalId = hashString([authorName, authorUrl, postContent].join('|'));
    return { internalId, authorName, authorUrl, authorTitle, postContent };
  }

  function scrapePosts(limit=Infinity){
    const posts=[]; const nodes=document.querySelectorAll('div.feed-shared-update-v2');
    for(let i=0;i<nodes.length && posts.length<limit;i++){ posts.push(extractPost(nodes[i])); }
    return posts;
  }
  function scrapeNewPosts(limitRemaining=Infinity){
    const posts=[]; const nodes=document.querySelectorAll("div.feed-shared-update-v2:not([data-li-scraped='1'])");
    for(let i=0;i<nodes.length && posts.length<limitRemaining;i++){ const n=nodes[i]; const d=extractPost(n); n.setAttribute('data-li-scraped','1'); posts.push(d); }
    return posts;
  }

  async function autoScrollAndScrape(limit=50, options={}){
    const waitMs = options.waitMs || 1700;
    let iterations=0; let collected=[]; let lastProgress=0; const seen=new Set();
    function uniquePush(items){ for(const p of items){ if(!seen.has(p.internalId)){ seen.add(p.internalId); collected.push(p); if(collected.length>=limit) break; } } }
    while(!window.__POST_SCRAPER_CANCEL__ && collected.length<limit){
      window.scrollTo({top:document.documentElement.scrollHeight, behavior:'smooth'});
      try {
        const xpathBtn = document.evaluate("//button[.//span[contains(normalize-space(.), 'Show more results')]]", document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
        if (xpathBtn && !xpathBtn.disabled) xpathBtn.click(); else {
          const showMoreBtn = document.querySelector('button.scaffold-finite-scroll__load-button, button.artdeco-button--full');
          if(showMoreBtn && !showMoreBtn.disabled) showMoreBtn.click();
        }
      } catch {}
      window.scrollBy({ top: 400, behavior: 'smooth' });
      uniquePush(scrapeNewPosts(limit-collected.length));
      await sleep(waitMs*0.35); uniquePush(scrapeNewPosts(limit-collected.length));
      await sleep(waitMs*0.65); uniquePush(scrapeNewPosts(limit-collected.length));
      iterations++;
      const now = Date.now();
      if(now-lastProgress>800 || collected.length>=limit){
        chrome.runtime.sendMessage({ action:'scrape_progress', target:'posts', mode:'auto', count:collected.length, limit, iterations },()=>{});
        lastProgress=now;
      }
    }
    if(window.__POST_SCRAPER_CANCEL__) chrome.runtime.sendMessage({ action:'scrape_cancelled', target:'posts' },()=>{});
    return collected.slice(0,limit).map(({internalId,...rest})=>rest);
  }

  chrome.runtime.onMessage.addListener((req, sender, sendResponse)=>{
    try {
      if(req.target !== 'posts') return; // ignore messages not for this scraper
      switch(req.action){
        case 'ping_posts_scraper':
          sendResponse({ ok:true, loaded:true }); return;
        case 'scrape_posts': {
          const data = scrapePosts(req.limit || 100);
          sendResponse({ ok:true, mode:'static', posts:data, count:data.length }); return;
        }
        case 'auto_scrape_posts': {
          window.__POST_SCRAPER_CANCEL__ = false; const limit = req.limit || 100;
          (async()=>{
            try { const data = await autoScrollAndScrape(limit, req.options||{}); if(!window.__POST_SCRAPER_CANCEL__){ sendResponse({ ok:true, mode:'auto', posts:data, count:data.length }); } else { sendResponse({ ok:true, mode:'auto', cancelled:true, posts:data, count:data.length }); } } catch(e){ sendResponse({ ok:false, error:e.message }); }
          })();
          return true;
        }
        case 'cancel_scrape_posts': {
          window.__POST_SCRAPER_CANCEL__ = true; sendResponse({ ok:true, cancelling:true }); return;
        }
      }
    } catch(e){ try { sendResponse({ ok:false, error:e.message }); } catch(_){} }
    return false;
  });
})();
