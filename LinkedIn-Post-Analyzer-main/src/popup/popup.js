const scrapeBtn = document.getElementById("scrapeBtn");
const downloadJSONBtn = document.getElementById("downloadJSONBtn");
const downloadCSVBtn = document.getElementById("downloadCSVBtn");
const postsDiv = document.getElementById("posts");
const postLimitInput = document.getElementById("postLimit");
let autoScrollToggle = document.getElementById("autoScrollToggle");
const stopBtn = document.getElementById("stopBtn");
const progressFill = document.getElementById("progressFill");
const progressText = document.getElementById("progressText");
// Search bar elements
const searchInput = document.getElementById('searchInput');
const searchBtn = document.getElementById('searchBtn');
// Track active scraping state
let scrapingActive = false;

function setStatus(message, type = "info") {
  postsDiv.innerHTML = `<div class="status status-${type}">${message}</div>`;
}

function enableDownloadButtons(enabled) {
  downloadJSONBtn.disabled = !enabled;
  downloadCSVBtn.disabled = !enabled;
}

function setScrapingState(active) {
  scrapingActive = active;
  scrapeBtn.disabled = active;
  stopBtn.disabled = !active;
  if (!active) {
    progressFill.style.transition = 'width 0.25s linear';
  }
}
// Listen for progress events from content script
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.action === 'scrape_progress') {
    const pct = msg.limit ? Math.min(100, Math.round((msg.count / msg.limit) * 100)) : 0;
    progressFill.style.width = pct + '%';
    progressText.textContent = `Progress: ${msg.count}/${msg.limit} (${pct}%) Iter:${msg.iterations}`;
  } else if (msg.action === 'scrape_cancelled') {
    progressText.textContent += ' (Cancelled)';
  }
});


enableDownloadButtons(false);

let scrapedPosts = [];

// Scrape posts by sending a message to content script
scrapeBtn.addEventListener("click", () => {
  if (scrapingActive) return; // prevent double start
  const limit = parseInt(postLimitInput.value) || 10;
  setStatus(`Scraping up to ${limit} posts...`, "loading");
  enableDownloadButtons(false);
  setScrapingState(true);

  chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
    if (!tabs || !tabs.length) {
      setStatus("Could not find the active tab.", "error");
      return;
    }

    const tabId = tabs[0].id;

    function pingContentScript(attempt = 1) {
      chrome.tabs.sendMessage(tabId, { action: "ping_scraper" }, resp => {
        if (resp && resp.ok) {
          sendScrape();
          return;
        }
        // immediate injection after first failure instead of waiting until attempt>2
        if (attempt === 1) {
          tryInject().then(() => setTimeout(() => pingContentScript(attempt + 1), 120));
          return;
        }
        if (attempt >= 5) {
          setStatus(`Failed to initialize content script after ${attempt} attempts.`, "error");
          return;
        }
        setStatus(`Retrying to connect... (attempt ${attempt + 1})`, 'loading');
        setTimeout(() => pingContentScript(attempt + 1), 250 * attempt);
      });
    }

    function tryInject() {
      return new Promise(resolve => {
        if (!chrome.scripting) return resolve();
        chrome.scripting.executeScript({ target: { tabId }, files: ["src/content/scraper.js"] }, () => resolve());
      });
    }

    function sendScrape() {
      const useAuto = autoScrollToggle && autoScrollToggle.checked;
      const action = useAuto ? "auto_scrape_posts" : "scrape_posts";
      if (useAuto) {
        setStatus(`Auto-scrolling & scraping up to ${limit} posts...`, "loading");
      }
      // Hard-coded defaults now (advanced options removed)
      progressFill.style.width = '0%';
      progressText.textContent = 'Starting...';
      chrome.tabs.sendMessage(tabId, { action, limit, options: { waitMs: 1400 } }, response => {
        if (chrome.runtime.lastError) {
          setStatus(`Message error: ${chrome.runtime.lastError.message}`, "error");
          setScrapingState(false);
          return;
        }
        if (!response) {
          setStatus("No response from content script.", "error");
          setScrapingState(false);
          return;
        }
        if (!response.ok && !response.cancelled) {
          setStatus(`Scrape failed: ${response.error || 'Unknown error'}`, "error");
          setScrapingState(false);
          return;
        }
        scrapedPosts = response.posts || [];
        const modeLabel = response.mode === 'auto' ? ' (auto-scroll)' : '';
        if (response.cancelled) {
          setStatus(`Scrape cancelled${modeLabel}. Collected ${response.count} posts (partial).`, 'info');
        } else {
          setStatus(`Scrape complete${modeLabel}. Collected ${response.count} posts.`, "success");
        }
        postsDiv.innerHTML += `<pre>${JSON.stringify(scrapedPosts, null, 2)}</pre>`;
        enableDownloadButtons(scrapedPosts.length > 0);
        progressText.textContent += response.cancelled ? ' Cancelled.' : ' Finished.';
        setScrapingState(false);
      });
    }

    pingContentScript();
  });
});

// Download JSON
downloadJSONBtn.addEventListener("click", () => {
  if (!scrapedPosts.length) return alert("No posts scraped yet!");
  const blob = new Blob([JSON.stringify(scrapedPosts, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "linkedin_posts.json";
  a.click();
  URL.revokeObjectURL(url);
});

// Download CSV
downloadCSVBtn.addEventListener("click", () => {
  if (!scrapedPosts.length) return alert("No posts scraped yet!");

  const headers = Object.keys(scrapedPosts[0]);
  const csvRows = [
    headers.join(","), // header row
    ...scrapedPosts.map(post => 
      headers.map(h => `"${(Array.isArray(post[h]) ? post[h].join(" | ") : post[h] || "")}"`).join(",")
    )
  ];

  const blob = new Blob([csvRows.join("\n")], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "linkedin_posts.csv";
  a.click();
  URL.revokeObjectURL(url);
});

// Stop button handler (moved outside CSV handler)
stopBtn.addEventListener('click', () => {
  if (!scrapingActive || stopBtn.disabled) return; // ignore if not active
  stopBtn.disabled = true;
  chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
    if (!tabs || !tabs.length) return;
    chrome.tabs.sendMessage(tabs[0].id, { action: 'cancel_scrape' }, () => {
      progressText.textContent += ' (Stopping...)';
      setStatus('Cancellation requested...', 'loading');
    });
  });
});

// Guard: if not on LinkedIn, show hint before scraping
chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
  if (tabs && tabs[0] && tabs[0].url && !/https:\/\/www\.linkedin\.com\//.test(tabs[0].url)) {
    setStatus('Open a LinkedIn feed page before scraping.', 'info');
  }
  // Initialize buttons
  setScrapingState(false);
});

// --- Search Feature Logic ---
if (searchInput && searchBtn) {
  // Enable/disable button based on trimmed value
  searchInput.addEventListener('input', () => {
    const val = searchInput.value.trim();
    searchBtn.disabled = val.length === 0;
  });

  searchBtn.addEventListener('click', () => {
    const keywords = searchInput.value.trim();
    if (!keywords) return; // Should already be disabled, guard anyway
    const encoded = encodeURIComponent(keywords);
    const targetUrl = `https://www.linkedin.com/search/results/content/?keywords=${encoded}`;

    // Reuse existing active tab if it's already a LinkedIn domain, else open new tab
    chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
      const activeTab = tabs && tabs[0];
      if (activeTab && /https:\/\/www\.linkedin\.com\//.test(activeTab.url || '')) {
        chrome.tabs.update(activeTab.id, { url: targetUrl });
      } else {
        chrome.tabs.create({ url: targetUrl });
      }
    });
  });
}
