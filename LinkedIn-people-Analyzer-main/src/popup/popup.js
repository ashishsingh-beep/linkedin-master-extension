// PEOPLE MODE POPUP
const scrapeBtn = document.getElementById('scrapeBtn');
const downloadJSONBtn = document.getElementById('downloadJSONBtn');
const downloadCSVBtn = document.getElementById('downloadCSVBtn');
const peopleDiv = document.getElementById('people');
const peopleLimitInput = document.getElementById('peopleLimit');
const modeRadios = Array.from(document.querySelectorAll('input[name="mode"]'));
const stopBtn = document.getElementById('stopBtn');
const progressFill = document.getElementById('progressFill');
const progressText = document.getElementById('progressText');
let scrapingActive = false;
let scrapedPeople = [];

// Quick search elements
const quickSearchInput = document.getElementById('liQuickSearch');
const quickSearchBtn = document.getElementById('liQuickSearchBtn');

if(quickSearchInput && quickSearchBtn){
  function updateSearchBtn(){
    const hasValue = quickSearchInput.value.trim().length>0;
    quickSearchBtn.disabled = !hasValue;
  }
  quickSearchInput.addEventListener('input', updateSearchBtn);
  quickSearchInput.addEventListener('keydown', e=>{ if(e.key==='Enter' && !quickSearchBtn.disabled){ quickSearchBtn.click(); }});
  quickSearchBtn.addEventListener('click', ()=>{
    const q = quickSearchInput.value.trim();
    if(!q) return; // safety
    const url = `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(q)}`;
    // Open in current active tab if it's LinkedIn, else new tab
    chrome.tabs.query({active:true,currentWindow:true}, tabs => {
      if(tabs && tabs[0] && /linkedin\.com/.test(tabs[0].url||'')){
        chrome.tabs.update(tabs[0].id, {url});
      } else {
        chrome.tabs.create({url});
      }
    });
  });
  updateSearchBtn();
}

function setStatus(msg, type='info') {
  peopleDiv.innerHTML = `<div class="status status-${type}">${msg}</div>`;
}
function enableDownloadButtons(on){ downloadJSONBtn.disabled = !on; downloadCSVBtn.disabled = !on; }
function setScrapingState(active){ scrapingActive = active; scrapeBtn.disabled = active; stopBtn.disabled = !active; }

// Robust messaging with timeout
function sendMessageSafely(tabId, message, cb, timeoutMs=10000){
  let done=false; const to=setTimeout(()=>{ if(!done){done=true; cb && cb(null,{message:'timeout'});} },timeoutMs);
  chrome.tabs.sendMessage(tabId, message, resp=>{
    if(done) return; done=true; clearTimeout(to);
    if(chrome.runtime.lastError) return cb && cb(null, chrome.runtime.lastError);
    cb && cb(resp,null);
  });
}

// Listen for real-time events
chrome.runtime.onMessage.addListener(msg => {
  if(msg.action==='scrape_progress'){
    const pct = msg.limit? Math.min(100, Math.round((msg.count/msg.limit)*100)) : 0;
    progressFill.style.width = pct + '%';
    progressText.textContent = `Progress: ${msg.count}/${msg.limit} (${pct}%) Iter:${msg.iterations}`;
  } else if(msg.action==='scrape_cancelled'){
    progressText.textContent += ' (Cancelled)';
  } else if(msg.action==='real_time_person_data') {
    // Could live preview; keeping console for now
    console.debug('Person realtime:', msg.data);
  } else if(msg.action==='real_time_new_person') {
    // light indication
    progressText.textContent = `Found: ${msg.newCount} (iterating...)`;
  }
});

enableDownloadButtons(false);

scrapeBtn.addEventListener('click', () => {
  if(scrapingActive) return;
  const limit = parseInt(peopleLimitInput.value)||10;
  setStatus(`Scraping up to ${limit} people...`, 'loading');
  enableDownloadButtons(false);
  setScrapingState(true);
  chrome.tabs.query({active:true,currentWindow:true}, tabs => {
    if(!tabs||!tabs.length){ setStatus('No active tab.', 'error'); setScrapingState(false); return; }
    const tabId = tabs[0].id;
    function tryInject(){
      return new Promise(resolve=>{
        if(!chrome.scripting) return resolve();
        chrome.scripting.executeScript({target:{tabId}, files:['src/content/scraper.js']}, ()=>resolve());
      });
    }
    function ping(attempt=1){
      sendMessageSafely(tabId,{action:'ping_scraper'}, (resp,err)=>{
        if(err || !resp || !resp.ok){
          if(attempt===1){
            tryInject().then(()=> setTimeout(()=> ping(attempt+1),300));
            return;
          }
          if(attempt>=5){ setStatus(`Failed to initialize content script after ${attempt} attempts. Refresh page and retry.`, 'error'); setScrapingState(false); return; }
          setStatus(`Retrying... (attempt ${attempt+1})`,'loading');
          return setTimeout(()=> ping(attempt+1), 400*attempt);
        }
        startScrape();
      });
    }
    function startScrape(){
  let selectedMode = modeRadios.find(r=>r.checked)?.value || 'static';
  let action = 'scrape_people';
  if(selectedMode==='paginate') action='auto_scrape_people';
      progressFill.style.width='0%';
      progressText.textContent='Starting...';
      sendMessageSafely(tabId,{action,limit,options:{waitMs:1600}}, (resp,err)=>{
        if(err){ setStatus(`Error: ${err.message}`,'error'); setScrapingState(false); return; }
        if(!resp){ setStatus('No response from content script','error'); setScrapingState(false); return; }
        if(!resp.ok && !resp.cancelled){ setStatus(`Scrape failed: ${resp.error||'Unknown'}`,'error'); setScrapingState(false); return; }
  const fieldsOrder=['name','profileUrl','jobTitle','location','currentTitle','followers','status'];
        scrapedPeople = (resp.people||[]).map(p=>{ const o={}; fieldsOrder.forEach(f=> o[f]= p && (p[f]!==undefined)? p[f]:'' ); return o; });
        const modeLabel = resp.mode==='auto' ? ' (auto)' : '';
        if(resp.cancelled) setStatus(`Scrape cancelled${modeLabel}. Collected ${resp.count} people (partial).`,'info');
        else setStatus(`Scrape complete${modeLabel}. Collected ${resp.count} people.`,'success');
        peopleDiv.innerHTML += `<pre>${JSON.stringify(scrapedPeople,null,2)}</pre>`;
        enableDownloadButtons(scrapedPeople.length>0);
        progressText.textContent += resp.cancelled ? ' Cancelled.' : ' Finished.';
        // Downloads now only triggered by explicit user clicks (removed autoDownload per new spec)
        setScrapingState(false);
      }, action==='auto_scrape_people'?60000:30000);
    }
    ping();
  });
});

stopBtn.addEventListener('click', ()=>{
  if(!scrapingActive || stopBtn.disabled) return;
  stopBtn.disabled = true;
  chrome.tabs.query({active:true,currentWindow:true}, tabs => {
    if(!tabs||!tabs.length) return;
    sendMessageSafely(tabs[0].id,{action:'cancel_scrape'},()=>{ setStatus('Cancellation requested...','loading'); });
  });
});

downloadJSONBtn.addEventListener('click', ()=>{
  if(!scrapedPeople.length) return alert('No data yet');
  triggerJSON(scrapedPeople);
});
downloadCSVBtn.addEventListener('click', ()=>{
  if(!scrapedPeople.length) return alert('No data yet');
  triggerCSV(scrapedPeople);
});

function triggerJSON(data){
  const blob = new Blob([JSON.stringify(data,null,2)], {type:'application/json'});
  const url = URL.createObjectURL(blob); const a=document.createElement('a');
  a.href=url; a.download=`linkedin_people_${Date.now()}.json`; a.click(); URL.revokeObjectURL(url);
}
function triggerCSV(data){
  const headers = Object.keys(data[0]);
  const esc=v=> (''+v).replace(/"/g,'""');
  const rows = [headers.join(','), ...data.map(r=> headers.map(h=>`"${esc(r[h])}"`).join(','))];
  const blob = new Blob([rows.join('\n')], {type:'text/csv'});
  const url = URL.createObjectURL(blob); const a=document.createElement('a');
  a.href=url; a.download=`linkedin_people_${Date.now()}.csv`; a.click(); URL.revokeObjectURL(url);
}
// autoDownload removed per specification (user must click)

// Initial status based on active tab URL
chrome.tabs.query({active:true,currentWindow:true}, tabs => {
  if(tabs && tabs[0] && tabs[0].url){
    const u = tabs[0].url;
    if(!/linkedin\.com/.test(u)) setStatus('Open LinkedIn people search page to begin','info');
    else if(!/\/search\/results\/people\//.test(u)) setStatus('Navigate to LinkedIn People Search results','info');
    else setStatus('Ready to scrape people','info');
  }
  setScrapingState(false);
});
