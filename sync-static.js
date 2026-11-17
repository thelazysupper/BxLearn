/**
 * Syncs the public frontend and data/library demos into root-level static files
 * (index.html, styles.css, app.js, workspace-static.json, and media/)
 * so Webflow Cloud ("framework": "static") serves the full app and walkthroughs.
 */
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');
const LIBRARY_ROOT = path.join(ROOT, 'data', 'library');
const STATIC_MEDIA_ROOT = path.join(ROOT, 'media');

function syncStaticAssets() {
  // 1. Copy public frontend files to root so Webflow Cloud static builder finds root index.html
  for (const file of ['index.html', 'styles.css', 'app.js']) {
    const src = path.join(PUBLIC_DIR, file);
    const dest = path.join(ROOT, file);
    if (fs.existsSync(src)) {
      fs.copyFileSync(src, dest);
    }
  }

  // 2. Scan data/library and copy media files into ./media/<demoId>/ and build workspace-static.json
  fs.mkdirSync(STATIC_MEDIA_ROOT, { recursive: true });
  const folders = [];
  const demos = [];

  function rewriteMediaUrl(demoId, rawUrl) {
    if (!rawUrl || typeof rawUrl !== 'string') return rawUrl;
    const prefix = `/api/demos/${demoId}/media/`;
    if (rawUrl.startsWith(prefix)) {
      const cleanFile = rawUrl.slice(prefix.length).split('?')[0];
      return `./media/${demoId}/${cleanFile}`;
    }
    return rawUrl;
  }

  function walk(currentAbsDir, relativePath = '') {
    if (!fs.existsSync(currentAbsDir)) return;
    const entries = fs.readdirSync(currentAbsDir, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      if (entry.name.startsWith('.demo-')) {
        const demoBundleDir = path.join(currentAbsDir, entry.name);
        const demoJsonPath = path.join(demoBundleDir, 'demo.json');
        if (fs.existsSync(demoJsonPath)) {
          try {
            const demo = JSON.parse(fs.readFileSync(demoJsonPath, 'utf8'));
            demo.folderPath = relativePath;

            // Copy any media files in this demo bundle to ./media/<demo.id>/
            const targetMediaDir = path.join(STATIC_MEDIA_ROOT, demo.id);
            fs.mkdirSync(targetMediaDir, { recursive: true });
            for (const f of fs.readdirSync(demoBundleDir)) {
              if (f === 'demo.json' || f.startsWith('.')) continue;
              fs.copyFileSync(path.join(demoBundleDir, f), path.join(targetMediaDir, f));
            }

            // Rewrite media URLs to relative ./media/<demo.id>/<file> for static hosting
            const staticDemo = {
              ...demo,
              videoUrl: rewriteMediaUrl(demo.id, demo.videoUrl),
              steps: Array.isArray(demo.steps)
                ? demo.steps.map(s => ({
                    ...s,
                    imageUrl: rewriteMediaUrl(demo.id, s.imageUrl)
                  }))
                : []
            };
            demos.push(staticDemo);
          } catch (e) {}
        }
        continue;
      }

      if (entry.name.startsWith('.')) continue;

      const childRelPath = relativePath ? `${relativePath}/${entry.name}` : entry.name;
      const childAbsDir = path.join(currentAbsDir, entry.name);
      const stat = fs.statSync(childAbsDir);
      folders.push({
        path: childRelPath,
        name: entry.name,
        parentPath: relativePath,
        createdAt: stat.birthtime.toISOString()
      });
      walk(childAbsDir, childRelPath);
    }
  }

  walk(LIBRARY_ROOT, '');
  folders.sort((a, b) => a.path.localeCompare(b.path));
  demos.sort((a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0));

  const payload = JSON.stringify({ folders, demos }, null, 2);
  fs.writeFileSync(path.join(ROOT, 'workspace-static.json'), payload, 'utf8');
  fs.writeFileSync(path.join(PUBLIC_DIR, 'workspace-static.json'), payload, 'utf8');
}

if (require.main === module) {
  syncStaticAssets();
  console.log('Synced static Webflow Cloud files (index.html, styles.css, app.js, workspace-static.json, media/).');
}

module.exports = { syncStaticAssets };
