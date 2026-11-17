# BxLearn — Interactive Demo Walkthrough Studio

A minimalistic, zero-dependency Storylane-style web application for creating interactive video walkthroughs with timeline pause points, pulsing hotspots, a filesystem folder hierarchy backend, and one-click Webflow embeds.

## Quick Start

```bash
npm start
```

Open **[http://localhost:3000](http://localhost:3000)** in your browser.

## Project Structure

- [`server.js`](file:///Users/marcussaltvik/Documents/Projects/BxLearn/server.js) — Zero-dependency Node.js server that maps folders and demos directly to a real directory hierarchy inside `data/library/` and streams video files with HTTP Range (`206 Partial Content`) support.
- [`public/index.html`](file:///Users/marcussaltvik/Documents/Projects/BxLearn/public/index.html) — App layout for the Folder Library Explorer, Interactive Video Stage, Timeline Scrubber, Hotspot Inspector, and Webflow Export Modal.
- [`public/styles.css`](file:///Users/marcussaltvik/Documents/Projects/BxLearn/public/styles.css) — Brand styling (`Host Grotesk` SemiBold `#00182C` headings, `Google Sans` Regular `#324158` paragraphs, `#0076DD` primary, `#00182C` secondary, and Lucide Icons).
- [`public/app.js`](file:///Users/marcussaltvik/Documents/Projects/BxLearn/public/app.js) — Frontend state, folder tree CRUD, drag-and-drop hotspot placement, timeline pause playback engine, and Webflow code generator.

## How to Upload / Embed in Webflow

1. Create your walkthroughs and organize them into folders in **BxLearn Studio**.
2. Click **Webflow Export** in the top bar:
   - **Single Walkthrough Embed**: Paste your hosted video URL (e.g. from Webflow Assets or a CDN) and copy the self-contained HTML snippet into a Webflow **Custom Code Embed** element.
   - **Full Folder Hierarchy Hub for Webflow**: Copy the full library snippet to embed the folder sidebar + interactive player directly inside a Webflow page.
   - **Download Standalone HTML**: Download a self-contained `.html` file ready for static hosting or `<iframe>` embedding.
