if (window.__LINKEDIN_POST_SCRAPER_LOADED__) {
  console.log("ℹ️ LinkedIn Post Scraper already initialized");
} else {
  window.__LINKEDIN_POST_SCRAPER_LOADED__ = true;
  console.log("✅ LinkedIn Post Scraper Loaded");
}

// Define all XPaths
const xpaths = {
  authorName: ".//div[contains(@class, 'update-components-actor__meta')]//span[contains(@class,'update-components-actor__title')]//span[@dir='ltr']/span[@aria-hidden='true']",
  authorUrl: ".//div[contains(@class, 'update-components-actor__meta')]//a[contains(@class,'update-components-actor__meta-link')]",
  authorTitle: ".//div[contains(@class, 'update-components-actor__meta')]//span[contains(@class,'update-components-actor__description')]",
  postContent: ".//div[contains(@class, 'update-components-text') and contains(@class, 'update-components-update-v2__commentary')]",
};

// Helper functions to extract text or href via XPath
function getText(xpath, context) {
  const result = document.evaluate(xpath, context, null, XPathResult.STRING_TYPE, null);
  return result.stringValue.trim();
}

function getHref(xpath, context) {
  const result = document.evaluate(xpath, context, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
  return result.singleNodeValue ? result.singleNodeValue.href : "";
}

// Scrape posts with optional limit
function scrapePosts(limit = Infinity) {
  const posts = [];
  const postNodes = document.querySelectorAll("div.feed-shared-update-v2");
  for (let i = 0; i < postNodes.length && posts.length < limit; i++) {
    posts.push(extractPost(postNodes[i]));
  }
  return posts;
}

// Incremental: only scrape posts not yet marked
function scrapeNewPosts(limitRemaining = Infinity) {
  const posts = [];
  const postNodes = document.querySelectorAll("div.feed-shared-update-v2:not([data-li-scraped='1'])");
  for (let i = 0; i < postNodes.length && posts.length < limitRemaining; i++) {
    const node = postNodes[i];
    const data = extractPost(node);
    node.setAttribute('data-li-scraped','1');
    posts.push(data);
  }
  return posts;
}

function extractPost(post) {
  const authorName = safe(getText, xpaths.authorName, post) || null;
  const authorUrl = safe(getHref, xpaths.authorUrl, post) || null;
  const authorTitle = safe(getText, xpaths.authorTitle, post) || null;
  const postContent = safe(getText, xpaths.postContent, post) || null;
  // Internal ID for dedupe (not returned)
  const internalId = hashString([authorName, authorUrl, postContent].join('|'));
  return { internalId, authorName, authorUrl, authorTitle, postContent };
}

function safe(fn, ...args) {
  try { return fn(...args); } catch { return null; }
}

// Auto-scroll until limit reached or user cancels
async function autoScrollAndScrape(limit = 50, options = {}) {
  const waitMs = options.waitMs || 1700;
  let iterations = 0;
  let collected = [];
  let lastProgressSent = 0;
  const seen = new Set();

  function uniquePush(items) {
    for (const p of items) {
      if (!seen.has(p.internalId)) {
        seen.add(p.internalId);
        collected.push(p);
        if (collected.length >= limit) break;
      }
    }
  }

  while (!window.__SCRAPER_CANCEL__ && collected.length < limit) {
    window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'smooth' });
    // Enhanced show more results attempt: first try XPath exact span text
    try {
      const xpathBtn = document.evaluate("//button[.//span[contains(normalize-space(.), 'Show more results')]]", document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
      if (xpathBtn && !xpathBtn.disabled) {
        xpathBtn.click();
      } else {
        const showMoreBtn = document.querySelector('button.scaffold-finite-scroll__load-button, button.artdeco-button--full');
        if (showMoreBtn && !showMoreBtn.disabled) showMoreBtn.click();
      }
    } catch {}
    // Small nudge to trigger lazy loaders
    window.scrollBy({ top: 400, behavior: 'smooth' });
    // First attempt to capture any new posts that appeared immediately
    uniquePush(scrapeNewPosts(limit - collected.length));
    await sleep(waitMs * 0.35);
    uniquePush(scrapeNewPosts(limit - collected.length));
    await sleep(waitMs * 0.65);
    uniquePush(scrapeNewPosts(limit - collected.length));
    iterations++;
    // Emit progress roughly every 800ms or when reaching limit
    const now = Date.now();
    if (now - lastProgressSent > 800 || collected.length >= limit) {
      chrome.runtime.sendMessage({
        action: 'scrape_progress',
        mode: 'auto',
        count: collected.length,
        limit,
        iterations
      }, () => {});
      lastProgressSent = now;
    }
  }
  if (window.__SCRAPER_CANCEL__) {
    chrome.runtime.sendMessage({ action: 'scrape_cancelled' }, () => {});
  }
  // Strip internalId before returning
  return collected.slice(0, limit).map(({ internalId, ...rest }) => rest);
}
function hashString(str) {
  let h = 0, i = 0, len = str.length;
  while (i < len) { h = (h << 5) - h + str.charCodeAt(i++) | 0; }
  return 'p_' + (h >>> 0).toString(16);
}

// Persistence removed per new specification

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// Listen for messages from popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  try {
    switch (request.action) {
      case 'scrape_posts': {
        const data = scrapePosts(request.limit || 100);
        sendResponse({ ok: true, mode: 'static', posts: data, count: data.length });
        return; // synchronous complete
      }
      case 'auto_scrape_posts': {
        window.__SCRAPER_CANCEL__ = false;
        const limit = request.limit || 100;
        (async () => {
          try {
            const data = await autoScrollAndScrape(limit, request.options || {});
            if (!window.__SCRAPER_CANCEL__) {
              sendResponse({ ok: true, mode: 'auto', posts: data, count: data.length });
            } else {
              // Cancellation returns partial data as a successful (ok:true) response
              sendResponse({ ok: true, mode: 'auto', cancelled: true, posts: data, count: data.length });
            }
          } catch (err) {
            console.error('Async scrape error', err);
            sendResponse({ ok: false, error: err.message });
          }
        })();
        return true; // async
      }
      case 'cancel_scrape': {
        window.__SCRAPER_CANCEL__ = true;
        sendResponse({ ok: true, cancelling: true });
        return; // done
      }
      case 'ping_scraper': {
        sendResponse({ ok: true, loaded: true });
        return;
      }
      // get_last_scrape removed
    }
  } catch (e) {
    console.error('Scrape error', e);
    try { sendResponse({ ok: false, error: e.message }); } catch {}
  }
  // If we reach here without handling, don't keep channel open
  return false;
});
