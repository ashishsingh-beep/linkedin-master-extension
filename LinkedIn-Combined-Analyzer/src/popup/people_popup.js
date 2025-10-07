// Adapted People popup logic for combined extension (namespaced messages)
const scrapeBtn = document.getElementById('scrapeBtn');
const downloadJSONBtn = document.getElementById('downloadJSONBtn');
const downloadCSVBtn = document.getElementById('downloadCSVBtn');
const peopleDiv = document.getElementById('people');
const peopleLimitInput = document.getElementById('peopleLimit');
const modeRadios = Array.from(document.querySelectorAll('input[name="mode"]'));
const stopBtn = document.getElementById('stopBtn');
const progressFill = document.getElementById('progressFill');
const progressText = document.getElementById('progressText');
const backBtn = document.getElementById('backBtn');
let scrapingActive = false; let scrapedPeople = [];
const quickSearchInput = document.getElementById('liQuickSearch');
const quickSearchBtn = document.getElementById('liQuickSearchBtn');

backBtn.addEventListener('click', ()=>{ window.location.href = 'popup.html'; });

if(quickSearchInput && quickSearchBtn){
  function updateSearchBtn(){ quickSearchBtn.disabled = quickSearchInput.value.trim().length===0; }
  quickSearchInput.addEventListener('input', updateSearchBtn);
  quickSearchInput.addEventListener('keydown', e=>{ if(e.key==='Enter' && !quickSearchBtn.disabled) quickSearchBtn.click(); });
  quickSearchBtn.addEventListener('click', ()=>{ const q=quickSearchInput.value.trim(); if(!q) return; const url=`https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(q)}`; chrome.tabs.query({active:true,currentWindow:true}, tabs=>{ if(tabs && tabs[0] && /linkedin\.com/.test(tabs[0].url||'')){ chrome.tabs.update(tabs[0].id,{url}); } else { chrome.tabs.create({url}); } }); });
  updateSearchBtn();
}

function setStatus(msg, type='info'){ peopleDiv.innerHTML = `<div class="status status-${type}">${msg}</div>`; }
function enableDownloadButtons(on){ downloadJSONBtn.disabled = !on; downloadCSVBtn.disabled = !on; }
function setScrapingState(active){ scrapingActive = active; scrapeBtn.disabled = active; stopBtn.disabled = !active; }

chrome.runtime.onMessage.addListener(msg => {
  if(msg.target !== 'people') return;
  if(msg.action==='scrape_progress'){
    const pct = msg.limit? Math.min(100, Math.round((msg.count/msg.limit)*100)) : 0;
    progressFill.style.width = pct + '%';
    progressText.textContent = `Progress: ${msg.count}/${msg.limit} (${pct}%) Iter:${msg.iterations}`;
  } else if(msg.action==='scrape_cancelled'){
    progressText.textContent += ' (Cancelled)';
  } else if(msg.action==='real_time_person_data'){
    // Optionally stream person info; leaving quiet.
  }
});

enableDownloadButtons(false);

scrapeBtn.addEventListener('click', ()=>{
  if(scrapingActive) return;
  const limit = parseInt(peopleLimitInput.value)||10;
  setStatus(`Scraping up to ${limit} people...`, 'loading');
  enableDownloadButtons(false); setScrapingState(true);
  chrome.tabs.query({active:true,currentWindow:true}, tabs => {
    if(!tabs||!tabs.length){ setStatus('No active tab.','error'); setScrapingState(false); return; }
    const tabId = tabs[0].id;
    function tryInject(){ return new Promise(r=>{ if(!chrome.scripting) return r(); chrome.scripting.executeScript({target:{tabId}, files:['src/content/people_scraper.js']}, ()=>r()); }); }
    function ping(attempt=1){
      chrome.tabs.sendMessage(tabId,{action:'ping_people_scraper', target:'people'}, resp => {
        if(resp && resp.ok){ startScrape(); return; }
        if(attempt===1){ tryInject().then(()=> setTimeout(()=> ping(attempt+1), 300)); return; }
        if(attempt>=5){ setStatus(`Failed to initialize people content script after ${attempt} attempts.`,'error'); setScrapingState(false); return; }
        setStatus(`Retrying... (attempt ${attempt+1})`,'loading');
        setTimeout(()=> ping(attempt+1), 400*attempt);
      });
    }
    function startScrape(){
      const limit = parseInt(peopleLimitInput.value)||10;
      let selectedMode = modeRadios.find(r=>r.checked)?.value || 'static';
      let action = selectedMode==='paginate' ? 'auto_scrape_people' : 'scrape_people';
      progressFill.style.width='0%'; progressText.textContent='Starting...';
      chrome.tabs.sendMessage(tabId,{action, target:'people', limit, options:{ waitMs:1600 }}, (resp)=>{
        if(chrome.runtime.lastError){ setStatus(`Error: ${chrome.runtime.lastError.message}`,'error'); setScrapingState(false); return; }
        if(!resp){ setStatus('No response from content script','error'); setScrapingState(false); return; }
        if(!resp.ok && !resp.cancelled){ setStatus(`Scrape failed: ${resp.error||'Unknown'}`,'error'); setScrapingState(false); return; }
  const fieldsOrder=['name','profileUrl','jobTitle','location','currentTitle','followers','status','statusObservedAt'];
        scrapedPeople = (resp.people||[]).map(p=>{ const o={};
          fieldsOrder.forEach(f=> { o[f]= p && (p[f]!==undefined)? p[f]:''; });
          if(!o.statusObservedAt){ o.statusObservedAt = new Date().toISOString(); }
          try {
            o.statusObservedHuman = new Date(o.statusObservedAt).toLocaleString(undefined, {
              year:'numeric', month:'short', day:'2-digit', hour:'2-digit', minute:'2-digit', second:'2-digit'
            });
          } catch(_) { o.statusObservedHuman = o.statusObservedAt; }
          return o; });
        const modeLabel = resp.mode==='auto' ? ' (auto)' : '';
        if(resp.cancelled) setStatus(`Scrape cancelled${modeLabel}. Collected ${resp.count} people (partial).`,'info'); else setStatus(`Scrape complete${modeLabel}. Collected ${resp.count} people.`,'success');
        peopleDiv.innerHTML += `<pre>${JSON.stringify(scrapedPeople,null,2)}</pre>`;
        enableDownloadButtons(scrapedPeople.length>0);
        progressText.textContent += resp.cancelled ? ' Cancelled.' : ' Finished.';
        setScrapingState(false);
      });
    }
    ping();
  });
});

stopBtn.addEventListener('click', ()=>{ if(!scrapingActive || stopBtn.disabled) return; stopBtn.disabled=true; chrome.tabs.query({active:true,currentWindow:true}, tabs=>{ if(!tabs||!tabs.length) return; chrome.tabs.sendMessage(tabs[0].id,{action:'cancel_scrape_people', target:'people'}, ()=>{ setStatus('Cancellation requested...','loading'); }); }); });

downloadJSONBtn.addEventListener('click', ()=>{ if(!scrapedPeople.length) return alert('No data yet'); const blob=new Blob([JSON.stringify(scrapedPeople,null,2)],{type:'application/json'}); const url=URL.createObjectURL(blob); const a=document.createElement('a'); a.href=url; a.download=`linkedin_people_${Date.now()}.json`; a.click(); URL.revokeObjectURL(url); });

downloadCSVBtn.addEventListener('click', ()=>{ if(!scrapedPeople.length) return alert('No data yet'); const headers=Object.keys(scrapedPeople[0]); const esc=v=> (''+v).replace(/"/g,'""'); const rows=[ headers.join(','), ...scrapedPeople.map(r=> headers.map(h=>`"${esc(r[h])}"`).join(',')) ]; const blob=new Blob([rows.join('\n')],{type:'text/csv'}); const url=URL.createObjectURL(blob); const a=document.createElement('a'); a.href=url; a.download=`linkedin_people_${Date.now()}.csv`; a.click(); URL.revokeObjectURL(url); });

chrome.tabs.query({active:true,currentWindow:true}, tabs => { if(tabs && tabs[0] && tabs[0].url){ const u=tabs[0].url; if(!/linkedin\.com/.test(u)) setStatus('Open LinkedIn people search page to begin','info'); else if(!/\/search\/results\/people\//.test(u)) setStatus('Navigate to LinkedIn People Search results','info'); else setStatus('Ready to scrape people','info'); } setScrapingState(false); });
