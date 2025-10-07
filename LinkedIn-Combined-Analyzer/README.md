# LinkedIn Data Collector (Combined Extension)

Unified Chrome (MV3) extension that lets you collect either:
- LinkedIn Feed Posts
- LinkedIn People Search Results

## Features
Posts:
- Static or auto-scroll collection
- Fields: authorName, authorUrl, authorTitle, postContent

People:
- Static (current page) or auto paginate via Next button
- Fields: name, profileUrl, jobTitle (bio), location, currentTitle, followers, status (derived), statusObservedAt (ISO timestamp), statusObservedHuman (localized readable time)

Shared:
- Progress bar + iteration tracking
- Cancellation support
- Retry + dynamic content script injection if initial ping fails
- Export JSON / CSV
- Quick navigation helpers (search content / people)

## Project Structure
```
manifest.json
src/
  content/
    posts_scraper.js
    people_scraper.js
  popup/
    popup.html          # Main menu (choose Posts or People)
    popup.js
    root.css
    posts_popup.html    # Posts UI
    posts_popup.js
    posts_popup.css
    people_popup.html   # People UI
    people_popup.js
    people_popup.css
  assets/
    logo.png (add your logo)
```

## Installation (Development)
1. Chrome -> chrome://extensions
2. Enable Developer Mode
3. Load unpacked -> select this `LinkedIn-Combined-Analyzer` folder
4. Pin the extension (optional)
5. Open a LinkedIn tab (feed or people search)
6. Click extension icon -> choose Collect Posts or Collect People

## Usage Notes
- For more results: scroll/feed load first (posts) or use auto-scroll / paginate modes.
- People pagination attempts: scroll stimulation + Next button discovery.
- Cancellation returns partial data with status.

## Permissions
- scripting: dynamic injection fallback
- activeTab: interact with current LinkedIn tab
- storage: reserved for future persistence
- downloads: enable file export naming (JSON/CSV)

## Extending
Potential enhancements:
- Add background service worker for history persistence
- Merge duplicated utility code (hashing, progress) into shared module via build step
- Add hashtags/time extraction for posts
- Add tests with JSDOM snapshots

## Disclaimer
Scraping may violate LinkedIn Terms of Service. Use responsibly.

## License
Internal / Personal Use.
