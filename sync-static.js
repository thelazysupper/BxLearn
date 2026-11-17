import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');
const LIBRARY_ROOT = path.join(ROOT, 'data', 'library');
const PUBLIC_MEDIA_ROOT = path.join(PUBLIC_DIR, 'media');

export function syncStaticAssets() {
  // Remove legacy root-level static files so Astro serves from src/pages and public/ cleanly
  for (const legacy of ['index.html', 'styles.css', 'app.js', 'workspace-static.json', 'media']) {
    const p = path.join(ROOT, legacy);
    if (fs.existsSync(p)) {
      fs.rmSync(p, { recursive: true, force: true });
    }
  }
  // Remove public/index.html if present so it doesn't collide with src/pages/index.astro
  const pubIndex = path.join(PUBLIC_DIR, 'index.html');
  if (fs.existsSync(pubIndex)) {
    fs.rmSync(pubIndex, { force: true });
  }

  fs.mkdirSync(PUBLIC_MEDIA_ROOT, { recursive: true });
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

            const targetMediaDir = path.join(PUBLIC_MEDIA_ROOT, demo.id);
            fs.mkdirSync(targetMediaDir, { recursive: true });
            for (const f of fs.readdirSync(demoBundleDir)) {
              if (f === 'demo.json' || f.startsWith('.')) continue;
              fs.copyFileSync(path.join(demoBundleDir, f), path.join(targetMediaDir, f));
            }

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
  fs.writeFileSync(path.join(PUBLIC_DIR, 'workspace-static.json'), payload, 'utf8');
}

syncStaticAssets();
console.log('Synced Astro public assets (public/workspace-static.json, public/media/).');
