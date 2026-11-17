const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { URL } = require('node:url');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const LIBRARY_ROOT = path.join(__dirname, 'data', 'library');

// Ensure library root exists
fs.mkdirSync(LIBRARY_ROOT, { recursive: true });

// MIME types for static files & video streaming
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/mp4',
  '.m4v': 'video/mp4',
  '.ogg': 'video/ogg'
};

/**
 * Sanitize a relative folder path (e.g. "Product Tours/Onboarding")
 * Prevents directory traversal outside LIBRARY_ROOT.
 */
function sanitizeFolderPath(relPath = '') {
  const cleaned = String(relPath || '')
    .replace(/\\/g, '/')
    .split('/')
    .map(segment => segment.trim().replace(/[<>:"|?*\x00-\x1F]/g, ''))
    .filter(segment => segment && segment !== '.' && segment !== '..' && !segment.startsWith('.demo-'))
    .join('/');
  const resolved = path.resolve(LIBRARY_ROOT, cleaned);
  if (!resolved.startsWith(LIBRARY_ROOT)) {
    throw new Error('Invalid folder path');
  }
  return { cleaned, resolved };
}

/**
 * Seed initial folder structure and a sample demo if library is empty
 */
function seedInitialDataIfEmpty() {
  const entries = fs.readdirSync(LIBRARY_ROOT);
  if (entries.length > 0) return;

  const sampleFolders = [
    'Getting Started',
    'Getting Started/Onboarding Flows',
    'Product Features',
    'Product Features/Analytics & Reporting',
    'Webflow Embeds'
  ];

  for (const folder of sampleFolders) {
    const { resolved } = sanitizeFolderPath(folder);
    fs.mkdirSync(resolved, { recursive: true });
  }

  // Create a starter demo inside "Getting Started/Onboarding Flows"
  const demoId = 'demo-welcome-tour';
  const folderPath = 'Getting Started/Onboarding Flows';
  const demoDir = path.join(LIBRARY_ROOT, folderPath, `.${demoId}`);
  fs.mkdirSync(demoDir, { recursive: true });

  const sampleDemo = {
    id: demoId,
    title: 'Workspace Overview & Quick Start',
    description: 'Interactive walkthrough showing new users how to navigate the dashboard, configure pipelines, and publish their first project.',
    folderPath,
    videoUrl: '',
    videoFileName: '',
    useSampleCanvasVideo: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    settings: {
      primaryColor: '#0076DD',
      secondaryColor: '#00182C',
      autoplayFirstSegment: true,
      showStepBar: true,
      loopDemo: false
    },
    steps: [
      {
        id: 'step-1',
        timestamp: 0.8,
        title: 'Welcome to BxLearn Analytics',
        body: 'Click the pulsing hotspot on "New Workspace" to create your first project container.',
        x: 24,
        y: 34,
        style: 'beacon',
        placement: 'right',
        buttonText: 'Next step',
        advanceOnHotspotClick: true,
        ctaUrl: ''
      },
      {
        id: 'step-2',
        timestamp: 3.2,
        title: 'Inspect Live Conversion Metrics',
        body: 'Track real-time engagement across your embedded walkthroughs and filter by campaign.',
        x: 58,
        y: 48,
        style: 'beacon',
        placement: 'bottom',
        buttonText: 'Continue',
        advanceOnHotspotClick: true,
        ctaUrl: ''
      },
      {
        id: 'step-3',
        timestamp: 5.8,
        title: 'Publish Directly to Webflow',
        body: 'When you are ready, click Publish in the top-right corner to copy your Webflow custom code snippet.',
        x: 84,
        y: 16,
        style: 'beacon',
        placement: 'left',
        buttonText: 'Finish Tour',
        advanceOnHotspotClick: true,
        ctaUrl: ''
      }
    ]
  };

  fs.writeFileSync(path.join(demoDir, 'demo.json'), JSON.stringify(sampleDemo, null, 2), 'utf8');
}

seedInitialDataIfEmpty();

/**
 * Recursively scan LIBRARY_ROOT to build the folder tree and demos list
 * Directly reflects the filesystem directory hierarchy.
 */
function scanLibrary() {
  const folders = [];
  const demos = [];

  function walk(currentAbsDir, relativePath = '') {
    const entries = fs.readdirSync(currentAbsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      // Demo bundle directory starts with ".demo-"
      if (entry.name.startsWith('.demo-')) {
        const demoJsonPath = path.join(currentAbsDir, entry.name, 'demo.json');
        if (fs.existsSync(demoJsonPath)) {
          try {
            const raw = fs.readFileSync(demoJsonPath, 'utf8');
            const demo = JSON.parse(raw);
            demo.folderPath = relativePath;
            demos.push(demo);
          } catch (err) {
            console.error('Failed reading demo.json:', demoJsonPath, err.message);
          }
        }
        continue;
      }

      // Skip hidden system folders
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

  return { folders, demos };
}

/**
 * Locate a demo directory by its ID across the folder hierarchy
 */
function findDemoLocation(demoId) {
  let found = null;

  function search(currentAbsDir, relativePath = '') {
    if (found) return;
    const entries = fs.readdirSync(currentAbsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (entry.name === `.${demoId}`) {
        const demoDir = path.join(currentAbsDir, entry.name);
        const demoJsonPath = path.join(demoDir, 'demo.json');
        if (fs.existsSync(demoJsonPath)) {
          found = {
            demoDir,
            demoJsonPath,
            folderPath: relativePath,
            demo: JSON.parse(fs.readFileSync(demoJsonPath, 'utf8'))
          };
          return;
        }
      } else if (!entry.name.startsWith('.')) {
        const nextRel = relativePath ? `${relativePath}/${entry.name}` : entry.name;
        search(path.join(currentAbsDir, entry.name), nextRel);
      }
    }
  }

  search(LIBRARY_ROOT, '');
  return found;
}

/**
 * Read JSON request body
 */
function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => {
      try {
        const str = Buffer.concat(chunks).toString('utf8');
        resolve(str ? JSON.parse(str) : {});
      } catch (e) {
        reject(new Error('Invalid JSON payload'));
      }
    });
    req.on('error', reject);
  });
}

/**
 * Send JSON response
 */
function sendJson(res, statusCode, data) {
  const payload = JSON.stringify(data);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-File-Name'
  });
  res.end(payload);
}

/**
 * Stream video or static file with HTTP Range support
 */
function serveFileWithRange(req, res, filePath) {
  if (!fs.existsSync(filePath)) {
    res.writeHead(404);
    res.end('Not found');
    return;
  }

  const stat = fs.statSync(filePath);
  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';
  const range = req.headers.range;

  if (range) {
    const parts = range.replace(/bytes=/, '').split('-');
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : stat.size - 1;

    if (start >= stat.size || end >= stat.size) {
      res.writeHead(416, { 'Content-Range': `bytes */${stat.size}` });
      res.end();
      return;
    }

    const chunkSize = end - start + 1;
    const stream = fs.createReadStream(filePath, { start, end });
    res.writeHead(206, {
      'Content-Range': `bytes ${start}-${end}/${stat.size}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': chunkSize,
      'Content-Type': contentType,
      'Access-Control-Allow-Origin': '*'
    });
    stream.pipe(res);
  } else {
    res.writeHead(200, {
      'Content-Length': stat.size,
      'Content-Type': contentType,
      'Accept-Ranges': 'bytes',
      'Access-Control-Allow-Origin': '*'
    });
    fs.createReadStream(filePath).pipe(res);
  }
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, X-File-Name'
      });
      res.end();
      return;
    }

    const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const pathname = decodeURIComponent(parsedUrl.pathname);

    // 1. GET /api/workspace -> Returns full folder hierarchy & all demos
    if (req.method === 'GET' && pathname === '/api/workspace') {
      const data = scanLibrary();
      return sendJson(res, 200, data);
    }

    // 2. POST /api/folders -> Create a folder in the filesystem hierarchy
    if (req.method === 'POST' && pathname === '/api/folders') {
      const body = await readJsonBody(req);
      const { path: folderPath } = body;
      const { cleaned, resolved } = sanitizeFolderPath(folderPath);
      if (!cleaned) {
        return sendJson(res, 400, { error: 'Folder name is required' });
      }
      fs.mkdirSync(resolved, { recursive: true });
      return sendJson(res, 201, { path: cleaned, workspace: scanLibrary() });
    }

    // 3. PUT /api/folders -> Rename or move a folder on disk
    if (req.method === 'PUT' && pathname === '/api/folders') {
      const body = await readJsonBody(req);
      const oldTarget = sanitizeFolderPath(body.oldPath);
      const newTarget = sanitizeFolderPath(body.newPath);

      if (!oldTarget.cleaned || !newTarget.cleaned) {
        return sendJson(res, 400, { error: 'Both oldPath and newPath are required' });
      }
      if (!fs.existsSync(oldTarget.resolved)) {
        return sendJson(res, 404, { error: 'Source folder not found' });
      }
      if (fs.existsSync(newTarget.resolved)) {
        return sendJson(res, 409, { error: 'A folder with that name already exists' });
      }

      fs.mkdirSync(path.dirname(newTarget.resolved), { recursive: true });
      fs.renameSync(oldTarget.resolved, newTarget.resolved);
      return sendJson(res, 200, { path: newTarget.cleaned, workspace: scanLibrary() });
    }

    // 4. DELETE /api/folders -> Delete a folder (and optionally move demos to root or delete)
    if (req.method === 'DELETE' && pathname === '/api/folders') {
      const folderPath = parsedUrl.searchParams.get('path') || '';
      const { cleaned, resolved } = sanitizeFolderPath(folderPath);
      if (!cleaned || !fs.existsSync(resolved)) {
        return sendJson(res, 404, { error: 'Folder not found' });
      }

      // Move any contained demos up to the parent folder before removing the directory
      const parentRel = cleaned.includes('/') ? cleaned.slice(0, cleaned.lastIndexOf('/')) : '';
      const parentAbs = sanitizeFolderPath(parentRel).resolved;

      const { demos } = scanLibrary();
      for (const demo of demos) {
        if (demo.folderPath === cleaned || demo.folderPath.startsWith(`${cleaned}/`)) {
          const loc = findDemoLocation(demo.id);
          if (loc) {
            const targetDir = path.join(parentAbs, `.${demo.id}`);
            fs.renameSync(loc.demoDir, targetDir);
            loc.demo.folderPath = parentRel;
            fs.writeFileSync(path.join(targetDir, 'demo.json'), JSON.stringify(loc.demo, null, 2), 'utf8');
          }
        }
      }

      fs.rmSync(resolved, { recursive: true, force: true });
      return sendJson(res, 200, { workspace: scanLibrary() });
    }

    // 5. POST /api/demos -> Create a new demo inside a folder
    if (req.method === 'POST' && pathname === '/api/demos') {
      const body = await readJsonBody(req);
      const demoId = `demo-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
      const { cleaned: folderPath, resolved: folderAbs } = sanitizeFolderPath(body.folderPath || '');
      fs.mkdirSync(folderAbs, { recursive: true });

      const demoDir = path.join(folderAbs, `.${demoId}`);
      fs.mkdirSync(demoDir, { recursive: true });

      const newDemo = {
        id: demoId,
        title: (body.title || 'Untitled Walkthrough').trim(),
        description: (body.description || '').trim(),
        folderPath,
        deviceMockup: body.deviceMockup === 'laptop' ? 'laptop' : 'handterminal',
        videoUrl: body.videoUrl || '',
        videoFileName: body.videoFileName || '',
        useSampleCanvasVideo: Boolean(body.useSampleCanvasVideo),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        settings: body.settings || {
          primaryColor: '#0076DD',
          secondaryColor: '#00182C',
          autoplayFirstSegment: true,
          showStepBar: true,
          loopDemo: false
        },
        steps: Array.isArray(body.steps) ? body.steps : []
      };

      fs.writeFileSync(path.join(demoDir, 'demo.json'), JSON.stringify(newDemo, null, 2), 'utf8');
      return sendJson(res, 201, { demo: newDemo, workspace: scanLibrary() });
    }

    // 6. PUT /api/demos/:id -> Update demo metadata, steps, hotspots, or move folder
    const demoMatch = pathname.match(/^\/api\/demos\/([^/]+)$/);
    if (req.method === 'PUT' && demoMatch) {
      const demoId = demoMatch[1];
      const loc = findDemoLocation(demoId);
      if (!loc) {
        return sendJson(res, 404, { error: 'Demo not found' });
      }

      const body = await readJsonBody(req);
      let targetDemoDir = loc.demoDir;
      let targetFolderPath = loc.folderPath;

      // If folderPath changed, physically move the demo directory in the filesystem hierarchy
      if (typeof body.folderPath === 'string') {
        const { cleaned: newFolderRel, resolved: newFolderAbs } = sanitizeFolderPath(body.folderPath);
        if (newFolderRel !== loc.folderPath) {
          fs.mkdirSync(newFolderAbs, { recursive: true });
          const nextDemoDir = path.join(newFolderAbs, `.${demoId}`);
          fs.renameSync(loc.demoDir, nextDemoDir);
          targetDemoDir = nextDemoDir;
          targetFolderPath = newFolderRel;
        }
      }

      const updatedDemo = {
        ...loc.demo,
        ...body,
        id: demoId,
        folderPath: targetFolderPath,
        updatedAt: new Date().toISOString()
      };

      fs.writeFileSync(path.join(targetDemoDir, 'demo.json'), JSON.stringify(updatedDemo, null, 2), 'utf8');
      return sendJson(res, 200, { demo: updatedDemo, workspace: scanLibrary() });
    }

    // 7. DELETE /api/demos/:id -> Remove demo directory from disk
    if (req.method === 'DELETE' && demoMatch) {
      const demoId = demoMatch[1];
      const loc = findDemoLocation(demoId);
      if (!loc) {
        return sendJson(res, 404, { error: 'Demo not found' });
      }
      fs.rmSync(loc.demoDir, { recursive: true, force: true });
      return sendJson(res, 200, { workspace: scanLibrary() });
    }

    // 8. POST /api/demos/:id/video -> Upload raw video binary directly into the demo's folder
    const videoUploadMatch = pathname.match(/^\/api\/demos\/([^/]+)\/video$/);
    if (req.method === 'POST' && videoUploadMatch) {
      const demoId = videoUploadMatch[1];
      const loc = findDemoLocation(demoId);
      if (!loc) {
        return sendJson(res, 404, { error: 'Demo not found' });
      }

      const rawFileName = decodeURIComponent(req.headers['x-file-name'] || 'video.mp4');
      const ext = path.extname(rawFileName).toLowerCase() || '.mp4';
      const safeVideoFile = `video${ext}`;
      const videoAbsPath = path.join(loc.demoDir, safeVideoFile);

      // Remove any previous video.* files in the demo folder
      for (const existing of fs.readdirSync(loc.demoDir)) {
        if (existing.startsWith('video.')) {
          fs.rmSync(path.join(loc.demoDir, existing), { force: true });
        }
      }

      await new Promise((resolve, reject) => {
        const writeStream = fs.createWriteStream(videoAbsPath);
        req.pipe(writeStream);
        writeStream.on('finish', resolve);
        writeStream.on('error', reject);
        req.on('error', reject);
      });

      const videoUrl = `/api/demos/${demoId}/media/${safeVideoFile}?t=${Date.now()}`;
      const updatedDemo = {
        ...loc.demo,
        videoUrl,
        videoFileName: rawFileName,
        useSampleCanvasVideo: false,
        updatedAt: new Date().toISOString()
      };

      fs.writeFileSync(loc.demoJsonPath, JSON.stringify(updatedDemo, null, 2), 'utf8');
      return sendJson(res, 200, { demo: updatedDemo, workspace: scanLibrary() });
    }

    // 8b. POST /api/demos/:id/screenshot -> Upload a screenshot image (PNG/JPG/WebP) into the demo's folder
    const screenshotUploadMatch = pathname.match(/^\/api\/demos\/([^/]+)\/screenshot$/);
    if (req.method === 'POST' && screenshotUploadMatch) {
      const demoId = screenshotUploadMatch[1];
      const loc = findDemoLocation(demoId);
      if (!loc) {
        return sendJson(res, 404, { error: 'Demo not found' });
      }

      const rawFileName = decodeURIComponent(req.headers['x-file-name'] || 'screenshot.png');
      const rawExt = path.extname(rawFileName).toLowerCase();
      const allowedExts = ['.png', '.jpg', '.jpeg', '.webp', '.svg'];
      const ext = allowedExts.includes(rawExt) ? rawExt : '.png';
      const safeImageFile = `screen-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}${ext}`;
      const imageAbsPath = path.join(loc.demoDir, safeImageFile);

      await new Promise((resolve, reject) => {
        const writeStream = fs.createWriteStream(imageAbsPath);
        req.pipe(writeStream);
        writeStream.on('finish', resolve);
        writeStream.on('error', reject);
        req.on('error', reject);
      });

      const imageUrl = `/api/demos/${demoId}/media/${safeImageFile}`;
      return sendJson(res, 200, { imageUrl, fileName: rawFileName });
    }

    // 9. GET /api/demos/:id/media/:filename -> Stream video or screenshot from demo folder with Range support
    const mediaMatch = pathname.match(/^\/api\/demos\/([^/]+)\/media\/([^/]+)$/);
    if (req.method === 'GET' && mediaMatch) {
      const demoId = mediaMatch[1];
      const fileName = path.basename(mediaMatch[2]);
      const loc = findDemoLocation(demoId);
      if (!loc) {
        res.writeHead(404);
        res.end('Demo not found');
        return;
      }
      const mediaFile = path.join(loc.demoDir, fileName);
      return serveFileWithRange(req, res, mediaFile);
    }

    // 9b. GET /api/webflow/proxy?endpoint=/v2/... -> Proxy requests to Webflow Data API v2 to avoid browser CORS
    if (req.method === 'GET' && pathname === '/api/webflow/proxy') {
      const endpoint = parsedUrl.searchParams.get('endpoint') || '/v2/sites';
      const token = (req.headers['x-webflow-token'] || '').trim();
      if (!token) {
        return sendJson(res, 400, { error: 'Missing Webflow API token' });
      }
      if (!endpoint.startsWith('/v2/')) {
        return sendJson(res, 400, { error: 'Invalid Webflow v2 endpoint' });
      }
      const wfRes = await fetch(`https://api.webflow.com${endpoint}`, {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/json'
        }
      });
      const wfData = await wfRes.json().catch(() => ({}));
      return sendJson(res, wfRes.status, wfData);
    }

    // Never return SPA index.html for unmatched /api/* routes
    if (pathname.startsWith('/api/')) {
      return sendJson(res, 404, { error: `API route not found: ${pathname}` });
    }

    // 10. Serve static frontend files from /public
    let staticFile = pathname === '/' ? '/index.html' : pathname;
    const resolvedStatic = path.resolve(PUBLIC_DIR, `.${staticFile}`);
    if (resolvedStatic.startsWith(PUBLIC_DIR) && fs.existsSync(resolvedStatic) && fs.statSync(resolvedStatic).isFile()) {
      return serveFileWithRange(req, res, resolvedStatic);
    }

    // SPA fallback
    const indexHtml = path.join(PUBLIC_DIR, 'index.html');
    if (fs.existsSync(indexHtml)) {
      return serveFileWithRange(req, res, indexHtml);
    }

    res.writeHead(404);
    res.end('Not found');
  } catch (err) {
    console.error('Server error:', err);
    sendJson(res, 500, { error: err.message || 'Internal Server Error' });
  }
});

server.listen(PORT, () => {
  console.log(`\n  BxLearn Walkthrough Studio running at: http://localhost:${PORT}`);
  console.log(`  Filesystem folder hierarchy root:      ${LIBRARY_ROOT}\n`);
});
