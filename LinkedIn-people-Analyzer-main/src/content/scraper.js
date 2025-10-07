// LinkedIn People Scraper (single file) - now aligned to provided simplified XPaths
// Features: static scrape, auto paginate (Next button), real-time progress, cancellation
// Output fields: name, profileUrl, jobTitle (bio), location, currentTitle, followers, status
// Mapping note: user provided 'bio' XPath -> stored in existing 'jobTitle' field to avoid downstream schema changes.

(function () {
  if (window.__LINKEDIN_PEOPLE_SCRAPER__) {
    console.log('ℹ️ People scraper already initialized');
    return;
  }
  window.__LINKEDIN_PEOPLE_SCRAPER__ = true;
  console.log('✅ LinkedIn People Scraper Loaded');

  const DEBUG_VERBOSE = false; // toggle for deep per-field logging

  // Updated XPaths now align to user-provided simplified structure under //ul[@role='list']/li results.
  // Provided mappings:
  // 1. name + url: (name visible span) //ul[@role="list"]/li//div[@class='mb1']//a//span[@aria-hidden="true"]  (text -> name) & anchor href -> profileUrl
  // 2. location:    //ul[@role="list"]/li//div[@class='mb1']/div[3]
  // 3. bio (mapped here to jobTitle): //ul[@role="list"]/li//div[@class='mb1']/div[2]
  // We keep support for legacy fallbacks after the primary provided XPaths.
  const xpaths = {
    name: [
      ".//div[@class='mb1']//a//span[@aria-hidden='true']", // provided new visible name span
      ".//div[@class='mb1']//a", // fallback (anchor text)
      ".//a[contains(@href,'/in/')][@data-view-name][1]",
      ".//a[@data-view-name='search-result-lockup-title'][1]",
      ".//a[contains(@href,'/in/')][1]" // legacy fallback
    ],
    profileUrl: [
      ".//div[@class='mb1']//a", // same anchor as name
      ".//a[contains(@href,'/in/')][@data-view-name][1]",
      ".//a[@data-view-name='search-result-lockup-title'][1]",
      ".//a[contains(@href,'/in/')][1]"
    ],
    jobTitle: [ // bio mapped to jobTitle
      ".//div[@class='mb1']/div[2]",
      ".//a[@data-view-name='search-result-lockup-title']/ancestor::p[1]/following-sibling::p[1]",
      ".//a[contains(@href,'/in/')]/ancestor::p[1]/following-sibling::p[1]",
      ".//p[1][contains(@class,'t-14') and contains(@class,'t-black')]" // legacy
    ],
    location: [
      ".//div[@class='mb1']/div[3]",
      ".//a[@data-view-name='search-result-lockup-title']/ancestor::p[1]/following-sibling::p[2]",
      ".//a[contains(@href,'/in/')]/ancestor::p[1]/following-sibling::p[2]",
      ".//p[contains(@class,'entity-result__secondary-subtitle')]" // legacy possible
    ],
    currentTitle: [
      ".//p[starts-with(normalize-space(.), 'Current:')]",
      ".//p[contains(normalize-space(.), 'Current:')]",
      ".//p[contains(@class,'entity-result__summary--2-lines')]" // legacy
    ],
    followers: [
      ".//a[contains(translate(., 'FOLLOWERS', 'followers'),'followers')]",
      ".//p[contains(translate(., 'FOLLOWERS', 'followers'),'followers')]/a",
      ".//p[contains(translate(., 'FOLLOWERS', 'followers'),'followers')]",
      ".//span[contains(translate(., 'FOLLOWERS', 'followers'),'followers')]",
      ".//a[contains(text(),'followers')]",
      ".//span[contains(text(),'followers')]"
    ],
    // status computed from container text: contains 'Status is online' -> online, contains 'Status is reachable' -> reachable, else offline
  };

  // State
  const state = {
    cancelled: false,
    seenIds: new Set(),
    collected: [],
    iterations: 0,
    lastProgress: 0,
    limit: 0
  };

  // Utilities
  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
  function hashString(str) { let h = 0, i = 0; while (i < str.length) { h = (h << 5) - h + str.charCodeAt(i++) | 0; } return 'p_' + (h >>> 0).toString(16); }
  function getText(xpath, context) {
    const res = document.evaluate(xpath, context, null, XPathResult.STRING_TYPE, null);
    return (res.stringValue || '').trim();
  }
  function getHref(xpath, context) {
    const res = document.evaluate(xpath, context, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
    return res.singleNodeValue ? res.singleNodeValue.href : '';
  }
  function safe(fn, ...args) { try { return fn(...args); } catch (e) { if (DEBUG_VERBOSE) console.warn('safe error', e); return null; } }

  // Container discovery (XPath-first). Updated for new DOM where results may be top-level <div componentkey="uuid"> blocks.
  const containerXPaths = [
    "//ul[@role='list']/li[.//div[@class='mb1']//a]", // primary provided container pattern
    "//div[@componentkey and .//a[@data-view-name='search-result-lockup-title']]",
    "//div[@componentkey and .//a[contains(@href,'/in/')]]",
    // legacy <li>-based containers:
    "//li[contains(@class,'reusable-search__result-container')][.//a[contains(@href,'/in/')]]",
    "//li[.//a[contains(@href,'/in/')]][contains(@class,'search')]",
    "//li[.//a[contains(@href,'/in/')]]"
  ];

  // Fallback: build synthetic containers from anchors if primary detection fails
  function buildContainersFromAnchors(max = 50) {
    const snap = document.evaluate("//a[contains(@href,'/in/')]/ancestor::li[1]", document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
    const arr = []; const seen = new Set();
    for (let i = 0; i < snap.snapshotLength && arr.length < max; i++) {
      const li = snap.snapshotItem(i);
      if (li && !seen.has(li)) { seen.add(li); arr.push(li); }
    }
    return arr;
  }

  function findAllContainers() {
    for (const xp of containerXPaths) {
      const snap = document.evaluate(xp, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
      if (snap.snapshotLength) {
        const arr = []; for (let i = 0; i < snap.snapshotLength; i++) arr.push(snap.snapshotItem(i));
        if (DEBUG_VERBOSE) console.log('Containers via', xp, arr.length);
        return { nodes: arr, xp, fallback: false };
      }
    }
    // fallback
    const anchors = buildContainersFromAnchors();
    if (anchors.length) {
      console.warn('⚠️ Using anchor-based fallback container detection. Count:', anchors.length);
      return { nodes: anchors, xp: 'fallback_anchor_li', fallback: true };
    }
    return { nodes: [], xp: null, fallback: false };
  }

  function countXPath(xpath) {
    try {
      const snap = document.evaluate(xpath, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
      return snap.snapshotLength;
    } catch (e) { return -1; }
  }

  function firstCandidateText(candidates, context) {
    if (!Array.isArray(candidates)) return '';
    for (const xp of candidates) {
      try {
        const res = document.evaluate(xp, context, null, XPathResult.STRING_TYPE, null).stringValue.trim();
        if (res) return res;
      } catch (_) { }
    }
    return '';
  }

  function firstCandidateHref(candidates, context) {
    if (!Array.isArray(candidates)) return '';
    for (const xp of candidates) {
      try {
        const res = document.evaluate(xp, context, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
        if (res && res.href) return res.href;
      } catch (_) { }
    }
    return '';
  }

  function globalFieldDiagnostics() {
    const diag = {};
    const map = {
      name: xpaths.name,
      jobTitle: xpaths.jobTitle,
      location: xpaths.location,
      currentTitle: xpaths.currentTitle,
      followers: xpaths.followers
    };
    for (const key of Object.keys(map)) {
      // use first candidate converted to global // form if it begins with .//
      const first = map[key][0] || '';
      let globalXp = first.startsWith('.//') ? first.replace('.//', '//') : first;
      // Strip predicates that rely on relative context if likely invalid globally
      try { diag[key + "Candidates"] = map[key].length; } catch (_) { }
      diag[key + "GlobalCount"] = countXPath(globalXp);
    }
    diag.profileAnchors = countXPath("//a[@data-view-name='search-result-lockup-title']");
    diag.componentKeyDivs = countXPath("//div[@componentkey]");
    return diag;
  }

  async function waitForPeopleDom(timeoutMs = 8000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const anchorCount = document.evaluate("//a[contains(@href,'/in/')]", document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null).snapshotLength;
      if (anchorCount > 2) return true;
      await sleep(250);
    }
    return false;
  }

  function extractPerson(node) {
    const name = firstCandidateText(xpaths.name, node);
    const profileUrl = firstCandidateHref(xpaths.profileUrl, node);
    const jobTitle = firstCandidateText(xpaths.jobTitle, node);
    const location = firstCandidateText(xpaths.location, node);
    const currentTitle = firstCandidateText(xpaths.currentTitle, node);
    const followers = firstCandidateText(xpaths.followers, node);
    // Derive status from raw text once (lowercased for robustness)
    let status = 'offline';
    try {
      const fullText = (node.innerText || '').toLowerCase();
      if (fullText.includes('status is online')) status = 'online';
      else if (fullText.includes('status is reachable')) status = 'reachable';
    } catch (_) { /* ignore */ }
    if (!(name || jobTitle || profileUrl || location || currentTitle)) return null;
    const internalId = hashString([name, profileUrl, jobTitle, location, currentTitle].join('|'));
    // Capture the exact ISO timestamp when this status snapshot was taken.
    const statusObservedAt = new Date().toISOString();
    const record = { internalId, name, profileUrl, jobTitle, location, currentTitle, followers, status, statusObservedAt };
    chrome.runtime.sendMessage({ action: 'real_time_person_data', data: { name, profileUrl, jobTitle, location, currentTitle, followers, status, statusObservedAt } }, () => { });
    return record;
  }

  function scrapeStatic(limit) {
    const { nodes, xp, fallback } = findAllContainers();
    if (nodes.length === 0) {
      console.warn('❌ No containers found during static scrape');
      console.table(globalFieldDiagnostics());
    } else {
      console.log(`📦 Using container XPath: ${xp} (fallback=${fallback}) count=${nodes.length}`);
    }
    const people = [];
    for (const n of nodes) {
      if (people.length >= limit) break;
      const p = extractPerson(n);
      if (p) { people.push(p); }
    }
    return people.map(({ internalId, ...rest }) => rest);
  }

  function scrapeNew(limitRemaining) {
    const { nodes } = findAllContainers();
    const batch = [];
    for (const n of nodes) {
      if (batch.length >= limitRemaining) break;
      if (n.getAttribute('data-li-scraped') === '1') continue;
      const p = extractPerson(n);
      n.setAttribute('data-li-scraped', '1');
      if (p) { batch.push(p); chrome.runtime.sendMessage({ action: 'real_time_new_person', person: { ...p, internalId: undefined } }, () => { }); }
    }
    return batch;
  }

  async function autoPaginate(limit, waitMs) {
    state.cancelled = false;
    state.seenIds.clear();
    state.collected = [];
    state.iterations = 0;
    state.limit = limit;
    const baseWait = waitMs || 1600;
    let emptyStreak = 0;

    while (!state.cancelled && state.collected.length < limit) {
      const before = state.collected.length;
      const newPeople = scrapeNew(limit - state.collected.length);
      for (const p of newPeople) {
        if (!state.seenIds.has(p.internalId)) {
          state.seenIds.add(p.internalId);
          state.collected.push(p);
          if (state.collected.length >= limit) break;
        }
      }
      const gained = state.collected.length - before;
      emptyStreak = gained === 0 ? emptyStreak + 1 : 0;
      maybeProgress();
      if (state.collected.length >= limit) break;
      if (emptyStreak >= 5) {
        console.warn('🛑 Stopping after 5 empty iterations. Diagnostics:');
        console.table(globalFieldDiagnostics());
        break;
      }
      // Attempt to click Next
      clickNext();
      // Scroll stimulation
      window.scrollBy({ top: 600, behavior: 'smooth' });
      await sleep(baseWait * 0.5);
      window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'smooth' });
      await sleep(baseWait * 0.5);
      state.iterations++;
    }
    if (state.cancelled) chrome.runtime.sendMessage({ action: 'scrape_cancelled' }, () => { });
    return state.collected.slice(0, limit).map(({ internalId, ...r }) => r);
  }

  function clickNext() {
    try {
      const nextBtn = document.querySelector('button.artdeco-pagination__button--next:not([disabled])')
        || document.querySelector('button[aria-label="Next"]:not([disabled])')
        || document.querySelector('button[aria-label="Next page"]:not([disabled])')
        || document.querySelector('button[data-testid="pagination-control-next-btn"]:not([disabled])');
      if (nextBtn) { nextBtn.click(); return true; }
    } catch (e) { }
    return false;
  }

  function maybeProgress() {
    const now = Date.now();
    if (now - state.lastProgress > 700) {
      chrome.runtime.sendMessage({ action: 'scrape_progress', mode: 'auto', count: state.collected.length, limit: state.limit, iterations: state.iterations }, () => { });
      state.lastProgress = now;
    }
  }

  function pageInfo() {
    const { nodes, xp } = findAllContainers();
    return { url: window.location.href, containerXPathUsed: xp, containerCount: nodes.length };
  }


  // Messaging API
  chrome.runtime.onMessage.addListener((req, sender, sendResponse) => {
    try {
      switch (req.action) {
        case 'ping_scraper':
          sendResponse({ ok: true, loaded: true, people: true });
          return false;
    
        case 'get_page_info':
          sendResponse({ ok: true, info: pageInfo() });
          return false;
        case 'scrape_people': {
          (async () => { await waitForPeopleDom(); })();
          const data = scrapeStatic(req.limit || 50);
          sendResponse({ ok: true, mode: 'static', people: data, count: data.length });
          return false;
        }
        case 'auto_scrape_people': {
          const limit = req.limit || 50;
          (async () => {
            try {
              const result = await autoPaginate(limit, (req.options && req.options.waitMs) || 1600);
              sendResponse({ ok: true, mode: 'auto', people: result, count: result.length, cancelled: state.cancelled });
            } catch (e) { sendResponse({ ok: false, error: e.message }); }
          })();
          return true; // async
        }
        case 'cancel_scrape':
          state.cancelled = true;
          sendResponse({ ok: true, cancelling: true });
          return false;
        default:
          sendResponse({ ok: false, error: 'Unknown action' });
          return false;
      }
    } catch (e) {
      try { sendResponse({ ok: false, error: e.message }); } catch (_) { }
      return false;
    }
  });
})();
