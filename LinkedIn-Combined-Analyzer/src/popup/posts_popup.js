// Adapted Posts popup logic for combined extension (namespaced messages)
const scrapeBtn = document.getElementById("scrapeBtn");
const downloadJSONBtn = document.getElementById("downloadJSONBtn");
const downloadCSVBtn = document.getElementById("downloadCSVBtn");
const postsDiv = document.getElementById("posts");
const postLimitInput = document.getElementById("postLimit");
let autoScrollToggle = document.getElementById("autoScrollToggle");
const stopBtn = document.getElementById("stopBtn");
const progressFill = document.getElementById("progressFill");
const progressText = document.getElementById("progressText");
const backBtn = document.getElementById('backBtn');
const searchInput = document.getElementById('searchInput');
const searchBtn = document.getElementById('searchBtn');
let scrapingActive = false;
let scrapedPosts = [];

backBtn.addEventListener('click', ()=>{ window.location.href = 'popup.html'; });

function setStatus(message, type = "info") { postsDiv.innerHTML = `<div class="status status-${type}">${message}</div>`; }
function enableDownloadButtons(enabled){ downloadJSONBtn.disabled = !enabled; downloadCSVBtn.disabled = !enabled; }
function setScrapingState(active){ scrapingActive = active; scrapeBtn.disabled = active; stopBtn.disabled = !active; if(!active){ progressFill.style.transition='width 0.25s linear'; } }

chrome.runtime.onMessage.addListener(msg => {
  if(msg.target !== 'posts') return; // ignore people messages
  if (msg.action === 'scrape_progress') {
    const pct = msg.limit ? Math.min(100, Math.round((msg.count / msg.limit) * 100)) : 0;
    progressFill.style.width = pct + '%';
    progressText.textContent = `Progress: ${msg.count}/${msg.limit} (${pct}%) Iter:${msg.iterations}`;
  } else if (msg.action === 'scrape_cancelled') {
    progressText.textContent += ' (Cancelled)';
  }
});

enableDownloadButtons(false);

scrapeBtn.addEventListener('click', ()=>{
  if(scrapingActive) return;
  const limit = parseInt(postLimitInput.value)||10;
  setStatus(`Scraping up to ${limit} posts...`, 'loading');
  enableDownloadButtons(false); setScrapingState(true);
  chrome.tabs.query({active:true,currentWindow:true}, tabs => {
    if(!tabs||!tabs.length){ setStatus('Could not find the active tab.','error'); setScrapingState(false); return; }
    const tabId = tabs[0].id;

    function tryInject(){ return new Promise(r=>{ if(!chrome.scripting) return r(); chrome.scripting.executeScript({target:{tabId}, files:['src/content/posts_scraper.js']}, ()=>r()); }); }
    function ping(attempt=1){
      chrome.tabs.sendMessage(tabId,{action:'ping_posts_scraper', target:'posts'}, resp => {
        if(resp && resp.ok){ start(); return; }
        if(attempt===1){ tryInject().then(()=> setTimeout(()=> ping(attempt+1), 120)); return; }
        if(attempt>=5){ setStatus(`Failed to initialize post content script after ${attempt} attempts.`,'error'); setScrapingState(false); return; }
        setStatus(`Retrying... (attempt ${attempt+1})`,'loading');
        setTimeout(()=> ping(attempt+1), 250*attempt);
      });
    }

    function start(){
      const useAuto = autoScrollToggle && autoScrollToggle.checked;
      const action = useAuto ? 'auto_scrape_posts' : 'scrape_posts';
      progressFill.style.width='0%'; progressText.textContent='Starting...';
      chrome.tabs.sendMessage(tabId,{ action, target:'posts', limit, options:{ waitMs:1400 }}, response => {
        if(chrome.runtime.lastError){ setStatus(`Message error: ${chrome.runtime.lastError.message}`,'error'); setScrapingState(false); return; }
        if(!response){ setStatus('No response from content script.','error'); setScrapingState(false); return; }
        if(!response.ok && !response.cancelled){ setStatus(`Scrape failed: ${response.error||'Unknown error'}`,'error'); setScrapingState(false); return; }
        scrapedPosts = response.posts || [];
        const modeLabel = response.mode==='auto' ? ' (auto-scroll)' : '';
        if(response.cancelled) setStatus(`Scrape cancelled${modeLabel}. Collected ${response.count} posts (partial).`,'info'); else setStatus(`Scrape complete${modeLabel}. Collected ${response.count} posts.`,'success');
        postsDiv.innerHTML += `<pre>${JSON.stringify(scrapedPosts,null,2)}</pre>`;
        enableDownloadButtons(scrapedPosts.length>0);
        progressText.textContent += response.cancelled ? ' Cancelled.' : ' Finished.';
        setScrapingState(false);
      });
    }

    ping();
  });
});

stopBtn.addEventListener('click', ()=>{
  if(!scrapingActive || stopBtn.disabled) return;
  stopBtn.disabled = true;
  chrome.tabs.query({active:true,currentWindow:true}, tabs => { if(!tabs||!tabs.length) return; chrome.tabs.sendMessage(tabs[0].id,{action:'cancel_scrape_posts', target:'posts'}, ()=>{ progressText.textContent += ' (Stopping...)'; setStatus('Cancellation requested...','loading'); }); });
});

downloadJSONBtn.addEventListener('click', ()=>{ if(!scrapedPosts.length) return alert('No posts scraped yet!'); const blob=new Blob([JSON.stringify(scrapedPosts,null,2)],{type:'application/json'}); const url=URL.createObjectURL(blob); const a=document.createElement('a'); a.href=url; a.download='linkedin_posts.json'; a.click(); URL.revokeObjectURL(url); });

downloadCSVBtn.addEventListener('click', ()=>{ if(!scrapedPosts.length) return alert('No posts scraped yet!'); const headers=Object.keys(scrapedPosts[0]); const rows=[ headers.join(','), ...scrapedPosts.map(p=> headers.map(h=>`"${(Array.isArray(p[h])? p[h].join(' | ') : p[h]||'').replace(/"/g,'""')}"`).join(',')) ]; const blob=new Blob([rows.join('\n')],{type:'text/csv'}); const url=URL.createObjectURL(blob); const a=document.createElement('a'); a.href=url; a.download='linkedin_posts.csv'; a.click(); URL.revokeObjectURL(url); });

chrome.tabs.query({active:true,currentWindow:true}, tabs => { if(tabs && tabs[0] && tabs[0].url && !/https:\/\/www\.linkedin\.com\//.test(tabs[0].url)){ setStatus('Open a LinkedIn feed page before scraping.','info'); } setScrapingState(false); });

if(searchInput && searchBtn){
  searchInput.addEventListener('input', ()=>{ const v=searchInput.value.trim(); searchBtn.disabled = v.length===0; });
  searchBtn.addEventListener('click', ()=>{ const keywords = searchInput.value.trim(); if(!keywords) return; const targetUrl = `https://www.linkedin.com/search/results/content/?keywords=${encodeURIComponent(keywords)}`; chrome.tabs.query({active:true,currentWindow:true}, tabs=>{ const activeTab = tabs && tabs[0]; if(activeTab && /https:\/\/www\.linkedin\.com\//.test(activeTab.url||'')){ chrome.tabs.update(activeTab.id,{url:targetUrl}); } else { chrome.tabs.create({url:targetUrl}); } }); });
}
