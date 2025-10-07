# LinkedIn Post Collector (Chrome Extension)

Scrape LinkedIn feed posts directly from your browser and export them as JSON or CSV.

## Features
- Scrape author name, profile URL, title, post text, time, and hashtags
- Limit number of posts per scrape
- Export to JSON or CSV
- Resilient messaging with retry & dynamic content script injection fallback
- Status messages with success/error feedback

## Project Structure
```
manifest.json
src/
  content/
    scraper.js      # Content script injected into LinkedIn pages
  popup/
    popup.html      # Extension popup UI
    popup.js        # Popup logic & messaging
    popup.css       # Styling including status classes
  assets/
    post-image.png  # Icon
```

## Installation (Development)
1. Open Chrome and navigate to: chrome://extensions/
2. Enable "Developer mode" (toggle in top-right)
3. Click "Load unpacked"
4. Select this project folder
5. Open a new tab to https://www.linkedin.com/feed/
6. Click the extension icon (puzzle piece -> Pin it if desired)
7. Open the popup and click "Scrape Posts"

## Usage Tips
- Scroll the LinkedIn feed first to load more posts before scraping
- Adjust the numeric limit field to control maximum posts returned
- After a scrape, use the download buttons to export the captured data

## Troubleshooting
### Error: "Message error: Could not establish connection. Receiving end does not exist."
This means the content script did not respond.
Common causes:
1. Not on a LinkedIn page (URL must include https://www.linkedin.com/)
2. The page is a special iframe or restricted area (e.g. some internal dialogs)
3. Extension not fully reloaded after changes
4. Page not yet finished loading

What the extension does now:
- Pings the content script (`ping_scraper` action)
- If absent, attempts up to 5 retries with backoff
- Falls back to dynamic injection via `chrome.scripting.executeScript`

Fix steps:
- Reload the LinkedIn feed page (Ctrl+R)
- Open DevTools Console and confirm you see: "✅ LinkedIn Post Scraper Loaded"
- If not, reload the extension from chrome://extensions/

### Received 0 posts
- Ensure you are on the feed (https://www.linkedin.com/feed/)
- LinkedIn may have changed DOM structure; adjust selectors in `scraper.js`
- Make sure posts are visible (scroll to load more)

### CSV formatting issues
- Internal commas are quoted. If you need to import into Excel, open Excel first, then use Data > Import From Text/CSV.

## Selectors (XPaths) Used
Defined in `scraper.js`:
- authorName
- authorUrl
- authorTitle
- postContent
- postTime
- hashtags

You can improve resilience by adding fallbacks or using querySelector + heuristic parsing if LinkedIn changes markup.

## Roadmap Ideas
- Auto-scroll to load more posts
- Deduplicate by post URN
- Add timestamp + export metadata
- Configurable fields selection
- Persist history in `chrome.storage.local`

## License
Internal / Personal Use (add a LICENSE file if you intend to distribute).

## Disclaimer
Scraping may violate LinkedIn's Terms of Service. Use responsibly and only on data you are permitted to access.
