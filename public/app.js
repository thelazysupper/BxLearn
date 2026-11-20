/**
 * BxLearn — Minimalistic Interactive Walkthrough Studio
 * - Real Folder Hierarchy Backend (/api/workspace, /api/folders, /api/demos)
 * - Automatic Browser Storage Fallback (when hosted statically / inside Webflow / file://)
 * - Locked 1:1 Video Viewport Sizing so Hotspots stay stuck to the exact pixel coordinate
 * - Storylane-style Intro / Text Screens + Pulsing Hotspots & Tooltips
 * - Webflow Custom Code Embed & Standalone HTML Generator
 */

const SAMPLE_DURATION = 8.0;

const state = {
  folders: [],
  demos: [],
  currentView: 'library', // 'library' | 'editor'
  selectedFolder: '__ALL__', // '__ALL__' | '' (root) | 'Folder/Path'
  libraryTypeFilter: '__ALL__', // '__ALL__' | 'walkthrough' | 'flow'
  searchQuery: '',

  // Editor state
  activeDemo: null,
  selectedStepId: null,
  editorMode: 'edit', // 'edit' | 'preview'
  isDraggingHotspot: false,
  traceAction: null, // null | 'move' | 'resize' | 'draw'
  traceResizeDir: null,
  traceDragStart: null,
  saveTimeout: null,
  undoStack: [],
  redoStack: [],

  // Unified Media Clock (handles both real <video> and instant 8s sample <canvas>)
  usingCanvasPlayer: false,
  canvasTime: 0,
  canvasPlaying: false,
  canvasRafId: null,
  canvasLastTick: 0,
  videoAspectRatio: 16 / 9,
  lastViewportW: 0,
  lastViewportH: 0,
  lastPlayIconPaused: null,

  // Preview state
  previewStepIndex: 0,
  previewWaitingForClick: false,

  // Backend mode
  usingLocalFallback: false,
  activeWfTab: 'single'
};

// =========================================================
// TOAST NOTIFICATION HELPER
// =========================================================
function showToast(message) {
  const container = document.getElementById('toast-container');
  if (!container) return;
  const el = document.createElement('div');
  el.className = 'toast-msg';
  el.textContent = message;
  container.appendChild(el);
  setTimeout(() => {
    el.style.opacity = '0';
    el.style.transition = 'opacity 0.25s ease';
    setTimeout(() => el.remove(), 260);
  }, 2200);
}

// =========================================================
// STEADY BACKDROP FRAME + CENTERED ASPECT-RATIO SCREEN LOCK
// Outer #stage-backdrop-frame stays at a steady 16:9 ratio
// with background color, while inner #video-viewport is
// centered at the exact aspect ratio of the current video or
// screenshot (vertical or horizontal) with rounded corners.
// =========================================================
function getActiveStageStep() {
  if (!state.activeDemo || !Array.isArray(state.activeDemo.steps)) return null;
  if (state.editorMode === 'edit') {
    return getSelectedStep();
  }
  if (!state.previewWaitingForClick) return null;
  return state.activeDemo.steps[state.previewStepIndex] || null;
}

function isStepSplitLayout(step) {
  return Boolean(step && getStepType(step) === 'screen' && step.screenLayout === 'split');
}

function syncViewportSize() {
  const wrap = document.getElementById('stage-viewport-wrap');
  const backdrop = document.getElementById('stage-backdrop-frame');
  const viewport = document.getElementById('video-viewport');
  if (!wrap || !viewport) return;

  const cw = wrap.clientWidth;
  const ch = wrap.clientHeight;
  if (!cw || !ch) return;

  // 1. Fit outer backdrop frame at steady 16:9 ratio
  const outerPad = 32;
  const maxOuterW = Math.max(240, cw - outerPad);
  const maxOuterH = Math.max(160, ch - outerPad);
  const backdropRatio = 16 / 9;

  let outerW = maxOuterW;
  let outerH = outerW / backdropRatio;
  if (outerH > maxOuterH) {
    outerH = maxOuterH;
    outerW = outerH * backdropRatio;
  }
  outerW = Math.floor(outerW);
  outerH = Math.floor(outerH);

  const stageStep = getActiveStageStep();
  const isSplit = isStepSplitLayout(stageStep);

  if (backdrop) {
    backdrop.style.width = `${outerW}px`;
    backdrop.style.height = `${outerH}px`;
    backdrop.classList.toggle('is-split-layout', isSplit);
  }

  // 2. Fit inner screen (#video-viewport) centered inside the backdrop (or left 50% column in 50/50 Split mode)
  const paneW = isSplit ? Math.floor(outerW / 2) : outerW;
  const innerPad = Math.max(20, Math.round(Math.min(paneW, outerH) * 0.065));
  const availW = Math.max(100, paneW - innerPad * 2);
  const availH = Math.max(100, outerH - innerPad * 2);
  const mediaRatio = state.videoAspectRatio || (16 / 9);

  let targetW = availW;
  let targetH = targetW / mediaRatio;

  if (targetH > availH) {
    targetH = availH;
    targetW = targetH * mediaRatio;
  }

  const w = Math.floor(targetW);
  const h = Math.floor(targetH);
  if (Math.abs(w - state.lastViewportW) >= 1 || Math.abs(h - state.lastViewportH) >= 1) {
    state.lastViewportW = w;
    state.lastViewportH = h;
    viewport.style.width = `${w}px`;
    viewport.style.height = `${h}px`;
  }
}

// =========================================================
// API & STORAGE LAYER (Node Filesystem + Static Fallback)
// =========================================================
const LOCAL_STORAGE_KEY = 'bxlearn_workspace_v4';

function getAppBasePath() {
  if (typeof window !== 'undefined' && typeof window.__BXLEARN_BASE__ === 'string') {
    return window.__BXLEARN_BASE__.replace(/\/$/, '');
  }
  const p = (typeof window !== 'undefined' ? window.location.pathname : '') || '';
  const cleaned = p.replace(/\/index\.html$/, '').replace(/\/$/, '');
  return cleaned === '/' ? '' : cleaned;
}

function normalizeStaticMediaUrl(url) {
  if (!url || typeof url !== 'string') return url;
  const base = getAppBasePath();
  if (url.startsWith('./media/')) {
    return `${base}/media/${url.slice('./media/'.length)}`;
  }
  return url;
}

function getDefaultWorkspace() {
  return {
    folders: [
      { path: 'Getting Started', name: 'Getting Started', parentPath: '' },
      { path: 'Getting Started/Onboarding Flows', name: 'Onboarding Flows', parentPath: 'Getting Started' },
      { path: 'Product Features', name: 'Product Features', parentPath: '' },
      { path: 'Product Features/Analytics & Reporting', name: 'Analytics & Reporting', parentPath: 'Product Features' },
      { path: 'Webflow Embeds', name: 'Webflow Embeds', parentPath: '' }
    ],
    demos: [
      {
        id: 'demo-welcome-tour',
        title: 'Workspace Overview & Quick Start',
        description: 'Interactive walkthrough with an intro screen, pinned hotspots, and Webflow publishing.',
        folderPath: 'Getting Started/Onboarding Flows',
        videoUrl: '',
        useSampleCanvasVideo: true,
        updatedAt: new Date().toISOString(),
        steps: [
          {
            id: 'step-intro',
            type: 'screen',
            backdrop: 'blur',
            kicker: 'Interactive Product Tour • 4 Steps',
            timestamp: 0.0,
            title: 'Welcome to BxLearn Analytics',
            body: 'Take a 30-second interactive walkthrough to see how teams build, organize, and embed product demos in Webflow.',
            x: 50,
            y: 50,
            style: 'beacon',
            placement: 'auto',
            buttonText: 'Start Walkthrough',
            advanceOnHotspotClick: true,
            ctaUrl: ''
          },
          {
            id: 'step-1',
            type: 'hotspot',
            backdrop: 'blur',
            kicker: '',
            timestamp: 1.0,
            title: 'Create a New Workspace',
            body: 'Click the pulsing hotspot on "+ New Workspace" to spin up a dedicated folder hierarchy for your team.',
            x: 32.3,
            y: 33.8,
            style: 'beacon',
            placement: 'right',
            buttonText: 'Next step',
            advanceOnHotspotClick: true,
            ctaUrl: ''
          },
          {
            id: 'step-2',
            type: 'hotspot',
            backdrop: 'blur',
            kicker: '',
            timestamp: 3.4,
            title: 'Inspect Live Conversion Metrics',
            body: 'Track real-time completion rates and engagement across every embedded walkthrough.',
            x: 58.0,
            y: 50.2,
            style: 'beacon',
            placement: 'bottom',
            buttonText: 'Continue',
            advanceOnHotspotClick: true,
            ctaUrl: ''
          },
          {
            id: 'step-3',
            type: 'hotspot',
            backdrop: 'blur',
            kicker: '',
            timestamp: 5.8,
            title: 'Publish Directly to Webflow',
            body: 'Click "Publish to Webflow" in the top-right corner to copy your ready-to-paste embed snippet.',
            x: 84.2,
            y: 4.6,
            style: 'beacon',
            placement: 'left',
            buttonText: 'Continue',
            advanceOnHotspotClick: true,
            ctaUrl: ''
          },
          {
            id: 'step-outro',
            type: 'screen',
            backdrop: 'dark',
            kicker: 'Tour Complete',
            timestamp: 7.4,
            title: 'Ready to Build Your Own Demo?',
            body: 'Upload any screen recording, drop hotspots or text screens onto the timeline, and embed it in Webflow in seconds.',
            x: 50,
            y: 50,
            style: 'beacon',
            placement: 'auto',
            buttonText: 'Replay Demo',
            advanceOnHotspotClick: true,
            ctaUrl: ''
          }
        ]
      }
    ]
  };
}

async function loadLocalFallbackWorkspace() {
  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && Array.isArray(parsed.folders) && Array.isArray(parsed.demos)) {
        return parsed;
      }
    }
  } catch (e) {}

  try {
    const base = getAppBasePath();
    const staticRes = await fetch(`${base}/workspace-static.json`, { cache: 'no-store' });
    if (staticRes.ok) {
      const staticData = await staticRes.json();
      if (staticData && Array.isArray(staticData.folders) && Array.isArray(staticData.demos)) {
        staticData.demos = staticData.demos.map(d => ({
          ...d,
          videoUrl: normalizeStaticMediaUrl(d.videoUrl),
          steps: Array.isArray(d.steps)
            ? d.steps.map(s => ({ ...s, imageUrl: normalizeStaticMediaUrl(s.imageUrl) }))
            : []
        }));
        try {
          localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(staticData));
        } catch (e) {}
        return staticData;
      }
    }
  } catch (e) {}

  const initial = getDefaultWorkspace();
  try {
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(initial));
  } catch (e) {}
  return initial;
}

function saveLocalFallbackWorkspace() {
  try {
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify({
      folders: state.folders,
      demos: state.demos
    }));
  } catch (e) {}
}

async function apiFetchWorkspace() {
  if (window.location.protocol === 'file:') {
    state.usingLocalFallback = true;
    return loadLocalFallbackWorkspace();
  }
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 1500);
    const res = await fetch('/api/workspace', { signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) throw new Error('Backend unavailable');
    const data = await res.json();
    state.usingLocalFallback = false;
    return data;
  } catch (err) {
    state.usingLocalFallback = true;
    return loadLocalFallbackWorkspace();
  }
}

async function apiCreateFolder(folderPath) {
  if (!state.usingLocalFallback) {
    const res = await fetch('/api/folders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: folderPath })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed creating folder');
    state.folders = data.workspace.folders;
    state.demos = data.workspace.demos;
    return data.path;
  } else {
    const parts = folderPath.split('/').filter(Boolean);
    let accum = '';
    for (const part of parts) {
      const parent = accum;
      accum = accum ? `${accum}/${part}` : part;
      if (!state.folders.some(f => f.path === accum)) {
        state.folders.push({ path: accum, name: part, parentPath: parent });
      }
    }
    state.folders.sort((a, b) => a.path.localeCompare(b.path));
    saveLocalFallbackWorkspace();
    return accum;
  }
}

async function apiRenameFolder(oldPath, newPath) {
  if (!state.usingLocalFallback) {
    const res = await fetch('/api/folders', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ oldPath, newPath })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed renaming folder');
    state.folders = data.workspace.folders;
    state.demos = data.workspace.demos;
    return data.path;
  } else {
    state.folders.forEach(f => {
      if (f.path === oldPath) {
        f.path = newPath;
        f.name = newPath.split('/').pop();
      } else if (f.path.startsWith(`${oldPath}/`)) {
        f.path = newPath + f.path.slice(oldPath.length);
        f.parentPath = f.path.includes('/') ? f.path.slice(0, f.path.lastIndexOf('/')) : '';
      }
    });
    state.demos.forEach(d => {
      if (d.folderPath === oldPath) d.folderPath = newPath;
      else if (d.folderPath && d.folderPath.startsWith(`${oldPath}/`)) {
        d.folderPath = newPath + d.folderPath.slice(oldPath.length);
      }
    });
    saveLocalFallbackWorkspace();
    return newPath;
  }
}

async function apiDeleteFolder(folderPath) {
  if (!state.usingLocalFallback) {
    const res = await fetch(`/api/folders?path=${encodeURIComponent(folderPath)}`, {
      method: 'DELETE'
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed deleting folder');
    state.folders = data.workspace.folders;
    state.demos = data.workspace.demos;
  } else {
    const parent = folderPath.includes('/') ? folderPath.slice(0, folderPath.lastIndexOf('/')) : '';
    state.folders = state.folders.filter(f => f.path !== folderPath && !f.path.startsWith(`${folderPath}/`));
    state.demos.forEach(d => {
      if (d.folderPath === folderPath || (d.folderPath && d.folderPath.startsWith(`${folderPath}/`))) {
        d.folderPath = parent;
      }
    });
    saveLocalFallbackWorkspace();
  }
}

async function apiCreateDemo(payload) {
  if (!state.usingLocalFallback) {
    const res = await fetch('/api/demos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed creating walkthrough');
    state.folders = data.workspace.folders;
    state.demos = data.workspace.demos;
    return data.demo;
  } else {
    const newDemo = {
      id: `demo-${Date.now().toString(36)}`,
      title: payload.title || 'Untitled Walkthrough',
      description: payload.description || '',
      folderPath: payload.folderPath || '',
      deviceMockup: payload.deviceMockup === 'laptop' ? 'laptop' : 'handterminal',
      videoUrl: '',
      useSampleCanvasVideo: false,
      updatedAt: new Date().toISOString(),
      steps: []
    };
    state.demos.unshift(newDemo);
    saveLocalFallbackWorkspace();
    return newDemo;
  }
}

async function apiUpdateDemo(demo) {
  if (!state.usingLocalFallback) {
    const res = await fetch(`/api/demos/${encodeURIComponent(demo.id)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(demo)
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed saving demo');
    state.folders = data.workspace.folders;
    state.demos = data.workspace.demos;
    return data.demo;
  } else {
    const idx = state.demos.findIndex(d => d.id === demo.id);
    if (idx !== -1) {
      state.demos[idx] = { ...demo, updatedAt: new Date().toISOString() };
    }
    saveLocalFallbackWorkspace();
    return demo;
  }
}

async function apiDeleteDemo(demoId) {
  if (!state.usingLocalFallback) {
    const res = await fetch(`/api/demos/${encodeURIComponent(demoId)}`, {
      method: 'DELETE'
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed deleting demo');
    state.folders = data.workspace.folders;
    state.demos = data.workspace.demos;
  } else {
    state.demos = state.demos.filter(d => d.id !== demoId);
    saveLocalFallbackWorkspace();
  }
}

async function apiUploadVideo(demoId, file) {
  if (!state.usingLocalFallback) {
    const res = await fetch(`/api/demos/${encodeURIComponent(demoId)}/video`, {
      method: 'POST',
      headers: {
        'Content-Type': file.type || 'video/mp4',
        'X-File-Name': encodeURIComponent(file.name)
      },
      body: file
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Video upload failed');
    state.folders = data.workspace.folders;
    state.demos = data.workspace.demos;
    return data.demo;
  } else {
    const blobUrl = URL.createObjectURL(file);
    state.activeDemo.videoUrl = blobUrl;
    state.activeDemo.videoFileName = file.name;
    state.activeDemo.useSampleCanvasVideo = false;
    return apiUpdateDemo(state.activeDemo);
  }
}

function getWebflowConfig() {
  try {
    return {
      apiToken: (localStorage.getItem(WF_TOKEN_STORAGE_KEY) || '').trim(),
      siteId: (localStorage.getItem(WF_SITE_ID_STORAGE_KEY) || '').trim()
    };
  } catch (e) {
    return { apiToken: '', siteId: '' };
  }
}

let lastWebflowUploadError = '';

async function webflowUploadAsset(file) {
  const { apiToken: token, siteId } = getWebflowConfig();
  if (!token || !siteId) {
    lastWebflowUploadError = 'Webflow API token or Site ID not configured';
    return null;
  }

  lastWebflowUploadError = '';
  const base = getAppBasePath();
  const endpoint = `/v2/sites/${encodeURIComponent(siteId)}/assets`;
  const rawName = file.name || `screenshot-${Date.now()}.png`;
  const fileName = rawName.replace(/[^a-zA-Z0-9._-]/g, '_');
  const candidateUrls = [
    `${base}/api/webflow/proxy?endpoint=${encodeURIComponent(endpoint)}`,
    `/api/webflow/proxy?endpoint=${encodeURIComponent(endpoint)}`
  ];

  for (const proxyUrl of candidateUrls) {
    try {
      const res = await fetch(proxyUrl, {
        method: 'POST',
        headers: {
          'X-Webflow-Token': token,
          'X-File-Name': encodeURIComponent(fileName),
          'Content-Type': file.type || 'image/png'
        },
        body: file
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && (data.hostedUrl || data.assetUrl)) {
        return { imageUrl: data.hostedUrl || data.assetUrl, fileName: data.fileName || fileName };
      }
      if (res.status !== 404) {
        lastWebflowUploadError = data.error || data.message || `HTTP ${res.status}`;
        console.warn('Webflow asset upload error:', lastWebflowUploadError);
        return null;
      }
    } catch (err) {
      lastWebflowUploadError = err.message || 'Network error';
      console.warn('Webflow asset upload failed:', err);
    }
  }
  if (!lastWebflowUploadError) lastWebflowUploadError = 'Proxy endpoint not found (404)';
  return null;
}

async function compressImageToDataUrl(file, maxDim = 1440, quality = 0.82) {
  const rawUrl = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });

  try {
    const img = await new Promise((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = reject;
      i.src = rawUrl;
    });
    const scale = Math.min(1, maxDim / Math.max(img.naturalWidth || 1, img.naturalHeight || 1));
    const w = Math.max(1, Math.round((img.naturalWidth || 1) * scale));
    const h = Math.max(1, Math.round((img.naturalHeight || 1) * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    canvas.getContext('2d').drawImage(img, 0, 0, w, h);
    const webp = canvas.toDataURL('image/webp', quality);
    if (webp && webp.startsWith('data:image/webp') && webp.length < rawUrl.length) return webp;
    const jpeg = canvas.toDataURL('image/jpeg', quality);
    if (jpeg && jpeg.length < rawUrl.length) return jpeg;
  } catch {}
  return rawUrl;
}

async function apiUploadScreenshot(demoId, file) {
  const fileName = file.name || `screenshot-${Date.now()}.png`;
  if (!state.usingLocalFallback) {
    const res = await fetch(`/api/demos/${encodeURIComponent(demoId)}/screenshot`, {
      method: 'POST',
      headers: {
        'Content-Type': file.type || 'image/png',
        'X-File-Name': encodeURIComponent(fileName)
      },
      body: file
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Screenshot upload failed');
    return { imageUrl: data.imageUrl, fileName: data.fileName || fileName };
  }

  // In static/Webflow Cloud mode, prefer uploading to Webflow Assets for a short CDN URL
  const wfUploaded = await webflowUploadAsset(file);
  if (wfUploaded) {
    return wfUploaded;
  }

  const dataUrl = await compressImageToDataUrl(file);
  return { imageUrl: dataUrl, fileName };
}

// =========================================================
// UNIFIED MEDIA CONTROLLER (<video> + Smooth Sample <canvas>)
// =========================================================
function drawRoundedRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function drawSampleDashboardAtTime(sec) {
  const canvas = document.getElementById('sample-video-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const t = Math.max(0, Math.min(1, sec / SAMPLE_DURATION));

  // Page Background
  ctx.fillStyle = '#F8FAFC';
  ctx.fillRect(0, 0, 1280, 720);

  // Top Navigation Bar (#00182C)
  ctx.fillStyle = '#00182C';
  ctx.fillRect(0, 0, 1280, 66);

  // Brand title
  ctx.fillStyle = '#FFFFFF';
  ctx.font = '600 20px "Host Grotesk", sans-serif';
  ctx.fillText('BxLearn Cloud Analytics', 32, 41);

  // Publish button in top right: center is at (x=1077.5 => 84.2%, y=33 => 4.6%)
  const pubActive = sec >= 4.8 && sec <= 6.8;
  ctx.fillStyle = pubActive ? '#0076DD' : '#1E3A5F';
  drawRoundedRect(ctx, 990, 15, 175, 36, 8);
  ctx.fill();
  ctx.fillStyle = '#FFFFFF';
  ctx.font = '600 14px "Google Sans", sans-serif';
  ctx.fillText('Publish to Webflow', 1014, 38);

  // Left Sidebar
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 66, 240, 654);
  ctx.strokeStyle = '#E2E8F0';
  ctx.strokeRect(0, 66, 240, 654);

  const navItems = ['Overview', 'Walkthroughs', 'Folder Tree', 'Webflow Sync', 'Analytics'];
  navItems.forEach((item, idx) => {
    const y = 108 + idx * 44;
    if (idx === 1) {
      ctx.fillStyle = 'rgba(0, 118, 221, 0.1)';
      drawRoundedRect(ctx, 16, y - 22, 208, 34, 6);
      ctx.fill();
      ctx.fillStyle = '#0076DD';
    } else {
      ctx.fillStyle = '#324158';
    }
    ctx.font = '500 14px "Google Sans", sans-serif';
    ctx.fillText(item, 32, y);
  });

  // Main Content Container
  ctx.fillStyle = '#FFFFFF';
  drawRoundedRect(ctx, 276, 96, 964, 584, 14);
  ctx.fill();
  ctx.strokeStyle = '#E2E8F0';
  ctx.stroke();

  // Heading
  ctx.fillStyle = '#00182C';
  ctx.font = '600 24px "Host Grotesk", sans-serif';
  ctx.fillText('Interactive Product Walkthroughs', 316, 152);

  ctx.fillStyle = '#324158';
  ctx.font = '400 14px "Google Sans", sans-serif';
  ctx.fillText('Click hotspots to guide users step-by-step through your product experience.', 316, 180);

  // "+ New Workspace" button: x=316..512 (center 414 => 32.3%), y=220..266 (center 243 => 33.8%)
  const btnHighlight = sec >= 0.4 && sec < 2.4;
  ctx.fillStyle = btnHighlight ? '#0076DD' : '#00182C';
  drawRoundedRect(ctx, 316, 220, 196, 46, 8);
  ctx.fill();
  ctx.fillStyle = '#FFFFFF';
  ctx.font = '600 15px "Host Grotesk", sans-serif';
  ctx.fillText('+ New Workspace', 348, 249);

  // Metric cards: middle card x=608..876 (center 742 => 58.0%), y=296..428 (center 362 => 50.2%)
  const cards = [
    { x: 316, y: 296, label: 'Active Walkthroughs', val: '28' },
    { x: 608, y: 296, label: 'Completion Rate', val: `${Math.min(96, Math.floor(64 + t * 32))}%` },
    { x: 900, y: 296, label: 'Webflow Embed Views', val: `${Math.floor(1240 + t * 680)}` }
  ];
  cards.forEach((c, idx) => {
    const activeCard = idx === 1 && sec >= 2.4 && sec <= 4.8;
    ctx.fillStyle = activeCard ? '#EAF4FF' : '#F8FAFC';
    drawRoundedRect(ctx, c.x, c.y, 268, 132, 10);
    ctx.fill();
    ctx.strokeStyle = activeCard ? '#0076DD' : '#E2E8F0';
    ctx.lineWidth = activeCard ? 2 : 1;
    ctx.stroke();
    ctx.lineWidth = 1;

    ctx.fillStyle = '#324158';
    ctx.font = '400 14px "Google Sans", sans-serif';
    ctx.fillText(c.label, c.x + 22, c.y + 40);

    ctx.fillStyle = '#00182C';
    ctx.font = '700 34px "Host Grotesk", sans-serif';
    ctx.fillText(c.val, c.x + 22, c.y + 94);
  });

  // Animated Engagement Bar Chart at bottom
  ctx.fillStyle = '#F8FAFC';
  drawRoundedRect(ctx, 316, 456, 852, 190, 10);
  ctx.fill();
  ctx.strokeStyle = '#E2E8F0';
  ctx.stroke();

  for (let i = 0; i < 12; i++) {
    const bx = 352 + i * 66;
    const barH = 42 + Math.sin(t * Math.PI * 2 + i * 0.55) * 32 + i * 4.5;
    ctx.fillStyle = i === 7 ? '#0076DD' : '#CBD5E1';
    drawRoundedRect(ctx, bx, 618 - barH, 38, barH, 5);
    ctx.fill();
  }
}

function mediaGetDuration() {
  if (state.usingCanvasPlayer) return SAMPLE_DURATION;
  const video = document.getElementById('demo-video');
  return (video && video.duration && isFinite(video.duration)) ? video.duration : SAMPLE_DURATION;
}

function mediaGetTime() {
  if (state.usingCanvasPlayer) return state.canvasTime;
  const video = document.getElementById('demo-video');
  return video ? (video.currentTime || 0) : 0;
}

function mediaSetTime(sec, skipPreviewCheck = true) {
  const clamped = Math.max(0, Math.min(mediaGetDuration(), Number(sec || 0)));
  if (state.usingCanvasPlayer) {
    state.canvasTime = clamped;
    drawSampleDashboardAtTime(clamped);
    updateTimelineReadoutUI();
    if (!skipPreviewCheck) checkPreviewStepPause();
  } else {
    const video = document.getElementById('demo-video');
    if (video) {
      try {
        if (Math.abs((video.currentTime || 0) - clamped) > 0.01) {
          video.currentTime = clamped;
        }
      } catch (e) {}
    }
    updateTimelineReadoutUI();
    if (!skipPreviewCheck) checkPreviewStepPause();
  }
}

function mediaIsPaused() {
  if (state.usingCanvasPlayer) return !state.canvasPlaying;
  const video = document.getElementById('demo-video');
  return video ? video.paused : true;
}

function mediaPlay() {
  if (state.usingCanvasPlayer) {
    if (state.canvasPlaying) return;
    if (state.canvasTime >= SAMPLE_DURATION - 0.05) {
      state.canvasTime = 0;
    }
    state.canvasPlaying = true;
    state.canvasLastTick = performance.now();
    updatePlayPauseButtonIcon(false);

    const tick = now => {
      if (!state.canvasPlaying) return;
      const dt = Math.min(0.1, Math.max(0, (now - state.canvasLastTick) / 1000));
      state.canvasLastTick = now;
      state.canvasTime = Math.min(SAMPLE_DURATION, state.canvasTime + dt);
      drawSampleDashboardAtTime(state.canvasTime);
      handleMediaTimeUpdate();

      if (!state.canvasPlaying) return;

      if (state.canvasTime >= SAMPLE_DURATION) {
        mediaPause();
        if (state.editorMode === 'preview' && !state.previewWaitingForClick) {
          jumpToPreviewStep(state.previewStepIndex);
        }
      } else {
        state.canvasRafId = requestAnimationFrame(tick);
      }
    };
    state.canvasRafId = requestAnimationFrame(tick);
  } else {
    const video = document.getElementById('demo-video');
    if (video) {
      updatePlayPauseButtonIcon(false);
      const playPromise = video.play();
      if (playPromise && typeof playPromise.catch === 'function') {
        playPromise.catch(() => {
          updatePlayPauseButtonIcon(true);
          // If browser blocks playback or codec is unsupported during preview, jump directly to target step
          if (state.editorMode === 'preview' && !state.previewWaitingForClick) {
            jumpToPreviewStep(state.previewStepIndex);
          }
        });
      }
    }
  }
}

function mediaPause() {
  if (state.usingCanvasPlayer) {
    state.canvasPlaying = false;
    if (state.canvasRafId) {
      cancelAnimationFrame(state.canvasRafId);
      state.canvasRafId = null;
    }
    updatePlayPauseButtonIcon(true);
  } else {
    const video = document.getElementById('demo-video');
    if (video && !video.paused) video.pause();
    updatePlayPauseButtonIcon(true);
  }
}

function updatePlayPauseButtonIcon(isPaused) {
  if (state.lastPlayIconPaused === isPaused) return;
  state.lastPlayIconPaused = isPaused;
  const wrap = document.getElementById('icon-play-pause-wrap');
  if (!wrap) return;
  wrap.innerHTML = `<i data-lucide="${isPaused ? 'play' : 'pause'}"></i>`;
  refreshIcons(wrap);
}

function updateTimelineReadoutUI() {
  const dur = mediaGetDuration();
  const curr = mediaGetTime();
  const pct = Math.max(0, Math.min(100, (curr / dur) * 100));

  const progressEl = document.getElementById('timeline-progress');
  const playheadEl = document.getElementById('timeline-playhead');
  const timeCurrentEl = document.getElementById('time-current');
  const timeDurationEl = document.getElementById('time-duration');

  if (progressEl) progressEl.style.width = `${pct}%`;
  if (playheadEl) playheadEl.style.left = `${pct}%`;
  if (timeCurrentEl) timeCurrentEl.textContent = formatSeconds(curr);
  if (timeDurationEl) timeDurationEl.textContent = formatSeconds(dur);
}

function checkPreviewStepPause() {
  if (state.editorMode !== 'preview' || state.previewWaitingForClick || !state.activeDemo) return;
  const targetStep = state.activeDemo.steps[state.previewStepIndex];
  if (!targetStep) return;

  const curr = mediaGetTime();
  const targetTime = Number(targetStep.timestamp || 0);
  if (curr >= targetTime - 0.04) {
    // Set waiting flag FIRST to prevent any re-entrant recursion
    state.previewWaitingForClick = true;
    mediaPause();
    mediaSetTime(targetTime, true);
    const isScreen = getStepType(targetStep) === 'screen';
    const pos = getNumberedStepPosition(state.activeDemo.steps, state.previewStepIndex);
    updatePreviewStatusPill(
      pos.isExplainer
        ? 'Explainer'
        : (isScreen ? `Step ${pos.number} — Intro / Text Screen` : `Step ${pos.number} — Click hotspot`),
      false
    );
    renderHotspotOverlay();
  }
}

function handleMediaTimeUpdate() {
  updateTimelineReadoutUI();
  checkPreviewStepPause();
}

// =========================================================
// RENDER LIBRARY & FOLDER HIERARCHY
// =========================================================
function getDemosCountForFolder(folderPath) {
  if (folderPath === '__ALL__') return state.demos.length;
  if (folderPath === '') return state.demos.filter(d => !d.folderPath).length;
  return state.demos.filter(
    d => d.folderPath === folderPath || (d.folderPath && d.folderPath.startsWith(`${folderPath}/`))
  ).length;
}

function renderLibraryView() {
  document.getElementById('count-all-demos').textContent = getDemosCountForFolder('__ALL__');
  document.getElementById('count-root-demos').textContent = getDemosCountForFolder('');

  document.getElementById('nav-all-demos').classList.toggle('active', state.selectedFolder === '__ALL__');
  document.getElementById('nav-root-demos').classList.toggle('active', state.selectedFolder === '');

  const treeEl = document.getElementById('folder-tree');
  treeEl.innerHTML = '';

  state.folders.forEach(folder => {
    const depth = folder.path.split('/').length - 1;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `folder-row ${state.selectedFolder === folder.path ? 'active' : ''}`;
    btn.style.paddingLeft = `${10 + depth * 16}px`;
    btn.innerHTML = `
      <div class="folder-row-left">
        <i data-lucide="${state.selectedFolder === folder.path ? 'folder-open' : 'folder'}" class="folder-icon"></i>
        <span class="folder-name">${escapeHtml(folder.name)}</span>
      </div>
      <span class="folder-count">${getDemosCountForFolder(folder.path)}</span>
    `;
    btn.addEventListener('click', () => {
      state.selectedFolder = folder.path;
      renderLibraryView();
    });
    treeEl.appendChild(btn);
  });

  const breadcrumbsEl = document.getElementById('library-breadcrumbs');
  const titleEl = document.getElementById('current-folder-title');
  const folderActionsEl = document.getElementById('current-folder-actions');

  breadcrumbsEl.innerHTML = '';
  if (state.selectedFolder === '__ALL__') {
    titleEl.textContent = 'All Walkthroughs';
    folderActionsEl.classList.add('hidden');
  } else if (state.selectedFolder === '') {
    titleEl.textContent = 'Unfiled';
    folderActionsEl.classList.add('hidden');
  } else {
    const segments = state.selectedFolder.split('/');
    titleEl.textContent = segments[segments.length - 1];
    folderActionsEl.classList.remove('hidden');

    const rootBtn = document.createElement('button');
    rootBtn.type = 'button';
    rootBtn.className = 'crumb-link';
    rootBtn.textContent = 'Library';
    rootBtn.onclick = () => {
      state.selectedFolder = '__ALL__';
      renderLibraryView();
    };
    breadcrumbsEl.appendChild(rootBtn);

    let built = '';
    segments.forEach(seg => {
      built = built ? `${built}/${seg}` : seg;
      const sep = document.createElement('span');
      sep.textContent = '/';
      breadcrumbsEl.appendChild(sep);

      const crumb = document.createElement('button');
      crumb.type = 'button';
      crumb.className = 'crumb-link';
      crumb.textContent = seg;
      const targetPath = built;
      crumb.onclick = () => {
        state.selectedFolder = targetPath;
        renderLibraryView();
      };
      breadcrumbsEl.appendChild(crumb);
    });
  }

  const subfoldersSection = document.getElementById('subfolders-section');
  const subfoldersGrid = document.getElementById('subfolders-grid');
  subfoldersGrid.innerHTML = '';

  const parentFilter = state.selectedFolder === '__ALL__' ? '' : state.selectedFolder;
  const childFolders = state.folders.filter(f => f.parentPath === parentFilter);

  if (childFolders.length > 0 && !state.searchQuery) {
    subfoldersSection.classList.remove('hidden');
    childFolders.forEach(sub => {
      const card = document.createElement('div');
      card.className = 'subfolder-card';
      card.innerHTML = `
        <div class="subfolder-card-left">
          <i data-lucide="folder"></i>
          <span class="subfolder-card-title">${escapeHtml(sub.name)}</span>
        </div>
        <span class="folder-count">${getDemosCountForFolder(sub.path)}</span>
      `;
      card.addEventListener('click', () => {
        state.selectedFolder = sub.path;
        renderLibraryView();
      });
      subfoldersGrid.appendChild(card);
    });
  } else {
    subfoldersSection.classList.add('hidden');
  }

  const demosGrid = document.getElementById('demos-grid');
  demosGrid.innerHTML = '';

  const query = state.searchQuery.trim().toLowerCase();
  const filteredDemos = state.demos.filter(demo => {
    const isFlow = demo.kind === 'flow';
    if (state.libraryTypeFilter === 'flow' && !isFlow) return false;
    if (state.libraryTypeFilter === 'walkthrough' && isFlow) return false;
    if (query) {
      const hay = `${demo.title} ${demo.description || ''} ${demo.folderPath || ''}`.toLowerCase();
      if (!hay.includes(query)) return false;
    }
    if (state.selectedFolder === '__ALL__') return true;
    if (state.selectedFolder === '') return !demo.folderPath;
    return (
      demo.folderPath === state.selectedFolder ||
      (demo.folderPath && demo.folderPath.startsWith(`${state.selectedFolder}/`))
    );
  });

  if (filteredDemos.length === 0) {
    demosGrid.innerHTML = `
      <div class="empty-library-box">
        <i data-lucide="video"></i>
        <h3>No walkthroughs in this folder</h3>
        <p>Create a walkthrough to upload a video, add hotspots, and intro screens.</p>
        <button type="button" id="btn-empty-create-demo" class="btn btn-sm btn-primary">
          <i data-lucide="plus"></i>
          <span>New Walkthrough</span>
        </button>
      </div>
    `;
    const emptyBtn = document.getElementById('btn-empty-create-demo');
    if (emptyBtn) emptyBtn.onclick = () => handleCreateNewDemo();
  } else {
    filteredDemos.forEach(demo => {
      const stepCount = Array.isArray(demo.steps) ? demo.steps.length : 0;
      const firstHotspot = (demo.steps || []).find(s => getStepType(s) === 'hotspot') || { x: 50, y: 50 };
      const folderShort = demo.folderPath ? demo.folderPath.split('/').pop() : 'Unfiled';
      const card = document.createElement('div');
      card.className = 'demo-card';
      const isFlow = demo.kind === 'flow';
      const itemCount = isFlow ? (demo.nodes?.length || 0) : stepCount;
      const itemLabel = isFlow ? (itemCount === 1 ? 'screen' : 'screens') : (itemCount === 1 ? 'step' : 'steps');
      card.innerHTML = `
        <div class="demo-card-preview" data-action="open">
          ${isFlow ? `
            <div class="flow-preview-mock">
              <div class="flow-mock-node"><span></span><span></span></div>
              <div class="flow-mock-arrow"></div>
              <div class="flow-mock-node"><span></span><span></span></div>
            </div>
          ` : `
            <div class="demo-card-preview-mock">
              <div class="mock-dots"><span></span><span></span><span></span></div>
              <div class="mock-bars"><div></div><div></div></div>
              <div class="mock-hotspot-dot" style="left:${firstHotspot.x || 50}%; top:${firstHotspot.y || 50}%;"></div>
            </div>
          `}
          <span class="demo-card-steps-pill">${isFlow ? 'Flow • ' : ''}${itemCount} ${itemLabel}</span>
        </div>
        <div class="demo-card-body">
          <div class="demo-card-folder">${escapeHtml(folderShort)} ${isFlow ? '<span class="demo-kind-badge">Interactive</span>' : ''}</div>
          <h3 class="demo-card-title" data-action="open">${escapeHtml(demo.title)}</h3>
          <p class="demo-card-desc">${escapeHtml(demo.description || (isFlow ? 'Interactive branching demo' : 'Interactive walkthrough'))}</p>
        </div>
        <div class="demo-card-footer">
          <button type="button" class="btn btn-xs btn-ghost" data-action="preview" title="${isFlow ? 'Play Interactive Demo' : 'Play Walkthrough'}">
            <i data-lucide="play"></i>
            <span>Play</span>
          </button>
          <div class="demo-card-actions">
            <button type="button" class="icon-btn" data-action="webflow" title="Webflow Embed">
              <i data-lucide="code-2"></i>
            </button>
            <button type="button" class="icon-btn" data-action="edit" title="Edit">
              <i data-lucide="sliders-horizontal"></i>
            </button>
            <button type="button" class="icon-btn text-danger" data-action="delete" title="Delete">
              <i data-lucide="trash-2"></i>
            </button>
          </div>
        </div>
      `;

      card.querySelectorAll('[data-action="open"], [data-action="edit"]').forEach(el => {
        el.addEventListener('click', () => {
          if (isFlow && typeof openFlowDemo === 'function') openFlowDemo(demo.id, 'canvas');
          else openDemoInEditor(demo.id, 'edit');
        });
      });
      card.querySelector('[data-action="preview"]').addEventListener('click', () => {
        if (isFlow && typeof openFlowDemo === 'function') openFlowDemo(demo.id, 'preview');
        else openDemoInEditor(demo.id, 'preview');
      });
      card.querySelector('[data-action="webflow"]').addEventListener('click', () => {
        openWebflowModal(demo.id);
      });
      card.querySelector('[data-action="delete"]').addEventListener('click', () => {
        openDialog({
          title: 'Delete Walkthrough',
          subtitle: `Delete "${demo.title}"?`,
          isConfirmOnly: true,
          confirmText: 'Delete',
          onConfirm: async () => {
            await apiDeleteDemo(demo.id);
            renderLibraryView();
            showToast('Deleted');
          }
        });
      });

      demosGrid.appendChild(card);
    });
  }

  refreshIcons();
}

// =========================================================
// EDITOR & INTERACTIVE PLAYER LOGIC
// =========================================================
function getStepType(step) {
  if (!step) return 'hotspot';
  if (step.type === 'explainer') return 'explainer';
  if (step.type === 'screen' || step.style === 'modal') return 'screen';
  return 'hotspot';
}

function isStepExplainer(step) {
  return Boolean(step && (step.type === 'explainer' || step.isExplainer === true));
}

function getNumberedStepPosition(steps, index) {
  const list = Array.isArray(steps) ? steps : [];
  let total = 0;
  let number = 0;
  list.forEach((s, idx) => {
    if (!isStepExplainer(s)) {
      total += 1;
      if (idx === index) number = total;
    }
  });
  return { number, total, isExplainer: isStepExplainer(list[index]) };
}

function demoHasVideo(demo = state.activeDemo) {
  return Boolean(demo && (demo.videoUrl || demo.useSampleCanvasVideo));
}

function demoHasScreenshots(demo = state.activeDemo) {
  return Boolean(demo && Array.isArray(demo.steps) && demo.steps.some(s => s && s.imageUrl));
}

function demoHasAnyMedia(demo = state.activeDemo) {
  return demoHasVideo(demo) || demoHasScreenshots(demo);
}

function resolveStepImageUrl(step) {
  if (step && step.imageUrl) return step.imageUrl;
  if (step && getStepType(step) === 'screen') return '';
  if (!demoHasVideo(state.activeDemo) && demoHasScreenshots(state.activeDemo)) {
    const fallbackStep = state.activeDemo.steps.find(s => s && s.imageUrl);
    return fallbackStep ? fallbackStep.imageUrl : '';
  }
  return '';
}

function preloadDemoImages(demo) {
  if (!demo || !Array.isArray(demo.steps)) return;
  demo.steps.forEach(s => {
    if (s && s.imageUrl) {
      const pre = new Image();
      pre.src = s.imageUrl;
    }
  });
}

function syncStageMediaForStep(step, onReady = null) {
  const video = document.getElementById('demo-video');
  const canvas = document.getElementById('sample-video-canvas');
  const img = document.getElementById('demo-step-image');
  const timelineBar = document.getElementById('timeline-bar');
  if (!video || !canvas || !img) {
    if (onReady) onReady();
    return;
  }

  const hasVideo = demoHasVideo(state.activeDemo);
  if (timelineBar) {
    timelineBar.classList.toggle('hidden', state.editorMode === 'preview' || !hasVideo);
  }

  const imgUrl = resolveStepImageUrl(step);
  if (imgUrl) {
    mediaPause();
    video.classList.add('hidden');
    canvas.classList.add('hidden');
    img.classList.remove('hidden');

    if (img.getAttribute('src') !== imgUrl) {
      let finished = false;
      const done = () => {
        if (finished) return;
        finished = true;
        if (img.naturalWidth && img.naturalHeight) {
          state.videoAspectRatio = img.naturalWidth / img.naturalHeight;
        }
        syncViewportSize();
        if (onReady) onReady();
      };
      img.onload = done;
      img.onerror = done;
      img.src = imgUrl;
      if (img.complete && img.naturalWidth && img.naturalHeight) {
        done();
      }
    } else if (img.complete && img.naturalWidth && img.naturalHeight) {
      state.videoAspectRatio = img.naturalWidth / img.naturalHeight;
      syncViewportSize();
      if (onReady) onReady();
    } else if (onReady) {
      onReady();
    }
    return;
  }

  img.classList.add('hidden');
  if (state.usingCanvasPlayer) {
    video.classList.add('hidden');
    canvas.classList.remove('hidden');
    state.videoAspectRatio = 1280 / 720;
    syncViewportSize();
  } else if (state.activeDemo && state.activeDemo.videoUrl) {
    canvas.classList.add('hidden');
    video.classList.remove('hidden');
    if (video.videoWidth && video.videoHeight) {
      state.videoAspectRatio = video.videoWidth / video.videoHeight;
      syncViewportSize();
    }
  } else {
    video.classList.add('hidden');
    canvas.classList.add('hidden');
  }
  if (onReady) onReady();
}

function sortActiveSteps() {
  if (!state.activeDemo || !Array.isArray(state.activeDemo.steps)) return;
  if (!demoHasVideo(state.activeDemo) || state.activeDemo.manualStepOrder) return;
  state.activeDemo.steps.sort((a, b) => Number(a.timestamp || 0) - Number(b.timestamp || 0));
}

function openDemoInEditor(demoId, initialMode = 'edit') {
  const found = state.demos.find(d => d.id === demoId);
  if (!found) return;

  mediaPause();
  state.activeDemo = JSON.parse(JSON.stringify(found));
  state.undoStack = [];
  state.redoStack = [];
  updateUndoButtonState();
  sortActiveSteps();
  preloadDemoImages(state.activeDemo);
  state.selectedStepId = state.activeDemo.steps[0]?.id || null;
  state.currentView = 'editor';

  document.getElementById('view-library').classList.add('hidden');
  document.getElementById('view-editor').classList.remove('hidden');
  document.getElementById('brand-home').classList.add('hidden');
  document.getElementById('btn-new-demo-top').classList.add('hidden');
  document.getElementById('new-demo-dropdown')?.classList.add('hidden');
  document.getElementById('btn-back-library').classList.remove('hidden');
  document.getElementById('btn-share-preview')?.classList.remove('hidden');
  document.getElementById('editor-breadcrumb').classList.remove('hidden');
  document.getElementById('editor-mode-switcher').classList.remove('hidden');

  const folderShort = state.activeDemo.folderPath
    ? state.activeDemo.folderPath.split('/').pop()
    : 'Root';
  document.getElementById('editor-demo-title').value = state.activeDemo.title;
  document.getElementById('editor-folder-label').textContent = folderShort;
  populateEditorFolderSelect();

  setupEditorVideoSource();
  setEditorMode(initialMode);
  renderEditorStepsList();
  renderInspectorPanel();
  renderTimelineMarkers();
  syncViewportSize();
  renderHotspotOverlay();
  refreshIcons();
}

function populateEditorFolderSelect() {
  const select = document.getElementById('editor-folder-select');
  select.innerHTML = `<option value="">Unfiled (Root)</option>`;
  state.folders.forEach(f => {
    const opt = document.createElement('option');
    opt.value = f.path;
    opt.textContent = f.path;
    if (state.activeDemo && state.activeDemo.folderPath === f.path) {
      opt.selected = true;
    }
    select.appendChild(opt);
  });
}

function setupEditorVideoSource() {
  const video = document.getElementById('demo-video');
  const canvas = document.getElementById('sample-video-canvas');
  const img = document.getElementById('demo-step-image');
  const emptyBox = document.getElementById('video-upload-empty');
  const stageBox = document.getElementById('video-stage-container');

  mediaPause();

  if (!demoHasAnyMedia(state.activeDemo)) {
    emptyBox.classList.remove('hidden');
    stageBox.classList.add('hidden');
    state.usingCanvasPlayer = false;
    video.removeAttribute('src');
    if (img) img.removeAttribute('src');
    return;
  }

  emptyBox.classList.add('hidden');
  stageBox.classList.remove('hidden');

  if (state.activeDemo.useSampleCanvasVideo && !state.activeDemo.videoUrl) {
    state.usingCanvasPlayer = true;
    state.videoAspectRatio = 1280 / 720;
    video.classList.add('hidden');
    canvas.classList.remove('hidden');
    state.canvasTime = Number(state.activeDemo.steps[0]?.timestamp || 0);
    syncViewportSize();
    drawSampleDashboardAtTime(state.canvasTime);
    handleMediaTimeUpdate();
  } else if (state.activeDemo.videoUrl) {
    state.usingCanvasPlayer = false;
    canvas.classList.add('hidden');
    video.classList.remove('hidden');
    if (video.getAttribute('src') !== state.activeDemo.videoUrl) {
      video.src = state.activeDemo.videoUrl;
      video.load();
    }
  } else {
    state.usingCanvasPlayer = false;
    canvas.classList.add('hidden');
    video.classList.add('hidden');
  }

  syncStageMediaForStep(getSelectedStep() || state.activeDemo.steps[0]);
}

function setEditorMode(mode) {
  state.editorMode = mode;
  const editorEl = document.getElementById('view-editor');
  const timelineBar = document.getElementById('timeline-bar');
  const previewBar = document.getElementById('preview-player-bar');
  const overlay = document.getElementById('hotspot-overlay');

  document.querySelectorAll('#editor-mode-switcher .seg-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.mode === mode);
  });

  if (mode === 'preview') {
    editorEl.classList.add('preview-mode');
    timelineBar.classList.add('hidden');
    previewBar.classList.remove('hidden');
    overlay.classList.remove('edit-cursor');
    syncViewportSize();
    startInteractivePreview();
  } else {
    editorEl.classList.remove('preview-mode');
    timelineBar.classList.toggle('hidden', !demoHasVideo(state.activeDemo));
    previewBar.classList.add('hidden');
    const activeStep = getSelectedStep();
    overlay.classList.toggle('edit-cursor', getStepType(activeStep) === 'hotspot');
    mediaPause();
    syncStageMediaForStep(activeStep);
    syncViewportSize();
    if (activeStep && !activeStep.imageUrl && demoHasVideo(state.activeDemo) && !isNaN(activeStep.timestamp)) {
      mediaSetTime(activeStep.timestamp);
    }
    renderHotspotOverlay();
  }
  refreshIcons();
}

let draggedStepId = null;

function updateUndoButtonState() {
  const btn = document.getElementById('btn-undo-step');
  if (btn) btn.disabled = !state.undoStack || state.undoStack.length === 0;
}

function pushUndoSnapshot() {
  if (!state.activeDemo) return;
  state.undoStack.push({
    steps: JSON.parse(JSON.stringify(state.activeDemo.steps || [])),
    selectedStepId: state.selectedStepId,
    manualStepOrder: Boolean(state.activeDemo.manualStepOrder)
  });
  if (state.undoStack.length > 40) state.undoStack.shift();
  state.redoStack = [];
  updateUndoButtonState();
}

function applyHistorySnapshot(snap) {
  if (!snap || !state.activeDemo) return;
  state.activeDemo.steps = snap.steps;
  state.activeDemo.manualStepOrder = snap.manualStepOrder;
  state.selectedStepId = snap.selectedStepId;
  setupEditorVideoSource();
  renderEditorStepsList();
  renderInspectorPanel();
  renderTimelineMarkers();
  renderHotspotOverlay();
  if (state.editorMode === 'preview') renderPreviewStepDots();
  scheduleAutoSave();
  refreshIcons();
  updateUndoButtonState();
}

function undoStepEdit() {
  if (!state.activeDemo || state.undoStack.length === 0) return;
  state.redoStack.push({
    steps: JSON.parse(JSON.stringify(state.activeDemo.steps || [])),
    selectedStepId: state.selectedStepId,
    manualStepOrder: Boolean(state.activeDemo.manualStepOrder)
  });
  applyHistorySnapshot(state.undoStack.pop());
  showToast('Undid change');
}

function redoStepEdit() {
  if (!state.activeDemo || state.redoStack.length === 0) return;
  state.undoStack.push({
    steps: JSON.parse(JSON.stringify(state.activeDemo.steps || [])),
    selectedStepId: state.selectedStepId,
    manualStepOrder: Boolean(state.activeDemo.manualStepOrder)
  });
  applyHistorySnapshot(state.redoStack.pop());
  showToast('Redid change');
}

function reorderStep(fromIdx, toIdx) {
  if (!state.activeDemo || !Array.isArray(state.activeDemo.steps)) return;
  const steps = state.activeDemo.steps;
  if (fromIdx < 0 || fromIdx >= steps.length || toIdx < 0 || toIdx >= steps.length || fromIdx === toIdx) return;

  pushUndoSnapshot();
  const [moved] = steps.splice(fromIdx, 1);
  steps.splice(toIdx, 0, moved);
  state.activeDemo.manualStepOrder = true;

  renderEditorStepsList();
  renderInspectorPanel();
  renderTimelineMarkers();
  renderHotspotOverlay();
  if (state.editorMode === 'preview') renderPreviewStepDots();
  scheduleAutoSave();
  refreshIcons();
}

function duplicateStep(stepId) {
  if (!state.activeDemo || !Array.isArray(state.activeDemo.steps)) return;
  const idx = state.activeDemo.steps.findIndex(s => s.id === stepId);
  if (idx === -1) return;

  pushUndoSnapshot();
  const original = state.activeDemo.steps[idx];
  const cloned = {
    ...original,
    id: `step-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 5)}`
  };
  state.activeDemo.steps.splice(idx + 1, 0, cloned);
  state.selectedStepId = cloned.id;

  renderEditorStepsList();
  renderInspectorPanel();
  renderTimelineMarkers();
  renderHotspotOverlay();
  if (state.editorMode === 'preview') renderPreviewStepDots();
  scheduleAutoSave();
  refreshIcons();
  showToast(isStepExplainer(cloned) ? 'Duplicated explainer' : 'Duplicated step');
}

function getSelectedStep() {
  if (!state.activeDemo || !Array.isArray(state.activeDemo.steps)) return null;
  return state.activeDemo.steps.find(s => s.id === state.selectedStepId) || null;
}

function insertBlankStepAfter(index) {
  if (!state.activeDemo) return;
  pushUndoSnapshot();
  const numberedCount = (state.activeDemo.steps || []).filter(s => !isStepExplainer(s)).length;
  const prevStep = state.activeDemo.steps[index] || getSelectedStep();
  const inheritedImageUrl = (!demoHasVideo(state.activeDemo) && prevStep && prevStep.imageUrl) ? prevStep.imageUrl : '';
  const inheritedImageName = (!demoHasVideo(state.activeDemo) && prevStep && prevStep.imageName) ? prevStep.imageName : '';
  const newStep = {
    id: `step-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 5)}`,
    type: 'hotspot',
    isExplainer: false,
    showKicker: true,
    showTitle: true,
    showBody: true,
    showPrimaryBtn: true,
    showBackBtn: true,
    showProgress: true,
    screenLayout: 'default',
    backdrop: 'blur',
    kicker: '',
    timestamp: Number(mediaGetTime().toFixed(1)),
    title: `Step ${numberedCount + 1}: Click here`,
    body: 'Click the highlighted hotspot to continue.',
    x: 50,
    y: 50,
    style: 'beacon',
    placement: 'auto',
    buttonText: 'Continue',
    advanceOnHotspotClick: true,
    ctaUrl: '',
    imageUrl: inheritedImageUrl,
    imageName: inheritedImageName
  };
  state.activeDemo.steps.splice(index + 1, 0, newStep);
  state.activeDemo.manualStepOrder = true;
  state.selectedStepId = newStep.id;
  renderEditorStepsList();
  renderInspectorPanel();
  renderTimelineMarkers();
  renderHotspotOverlay();
  scheduleAutoSave();
  refreshIcons();
  showToast('Added step');
}

function renderEditorStepsList() {
  const listEl = document.getElementById('steps-list');
  listEl.innerHTML = '';

  if (!state.activeDemo) return;
  const hasVideo = demoHasVideo(state.activeDemo);

  state.activeDemo.steps.forEach((step, idx) => {
    const isScreen = getStepType(step) === 'screen';
    const pos = getNumberedStepPosition(state.activeDemo.steps, idx);
    const hasShot = Boolean(step.imageUrl);
    const titleText = step.title || (pos.isExplainer ? 'Explainer' : `Step ${pos.number}`);

    const card = document.createElement('div');
    card.className = `step-thumb-card ${step.id === state.selectedStepId ? 'active' : ''}`;
    card.draggable = true;
    card.dataset.stepId = step.id;
    card.innerHTML = `
      <div class="step-thumb-media">
        ${hasShot
          ? `<img src="${escapeHtml(step.imageUrl)}" alt="" loading="lazy" />`
          : `<div class="step-thumb-screen-mock">${escapeHtml(isScreen ? (step.kicker || titleText) : (hasVideo ? formatSeconds(step.timestamp) : titleText))}</div>`}
        <div class="step-thumb-badge ${pos.isExplainer ? 'is-explainer' : ''}" title="${pos.isExplainer ? 'Explainer (not a step)' : (isScreen ? 'Text Page' : 'Hotspot Step')}">
          ${pos.isExplainer ? '<i data-lucide="book-open"></i>' : (isScreen ? '<i data-lucide="layout-template"></i>' : pos.number)}
        </div>
        <div class="step-thumb-actions">
          <button type="button" class="step-thumb-act-btn step-dup-btn" data-dup-step="${step.id}" title="Duplicate">
            <i data-lucide="copy"></i>
          </button>
          <button type="button" class="step-thumb-act-btn step-del-btn" data-del-step="${step.id}" title="Delete">
            <i data-lucide="trash-2"></i>
          </button>
        </div>
      </div>
      <div class="step-thumb-footer">
        <div class="step-thumb-title">${escapeHtml(titleText)}</div>
      </div>
    `;

    card.addEventListener('dragstart', e => {
      draggedStepId = step.id;
      card.classList.add('is-dragging');
      if (e.dataTransfer) {
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', step.id);
      }
    });
    card.addEventListener('dragover', e => {
      if (!draggedStepId || draggedStepId === step.id) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
      const rect = card.getBoundingClientRect();
      const isTop = (e.clientY - rect.top) < rect.height / 2;
      listEl.querySelectorAll('.step-thumb-card').forEach(c => {
        if (c !== card) c.classList.remove('drag-over-top', 'drag-over-bottom');
      });
      card.classList.toggle('drag-over-top', isTop);
      card.classList.toggle('drag-over-bottom', !isTop);
    });
    card.addEventListener('dragleave', () => {
      card.classList.remove('drag-over-top', 'drag-over-bottom');
    });
    card.addEventListener('drop', e => {
      e.preventDefault();
      card.classList.remove('drag-over-top', 'drag-over-bottom');
      const sourceId = draggedStepId || e.dataTransfer?.getData('text/plain');
      if (!sourceId || sourceId === step.id) return;
      const steps = state.activeDemo.steps;
      const fromIdx = steps.findIndex(s => s.id === sourceId);
      const targetIdx = steps.findIndex(s => s.id === step.id);
      if (fromIdx === -1 || targetIdx === -1) return;
      const rect = card.getBoundingClientRect();
      const isTop = (e.clientY - rect.top) < rect.height / 2;
      let toIdx = isTop ? targetIdx : targetIdx + 1;
      if (fromIdx < toIdx) toIdx -= 1;
      reorderStep(fromIdx, toIdx);
    });
    card.addEventListener('dragend', () => {
      draggedStepId = null;
      listEl.querySelectorAll('.step-thumb-card').forEach(c => {
        c.classList.remove('is-dragging', 'drag-over-top', 'drag-over-bottom');
      });
    });

    const dupBtn = card.querySelector('.step-dup-btn');
    if (dupBtn) {
      dupBtn.addEventListener('click', e => {
        e.stopPropagation();
        duplicateStep(step.id);
      });
    }
    const delBtn = card.querySelector('.step-del-btn');
    if (delBtn) {
      delBtn.addEventListener('click', e => {
        e.stopPropagation();
        pushUndoSnapshot();
        state.activeDemo.steps = state.activeDemo.steps.filter(s => s.id !== step.id);
        if (state.selectedStepId === step.id) {
          state.selectedStepId = state.activeDemo.steps[Math.max(0, idx - 1)]?.id || null;
        }
        setupEditorVideoSource();
        renderEditorStepsList();
        renderInspectorPanel();
        renderTimelineMarkers();
        renderHotspotOverlay();
        scheduleAutoSave();
        refreshIcons();
      });
    }

    card.addEventListener('click', () => {
      state.selectedStepId = step.id;
      mediaPause();
      if (!step.imageUrl && hasVideo) {
        mediaSetTime(Number(step.timestamp || 0));
      }
      renderEditorStepsList();
      renderInspectorPanel();
      renderTimelineMarkers();
      renderHotspotOverlay();
      refreshIcons();
    });
    listEl.appendChild(card);

    const insertBtn = document.createElement('button');
    insertBtn.type = 'button';
    insertBtn.className = 'step-insert-btn';
    insertBtn.innerHTML = `<i data-lucide="plus"></i><span>Add Step</span>`;
    insertBtn.addEventListener('click', () => insertBlankStepAfter(idx));
    listEl.appendChild(insertBtn);
  });
}

function renderInspectorPanel() {
  const step = getSelectedStep();
  const emptyEl = document.getElementById('inspector-empty');
  const formEl = document.getElementById('inspector-form');
  const badgeEl = document.getElementById('inspector-step-badge');
  const delBtn = document.getElementById('btn-delete-step');
  const overlay = document.getElementById('hotspot-overlay');

  if (!step) {
    emptyEl.classList.remove('hidden');
    formEl.classList.add('hidden');
    if (delBtn) delBtn.classList.add('hidden');
    badgeEl.textContent = '0 / 0';
    return;
  }

  emptyEl.classList.add('hidden');
  formEl.classList.remove('hidden');
  if (delBtn) delBtn.classList.remove('hidden');

  const idx = state.activeDemo.steps.findIndex(s => s.id === step.id);
  const pos = getNumberedStepPosition(state.activeDemo.steps, idx);
  const panelTitleEl = document.getElementById('inspector-panel-title');
  if (panelTitleEl) panelTitleEl.textContent = pos.isExplainer ? 'Explainer' : 'Step';
  badgeEl.textContent = pos.isExplainer ? 'Explainer' : `${pos.number} / ${pos.total}`;

  const stepType = getStepType(step);
  document.querySelectorAll('#step-type-switcher .type-pill-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.stepType === stepType);
  });

  // Screenshot inspector status & controls
  const hasShot = Boolean(step.imageUrl);
  const hasVideo = demoHasVideo(state.activeDemo);
  const shotBtnLabel = document.getElementById('step-screenshot-btn-label');
  const clearShotBtn = document.getElementById('btn-clear-step-screenshot');
  const snapFrameBtn = document.getElementById('btn-snap-video-frame');
  const shotStatus = document.getElementById('step-screenshot-status');
  const timestampGroup = document.getElementById('step-timestamp-group');

  const isScreen = stepType === 'screen';
  if (shotBtnLabel) shotBtnLabel.textContent = hasShot ? 'Replace' : 'Upload';
  if (clearShotBtn) clearShotBtn.classList.toggle('hidden', !hasShot || (!hasVideo && !isScreen));
  if (snapFrameBtn) snapFrameBtn.classList.toggle('hidden', !hasVideo);
  if (shotStatus) {
    shotStatus.textContent = hasShot
      ? `Screenshot: ${step.imageName || 'Custom image attached'}`
      : (isScreen ? 'Optional: add an image for 50/50 split' : 'Or press ⌘V to paste a screenshot');
    shotStatus.classList.toggle('active-shot', hasShot);
  }
  if (timestampGroup) {
    timestampGroup.classList.toggle('hidden', hasShot || !hasVideo);
  }

  // Toggle fields based on Hotspot vs Text Screen vs Explainer Tooltip
  const isExplainerType = stepType === 'explainer';
  const isHotspot = stepType === 'hotspot';
  const isTrace = isHotspot && step.style === 'trace';
  document.getElementById('screen-kicker-group').classList.toggle('hidden', !(isScreen || isExplainerType));
  document.getElementById('screen-only-fields').classList.toggle('hidden', !isScreen);
  document.getElementById('hotspot-only-fields').classList.toggle('hidden', !isHotspot);
  document.getElementById('hotspot-advance-group').classList.toggle('hidden', !isHotspot);
  const tooltipToggleEl = document.getElementById('hotspot-tooltip-toggle');
  if (tooltipToggleEl) tooltipToggleEl.classList.toggle('hidden', !isHotspot);
  const traceFieldsEl = document.getElementById('trace-only-fields');
  if (traceFieldsEl) traceFieldsEl.classList.toggle('hidden', !isTrace);
  if (overlay && state.editorMode === 'edit') {
    overlay.classList.toggle('edit-cursor', !isScreen);
  }

  document.getElementById('step-kicker-input').value = step.kicker || '';
  document.getElementById('step-title-input').value = step.title || '';
  document.getElementById('step-body-input').value = step.body || '';
  document.getElementById('step-timestamp-input').value = Number(step.timestamp || 0).toFixed(1);
  document.getElementById('step-placement-select').value = step.placement || 'auto';
  const resolvedStyle = ['ring', 'trace'].includes(step.style) ? step.style : 'beacon';
  document.getElementById('step-style-select').value = resolvedStyle;
  document.querySelectorAll('#step-style-cards .style-card-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.style === resolvedStyle);
  });
  const resolvedAlign = step.textAlign || (isScreen ? 'center' : 'left');
  document.querySelectorAll('#step-align-switcher .type-pill-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.align === resolvedAlign);
  });
  const bgColor = (step.cardBgColor || '#FFFFFF').toUpperCase();
  const textColor = (step.cardTextColor || '#00182C').toUpperCase();
  const bgInp = document.getElementById('step-bg-color');
  const txtInp = document.getElementById('step-text-color');
  const bgHex = document.getElementById('step-bg-color-hex');
  const txtHex = document.getElementById('step-text-color-hex');
  if (bgInp) bgInp.value = bgColor;
  if (txtInp) txtInp.value = textColor;
  if (bgHex) bgHex.textContent = bgColor;
  if (txtHex) txtHex.textContent = textColor;
  const radSel = document.getElementById('step-radius-select');
  if (radSel) radSel.value = step.cardRadius || 'round';
  const zoomVal = Number(step.zoom || 1);
  const zoomSel = document.getElementById('step-zoom-select');
  if (zoomSel) zoomSel.value = String(zoomVal > 1 ? zoomVal : 1);
  const zoomToolbarBtn = document.getElementById('btn-stage-zoom-pan');
  if (zoomToolbarBtn) zoomToolbarBtn.classList.toggle('active', zoomVal > 1);
  const showTip = step.showTooltip !== false;
  const showTipEl = document.getElementById('step-show-tooltip');
  if (showTipEl) showTipEl.checked = showTip;
  document.querySelectorAll('#step-tooltip-switcher .type-pill-btn').forEach(btn => {
    btn.classList.toggle('active', (btn.dataset.tooltipVis === 'visible') === showTip);
  });
  const showKickerEl = document.getElementById('step-show-kicker');
  if (showKickerEl) showKickerEl.checked = step.showKicker !== false;
  const showTitleEl = document.getElementById('step-show-title');
  if (showTitleEl) showTitleEl.checked = step.showTitle !== false;
  const showBodyEl = document.getElementById('step-show-body');
  if (showBodyEl) showBodyEl.checked = step.showBody !== false;
  const showPrimaryBtnEl = document.getElementById('step-show-primary-btn');
  if (showPrimaryBtnEl) showPrimaryBtnEl.checked = step.showPrimaryBtn !== undefined ? Boolean(step.showPrimaryBtn) : step.showButtons !== false;
  const showBackBtnEl = document.getElementById('step-show-back-btn');
  if (showBackBtnEl) showBackBtnEl.checked = step.showBackBtn !== undefined ? Boolean(step.showBackBtn) : step.showButtons !== false;
  const showProgressEl = document.getElementById('step-show-progress');
  if (showProgressEl) showProgressEl.checked = step.showProgress !== undefined ? Boolean(step.showProgress) : !isExplainerType;
  const screenLayout = ['split', 'image'].includes(step.screenLayout) ? step.screenLayout : 'default';
  document.querySelectorAll('#step-screen-layout-switcher .type-pill-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.screenLayout === screenLayout);
  });
  document.getElementById('step-backdrop-select').value = step.backdrop || 'blur';
  document.getElementById('step-btn-text-input').value = step.buttonText || 'Next';
  document.getElementById('coord-x-val').textContent = `${Math.round(step.x)}%`;
  document.getElementById('coord-y-val').textContent = `${Math.round(step.y)}%`;
  document.getElementById('step-advance-hotspot').checked = step.advanceOnHotspotClick !== false;
  document.getElementById('step-cta-url-input').value = step.ctaUrl || '';
}

function renderTimelineMarkers() {
  const markersEl = document.getElementById('timeline-markers');
  if (!markersEl || !state.activeDemo) return;
  markersEl.innerHTML = '';

  const duration = mediaGetDuration();

  state.activeDemo.steps.forEach((step, idx) => {
    const isScreen = getStepType(step) === 'screen';
    const pos = getNumberedStepPosition(state.activeDemo.steps, idx);
    const pct = Math.max(0, Math.min(100, (Number(step.timestamp || 0) / duration) * 100));
    const pin = document.createElement('div');
    pin.className = `timeline-pin ${isScreen ? 'screen-pin' : ''} ${pos.isExplainer ? 'explainer-pin' : ''} ${step.id === state.selectedStepId ? 'active' : ''}`;
    pin.style.left = `${pct}%`;
    pin.title = pos.isExplainer
      ? `Explainer: ${step.title} (${formatSeconds(step.timestamp)})`
      : `Step ${pos.number} (${isScreen ? 'Text Screen' : 'Hotspot'}): ${step.title} (${formatSeconds(step.timestamp)})`;
    pin.textContent = pos.isExplainer ? 'E' : pos.number;
    pin.addEventListener('click', e => {
      e.stopPropagation();
      state.selectedStepId = step.id;
      mediaPause();
      if (!step.imageUrl && demoHasVideo(state.activeDemo)) {
        mediaSetTime(Number(step.timestamp || 0));
      }
      renderEditorStepsList();
      renderInspectorPanel();
      renderTimelineMarkers();
      renderHotspotOverlay();
    });
    markersEl.appendChild(pin);
  });
}

function resolvePlacementClass(step) {
  const x = Number(step.x || 50);
  const y = Number(step.y || 50);
  let placement = step.placement || 'auto';

  if (placement === 'auto') {
    if (state.videoAspectRatio && state.videoAspectRatio < 0.85) {
      placement = y < 52 ? 'bottom' : 'top';
    } else {
      if (x < 38) placement = 'right';
      else if (x > 62) placement = 'left';
      else if (y < 50) placement = 'bottom';
      else placement = 'top';
    }
  }

  const classes = [`place-${placement}`];
  if (placement === 'left' || placement === 'right') {
    if (y > 74) classes.push('edge-bottom');
    else if (y < 26) classes.push('edge-top');
  } else if (placement === 'top' || placement === 'bottom') {
    if (x > 68) classes.push('edge-right');
    else if (x < 32) classes.push('edge-left');
  }
  return classes.join(' ');
}

function getStepZoomTransform(step) {
  if (!step) return { z: 1, zx: 50, zy: 50 };
  const stepType = getStepType(step);
  if (stepType === 'screen' && step.screenLayout !== 'image') {
    return { z: 1, zx: 50, zy: 50 };
  }
  const z = Math.max(1, Math.min(3, Number(step.zoom || 1)));
  const zx = Math.max(0, Math.min(100, Number(step.zoomX !== undefined ? step.zoomX : (step.x ?? 50))));
  const zy = Math.max(0, Math.min(100, Number(step.zoomY !== undefined ? step.zoomY : (step.y ?? 50))));
  return { z, zx, zy };
}

function applyStageZoomForStep(step) {
  const { z, zx, zy } = getStepZoomTransform(step);
  ['demo-video', 'sample-video-canvas', 'demo-step-image'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.style.transformOrigin = `${zx}% ${zy}%`;
    el.style.transform = z > 1 ? `scale(${z})` : 'scale(1)';
  });
}

let overlayRenderSeq = 0;

function renderHotspotOverlay() {
  const seq = ++overlayRenderSeq;
  const overlay = document.getElementById('hotspot-overlay');
  const screenOverlay = document.getElementById('stage-screen-overlay');
  if (!overlay || !state.activeDemo) return;
  overlay.innerHTML = '';
  if (screenOverlay) {
    screenOverlay.innerHTML = '';
    screenOverlay.classList.add('hidden');
  }

  const steps = state.activeDemo.steps || [];
  if (steps.length === 0) {
    syncViewportSize();
    return;
  }

  if (state.editorMode === 'edit') {
    const step = getSelectedStep();
    if (!step) {
      syncViewportSize();
      return;
    }
    const stepIdx = steps.findIndex(s => s.id === step.id);
    syncStageMediaForStep(step, () => {
      if (seq !== overlayRenderSeq) return;
      syncViewportSize();
      renderStepOnStage(overlay, step, stepIdx, steps.length, false);
      refreshIcons(overlay);
      if (screenOverlay) refreshIcons(screenOverlay);
    });
  } else {
    const step = steps[state.previewStepIndex];
    if (!state.previewWaitingForClick) {
      // Playing video between steps -> ensure video/canvas is visible, not a static screenshot
      applyStageZoomForStep(null);
      syncStageMediaForStep(null);
      syncViewportSize();
      return;
    }
    if (!step) {
      syncViewportSize();
      return;
    }
    syncStageMediaForStep(step, () => {
      if (seq !== overlayRenderSeq) return;
      syncViewportSize();
      renderStepOnStage(overlay, step, state.previewStepIndex, steps.length, true);
      refreshIcons(overlay);
      if (screenOverlay) refreshIcons(screenOverlay);
    });
  }
}

function renderStepOnStage(overlay, step, stepIndex, totalSteps, isPreview) {
  const stepType = getStepType(step);
  applyStageZoomForStep(step);
  const { z, zx, zy } = getStepZoomTransform(step);
  const pos = getNumberedStepPosition(state.activeDemo?.steps, stepIndex);
  const progressPct = pos.total > 0 ? Math.round((pos.number / pos.total) * 100) : 100;
  const isLast = stepIndex === totalSteps - 1;
  const btnText = step.buttonText || (isLast ? 'Finish' : 'Next');
  const showKicker = step.showKicker !== false;
  const showTitle = step.showTitle !== false;
  const showBody = step.showBody !== false && Boolean(step.body && step.body.trim());
  const showPrimaryBtn = step.showPrimaryBtn !== undefined ? Boolean(step.showPrimaryBtn) : step.showButtons !== false;
  const showBackBtn = step.showBackBtn !== undefined ? Boolean(step.showBackBtn) : step.showButtons !== false;
  const showAnyAction = (showBackBtn && stepIndex > 0) || Boolean(step.ctaUrl) || showPrimaryBtn;
  const showProgress = step.showProgress !== undefined ? Boolean(step.showProgress) : !pos.isExplainer;

  const radiusPx = step.cardRadius === 'sharp' ? '4px' : (step.cardRadius === 'pill' ? '20px' : (stepType === 'screen' ? '16px' : '12px'));
  const customBg = step.cardBgColor || '';
  const customText = step.cardTextColor || '';
  const applyCardCustomStyles = (el, defaultAlign) => {
    if (!el) return;
    const align = step.textAlign || defaultAlign;
    el.style.textAlign = align;
    el.style.alignItems = align === 'center' ? 'center' : (align === 'right' ? 'flex-end' : 'flex-start');
    if (customBg) el.style.background = customBg;
    if (customText) {
      el.style.color = customText;
      el.querySelectorAll('.text-screen-title, .text-screen-body, .tooltip-title, .tooltip-body').forEach(t => {
        t.style.color = customText;
      });
    }
    if (stepType !== 'screen' || step.screenLayout !== 'split') {
      el.style.borderRadius = radiusPx;
    }
  };

  // CASE 1: INTRO / CHAPTER / OUTRO TEXT PAGE (Default Full-Stage, 50/50 Split, or Image Only)
  if (stepType === 'screen') {
    if (step.screenLayout === 'image') {
      if (isPreview) {
        const imgEl = document.getElementById('demo-step-image');
        if (imgEl) {
          imgEl.style.cursor = 'pointer';
          imgEl.onclick = () => advancePreviewStep();
        }
      }
      return;
    }
    const screenOverlay = document.getElementById('stage-screen-overlay') || overlay;
    screenOverlay.classList.remove('hidden');
    const backdropMode = step.backdrop || 'blur';
    const screenEl = document.createElement('div');
    screenEl.className = `demo-text-screen backdrop-${backdropMode}`;
    screenEl.innerHTML = `
      <div class="text-screen-card">
        ${showKicker ? `<div class="text-screen-kicker" id="active-stage-kicker">${step.kicker ? escapeHtml(step.kicker) : (pos.isExplainer ? 'Explainer' : `Step ${pos.number} of ${pos.total}`)}</div>` : ''}
        ${showTitle ? `<h2 class="text-screen-title" id="active-stage-title">${escapeHtml(step.title || (pos.isExplainer ? 'Explainer' : `Step ${pos.number}`))}</h2>` : ''}
        ${showBody ? `<p class="text-screen-body" id="active-stage-body">${escapeHtml(step.body || '')}</p>` : ''}
        ${showAnyAction ? `
          <div class="text-screen-actions">
            ${showBackBtn && stepIndex > 0 ? `<button type="button" class="btn btn-sm btn-ghost" data-step-nav="prev">Back</button>` : ''}
            ${step.ctaUrl ? `<a href="${escapeHtml(step.ctaUrl)}" target="_blank" rel="noopener" class="btn btn-sm btn-outline">Open Link</a>` : ''}
            ${showPrimaryBtn ? `
              <button type="button" class="text-screen-btn-primary" data-step-nav="next">
                <span id="active-stage-btn-text">${escapeHtml(btnText)}</span>
                <i data-lucide="arrow-right"></i>
              </button>
            ` : ''}
          </div>
        ` : ''}
        ${showProgress ? `
          <div class="tooltip-progress-bar" style="width:100%; margin-top:8px; margin-bottom:0;">
            <div class="tooltip-progress-fill" style="width: ${progressPct}%"></div>
          </div>
        ` : ''}
      </div>
    `;
    screenEl.addEventListener('pointerdown', e => e.stopPropagation());
    screenEl.addEventListener('click', e => e.stopPropagation());
    applyCardCustomStyles(screenEl.querySelector('.text-screen-card'), step.screenLayout === 'split' ? 'left' : 'center');
    bindStepCardNavigation(screenEl, stepIndex, totalSteps, isPreview);
    screenOverlay.appendChild(screenEl);
    return;
  }

  // CASE 1B: EXPLAINER TOOLTIP (Floating tooltip card, not a page, not a numbered step)
  if (stepType === 'explainer') {
    const adjX = zx + (Number(step.x ?? 50) - zx) * z;
    const adjY = zy + (Number(step.y ?? 50) - zy) * z;
    const anchor = document.createElement('div');
    anchor.className = 'hotspot-anchor';
    anchor.id = 'active-hotspot-anchor';
    anchor.style.left = `${adjX}%`;
    anchor.style.top = `${adjY}%`;

    const tooltip = document.createElement('div');
    tooltip.id = 'active-hotspot-tooltip';
    tooltip.className = `hotspot-tooltip is-explainer-tooltip ${isPreview ? 'is-preview' : ''}`;
    tooltip.innerHTML = `
      ${showKicker ? `
        <div class="tooltip-step-top">
          <span class="tooltip-step-counter" id="active-stage-kicker">${escapeHtml(step.kicker || 'Explainer')}</span>
        </div>
      ` : ''}
      ${showTitle ? `<h3 class="tooltip-title" id="active-stage-title">${escapeHtml(step.title || 'Explainer')}</h3>` : ''}
      ${showBody ? `<p class="tooltip-body" id="active-stage-body">${escapeHtml(step.body || '')}</p>` : ''}
      ${showAnyAction ? `
        <div class="tooltip-footer">
          ${showBackBtn && stepIndex > 0 ? `<button type="button" class="btn btn-xs btn-ghost" data-step-nav="prev">Back</button>` : `<span></span>`}
          <div style="display:flex; gap:6px;">
            ${step.ctaUrl ? `<a href="${escapeHtml(step.ctaUrl)}" target="_blank" rel="noopener" class="btn btn-xs btn-outline">Open Link</a>` : ''}
            ${showPrimaryBtn ? `<button type="button" class="btn btn-xs btn-primary" data-step-nav="next"><span id="active-stage-btn-text">${escapeHtml(btnText)}</span></button>` : ''}
          </div>
        </div>
      ` : ''}
      ${showProgress ? `
        <div class="tooltip-progress-bar">
          <div class="tooltip-progress-fill" style="width: ${progressPct}%"></div>
        </div>
      ` : ''}
    `;

    if (!isPreview) {
      tooltip.addEventListener('pointerdown', e => {
        if (e.target.closest('button, a')) return;
        e.stopPropagation();
        e.preventDefault();
        state.isDraggingHotspot = true;
        state.traceAction = null;
      });
    } else {
      tooltip.addEventListener('pointerdown', e => e.stopPropagation());
    }
    tooltip.addEventListener('click', e => e.stopPropagation());
    applyCardCustomStyles(tooltip, 'left');
    bindStepCardNavigation(tooltip, stepIndex, totalSteps, isPreview);
    anchor.appendChild(tooltip);
    overlay.appendChild(anchor);
    return;
  }

  // CASE 2: ANCHORED HOTSPOT PIN OR BUTTON TRACE BOX + TOOLTIP
  const isTrace = step.style === 'trace';
  if (isTrace) {
    if (!step.w) step.w = 16;
    if (!step.h) step.h = 8;
  }

  const anchor = document.createElement('div');
  anchor.className = `hotspot-anchor ${isTrace ? 'is-trace-anchor' : ''}`;
  anchor.id = 'active-hotspot-anchor';
  const adjX = zx + (Number(step.x ?? 50) - zx) * z;
  const adjY = zy + (Number(step.y ?? 50) - zy) * z;
  anchor.style.left = `${adjX}%`;
  anchor.style.top = `${adjY}%`;
  if (isTrace) {
    anchor.style.width = `${Number(step.w || 16) * z}%`;
    anchor.style.height = `${Number(step.h || 8) * z}%`;
  }

  if (isTrace) {
    const traceBox = document.createElement('div');
    traceBox.className = `hotspot-trace-box ${isPreview ? 'is-preview' : ''}`;

    if (!isPreview) {
      traceBox.addEventListener('pointerdown', e => {
        if (e.target.closest('.trace-resize-handle')) return;
        e.stopPropagation();
        e.preventDefault();
        const rect = overlay.getBoundingClientRect();
        state.isDraggingHotspot = true;
        state.traceAction = 'move';
        state.traceDragStart = {
          clientX: e.clientX,
          clientY: e.clientY,
          rectW: rect.width,
          rectH: rect.height,
          startX: Number(step.x || 50),
          startY: Number(step.y || 50)
        };
      });

      const dirs = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
      dirs.forEach(dir => {
        const handle = document.createElement('span');
        handle.className = `trace-resize-handle handle-${dir}`;
        handle.dataset.dir = dir;
        handle.addEventListener('pointerdown', e => {
          e.stopPropagation();
          e.preventDefault();
          const rect = overlay.getBoundingClientRect();
          state.isDraggingHotspot = true;
          state.traceAction = 'resize';
          state.traceResizeDir = dir;
          state.traceDragStart = {
            clientX: e.clientX,
            clientY: e.clientY,
            rectW: rect.width,
            rectH: rect.height,
            startX: Number(step.x || 50),
            startY: Number(step.y || 50),
            startW: Number(step.w || 16),
            startH: Number(step.h || 8)
          };
        });
        traceBox.appendChild(handle);
      });
    } else if (step.advanceOnHotspotClick !== false) {
      traceBox.addEventListener('click', e => {
        e.stopPropagation();
        advancePreviewStep();
      });
    }

    anchor.appendChild(traceBox);
  } else {
    const pin = document.createElement('div');
    pin.className = 'hotspot-pin';
    if (step.style === 'ring') {
      pin.innerHTML = `<div class="hotspot-ring"></div>`;
    } else {
      pin.innerHTML = `<div class="hotspot-beacon">${pos.number}</div>`;
    }

    if (!isPreview) {
      pin.addEventListener('pointerdown', e => {
        e.stopPropagation();
        e.preventDefault();
        state.isDraggingHotspot = true;
        state.traceAction = null;
      });
    } else if (step.advanceOnHotspotClick !== false) {
      pin.addEventListener('click', e => {
        e.stopPropagation();
        advancePreviewStep();
      });
    }

    anchor.appendChild(pin);
  }

  const shouldShowTooltip = step.showTooltip !== false;
  if (shouldShowTooltip) {
    const tooltip = document.createElement('div');
    tooltip.id = 'active-hotspot-tooltip';
    tooltip.className = `hotspot-tooltip ${resolvePlacementClass(step)}`;
    tooltip.innerHTML = `
      ${showKicker ? `
        <div class="tooltip-step-top">
          <span class="tooltip-step-counter">Step ${pos.number} of ${pos.total}</span>
        </div>
      ` : ''}
      ${showTitle ? `<h3 class="tooltip-title" id="active-stage-title">${escapeHtml(step.title || `Step ${pos.number}`)}</h3>` : ''}
      ${showBody ? `<p class="tooltip-body" id="active-stage-body">${escapeHtml(step.body || '')}</p>` : ''}
      ${showAnyAction ? `
        <div class="tooltip-footer">
          ${showBackBtn && stepIndex > 0 ? `<button type="button" class="btn btn-xs btn-ghost" data-step-nav="prev">Back</button>` : `<span></span>`}
          <div style="display:flex; gap:6px;">
            ${step.ctaUrl ? `<a href="${escapeHtml(step.ctaUrl)}" target="_blank" rel="noopener" class="btn btn-xs btn-outline">Open Link</a>` : ''}
            ${showPrimaryBtn ? `<button type="button" class="btn btn-xs btn-primary" data-step-nav="next"><span id="active-stage-btn-text">${escapeHtml(btnText)}</span></button>` : ''}
          </div>
        </div>
      ` : ''}
      ${showProgress ? `
        <div class="tooltip-progress-bar">
          <div class="tooltip-progress-fill" style="width: ${progressPct}%"></div>
        </div>
      ` : ''}
    `;

    tooltip.addEventListener('pointerdown', e => e.stopPropagation());
    tooltip.addEventListener('click', e => e.stopPropagation());
    applyCardCustomStyles(tooltip, 'left');
    bindStepCardNavigation(tooltip, stepIndex, totalSteps, isPreview);
    anchor.appendChild(tooltip);
  }

  overlay.appendChild(anchor);
}

function bindStepCardNavigation(container, stepIndex, totalSteps, isPreview) {
  const prevBtn = container.querySelector('[data-step-nav="prev"]');
  if (prevBtn) {
    prevBtn.addEventListener('click', e => {
      e.stopPropagation();
      if (isPreview) {
        jumpToPreviewStep(stepIndex - 1);
      } else if (stepIndex > 0) {
        const target = state.activeDemo.steps[stepIndex - 1];
        state.selectedStepId = target.id;
        mediaPause();
        if (!target.imageUrl && demoHasVideo(state.activeDemo)) {
          mediaSetTime(target.timestamp);
        }
        renderEditorStepsList();
        renderInspectorPanel();
        renderTimelineMarkers();
        renderHotspotOverlay();
      }
    });
  }

  const nextBtn = container.querySelector('[data-step-nav="next"]');
  if (nextBtn) {
    nextBtn.addEventListener('click', e => {
      e.stopPropagation();
      if (isPreview) {
        advancePreviewStep();
      } else if (stepIndex + 1 < totalSteps) {
        const target = state.activeDemo.steps[stepIndex + 1];
        state.selectedStepId = target.id;
        mediaPause();
        if (!target.imageUrl && demoHasVideo(state.activeDemo)) {
          mediaSetTime(target.timestamp);
        }
        renderEditorStepsList();
        renderInspectorPanel();
        renderTimelineMarkers();
        renderHotspotOverlay();
      } else if (totalSteps > 0) {
        const first = state.activeDemo.steps[0];
        state.selectedStepId = first.id;
        mediaPause();
        if (!first.imageUrl && demoHasVideo(state.activeDemo)) {
          mediaSetTime(first.timestamp);
        }
        renderEditorStepsList();
        renderInspectorPanel();
        renderTimelineMarkers();
        renderHotspotOverlay();
        showToast('Restarted from Step 1');
      }
    });
  }
}

// =========================================================
// INTERACTIVE PREVIEW ENGINE
// =========================================================
function startInteractivePreview() {
  const steps = state.activeDemo?.steps || [];
  state.previewStepIndex = 0;

  renderPreviewStepDots();

  if (steps.length === 0) {
    state.previewWaitingForClick = false;
    updatePreviewStatusPill('Playing', true);
    mediaSetTime(0, true);
    mediaPlay();
    renderHotspotOverlay();
    return;
  }

  const firstStep = steps[0];
  if (firstStep.imageUrl || !demoHasVideo(state.activeDemo) || Number(firstStep.timestamp) <= 0.25) {
    state.previewWaitingForClick = true;
    mediaPause();
    if (!firstStep.imageUrl && demoHasVideo(state.activeDemo)) {
      mediaSetTime(Number(firstStep.timestamp), true);
    }
    const isScreen = getStepType(firstStep) === 'screen';
    const pos = getNumberedStepPosition(steps, 0);
    updatePreviewStatusPill(
      pos.isExplainer ? 'Explainer' : (isScreen ? 'Intro Screen' : `Step ${pos.number} — Click hotspot`),
      false
    );
    renderHotspotOverlay();
  } else {
    state.previewWaitingForClick = false;
    updatePreviewStatusPill('Playing...', true);
    renderHotspotOverlay();
    mediaSetTime(0, true);
    mediaPlay();
  }
}

function advancePreviewStep() {
  const steps = state.activeDemo?.steps || [];
  if (steps.length === 0) return;

  if (state.previewStepIndex + 1 < steps.length) {
    state.previewStepIndex += 1;
    const nextStep = steps[state.previewStepIndex];
    const currTime = mediaGetTime();

    // If next step is a screenshot, or demo has no video, or next step is at/before current timestamp: show immediately
    if (nextStep.imageUrl || !demoHasVideo(state.activeDemo) || Number(nextStep.timestamp || 0) <= currTime + 0.08) {
      jumpToPreviewStep(state.previewStepIndex);
      return;
    }

    state.previewWaitingForClick = false;
    renderPreviewStepDots();
    renderHotspotOverlay();
    const nextPos = getNumberedStepPosition(steps, state.previewStepIndex);
    updatePreviewStatusPill(
      nextPos.isExplainer ? 'Playing to Explainer...' : `Playing to Step ${nextPos.number}...`,
      true
    );
    mediaPlay();
  } else {
    state.previewWaitingForClick = false;
    renderHotspotOverlay();
    showToast('Restarting walkthrough');
    startInteractivePreview();
  }
}

function jumpToPreviewStep(index) {
  const steps = state.activeDemo?.steps || [];
  if (index < 0 || index >= steps.length) return;

  state.previewStepIndex = index;
  state.previewWaitingForClick = true;
  const targetStep = steps[index];
  mediaPause();
  if (!targetStep.imageUrl && demoHasVideo(state.activeDemo)) {
    mediaSetTime(Number(targetStep.timestamp || 0), true);
  }
  renderPreviewStepDots();
  const isScreen = getStepType(targetStep) === 'screen';
  const pos = getNumberedStepPosition(steps, index);
  updatePreviewStatusPill(
    pos.isExplainer ? 'Explainer' : (isScreen ? `Step ${pos.number} — Text Screen` : `Step ${pos.number} — Click hotspot`),
    false
  );
  renderHotspotOverlay();
}

function renderPreviewStepDots() {
  const container = document.getElementById('preview-step-dots');
  if (!container || !state.activeDemo) return;
  container.innerHTML = '';

  state.activeDemo.steps.forEach((step, idx) => {
    const pos = getNumberedStepPosition(state.activeDemo.steps, idx);
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `step-dot-btn ${pos.isExplainer ? 'is-explainer-dot' : ''} ${idx === state.previewStepIndex ? 'active' : ''}`;
    btn.title = step.title || (pos.isExplainer ? 'Explainer' : `Step ${pos.number}`);
    btn.innerHTML = pos.isExplainer ? '<i data-lucide="book-open"></i>' : String(pos.number);
    btn.addEventListener('click', () => jumpToPreviewStep(idx));
    container.appendChild(btn);
  });
  refreshIcons(container);
}

function updatePreviewStatusPill(text, isPlaying) {
  const pill = document.getElementById('preview-status-pill');
  const label = document.getElementById('preview-status-text');
  if (!pill || !label) return;
  label.textContent = text;
  pill.classList.toggle('playing', Boolean(isPlaying));
}

// =========================================================
// AUTO-SAVE & STEP CREATION (HOTSPOT + INTRO/TEXT SCREEN)
// =========================================================
function scheduleAutoSave() {
  if (!state.activeDemo) return;
  const saveEl = document.getElementById('save-status');
  saveEl.classList.remove('hidden');

  clearTimeout(state.saveTimeout);
  state.saveTimeout = setTimeout(async () => {
    await apiUpdateDemo(state.activeDemo);
  }, 300);
}

function addStepAtCurrentTime(x = 50, y = 50, stepType = 'hotspot', options = {}) {
  if (!state.activeDemo) return;
  mediaPause();
  pushUndoSnapshot();

  const isExplainer = stepType === 'explainer' || Boolean(options.isExplainer);
  const isScreen = !isExplainer && stepType === 'screen';
  const isIntro = isScreen && Boolean(options.isIntro);
  const hasSteps = state.activeDemo.steps && state.activeDemo.steps.length > 0;
  const timestamp = isIntro ? 0.0 : ((isScreen && !hasSteps) ? 0.0 : Number(mediaGetTime().toFixed(1)));
  const numberedCount = (state.activeDemo.steps || []).filter(s => !isStepExplainer(s)).length;
  const stepNum = numberedCount + 1;
  const activeStep = getSelectedStep();
  const inheritedImageUrl = (!isScreen && !demoHasVideo(state.activeDemo) && activeStep && activeStep.imageUrl) ? activeStep.imageUrl : '';
  const inheritedImageName = (!isScreen && !demoHasVideo(state.activeDemo) && activeStep && activeStep.imageName) ? activeStep.imageName : '';

  const newStep = {
    id: `step-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 5)}`,
    type: isExplainer ? 'explainer' : (isScreen ? 'screen' : 'hotspot'),
    isExplainer,
    showKicker: true,
    showTitle: true,
    showBody: true,
    showPrimaryBtn: true,
    showBackBtn: true,
    showProgress: !isExplainer,
    screenLayout: 'default',
    backdrop: isIntro ? 'dark' : 'blur',
    kicker: isExplainer ? 'Explainer' : (isIntro ? 'Welcome' : (isScreen ? (timestamp === 0 ? 'Welcome • Product Tour' : `Chapter ${stepNum}`) : '')),
    timestamp,
    title: isExplainer
      ? 'About this step'
      : (isIntro
        ? `${state.activeDemo.title}`
        : (isScreen
          ? (timestamp === 0 ? `Welcome to ${state.activeDemo.title}` : 'Key Takeaway')
          : `Step ${stepNum}: Click here`)),
    body: isExplainer
      ? 'Add context or background information here without counting this as a numbered step.'
      : (isScreen
        ? 'Introduce this section of the walkthrough before guiding the user through the next actions.'
        : 'Click the highlighted hotspot to continue.'),
    x: Math.round(x * 10) / 10,
    y: Math.round(y * 10) / 10,
    style: 'beacon',
    placement: 'auto',
    buttonText: (isIntro || (isScreen && timestamp === 0 && !isExplainer)) ? 'Start Tour' : 'Continue',
    advanceOnHotspotClick: true,
    ctaUrl: '',
    imageUrl: inheritedImageUrl,
    imageName: inheritedImageName
  };

  if (isIntro) {
    state.activeDemo.steps.unshift(newStep);
  } else {
    state.activeDemo.steps.push(newStep);
    sortActiveSteps();
  }
  state.selectedStepId = newStep.id;

  renderEditorStepsList();
  renderInspectorPanel();
  renderTimelineMarkers();
  renderHotspotOverlay();
  scheduleAutoSave();
  refreshIcons();
  showToast(isIntro ? 'Added Intro Screen' : (isExplainer ? 'Added Explainer' : (isScreen ? 'Added Text Screen' : 'Added Hotspot Step')));
}

async function addScreenshotStepsFromFiles(fileList) {
  if (!state.activeDemo || !fileList || fileList.length === 0) return;
  const files = Array.from(fileList).filter(f => f && f.type && f.type.startsWith('image/'));
  if (files.length === 0) {
    showToast('Please select image files (PNG, JPG, WebP)');
    return;
  }

  mediaPause();
  showToast(files.length === 1 ? 'Uploading screenshot...' : `Uploading ${files.length} screenshots...`);

  let firstCreatedId = null;
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const uploaded = await apiUploadScreenshot(state.activeDemo.id, file);
    const stepNum = (state.activeDemo.steps?.length || 0) + 1;
    const baseTitle = file.name
      ? file.name.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ')
      : 'Click here';

    const newStep = {
      id: `step-${Date.now().toString(36)}-${i}-${Math.random().toString(36).slice(2, 5)}`,
      type: 'hotspot',
      backdrop: 'blur',
      kicker: '',
      timestamp: Number((stepNum - 1).toFixed(1)),
      title: files.length > 1 ? `Step ${stepNum}: ${baseTitle}` : `Step ${stepNum}: Click here`,
      body: 'Click the highlighted hotspot on this screen to continue.',
      x: 50,
      y: 50,
      style: 'beacon',
      placement: 'auto',
      buttonText: 'Continue',
      advanceOnHotspotClick: true,
      ctaUrl: '',
      imageUrl: uploaded.imageUrl,
      imageName: uploaded.fileName
    };

    state.activeDemo.steps.push(newStep);
    if (!firstCreatedId) firstCreatedId = newStep.id;
  }

  state.selectedStepId = firstCreatedId || state.activeDemo.steps[0]?.id || null;
  setupEditorVideoSource();
  renderEditorStepsList();
  renderInspectorPanel();
  renderTimelineMarkers();
  renderHotspotOverlay();
  await apiUpdateDemo(state.activeDemo);
  refreshIcons();
  showToast(files.length === 1 ? 'Added screenshot step' : `Added ${files.length} screenshot steps`);
}

async function setScreenshotForCurrentStep(file) {
  if (!state.activeDemo || !file) return;
  let step = getSelectedStep();
  if (!step) {
    await addScreenshotStepsFromFiles([file]);
    return;
  }

  showToast('Uploading screenshot...');
  const uploaded = await apiUploadScreenshot(state.activeDemo.id, file);
  step.imageUrl = uploaded.imageUrl;
  step.imageName = uploaded.fileName;

  setupEditorVideoSource();
  renderEditorStepsList();
  renderInspectorPanel();
  renderTimelineMarkers();
  renderHotspotOverlay();
  scheduleAutoSave();
  refreshIcons();
  showToast('Screenshot attached to step');
}

async function snapCurrentVideoFrameToStep() {
  if (!state.activeDemo || !demoHasVideo(state.activeDemo)) {
    showToast('No video frame to capture');
    return;
  }

  const offCanvas = document.createElement('canvas');
  if (state.usingCanvasPlayer) {
    const srcCanvas = document.getElementById('sample-video-canvas');
    offCanvas.width = srcCanvas.width || 1280;
    offCanvas.height = srcCanvas.height || 720;
    offCanvas.getContext('2d').drawImage(srcCanvas, 0, 0);
  } else {
    const video = document.getElementById('demo-video');
    if (!video || !video.videoWidth || !video.videoHeight) {
      showToast('Video frame not ready yet');
      return;
    }
    offCanvas.width = video.videoWidth;
    offCanvas.height = video.videoHeight;
    offCanvas.getContext('2d').drawImage(video, 0, 0, offCanvas.width, offCanvas.height);
  }

  const blob = await new Promise(resolve => offCanvas.toBlob(resolve, 'image/png'));
  if (!blob) return;
  const timeLabel = formatSeconds(mediaGetTime()).replace(':', '-');
  const file = new File([blob], `frame-${timeLabel}.png`, { type: 'image/png' });
  await setScreenshotForCurrentStep(file);
}

// =========================================================
// WEBFLOW CUSTOM CODE EMBED & STANDALONE HTML GENERATOR
// =========================================================
function openWebflowModal(preselectedDemoId = null) {
  const modal = document.getElementById('modal-webflow');
  const select = document.getElementById('wf-select-demo');
  const urlInput = document.getElementById('wf-video-override');

  select.innerHTML = '';
  state.demos.forEach(d => {
    const opt = document.createElement('option');
    opt.value = d.id;
    opt.textContent = `${d.folderPath ? `[${d.folderPath}] ` : ''}${d.title}`;
    select.appendChild(opt);
  });

  const targetId = preselectedDemoId || state.activeDemo?.id || state.demos[0]?.id;
  if (targetId) select.value = targetId;

  const chosen = state.demos.find(d => d.id === select.value);
  urlInput.value = (chosen && chosen.videoUrl && chosen.videoUrl.startsWith('http')) ? chosen.videoUrl : '';

  modal.classList.remove('hidden');
  updateWebflowCodeOutput();
  refreshIcons();
}

function generateSingleDemoWebflowSnippet(demo, videoOverrideUrl = '') {
  if (!demo) return '<!-- No walkthrough selected -->';
  if (demo.kind === 'flow' && typeof generateFlowWebflowSnippet === 'function') {
    return generateFlowWebflowSnippet(demo);
  }
  const safeDemo = {
    id: demo.id,
    title: demo.title,
    description: demo.description,
    videoUrl: videoOverrideUrl || demo.videoUrl || '',
    steps: demo.steps || []
  };

  const widgetId = `bxlearn-${demo.id.replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const serialized = JSON.stringify(safeDemo);

  return `<!-- BxLearn Interactive Walkthrough Embed for Webflow (${demo.title}) -->
<link href="https://fonts.googleapis.com/css2?family=Host+Grotesk:wght@600&family=Google+Sans:wght@400;500&display=swap" rel="stylesheet">
<div id="${widgetId}" style="font-family:'Google Sans',sans-serif; color:#324158; max-width:960px; margin:0 auto;"></div>
<script>
(function(){
  const demo = ${serialized};
  const root = document.getElementById("${widgetId}");
  if (!root) return;
  let stepIdx = 0, waiting = false;
  root.innerHTML = \`
    <style>
      #${widgetId} .bx-wrap { background:#00182C; border-radius:16px; overflow:hidden; box-shadow:0 18px 44px rgba(0,24,44,0.18); position:relative; }
      #${widgetId} .bx-stage { position:relative; aspect-ratio:16/9; width:100%; background:radial-gradient(circle at 50% 18%, #0B2B4C 0%, #00182C 100%); display:flex; align-items:center; justify-content:center; box-sizing:border-box; overflow:hidden; }
      #${widgetId} .bx-stage.is-split { display:grid; grid-template-columns:minmax(0,1fr) minmax(0,1fr); grid-template-rows:minmax(0,1fr); align-items:stretch; }
      #${widgetId} .bx-media-pane { width:100%; height:100%; min-width:0; min-height:0; display:flex; align-items:center; justify-content:center; position:relative; }
      #${widgetId} .bx-stage.is-split .bx-media-pane { border-right:1px solid rgba(255,255,255,0.1); }
      #${widgetId} .bx-screen-inner { position:relative; width:100%; height:100%; border-radius:12px; box-shadow:0 16px 40px rgba(0,10,22,0.42), 0 0 0 1px rgba(255,255,255,0.14); overflow:visible; }
      #${widgetId} .bx-media-clip { position:absolute; inset:0; border-radius:inherit; overflow:hidden; background:#00101F; }
      #${widgetId} video, #${widgetId} .bx-img { width:100%; height:100%; display:block; object-fit:fill; transition:transform 0.55s cubic-bezier(0.22,1,0.36,1); will-change:transform; }
      #${widgetId} .bx-overlay { position:absolute; inset:0; pointer-events:none; }
      #${widgetId} .bx-screen-overlay { position:absolute; inset:0; pointer-events:none; z-index:18; }
      #${widgetId} .bx-stage.is-split .bx-screen-overlay { position:relative; inset:auto; width:100%; height:100%; min-width:0; min-height:0; }
      #${widgetId} .bx-anchor { position:absolute; width:0; height:0; pointer-events:auto; }
      #${widgetId} .bx-pin { position:absolute; left:0; top:0; width:28px; height:28px; border-radius:50%; background:#0076DD; border:2.5px solid #FFF; color:#FFF; font-family:'Host Grotesk',sans-serif; font-weight:600; font-size:12px; display:flex; align-items:center; justify-content:center; transform:translate(-50%,-50%); cursor:pointer; box-shadow:0 0 0 8px rgba(0,118,221,0.28); animation:bxPulse_${widgetId} 2.2s ease-in-out infinite; }
      #${widgetId} .bx-trace { position:absolute; inset:0; border-radius:8px; border:2.5px solid #0076DD; background:rgba(0,118,221,0.10); box-shadow:0 0 0 4px rgba(0,118,221,0.22); cursor:pointer; animation:bxFadeIn_${widgetId} 0.22s ease-out; }
      #${widgetId} .bx-tip { position:absolute; width:270px; background:#FFF; border-radius:12px; padding:16px 17px 14px; display:flex; flex-direction:column; gap:7px; box-shadow:0 16px 38px rgba(0,24,44,0.24); animation:bxTipIn_${widgetId} 0.24s cubic-bezier(0.16,1,0.3,1); }
      #${widgetId} .bx-tip h4 { font-family:'Host Grotesk',sans-serif; font-weight:600; color:#00182C; font-size:15px; line-height:1.3; margin:0; }
      #${widgetId} .bx-tip p { font-family:'Google Sans',sans-serif; color:#324158; font-size:13px; margin:0; line-height:1.48; }
      #${widgetId} .bx-tip .bx-btn { align-self:flex-start; margin-top:5px; }
      #${widgetId} .bx-screen { position:absolute; inset:0; background:rgba(0,24,44,0.78); display:flex; align-items:center; justify-content:center; padding:24px; pointer-events:auto; animation:bxFadeIn_${widgetId} 0.22s ease-out; }
      #${widgetId} .bx-stage.is-split .bx-screen { padding:0; background:transparent; }
      #${widgetId} .bx-screen-card { max-width:440px; width:100%; background:#FFF; border-radius:16px; padding:30px 34px 26px; display:flex; flex-direction:column; align-items:center; gap:12px; text-align:center; box-shadow:0 24px 52px rgba(0,24,44,0.28); box-sizing:border-box; animation:bxTipIn_${widgetId} 0.26s cubic-bezier(0.16,1,0.3,1); }
      #${widgetId} .bx-img.is-entering { animation:bxFadeIn_${widgetId} 0.22s ease-out; }
      @keyframes bxPulse_${widgetId} { 0%, 100% { box-shadow:0 0 0 6px rgba(0,118,221,0.28); } 50% { box-shadow:0 0 0 12px rgba(0,118,221,0.10); } }
      @keyframes bxFadeIn_${widgetId} { from { opacity:0; } to { opacity:1; } }
      @keyframes bxTipIn_${widgetId} { from { opacity:0; margin-top:6px; } to { opacity:1; margin-top:0; } }
      #${widgetId} .bx-stage.is-split .bx-screen-card { max-width:100%; height:100%; border-radius:0; box-shadow:none; padding:28px 32px; display:flex; flex-direction:column; justify-content:center; align-items:flex-start; text-align:left; overflow-y:auto; }
      #${widgetId} .bx-btn { background:#0076DD; color:#FFF; border:none; border-radius:7px; padding:8px 16px; font-family:'Host Grotesk',sans-serif; font-weight:600; font-size:13px; cursor:pointer; }
      #${widgetId} .bx-bar { background:#FFF; border-top:1px solid #E2E8F0; padding:10px 16px; display:flex; align-items:center; justify-content:space-between; }
      @media (max-width: 640px) {
        #${widgetId} .bx-stage.is-split { aspect-ratio:auto; grid-template-columns:minmax(0,1fr); grid-template-rows:auto auto; }
        #${widgetId} .bx-stage.is-split .bx-media-pane { aspect-ratio:16/10; border-right:none; border-bottom:1px solid rgba(255,255,255,0.1); }
        #${widgetId} .bx-stage.is-split .bx-screen-card { padding:20px 18px; }
      }
    </style>
    <div class="bx-wrap">
      <div class="bx-stage">
        <div class="bx-media-pane">
          <div class="bx-screen-inner">
            <div class="bx-media-clip">
              <video playsinline preload="metadata" src="\${demo.videoUrl}"></video>
              <img class="bx-img" style="display:none;" alt="" />
            </div>
            <div class="bx-overlay"></div>
          </div>
        </div>
        <div class="bx-screen-overlay"></div>
      </div>
      <div class="bx-bar">
        <strong style="font-family:'Host Grotesk',sans-serif; color:#00182C; font-size:14px;">\${demo.title}</strong>
        <div class="bx-dots" style="display:flex; gap:6px;"></div>
      </div>
    </div>\`;
  const stage = root.querySelector(".bx-stage");
  const inner = root.querySelector(".bx-screen-inner");
  const video = root.querySelector("video");
  const img = root.querySelector(".bx-img");
  const overlay = root.querySelector(".bx-overlay");
  const screenOverlay = root.querySelector(".bx-screen-overlay");
  const dots = root.querySelector(".bx-dots");
  let mediaRatio = 16 / 9;
  let renderSeq = 0;

  // Preload all step screenshots so transitions stay instant and in sync
  (demo.steps || []).forEach(st => {
    if (st && st.imageUrl) {
      const pre = new Image();
      pre.src = st.imageUrl;
    }
  });

  function fitInner() {
    if (!stage || !inner) return;
    const isSplit = stage.classList.contains("is-split");
    const isStacked = isSplit && window.innerWidth <= 640;
    const paneEl = stage.querySelector(".bx-media-pane");
    const paneW = isStacked && paneEl ? paneEl.clientWidth : (isSplit ? (stage.clientWidth / 2) : stage.clientWidth);
    const paneH = isStacked && paneEl ? paneEl.clientHeight : stage.clientHeight;
    const sw = paneW * 0.88;
    const sh = paneH * 0.88;
    if (!sw || !sh) return;
    let w = sw, h = w / mediaRatio;
    if (h > sh) { h = sh; w = h * mediaRatio; }
    inner.style.width = Math.floor(w) + "px";
    inner.style.height = Math.floor(h) + "px";
  }
  window.addEventListener("resize", fitInner);
  video.addEventListener("loadedmetadata", () => {
    if (video.videoWidth && video.videoHeight) {
      mediaRatio = video.videoWidth / video.videoHeight;
      fitInner();
    }
  });

  function render() {
    const seq = ++renderSeq;
    overlay.innerHTML = "";
    screenOverlay.innerHTML = "";
    dots.innerHTML = "";
    let stepNumCounter = 0;
    const stepNumbers = demo.steps.map(item => {
      const itemIsExplainer = item.type === "explainer" || item.isExplainer === true;
      if (itemIsExplainer) return null;
      stepNumCounter += 1;
      return stepNumCounter;
    });
    demo.steps.forEach((s, i) => {
      const b = document.createElement("button");
      const num = stepNumbers[i];
      b.textContent = num === null ? "•" : num;
      b.title = s.title || (num === null ? "Explainer" : ("Step " + num));
      b.style.cssText = "width:26px;height:26px;border-radius:99px;border:1px " + (num === null ? "dashed" : "solid") + " #CBD5E1;cursor:pointer;font-weight:600;background:" + (i===stepIdx?"#0076DD":"#FFF") + ";color:" + (i===stepIdx?"#FFF":"#324158");
      b.onclick = () => jump(i);
      dots.appendChild(b);
    });
    if (!waiting || !demo.steps[stepIdx]) {
      stage.classList.remove("is-split");
      fitInner();
      return;
    }
    const s = demo.steps[stepIdx];
    const isExplainer = s.type === "explainer";
    const isScreen = !isExplainer && (s.type === "screen" || s.style === "modal");
    const isSplit = isScreen && s.screenLayout === "split";
    const showKicker = s.showKicker !== false;
    const showTitle = s.showTitle !== false;
    const showBody = s.showBody !== false && Boolean(s.body && s.body.trim());
    const showPrimaryBtn = s.showPrimaryBtn !== undefined ? Boolean(s.showPrimaryBtn) : s.showButtons !== false;
    const showBackBtn = s.showBackBtn !== undefined ? Boolean(s.showBackBtn) : s.showButtons !== false;
    const showAnyAction = (showBackBtn && stepIdx > 0) || showPrimaryBtn;
    const actionsHtml = showAnyAction ? \`<div style="display:flex;align-items:center;gap:8px;margin-top:8px;\${isScreen && !isSplit ? 'justify-content:center;' : 'justify-content:flex-start;'}">\${showBackBtn && stepIdx > 0 ? \`<button data-bx-prev style="background:transparent;color:#324158;border:none;padding:8px 12px;font-family:'Host Grotesk',sans-serif;font-weight:500;font-size:13px;cursor:pointer;">Back</button>\` : ''}\${showPrimaryBtn ? \`<button class="bx-btn" data-bx-next>\${s.buttonText || (isScreen || isExplainer ? 'Continue' : 'Next')}</button>\` : ''}</div>\` : '';
    stage.classList.toggle("is-split", isSplit);

    function bindBtns(el) {
      const n = el.querySelector("[data-bx-next]");
      const p = el.querySelector("[data-bx-prev]");
      if (n) n.onclick = next;
      if (p) p.onclick = () => { if (stepIdx > 0) jump(stepIdx - 1); };
    }

    function commitStepOverlay() {
      if (seq !== renderSeq) return;
      fitInner();
      const z = (isScreen && s.screenLayout !== "image") ? 1 : Math.max(1, Math.min(3, Number(s.zoom || 1)));
      const zx = Math.max(0, Math.min(100, Number(s.x ?? 50)));
      const zy = Math.max(0, Math.min(100, Number(s.y ?? 50)));
      [video, img].forEach(m => {
        if (!m) return;
        m.style.transformOrigin = zx + "% " + zy + "%";
        m.style.transform = z > 1 ? ("scale(" + z + ")") : "scale(1)";
      });
      if (isScreen) {
        if (s.screenLayout === "image") {
          img.style.cursor = "pointer";
          img.onclick = next;
          return;
        }
        const scr = document.createElement("div");
        scr.className = "bx-screen";
        scr.innerHTML = \`<div class="bx-screen-card">\${showKicker && s.kicker ? \`<div style="font-size:11px;font-weight:600;color:#0076DD;background:rgba(0,118,221,0.1);padding:4px 12px;border-radius:99px;display:inline-block;margin-bottom:2px;">\${s.kicker}</div>\` : ''}\${showTitle ? \`<h3 style="font-family:'Host Grotesk',sans-serif;color:#00182C;font-size:21px;line-height:1.25;margin:0;">\${s.title}</h3>\` : ''}\${showBody ? \`<p style="font-size:14px;color:#324158;margin:0;max-width:38ch;line-height:1.55;">\${s.body}</p>\` : ''}\${actionsHtml}</div>\`;
        bindBtns(scr);
        screenOverlay.appendChild(scr);
        return;
      }
      const anchor = document.createElement("div");
      anchor.className = "bx-anchor";
      const adjX = zx + (Number(s.x ?? 50) - zx) * z;
      const adjY = zy + (Number(s.y ?? 50) - zy) * z;
      anchor.style.left = adjX + "%"; anchor.style.top = adjY + "%";
      if (isExplainer) {
        const tip = document.createElement("div");
        tip.className = "bx-tip";
        tip.style.transform = "translate(-50%, -50%)";
        tip.style.pointerEvents = "auto";
        tip.innerHTML = \`\${showKicker ? \`<div style="font-size:11px;font-weight:600;color:#0076DD;margin-bottom:4px;">\${s.kicker || 'Explainer'}</div>\` : ''}\${showTitle ? \`<h4>\${s.title}</h4>\` : ''}\${showBody ? \`<p>\${s.body}</p>\` : ''}\${actionsHtml}\`;
        bindBtns(tip);
        anchor.appendChild(tip);
        overlay.appendChild(anchor);
        return;
      }
      if (s.style === "trace") {
        anchor.style.width = ((s.w || 16) * z) + "%";
        anchor.style.height = ((s.h || 8) * z) + "%";
        anchor.style.transform = "translate(-50%,-50%)";
        const tr = document.createElement("div");
        tr.className = "bx-trace";
        tr.onclick = next;
        anchor.appendChild(tr);
      } else {
        const pin = document.createElement("div");
        pin.className = "bx-pin";
        pin.textContent = stepNumbers[stepIdx] || "•";
        pin.onclick = next;
        anchor.appendChild(pin);
      }

      if (s.showTooltip !== false) {
        const tip = document.createElement("div");
        tip.className = "bx-tip";
        tip.style.pointerEvents = "auto";
        if (s.x > 62) { tip.style.right = s.style === "trace" ? "calc(100% + 14px)" : "24px"; tip.style.top = "50%"; tip.style.transform = "translateY(-50%)"; }
        else { tip.style.left = s.style === "trace" ? "calc(100% + 14px)" : "24px"; tip.style.top = "50%"; tip.style.transform = "translateY(-50%)"; }
        tip.innerHTML = \`\${showKicker ? \`<div style="font-size:11px;font-weight:600;color:#0076DD;margin-bottom:4px;">Step \${stepNumbers[stepIdx] || (stepIdx+1)}</div>\` : ''}\${showTitle ? \`<h4>\${s.title}</h4>\` : ''}\${showBody ? \`<p>\${s.body}</p>\` : ''}\${actionsHtml}\`;
        bindBtns(tip);
        anchor.appendChild(tip);
      }
      overlay.appendChild(anchor);
    }

    if (s.imageUrl) {
      video.style.display = "none";
      const sameSrc = img.getAttribute("src") === s.imageUrl;
      if (sameSrc && img.complete && img.naturalWidth) {
        img.style.display = "block";
        mediaRatio = img.naturalWidth / img.naturalHeight;
        commitStepOverlay();
      } else {
        img.classList.remove("is-entering");
        const onReady = () => {
          if (seq !== renderSeq) return;
          if (img.naturalWidth && img.naturalHeight) {
            mediaRatio = img.naturalWidth / img.naturalHeight;
          }
          img.style.display = "block";
          void img.offsetWidth;
          img.classList.add("is-entering");
          commitStepOverlay();
        };
        img.onload = onReady;
        img.onerror = commitStepOverlay;
        img.src = s.imageUrl;
        if (img.complete && img.naturalWidth) onReady();
      }
      return;
    }

    img.style.display = "none";
    video.style.display = "block";
    commitStepOverlay();
  }
  function jump(i) {
    stepIdx = i;
    video.pause();
    if (!demo.steps[i].imageUrl && demo.videoUrl) {
      video.currentTime = Number(demo.steps[i].timestamp || 0);
    }
    waiting = true;
    render();
  }
  function next() {
    if (stepIdx + 1 < demo.steps.length) {
      stepIdx++;
      if (demo.steps[stepIdx].imageUrl || !demo.videoUrl) {
        jump(stepIdx);
        return;
      }
      waiting = false;
      img.style.display = "none";
      video.style.display = "block";
      render();
      video.play().catch(() => jump(stepIdx));
    } else {
      jump(0);
    }
  }
  video.addEventListener("timeupdate", () => {
    const s = demo.steps[stepIdx];
    if (s && !waiting && video.currentTime >= Number(s.timestamp || 0)) {
      video.pause();
      video.currentTime = Number(s.timestamp || 0);
      waiting = true;
      render();
    }
  });
  if (demo.steps.length) jump(0);
})();
</script>`;
}

function generateHubWebflowSnippet() {
  const payload = JSON.stringify({
    folders: state.folders,
    demos: state.demos.map(d => ({
      id: d.id,
      title: d.title,
      description: d.description,
      folderPath: d.folderPath,
      videoUrl: d.videoUrl,
      steps: d.steps
    }))
  });

  return `<!-- BxLearn Full Folder Hierarchy Walkthrough Hub for Webflow -->
<link href="https://fonts.googleapis.com/css2?family=Host+Grotesk:wght@600&family=Google+Sans:wght@400;500&display=swap" rel="stylesheet">
<div id="bxlearn-webflow-hub" style="font-family:'Google Sans',sans-serif; color:#324158; border:1px solid #E2E8F0; border-radius:16px; overflow:hidden; background:#FFFFFF; display:grid; grid-template-columns:240px 1fr; min-height:560px; box-shadow:0 12px 32px rgba(0,24,44,0.08);"></div>
<script>
(function(){
  const data = ${payload};
  const hub = document.getElementById("bxlearn-webflow-hub");
  if (!hub) return;
  let currentFolder = "__ALL__";
  let activeDemo = data.demos[0] || null;
  let stepIdx = 0;

  function renderHub() {
    const visibleDemos = data.demos.filter(d => currentFolder === "__ALL__" || d.folderPath === currentFolder || (d.folderPath && d.folderPath.startsWith(currentFolder + "/")));
    if (!visibleDemos.includes(activeDemo)) activeDemo = visibleDemos[0] || null;
    const step = activeDemo && activeDemo.steps ? activeDemo.steps[stepIdx] : null;
    const isScreen = step && (step.type === "screen" || step.style === "modal");
    const isSplit = isScreen && step.screenLayout === "split";

    hub.innerHTML = \`
      <aside style="background:#F8FAFC; border-right:1px solid #E2E8F0; padding:18px 12px;">
        <div style="font-family:'Host Grotesk',sans-serif; font-weight:600; color:#00182C; font-size:14px; padding:0 8px 12px;">Folders</div>
        <button data-f="__ALL__" style="width:100%;text-align:left;padding:7px 10px;border:none;border-radius:6px;cursor:pointer;background:\${currentFolder==='__ALL__'?'rgba(0,118,221,0.1)':'transparent'};color:\${currentFolder==='__ALL__'?'#0076DD':'#324158'};font-weight:500;">All Walkthroughs (\${data.demos.length})</button>
        \${data.folders.map(f => {
          const depth = f.path.split('/').length - 1;
          return \`<button data-f="\${f.path}" style="width:100%;text-align:left;padding:6px 10px 6px \${10 + depth*14}px;border:none;border-radius:6px;cursor:pointer;background:\${currentFolder===f.path?'rgba(0,118,221,0.1)':'transparent'};color:\${currentFolder===f.path?'#0076DD':'#324158'};">📁 \${f.name}</button>\`;
        }).join('')}
      </aside>
      <section style="padding:22px; display:flex; flex-direction:column; gap:16px;">
        <div style="display:flex; gap:8px; flex-wrap:wrap;">
          \${visibleDemos.map(d => \`<button data-d="\${d.id}" style="padding:6px 12px;border-radius:99px;border:1px solid \${activeDemo&&activeDemo.id===d.id?'#0076DD':'#CBD5E1'};background:\${activeDemo&&activeDemo.id===d.id?'#0076DD':'#FFF'};color:\${activeDemo&&activeDemo.id===d.id?'#FFF':'#00182C'};font-family:'Host Grotesk',sans-serif;font-weight:600;font-size:12.5px;cursor:pointer;">\${d.title}</button>\`).join('')}
        </div>
        \${activeDemo ? \`
          <div style="position:relative; aspect-ratio:16/9; background:radial-gradient(circle at 50% 18%, #0B2B4C 0%, #00182C 100%); border-radius:12px; overflow:hidden;\${isSplit ? ' display:grid; grid-template-columns:minmax(0,1fr) minmax(0,1fr); grid-template-rows:minmax(0,1fr); align-items:stretch;' : ''}">
            <div style="width:100%;height:100%;min-width:0;min-height:0;display:flex;align-items:center;justify-content:center;padding:\${isSplit ? '16px' : '0'};box-sizing:border-box;\${isSplit ? 'border-right:1px solid rgba(255,255,255,0.1);' : ''}">
              \${step && step.imageUrl ? \`<img src="\${step.imageUrl}" alt="" style="max-width:100%;max-height:100%;width:\${isSplit ? 'auto' : '100%'};height:\${isSplit ? 'auto' : '100%'};object-fit:\${isSplit ? 'contain' : 'fill'};border-radius:\${isSplit ? '10px' : '0'};display:block;box-shadow:\${isSplit ? '0 12px 30px rgba(0,10,22,0.4)' : 'none'};" />\` : \`<video id="bx-hub-video" src="\${activeDemo.videoUrl || ''}" playsinline style="max-width:100%;max-height:100%;width:\${isSplit ? 'auto' : '100%'};height:\${isSplit ? 'auto' : '100%'};object-fit:\${isSplit ? 'contain' : 'fill'};border-radius:\${isSplit ? '10px' : '0'};"></video>\`}
            </div>
            \${step ? (isScreen ? \`
              <div style="\${isSplit ? 'position:relative;min-width:0;min-height:0;padding:0;background:transparent;' : 'position:absolute;inset:0;padding:20px;background:rgba(0,24,44,0.78);'}display:flex;align-items:center;justify-content:center;box-sizing:border-box;">
                <div style="background:#FFF;padding:\${isSplit ? '28px 32px' : '28px'};\${isSplit ? 'border-radius:0;width:100%;height:100%;display:flex;flex-direction:column;justify-content:center;align-items:flex-start;text-align:left;box-sizing:border-box;overflow-y:auto;' : 'border-radius:14px;max-width:420px;text-align:center;box-shadow:0 20px 44px rgba(0,24,44,0.26);'}">
                  <div style="font-family:'Host Grotesk',sans-serif;font-weight:600;color:#00182C;font-size:20px;margin-bottom:8px;">\${step.title}</div>
                  <div style="font-size:13.5px;color:#324158;margin-bottom:16px;line-height:1.5;">\${step.body}</div>
                  <button id="bx-hub-next" style="background:#0076DD;color:#FFF;border:none;padding:8px 18px;border-radius:7px;font-weight:600;cursor:pointer;">\${step.buttonText || 'Continue'}</button>
                </div>
              </div>
            \` : \`
              <div id="bx-hub-pin" style="position:absolute;left:\${step.x}%;top:\${step.y}%;width:28px;height:28px;border-radius:50%;background:#0076DD;border:3px solid #FFF;color:#FFF;display:flex;align-items:center;justify-content:center;font-weight:600;transform:translate(-50%,-50%);cursor:pointer;box-shadow:0 0 0 8px rgba(0,118,221,0.3);">\${stepIdx+1}</div>
              <div style="position:absolute;left:20px;bottom:20px;background:#FFF;padding:14px 16px;border-radius:10px;max-width:300px;box-shadow:0 12px 30px rgba(0,24,44,0.22);">
                <div style="font-size:11px;color:#0076DD;font-weight:600;margin-bottom:3px;">STEP \${stepIdx+1} OF \${activeDemo.steps.length}</div>
                <div style="font-family:'Host Grotesk',sans-serif;font-weight:600;color:#00182C;font-size:14.5px;margin-bottom:4px;">\${step.title}</div>
                <div style="font-size:12.5px;color:#324158;margin-bottom:10px;">\${step.body}</div>
                <button id="bx-hub-next" style="background:#0076DD;color:#FFF;border:none;padding:6px 12px;border-radius:6px;cursor:pointer;">\${step.buttonText || 'Next'}</button>
              </div>
            \`) : ''}
          </div>
        \` : '<p>No walkthroughs in this folder.</p>'}
      </section>
    \`;

    hub.querySelectorAll("[data-f]").forEach(b => b.onclick = () => { currentFolder = b.dataset.f; stepIdx = 0; renderHub(); });
    hub.querySelectorAll("[data-d]").forEach(b => b.onclick = () => { activeDemo = data.demos.find(x => x.id === b.dataset.d); stepIdx = 0; renderHub(); });
    const nextBtn = hub.querySelector("#bx-hub-next");
    const pinBtn = hub.querySelector("#bx-hub-pin");
    const advance = () => {
      if (!activeDemo || !activeDemo.steps) return;
      stepIdx = (stepIdx + 1) % activeDemo.steps.length;
      renderHub();
    };
    if (nextBtn) nextBtn.onclick = advance;
    if (pinBtn) pinBtn.onclick = advance;
  }
  renderHub();
})();
</script>`;
}

function updateWebflowCodeOutput() {
  const codeOutput = document.getElementById('wf-code-output');
  const codeLabel = document.getElementById('wf-code-label');
  const warningEl = document.getElementById('wf-base64-warning');
  const uploadBase64Btn = document.getElementById('btn-upload-base64-wf');
  const select = document.getElementById('wf-select-demo');
  const urlOverride = document.getElementById('wf-video-override').value.trim();
  const chosenDemo = state.demos.find(d => d.id === select.value) || state.activeDemo || state.demos[0];

  const snippet = state.activeWfTab === 'hub'
    ? generateHubWebflowSnippet()
    : generateSingleDemoWebflowSnippet(chosenDemo, urlOverride);
  codeOutput.value = snippet;

  const kb = (snippet.length / 1024).toFixed(1);
  if (codeLabel) codeLabel.textContent = `Embed Snippet (${kb} KB)`;

  const demosToCheck = state.activeWfTab === 'hub' ? state.demos : (chosenDemo ? [chosenDemo] : []);
  const hasBase64 = demosToCheck.some(d => (d.steps || []).some(s => s && typeof s.imageUrl === 'string' && s.imageUrl.startsWith('data:image/')));
  if (warningEl) warningEl.classList.toggle('hidden', !hasBase64);
  if (uploadBase64Btn) {
    const wfCfg = getWebflowConfig();
    const hasWf = Boolean(wfCfg.apiToken && wfCfg.siteId);
    uploadBase64Btn.classList.toggle('hidden', !hasWf);
  }
}

async function convertBase64ScreenshotsToWebflow() {
  const wfCfg = getWebflowConfig();
  if (!wfCfg.apiToken || !wfCfg.siteId) {
    showToast('Connect Webflow Assets first');
    return;
  }
  const btn = document.getElementById('btn-upload-base64-wf');
  if (btn) { btn.disabled = true; btn.textContent = 'Uploading...'; }

  try {
    const select = document.getElementById('wf-select-demo');
    const chosenDemo = state.demos.find(d => d.id === select.value) || state.activeDemo || state.demos[0];
    const targetDemos = state.activeWfTab === 'hub' ? state.demos : (chosenDemo ? [chosenDemo] : []);
    let converted = 0;

    for (const demo of targetDemos) {
      let demoChanged = false;
      for (const step of (demo.steps || [])) {
        if (step && typeof step.imageUrl === 'string' && step.imageUrl.startsWith('data:image/')) {
          const blob = await (await fetch(step.imageUrl)).blob();
          const ext = (blob.type && blob.type.split('/')[1]) || 'png';
          const file = new File([blob], step.imageName || `step-${step.id}.${ext}`, { type: blob.type || 'image/png' });
          const uploaded = await webflowUploadAsset(file);
          if (uploaded && uploaded.imageUrl) {
            step.imageUrl = uploaded.imageUrl;
            demoChanged = true;
            converted += 1;
          }
        }
      }
      if (demoChanged) await apiUpdateDemo(demo);
    }

    updateWebflowCodeOutput();
    if (state.activeDemo) renderHotspotOverlay();
    showToast(converted > 0 ? `Converted ${converted} image(s) to Webflow CDN URLs` : 'Could not upload images to Webflow Assets');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Upload to Webflow Assets'; }
  }
}

function downloadHtmlFile(filename, bodySnippet, title) {
  const fullHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(title)}</title>
</head>
<body style="margin:0; padding:32px; background:#F8FAFC;">
${bodySnippet}
</body>
</html>`;
  const blob = new Blob([fullHtml], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// =========================================================
// DIALOG HELPER
// =========================================================
let activeDialogHandler = null;
let activeDialogIsConfirmOnly = false;

function openDialog({
  title,
  subtitle = '',
  label = 'Name',
  initialValue = '',
  showParentSelect = false,
  defaultParent = '',
  isConfirmOnly = false,
  confirmText = 'Confirm',
  onConfirm
}) {
  const modal = document.getElementById('modal-dialog');
  document.getElementById('dialog-title').textContent = title;
  const subEl = document.getElementById('dialog-subtitle');
  subEl.textContent = subtitle;
  subEl.classList.toggle('hidden', !subtitle);

  const inputGroup = document.getElementById('dialog-input-group');
  const input = document.getElementById('dialog-input');
  activeDialogIsConfirmOnly = Boolean(isConfirmOnly);

  if (isConfirmOnly) {
    inputGroup.classList.add('hidden');
    input.required = false;
  } else {
    inputGroup.classList.remove('hidden');
    input.required = true;
    document.getElementById('dialog-label').textContent = label;
    input.value = initialValue;
  }

  const confirmBtn = document.getElementById('btn-confirm-dialog');
  confirmBtn.textContent = confirmText;

  const parentGroup = document.getElementById('dialog-parent-group');
  const parentSelect = document.getElementById('dialog-parent-select');
  if (showParentSelect && !isConfirmOnly) {
    parentGroup.classList.remove('hidden');
    parentSelect.innerHTML = `<option value="">Root (Top Level)</option>`;
    state.folders.forEach(f => {
      const opt = document.createElement('option');
      opt.value = f.path;
      opt.textContent = f.path;
      if (f.path === defaultParent) opt.selected = true;
      parentSelect.appendChild(opt);
    });
  } else {
    parentGroup.classList.add('hidden');
  }

  activeDialogHandler = onConfirm;
  modal.classList.remove('hidden');
  if (!isConfirmOnly) {
    setTimeout(() => {
      input.focus();
      input.select();
    }, 40);
  }
}

function closeDialog() {
  document.getElementById('modal-dialog').classList.add('hidden');
  activeDialogHandler = null;
}

// =========================================================
// EVENT LISTENERS & INITIALIZATION
// =========================================================
function handleCreateNewDemo() {
  const targetFolder = (state.selectedFolder === '__ALL__') ? '' : state.selectedFolder;
  openDialog({
    title: 'New Walkthrough',
    subtitle: 'Create an interactive demo walkthrough and assign it to a folder.',
    label: 'Title',
    initialValue: 'Product Feature Walkthrough',
    showParentSelect: true,
    defaultParent: targetFolder,
    confirmText: 'Create',
    onConfirm: async (val, parentPath) => {
      const created = await apiCreateDemo({
        title: val,
        folderPath: parentPath
      });
      renderLibraryView();
      openDemoInEditor(created.id, 'edit');
      showToast(`Created "${created.title}"`);
    }
  });
}

function bindEvents() {
  // Keep video viewport locked 1:1 on window or stage resize
  const stageWrap = document.getElementById('stage-viewport-wrap');
  if (window.ResizeObserver && stageWrap) {
    const ro = new ResizeObserver(() => syncViewportSize());
    ro.observe(stageWrap);
  }
  window.addEventListener('resize', syncViewportSize);

  const goHome = () => {
    mediaPause();
    state.currentView = 'library';
    if (typeof closeFlowView === 'function') closeFlowView();
    document.getElementById('view-editor').classList.add('hidden');
    document.getElementById('view-library').classList.remove('hidden');
    document.getElementById('brand-home').classList.remove('hidden');
    document.getElementById('btn-new-demo-top').classList.remove('hidden');
    document.getElementById('new-demo-dropdown')?.classList.remove('hidden');
    document.getElementById('btn-back-library').classList.add('hidden');
    document.getElementById('btn-share-preview')?.classList.add('hidden');
    document.getElementById('editor-breadcrumb').classList.add('hidden');
    document.getElementById('editor-mode-switcher').classList.add('hidden');
    document.getElementById('save-status').classList.add('hidden');
    renderLibraryView();
  };

  document.getElementById('btn-back-library').addEventListener('click', goHome);
  document.getElementById('btn-share-preview')?.addEventListener('click', copySharePreviewUrl);
  document.getElementById('brand-home').addEventListener('click', () => {
    const inFlowPreview = state.currentView === 'flow' && typeof flowState !== 'undefined' && flowState.mode === 'preview';
    if (state.isSharedPreviewMode || state.editorMode === 'preview' || inFlowPreview) {
      window.location.href = 'https://bxlogistics.no';
      return;
    }
    goHome();
  });

  document.getElementById('btn-new-demo-top').addEventListener('click', handleCreateNewDemo);
  document.getElementById('btn-webflow-hub').addEventListener('click', () => {
    openWebflowModal(state.currentView === 'editor' ? state.activeDemo?.id : null);
  });

  document.querySelectorAll('#editor-mode-switcher .seg-btn').forEach(btn => {
    btn.addEventListener('click', () => setEditorMode(btn.dataset.mode));
  });

  document.getElementById('nav-all-demos').addEventListener('click', () => {
    state.selectedFolder = '__ALL__';
    renderLibraryView();
  });
  document.getElementById('nav-root-demos').addEventListener('click', () => {
    state.selectedFolder = '';
    renderLibraryView();
  });

  document.getElementById('search-demos').addEventListener('input', e => {
    state.searchQuery = e.target.value;
    renderLibraryView();
  });

  document.querySelectorAll('#library-type-filter .seg-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      state.libraryTypeFilter = btn.dataset.kindFilter || '__ALL__';
      document.querySelectorAll('#library-type-filter .seg-btn').forEach(b => {
        b.classList.toggle('active', b === btn);
      });
      renderLibraryView();
    });
  });

  // Folder CRUD buttons
  document.getElementById('btn-new-folder').addEventListener('click', () => {
    const defaultParent = (state.selectedFolder && state.selectedFolder !== '__ALL__') ? state.selectedFolder : '';
    openDialog({
      title: 'New Folder',
      label: 'Folder Name',
      initialValue: '',
      showParentSelect: true,
      defaultParent,
      confirmText: 'Create',
      onConfirm: async (name, parentPath) => {
        const cleanName = name.trim().replace(/\//g, '-');
        const fullPath = parentPath ? `${parentPath}/${cleanName}` : cleanName;
        const createdPath = await apiCreateFolder(fullPath);
        state.selectedFolder = createdPath;
        renderLibraryView();
        showToast(`Created "${cleanName}"`);
      }
    });
  });

  document.getElementById('btn-add-subfolder').addEventListener('click', () => {
    if (!state.selectedFolder || state.selectedFolder === '__ALL__') return;
    openDialog({
      title: 'New Subfolder',
      subtitle: `Inside "${state.selectedFolder}"`,
      label: 'Subfolder Name',
      initialValue: '',
      showParentSelect: false,
      confirmText: 'Create',
      onConfirm: async name => {
        const cleanName = name.trim().replace(/\//g, '-');
        const fullPath = `${state.selectedFolder}/${cleanName}`;
        const createdPath = await apiCreateFolder(fullPath);
        state.selectedFolder = createdPath;
        renderLibraryView();
        showToast(`Created "${cleanName}"`);
      }
    });
  });

  document.getElementById('btn-rename-folder').addEventListener('click', () => {
    if (!state.selectedFolder || state.selectedFolder === '__ALL__') return;
    const parts = state.selectedFolder.split('/');
    const currentName = parts[parts.length - 1];
    const parent = parts.slice(0, -1).join('/');
    openDialog({
      title: 'Rename Folder',
      label: 'New Name',
      initialValue: currentName,
      confirmText: 'Save',
      onConfirm: async newName => {
        const clean = newName.trim().replace(/\//g, '-');
        const newPath = parent ? `${parent}/${clean}` : clean;
        if (newPath === state.selectedFolder) return;
        const updatedPath = await apiRenameFolder(state.selectedFolder, newPath);
        state.selectedFolder = updatedPath;
        renderLibraryView();
        showToast(`Renamed to "${clean}"`);
      }
    });
  });

  document.getElementById('btn-delete-folder').addEventListener('click', () => {
    if (!state.selectedFolder || state.selectedFolder === '__ALL__') return;
    openDialog({
      title: 'Delete Folder',
      subtitle: `Delete "${state.selectedFolder}"? Walkthroughs inside will move to its parent folder.`,
      isConfirmOnly: true,
      confirmText: 'Delete',
      onConfirm: async () => {
        const parent = state.selectedFolder.includes('/')
          ? state.selectedFolder.slice(0, state.selectedFolder.lastIndexOf('/'))
          : '__ALL__';
        await apiDeleteFolder(state.selectedFolder);
        state.selectedFolder = parent;
        renderLibraryView();
        showToast('Folder deleted');
      }
    });
  });

  // Dialog Modal Submit
  document.getElementById('dialog-form').addEventListener('submit', async e => {
    e.preventDefault();
    const val = document.getElementById('dialog-input').value.trim();
    const parentVal = document.getElementById('dialog-parent-select').value;
    if (!activeDialogIsConfirmOnly && !val) return;
    if (!activeDialogHandler) return;
    const handler = activeDialogHandler;
    closeDialog();
    try {
      await handler(val, parentVal);
    } catch (err) {
      showToast(err.message || 'Operation failed');
    }
  });
  document.getElementById('btn-close-dialog').addEventListener('click', closeDialog);
  document.getElementById('btn-cancel-dialog').addEventListener('click', closeDialog);

  // Editor Demo Title & Folder Assignment
  document.getElementById('editor-demo-title').addEventListener('input', e => {
    if (!state.activeDemo) return;
    state.activeDemo.title = e.target.value;
    scheduleAutoSave();
  });

  document.getElementById('editor-folder-select').addEventListener('change', e => {
    if (!state.activeDemo) return;
    state.activeDemo.folderPath = e.target.value;
    const shortName = e.target.value ? e.target.value.split('/').pop() : 'Root';
    document.getElementById('editor-folder-label').textContent = shortName;
    scheduleAutoSave();
    showToast(`Moved to ${shortName}`);
  });

  // Video & Screenshot Upload Handlers
  const handleFileSelected = async file => {
    if (!file || !state.activeDemo) return;
    if (file.type && file.type.startsWith('image/')) {
      await addScreenshotStepsFromFiles([file]);
      return;
    }
    showToast(`Uploading "${file.name}"...`);
    const updated = await apiUploadVideo(state.activeDemo.id, file);
    state.activeDemo.videoUrl = updated.videoUrl;
    state.activeDemo.videoFileName = updated.videoFileName;
    state.activeDemo.useSampleCanvasVideo = false;
    setupEditorVideoSource();
    if (state.activeDemo.steps.length === 0) {
      addStepAtCurrentTime(50, 50, 'screen');
    }
    showToast('Video uploaded');
  };

  document.getElementById('video-file-input').addEventListener('change', e => {
    if (e.target.files[0]) handleFileSelected(e.target.files[0]);
    e.target.value = '';
  });
  document.getElementById('video-file-replace').addEventListener('change', e => {
    if (e.target.files[0]) handleFileSelected(e.target.files[0]);
    e.target.value = '';
  });

  const screenshotsEmptyInput = document.getElementById('screenshots-empty-input');
  if (screenshotsEmptyInput) {
    screenshotsEmptyInput.addEventListener('change', async e => {
      if (e.target.files && e.target.files.length > 0) {
        await addScreenshotStepsFromFiles(e.target.files);
      }
      e.target.value = '';
    });
  }

  const screenshotStepsInput = document.getElementById('screenshot-steps-input');
  if (screenshotStepsInput) {
    screenshotStepsInput.addEventListener('change', async e => {
      if (e.target.files && e.target.files.length > 0) {
        await addScreenshotStepsFromFiles(e.target.files);
      }
      e.target.value = '';
    });
  }

  const stepScreenshotInput = document.getElementById('step-screenshot-input');
  if (stepScreenshotInput) {
    stepScreenshotInput.addEventListener('change', async e => {
      if (e.target.files && e.target.files[0]) {
        await setScreenshotForCurrentStep(e.target.files[0]);
      }
      e.target.value = '';
    });
  }

  const snapVideoFrameBtn = document.getElementById('btn-snap-video-frame');
  if (snapVideoFrameBtn) {
    snapVideoFrameBtn.addEventListener('click', () => snapCurrentVideoFrameToStep());
  }

  const snapFrameTimelineBtn = document.getElementById('btn-snap-frame-timeline');
  if (snapFrameTimelineBtn) {
    snapFrameTimelineBtn.addEventListener('click', () => snapCurrentVideoFrameToStep());
  }

  const clearStepScreenshotBtn = document.getElementById('btn-clear-step-screenshot');
  if (clearStepScreenshotBtn) {
    clearStepScreenshotBtn.addEventListener('click', () => {
      const step = getSelectedStep();
      if (!step) return;
      step.imageUrl = '';
      step.imageName = '';
      setupEditorVideoSource();
      renderEditorStepsList();
      renderInspectorPanel();
      renderTimelineMarkers();
      renderHotspotOverlay();
      scheduleAutoSave();
      showToast('Reverted step to video timeline');
    });
  }

  // Clipboard Screenshot Paste (Cmd+V / Ctrl+V) inside Editor
  window.addEventListener('paste', async e => {
    if (state.currentView !== 'editor' || !state.activeDemo) return;
    if (e.target && e.target.matches('input, textarea')) return;
    const items = e.clipboardData?.items;
    if (!items) return;
    const imageFiles = [];
    for (const item of items) {
      if (item.type && item.type.startsWith('image/')) {
        const blob = item.getAsFile();
        if (blob) {
          const ext = item.type.split('/')[1] || 'png';
          imageFiles.push(new File([blob], `pasted-screenshot-${Date.now()}.${ext}`, { type: item.type }));
        }
      }
    }
    if (imageFiles.length > 0) {
      e.preventDefault();
      await addScreenshotStepsFromFiles(imageFiles);
    }
  });

  const dropzone = document.getElementById('upload-dropzone');
  dropzone.addEventListener('dragover', e => {
    e.preventDefault();
    dropzone.classList.add('dragover');
  });
  dropzone.addEventListener('dragleave', () => dropzone.classList.remove('dragover'));
  dropzone.addEventListener('drop', async e => {
    e.preventDefault();
    dropzone.classList.remove('dragover');
    const files = e.dataTransfer?.files;
    if (!files || files.length === 0) return;
    const imageFiles = Array.from(files).filter(f => f.type && f.type.startsWith('image/'));
    if (imageFiles.length > 0) {
      await addScreenshotStepsFromFiles(imageFiles);
    } else {
      await handleFileSelected(files[0]);
    }
  });

  document.getElementById('btn-use-sample-video').addEventListener('click', () => {
    if (!state.activeDemo) return;
    state.activeDemo.useSampleCanvasVideo = true;
    state.activeDemo.videoUrl = '';
    if (state.activeDemo.steps.length === 0) {
      state.activeDemo.steps = [
        {
          id: `step-${Date.now()}-intro`,
          type: 'screen',
          backdrop: 'blur',
          kicker: 'Interactive Tour',
          timestamp: 0.0,
          title: `Welcome to ${state.activeDemo.title}`,
          body: 'Follow the interactive hotspots to explore the key features.',
          x: 50,
          y: 50,
          style: 'beacon',
          placement: 'auto',
          buttonText: 'Start Tour',
          advanceOnHotspotClick: true,
          ctaUrl: ''
        },
        {
          id: `step-${Date.now()}-1`,
          type: 'hotspot',
          backdrop: 'blur',
          kicker: '',
          timestamp: 1.0,
          title: 'Create New Workspace',
          body: 'Click "+ New Workspace" to start your project.',
          x: 32.3,
          y: 33.8,
          style: 'beacon',
          placement: 'right',
          buttonText: 'Next',
          advanceOnHotspotClick: true,
          ctaUrl: ''
        },
        {
          id: `step-${Date.now()}-2`,
          type: 'hotspot',
          backdrop: 'blur',
          kicker: '',
          timestamp: 3.4,
          title: 'Monitor Completion Rates',
          body: 'See how many visitors complete your walkthroughs in real time.',
          x: 58.0,
          y: 50.2,
          style: 'beacon',
          placement: 'bottom',
          buttonText: 'Continue',
          advanceOnHotspotClick: true,
          ctaUrl: ''
        },
        {
          id: `step-${Date.now()}-3`,
          type: 'hotspot',
          backdrop: 'blur',
          kicker: '',
          timestamp: 5.8,
          title: 'Publish to Webflow',
          body: 'Export a ready-to-paste embed snippet for your Webflow site.',
          x: 84.2,
          y: 4.6,
          style: 'beacon',
          placement: 'left',
          buttonText: 'Finish',
          advanceOnHotspotClick: true,
          ctaUrl: ''
        }
      ];
      state.selectedStepId = state.activeDemo.steps[0].id;
    }
    setupEditorVideoSource();
    renderEditorStepsList();
    renderInspectorPanel();
    renderTimelineMarkers();
    renderHotspotOverlay();
    scheduleAutoSave();
    showToast('Loaded sample video');
  });

  document.getElementById('btn-set-video-url').addEventListener('click', () => {
    const url = document.getElementById('video-url-input').value.trim();
    if (!url || !state.activeDemo) return;
    loadAssetUrlIntoActiveDemo(url);
    document.getElementById('video-url-input').value = '';
  });

  // Webflow Site Assets Browser Triggers
  const browseWfBtn = document.getElementById('btn-browse-webflow-assets');
  if (browseWfBtn) {
    browseWfBtn.addEventListener('click', () => openWebflowAssetsModal('append'));
  }
  const sidebarWfBtn = document.getElementById('btn-sidebar-wf-assets');
  if (sidebarWfBtn) {
    sidebarWfBtn.addEventListener('click', () => openWebflowAssetsModal('append'));
  }
  const inspectorWfBtn = document.getElementById('btn-inspector-wf-assets');
  if (inspectorWfBtn) {
    inspectorWfBtn.addEventListener('click', () => openWebflowAssetsModal('replace-step'));
  }

  document.getElementById('btn-video-url-modal').addEventListener('click', () => {
    if (!state.activeDemo) return;
    openDialog({
      title: 'Video URL',
      subtitle: 'Direct link to an MP4 or WebM file (e.g. Webflow Asset URL).',
      label: 'URL',
      initialValue: state.activeDemo.videoUrl || '',
      confirmText: 'Load',
      onConfirm: async url => {
        state.activeDemo.videoUrl = url;
        state.activeDemo.useSampleCanvasVideo = false;
        setupEditorVideoSource();
        scheduleAutoSave();
        showToast('Updated video URL');
      }
    });
  });

  // Video Element & Scrubber Timeline Events
  const video = document.getElementById('demo-video');
  const playPauseBtn = document.getElementById('btn-play-pause');
  const timelineTrack = document.getElementById('timeline-track');

  playPauseBtn.addEventListener('click', () => {
    if (mediaIsPaused()) mediaPlay();
    else mediaPause();
  });

  video.addEventListener('play', () => updatePlayPauseButtonIcon(false));
  video.addEventListener('pause', () => updatePlayPauseButtonIcon(true));
  video.addEventListener('loadedmetadata', () => {
    if (video.videoWidth && video.videoHeight) {
      state.videoAspectRatio = video.videoWidth / video.videoHeight;
      syncViewportSize();
    }
    handleMediaTimeUpdate();
    renderTimelineMarkers();
  });
  video.addEventListener('timeupdate', () => {
    if (!state.usingCanvasPlayer) handleMediaTimeUpdate();
  });

  timelineTrack.addEventListener('pointerdown', e => {
    const rect = timelineTrack.getBoundingClientRect();
    const dur = mediaGetDuration();
    const seek = clientX => {
      const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      mediaSetTime(ratio * dur);
    };
    seek(e.clientX);
    const onMove = ev => seek(ev.clientX);
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  });

  // Smooth In-Place Hotspot & Button Trace Positioning / Resizing (Zero DOM Destruction During Drag)
  const overlay = document.getElementById('hotspot-overlay');
  const syncActiveAnchorDOM = step => {
    const coordXEl = document.getElementById('coord-x-val');
    const coordYEl = document.getElementById('coord-y-val');
    if (coordXEl) coordXEl.textContent = `${Math.round(step.x)}%`;
    if (coordYEl) coordYEl.textContent = `${Math.round(step.y)}%`;

    const anchor = document.getElementById('active-hotspot-anchor');
    const tooltip = document.getElementById('active-hotspot-tooltip');
    if (anchor) {
      anchor.style.left = `${step.x}%`;
      anchor.style.top = `${step.y}%`;
      if (step.style === 'trace') {
        anchor.style.width = `${step.w || 16}%`;
        anchor.style.height = `${step.h || 8}%`;
      }
    }
    if (tooltip) {
      tooltip.className = `hotspot-tooltip ${resolvePlacementClass(step)}`;
    }
  };

  const updateHotspotFromPointer = (e, finalize = false) => {
    const step = getSelectedStep();
    if (step && getStepType(step) === 'screen') return;

    const rect = overlay.getBoundingClientRect();
    if (!rect.width || !rect.height) return;

    // 1. Moving an existing Button Trace box
    if (step && step.style === 'trace' && state.traceAction === 'move' && state.traceDragStart) {
      const dxPct = ((e.clientX - state.traceDragStart.clientX) / state.traceDragStart.rectW) * 100;
      const dyPct = ((e.clientY - state.traceDragStart.clientY) / state.traceDragStart.rectH) * 100;
      const halfW = (Number(step.w || 16)) / 2;
      const halfH = (Number(step.h || 8)) / 2;
      step.x = Math.round(Math.max(halfW, Math.min(100 - halfW, state.traceDragStart.startX + dxPct)) * 10) / 10;
      step.y = Math.round(Math.max(halfH, Math.min(100 - halfH, state.traceDragStart.startY + dyPct)) * 10) / 10;
      syncActiveAnchorDOM(step);
      if (finalize) scheduleAutoSave();
      return;
    }

    // 2. Resizing an existing Button Trace box via 8 handles
    if (step && step.style === 'trace' && state.traceAction === 'resize' && state.traceDragStart) {
      const s = state.traceDragStart;
      const dxPct = ((e.clientX - s.clientX) / s.rectW) * 100;
      const dyPct = ((e.clientY - s.clientY) / s.rectH) * 100;
      const dir = state.traceResizeDir || 'se';

      let left = s.startX - s.startW / 2;
      let right = s.startX + s.startW / 2;
      let top = s.startY - s.startH / 2;
      let bottom = s.startY + s.startH / 2;

      if (dir.includes('w')) left = Math.max(0, Math.min(right - 3, left + dxPct));
      if (dir.includes('e')) right = Math.min(100, Math.max(left + 3, right + dxPct));
      if (dir.includes('n')) top = Math.max(0, Math.min(bottom - 3, top + dyPct));
      if (dir.includes('s')) bottom = Math.min(100, Math.max(top + 3, bottom + dyPct));

      step.w = Math.round((right - left) * 10) / 10;
      step.h = Math.round((bottom - top) * 10) / 10;
      step.x = Math.round(((left + right) / 2) * 10) / 10;
      step.y = Math.round(((top + bottom) / 2) * 10) / 10;
      syncActiveAnchorDOM(step);
      if (finalize) scheduleAutoSave();
      return;
    }

    // 3. Drawing a Button Trace box directly on the screenshot canvas
    if (step && step.style === 'trace' && state.traceAction === 'draw' && state.traceDragStart) {
      const s = state.traceDragStart;
      const curX = Math.max(0, Math.min(100, ((e.clientX - rect.left) / rect.width) * 100));
      const curY = Math.max(0, Math.min(100, ((e.clientY - rect.top) / rect.height) * 100));
      const distPx = Math.hypot(e.clientX - s.clientX, e.clientY - s.clientY);

      if (distPx > 8) {
        const left = Math.min(s.clickXPct, curX);
        const right = Math.max(s.clickXPct, curX);
        const top = Math.min(s.clickYPct, curY);
        const bottom = Math.max(s.clickYPct, curY);
        step.w = Math.max(3, Math.round((right - left) * 10) / 10);
        step.h = Math.max(3, Math.round((bottom - top) * 10) / 10);
        step.x = Math.round(((left + right) / 2) * 10) / 10;
        step.y = Math.round(((top + bottom) / 2) * 10) / 10;
      } else {
        step.x = Math.round(curX * 10) / 10;
        step.y = Math.round(curY * 10) / 10;
      }
      syncActiveAnchorDOM(step);
      if (finalize) scheduleAutoSave();
      return;
    }

    // 4. Standard Pin (Beacon / Ring) Positioning
    const x = Math.max(2, Math.min(98, ((e.clientX - rect.left) / rect.width) * 100));
    const y = Math.max(2, Math.min(98, ((e.clientY - rect.top) / rect.height) * 100));

    if (!step) {
      addStepAtCurrentTime(x, y, 'hotspot');
      return;
    }

    step.x = Math.round(x * 10) / 10;
    step.y = Math.round(y * 10) / 10;
    syncActiveAnchorDOM(step);

    if (finalize) {
      scheduleAutoSave();
    }
  };

  overlay.addEventListener('pointerdown', e => {
    if (state.editorMode !== 'edit') return;
    if (e.target.closest('.hotspot-tooltip') || e.target.closest('.demo-text-screen')) return;
    const step = getSelectedStep();
    if (step && getStepType(step) === 'screen') return;
    state.isDraggingHotspot = true;

    if (step && step.style === 'trace') {
      const rect = overlay.getBoundingClientRect();
      state.traceAction = 'draw';
      state.traceDragStart = {
        clientX: e.clientX,
        clientY: e.clientY,
        clickXPct: Math.max(2, Math.min(98, ((e.clientX - rect.left) / rect.width) * 100)),
        clickYPct: Math.max(2, Math.min(98, ((e.clientY - rect.top) / rect.height) * 100))
      };
    } else {
      state.traceAction = null;
    }

    updateHotspotFromPointer(e, true);
  });

  window.addEventListener('pointermove', e => {
    if (!state.isDraggingHotspot || state.editorMode !== 'edit') return;
    updateHotspotFromPointer(e, false);
  });

  window.addEventListener('pointerup', () => {
    if (state.isDraggingHotspot) {
      state.isDraggingHotspot = false;
      state.traceAction = null;
      state.traceResizeDir = null;
      state.traceDragStart = null;
      scheduleAutoSave();
    }
  });

  // Stage Quick Action Bar buttons
  document.querySelectorAll('#stage-edit-toolbar [data-stage-add]').forEach(btn => {
    btn.addEventListener('click', () => {
      const kind = btn.dataset.stageAdd;
      if (kind === 'intro') addStepAtCurrentTime(50, 50, 'screen', { isIntro: true });
      else if (kind === 'screen') addStepAtCurrentTime(50, 50, 'screen');
      else if (kind === 'explainer') addStepAtCurrentTime(50, 50, 'explainer', { isExplainer: true });
      else addStepAtCurrentTime(50, 50, 'hotspot');
    });
  });
  document.getElementById('btn-stage-wf-assets')?.addEventListener('click', () => openWebflowAssetsModal('append'));

  // Zoom & Pan controls (toolbar toggle + inspector select)
  document.getElementById('btn-stage-zoom-pan')?.addEventListener('click', () => {
    const step = getSelectedStep();
    if (!step) return;
    pushUndoSnapshot();
    const curr = Number(step.zoom || 1);
    step.zoom = curr > 1 ? 1 : 1.75;
    renderInspectorPanel();
    renderHotspotOverlay();
    scheduleAutoSave();
    showToast(step.zoom > 1 ? `Zoom & Pan: ${step.zoom}x` : 'Zoom & Pan off');
  });

  document.getElementById('step-zoom-select')?.addEventListener('change', e => {
    const step = getSelectedStep();
    if (!step) return;
    pushUndoSnapshot();
    step.zoom = Number(e.target.value || 1);
    renderInspectorPanel();
    renderHotspotOverlay();
    scheduleAutoSave();
  });

  // Visual Hotspot Style Cards
  document.querySelectorAll('#step-style-cards .style-card-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const step = getSelectedStep();
      if (!step) return;
      pushUndoSnapshot();
      step.style = btn.dataset.style || 'beacon';
      renderInspectorPanel();
      renderHotspotOverlay();
      scheduleAutoSave();
      refreshIcons();
    });
  });

  // Text Alignment Switcher
  document.querySelectorAll('#step-align-switcher .type-pill-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const step = getSelectedStep();
      if (!step) return;
      step.textAlign = btn.dataset.align || 'left';
      renderInspectorPanel();
      renderHotspotOverlay();
      scheduleAutoSave();
    });
  });

  // Card Colors & Border Radius
  document.getElementById('step-bg-color')?.addEventListener('input', e => {
    const step = getSelectedStep();
    if (!step) return;
    step.cardBgColor = e.target.value;
    const hexEl = document.getElementById('step-bg-color-hex');
    if (hexEl) hexEl.textContent = e.target.value.toUpperCase();
    renderHotspotOverlay();
    scheduleAutoSave();
  });

  document.getElementById('step-text-color')?.addEventListener('input', e => {
    const step = getSelectedStep();
    if (!step) return;
    step.cardTextColor = e.target.value;
    const hexEl = document.getElementById('step-text-color-hex');
    if (hexEl) hexEl.textContent = e.target.value.toUpperCase();
    renderHotspotOverlay();
    scheduleAutoSave();
  });

  document.getElementById('step-radius-select')?.addEventListener('change', e => {
    const step = getSelectedStep();
    if (!step) return;
    step.cardRadius = e.target.value;
    renderHotspotOverlay();
    scheduleAutoSave();
  });

  // Add Step Dropdown Menu & Undo Button
  const addMenuBtn = document.getElementById('btn-add-step-menu');
  const addMenuEl = document.getElementById('add-step-menu');
  if (addMenuBtn && addMenuEl) {
    addMenuBtn.addEventListener('click', e => {
      e.stopPropagation();
      addMenuEl.classList.toggle('hidden');
    });
    addMenuEl.addEventListener('click', e => {
      if (e.target.closest('.add-step-menu-item')) {
        addMenuEl.classList.add('hidden');
      }
    });
    document.addEventListener('click', e => {
      if (!e.target.closest('.add-step-dropdown')) {
        addMenuEl.classList.add('hidden');
      }
    });
  }
  document.getElementById('btn-undo-step')?.addEventListener('click', undoStepEdit);

  // Add Hotspot Step vs Intro Screen vs Text Screen vs Explainer Tooltip buttons
  document.getElementById('btn-add-step').addEventListener('click', () => addStepAtCurrentTime(50, 50, 'hotspot'));
  document.getElementById('btn-add-step-timeline').addEventListener('click', () => addStepAtCurrentTime(50, 50, 'hotspot'));
  document.getElementById('btn-add-intro-step')?.addEventListener('click', () => addStepAtCurrentTime(50, 50, 'screen', { isIntro: true }));
  document.getElementById('btn-add-text-step').addEventListener('click', () => addStepAtCurrentTime(50, 50, 'screen'));
  document.getElementById('btn-add-text-timeline').addEventListener('click', () => addStepAtCurrentTime(50, 50, 'screen'));
  document.getElementById('btn-add-explainer-step').addEventListener('click', () => addStepAtCurrentTime(50, 50, 'explainer', { isExplainer: true }));
  document.getElementById('btn-add-explainer-timeline').addEventListener('click', () => addStepAtCurrentTime(50, 50, 'explainer', { isExplainer: true }));

  // Step Type Switcher inside Inspector (Hotspot <-> Text Page <-> Explainer Tooltip)
  document.querySelectorAll('#step-type-switcher .type-pill-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const step = getSelectedStep();
      if (!step) return;
      pushUndoSnapshot();
      const nextType = btn.dataset.stepType;
      step.type = nextType;
      if (nextType === 'explainer') {
        step.isExplainer = true;
        step.showProgress = false;
        if (!step.kicker || step.kicker === 'Product Tour') step.kicker = 'Explainer';
      } else {
        step.isExplainer = false;
      }
      if (nextType === 'screen' && !step.kicker) {
        step.kicker = 'Product Tour';
      }
      if (nextType === 'screen' && !step.screenLayout) {
        step.screenLayout = 'default';
      }
      if (nextType === 'hotspot' && step.style === 'modal') {
        step.style = 'beacon';
      }
      renderEditorStepsList();
      renderInspectorPanel();
      renderTimelineMarkers();
      renderHotspotOverlay();
      if (state.editorMode === 'preview') renderPreviewStepDots();
      scheduleAutoSave();
      refreshIcons();
    });
  });

  // Text Screen Layout Switcher (50/50 vs Text only vs Image only)
  document.querySelectorAll('#step-screen-layout-switcher .type-pill-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const step = getSelectedStep();
      if (!step) return;
      pushUndoSnapshot();
      const layout = btn.dataset.screenLayout;
      step.screenLayout = ['split', 'image'].includes(layout) ? layout : 'default';
      renderInspectorPanel();
      renderHotspotOverlay();
      scheduleAutoSave();
      refreshIcons();
    });
  });

  // Tooltip Visible / Hidden Switcher
  document.querySelectorAll('#step-tooltip-switcher .type-pill-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const step = getSelectedStep();
      if (!step) return;
      const isVis = btn.dataset.tooltipVis === 'visible';
      step.showTooltip = isVis;
      const cb = document.getElementById('step-show-tooltip');
      if (cb) cb.checked = isVis;
      renderInspectorPanel();
      renderHotspotOverlay();
      scheduleAutoSave();
    });
  });

  // Card Element Visibility Checkboxes
  [
    ['step-show-kicker', 'showKicker'],
    ['step-show-title', 'showTitle'],
    ['step-show-body', 'showBody'],
    ['step-show-primary-btn', 'showPrimaryBtn'],
    ['step-show-back-btn', 'showBackBtn'],
    ['step-show-progress', 'showProgress']
  ].forEach(([elId, prop]) => {
    const el = document.getElementById(elId);
    if (!el) return;
    el.addEventListener('change', e => {
      const step = getSelectedStep();
      if (!step) return;
      step[prop] = Boolean(e.target.checked);
      renderHotspotOverlay();
      scheduleAutoSave();
    });
  });

  const setStepToCurrentVideoTime = () => {
    const step = getSelectedStep();
    if (!step) return;
    step.timestamp = Number(mediaGetTime().toFixed(1));
    sortActiveSteps();
    renderEditorStepsList();
    renderInspectorPanel();
    renderTimelineMarkers();
    renderHotspotOverlay();
    scheduleAutoSave();
    showToast(`Time set to ${formatSeconds(step.timestamp)}`);
  };

  document.getElementById('btn-capture-time').addEventListener('click', setStepToCurrentVideoTime);
  document.getElementById('btn-use-curr-time').addEventListener('click', setStepToCurrentVideoTime);

  // Inspector Form Inputs (In-place stage DOM updates for zero-jank typing)
  document.getElementById('step-kicker-input').addEventListener('input', e => {
    const step = getSelectedStep();
    if (!step) return;
    step.kicker = e.target.value;
    const kickerEl = document.getElementById('active-stage-kicker');
    if (kickerEl) {
      const idx = state.activeDemo.steps.findIndex(s => s.id === step.id);
      kickerEl.textContent = step.kicker || `Step ${idx + 1} of ${state.activeDemo.steps.length}`;
    } else {
      renderHotspotOverlay();
    }
    scheduleAutoSave();
  });

  document.getElementById('step-title-input').addEventListener('input', e => {
    const step = getSelectedStep();
    if (!step) return;
    step.title = e.target.value;
    const titleEl = document.getElementById('active-stage-title');
    const idx = state.activeDemo.steps.findIndex(s => s.id === step.id);
    if (titleEl) {
      titleEl.textContent = step.title || `Step ${idx + 1}`;
    } else {
      renderHotspotOverlay();
    }
    const activeCardTitle = document.querySelector('#steps-list .step-card.active .step-card-title');
    if (activeCardTitle) {
      activeCardTitle.textContent = step.title || `Step ${idx + 1}`;
    } else {
      renderEditorStepsList();
    }
    scheduleAutoSave();
  });

  document.getElementById('step-body-input').addEventListener('input', e => {
    const step = getSelectedStep();
    if (!step) return;
    step.body = e.target.value;
    const bodyEl = document.getElementById('active-stage-body');
    if (bodyEl) {
      bodyEl.textContent = step.body || '';
    } else {
      renderHotspotOverlay();
    }
    scheduleAutoSave();
  });

  document.getElementById('step-timestamp-input').addEventListener('change', e => {
    const step = getSelectedStep();
    if (!step) return;
    step.timestamp = Math.max(0, Number(e.target.value || 0));
    sortActiveSteps();
    mediaSetTime(step.timestamp);
    renderEditorStepsList();
    renderTimelineMarkers();
    renderHotspotOverlay();
    scheduleAutoSave();
  });

  document.getElementById('step-placement-select').addEventListener('change', e => {
    const step = getSelectedStep();
    if (!step) return;
    step.placement = e.target.value;
    renderHotspotOverlay();
    scheduleAutoSave();
  });

  document.getElementById('step-style-select').addEventListener('change', e => {
    const step = getSelectedStep();
    if (!step) return;
    step.style = e.target.value;
    if (step.style === 'trace') {
      if (!step.w) step.w = 16;
      if (!step.h) step.h = 8;
      if (step.showTooltip === undefined) step.showTooltip = true;
    }
    renderInspectorPanel();
    renderHotspotOverlay();
    scheduleAutoSave();
    refreshIcons();
  });

  const showTipCheckbox = document.getElementById('step-show-tooltip');
  if (showTipCheckbox) {
    showTipCheckbox.addEventListener('change', e => {
      const step = getSelectedStep();
      if (!step) return;
      step.showTooltip = e.target.checked;
      renderHotspotOverlay();
      scheduleAutoSave();
    });
  }

  document.getElementById('step-backdrop-select').addEventListener('change', e => {
    const step = getSelectedStep();
    if (!step) return;
    step.backdrop = e.target.value;
    renderHotspotOverlay();
    scheduleAutoSave();
  });

  document.getElementById('step-btn-text-input').addEventListener('input', e => {
    const step = getSelectedStep();
    if (!step) return;
    step.buttonText = e.target.value;
    const btnTextEl = document.getElementById('active-stage-btn-text');
    if (btnTextEl) {
      const idx = state.activeDemo.steps.findIndex(s => s.id === step.id);
      const isLast = idx === state.activeDemo.steps.length - 1;
      btnTextEl.textContent = step.buttonText || (isLast ? 'Finish' : 'Next');
    } else {
      renderHotspotOverlay();
    }
    scheduleAutoSave();
  });

  document.getElementById('step-advance-hotspot').addEventListener('change', e => {
    const step = getSelectedStep();
    if (!step) return;
    step.advanceOnHotspotClick = e.target.checked;
    scheduleAutoSave();
  });

  document.getElementById('step-cta-url-input').addEventListener('input', e => {
    const step = getSelectedStep();
    if (!step) return;
    step.ctaUrl = e.target.value.trim();
    renderHotspotOverlay();
    scheduleAutoSave();
  });

  document.getElementById('btn-delete-step').addEventListener('click', () => {
    const step = getSelectedStep();
    if (!step || !state.activeDemo) return;
    pushUndoSnapshot();
    state.activeDemo.steps = state.activeDemo.steps.filter(s => s.id !== step.id);
    state.selectedStepId = state.activeDemo.steps[0]?.id || null;
    setupEditorVideoSource();
    renderEditorStepsList();
    renderInspectorPanel();
    renderTimelineMarkers();
    renderHotspotOverlay();
    scheduleAutoSave();
    showToast('Step deleted');
  });

  // Preview Controls Bar & Keyboard Navigation
  document.getElementById('btn-preview-restart').addEventListener('click', () => startInteractivePreview());
  document.getElementById('btn-preview-prev').addEventListener('click', () => {
    if (state.previewStepIndex > 0) jumpToPreviewStep(state.previewStepIndex - 1);
  });
  document.getElementById('btn-preview-next').addEventListener('click', () => advancePreviewStep());
  document.getElementById('btn-preview-fullscreen').addEventListener('click', () => {
    const stageWrap = document.getElementById('stage-viewport-wrap');
    if (!stageWrap) return;
    if (document.fullscreenElement) {
      if (document.exitFullscreen) document.exitFullscreen();
    } else if (stageWrap.requestFullscreen) {
      stageWrap.requestFullscreen();
    }
  });

  document.addEventListener('fullscreenchange', () => {
    syncViewportSize();
  });

  window.addEventListener('keydown', e => {
    if (state.currentView !== 'editor') return;
    if (e.target.matches('input, textarea, select')) return;

    if (state.editorMode === 'edit' && (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      if (e.shiftKey) redoStepEdit();
      else undoStepEdit();
      return;
    }

    if (state.editorMode !== 'preview') return;
    if (e.key === 'ArrowRight' || e.key === 'Enter') {
      e.preventDefault();
      advancePreviewStep();
    } else if (e.key === 'ArrowLeft' && state.previewStepIndex > 0) {
      e.preventDefault();
      jumpToPreviewStep(state.previewStepIndex - 1);
    }
  });

  // Webflow Modal Events
  document.getElementById('btn-close-webflow-modal').addEventListener('click', () => {
    document.getElementById('modal-webflow').classList.add('hidden');
  });

  document.querySelectorAll('.modal-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      state.activeWfTab = tab.dataset.wfTab;
      document.querySelectorAll('.modal-tab').forEach(t => t.classList.toggle('active', t === tab));
      document.getElementById('wf-config-single').classList.toggle('hidden', state.activeWfTab !== 'single');
      document.getElementById('wf-config-hub').classList.toggle('hidden', state.activeWfTab !== 'hub');
      document.getElementById('wf-config-download').classList.toggle('hidden', state.activeWfTab !== 'download');
      updateWebflowCodeOutput();
    });
  });

  document.getElementById('wf-select-demo').addEventListener('change', updateWebflowCodeOutput);
  document.getElementById('wf-video-override').addEventListener('input', updateWebflowCodeOutput);
  document.getElementById('btn-upload-base64-wf')?.addEventListener('click', convertBase64ScreenshotsToWebflow);

  document.getElementById('btn-copy-wf-code').addEventListener('click', () => {
    const code = document.getElementById('wf-code-output').value;
    navigator.clipboard.writeText(code).catch(() => {});
    const btnSpan = document.querySelector('#btn-copy-wf-code span');
    btnSpan.textContent = 'Copied!';
    showToast('Copied Webflow snippet');
    setTimeout(() => { btnSpan.textContent = 'Copy'; }, 1800);
  });

  document.getElementById('btn-download-single-html').addEventListener('click', () => {
    const select = document.getElementById('wf-select-demo');
    const urlOverride = document.getElementById('wf-video-override').value.trim();
    const demo = state.demos.find(d => d.id === select.value) || state.activeDemo || state.demos[0];
    if (!demo) return;
    const snippet = generateSingleDemoWebflowSnippet(demo, urlOverride);
    downloadHtmlFile(`${demo.id}.html`, snippet, demo.title);
    showToast(`Downloaded ${demo.id}.html`);
  });

  document.getElementById('btn-download-hub-html').addEventListener('click', () => {
    const snippet = generateHubWebflowSnippet();
    downloadHtmlFile('bxlearn-walkthrough-hub.html', snippet, 'BxLearn Walkthrough Hub');
    showToast('Downloaded bxlearn-walkthrough-hub.html');
  });

  bindWebflowAssetsModalEvents();
}

// =========================================================
// WEBFLOW SITE ASSETS BROWSER & SMART ASSET URL LOADER
// =========================================================
const WF_TOKEN_STORAGE_KEY = 'bxlearn_webflow_api_token_v1';
const WF_SITE_ID_STORAGE_KEY = 'bxlearn_webflow_site_id_v1';

const wfAssetsState = {
  mode: 'append', // 'append' | 'replace-step'
  sites: [],
  folders: [],
  assets: [],
  selectedIds: new Set(),
  searchQuery: '',
  selectedFolderId: '__ALL__',
  loading: false
};

function isImageAssetUrl(url = '', contentType = '') {
  if (contentType && contentType.startsWith('image/')) return true;
  const clean = String(url).split('?')[0].toLowerCase();
  return /\.(png|jpe?g|webp|gif|svg|avif)$/.test(clean);
}

function extractAssetDisplayName(url = '', fallback = 'Webflow Asset') {
  try {
    const clean = decodeURIComponent(String(url).split('?')[0].split('/').pop() || '');
    // Strip Webflow's 24-char hex asset prefix if present (e.g. "65f1a2b..._hero.png")
    const stripped = clean.replace(/^[0-9a-f]{24}[_-]/i, '').replace(/\.[^.]+$/, '');
    return stripped || fallback;
  } catch (e) {
    return fallback;
  }
}

function addScreenshotStepFromUrl(imageUrl, displayName = '') {
  if (!state.activeDemo || !imageUrl) return null;
  const stepNum = (state.activeDemo.steps?.length || 0) + 1;
  const cleanName = displayName || extractAssetDisplayName(imageUrl, 'Click here');
  const newStep = {
    id: `step-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    type: 'hotspot',
    backdrop: 'blur',
    kicker: '',
    timestamp: Number((stepNum - 1).toFixed(1)),
    title: `Step ${stepNum}: ${cleanName}`,
    body: 'Click the highlighted hotspot on this screen to continue.',
    x: 50,
    y: 50,
    w: 16,
    h: 8,
    style: 'beacon',
    placement: 'auto',
    buttonText: 'Continue',
    advanceOnHotspotClick: true,
    ctaUrl: '',
    imageUrl,
    imageName: displayName || imageUrl.split('/').pop() || 'Webflow Asset'
  };
  state.activeDemo.steps.push(newStep);
  return newStep;
}

function loadAssetUrlIntoActiveDemo(url, displayName = '') {
  if (!url || !state.activeDemo) return;
  if (isImageAssetUrl(url)) {
    const created = addScreenshotStepFromUrl(url, displayName);
    if (created) state.selectedStepId = created.id;
    setupEditorVideoSource();
    renderEditorStepsList();
    renderInspectorPanel();
    renderTimelineMarkers();
    renderHotspotOverlay();
    scheduleAutoSave();
    refreshIcons();
    showToast('Added Webflow image asset as step');
  } else {
    state.activeDemo.videoUrl = url;
    state.activeDemo.useSampleCanvasVideo = false;
    setupEditorVideoSource();
    if (state.activeDemo.steps.length === 0) addStepAtCurrentTime(50, 50, 'hotspot');
    scheduleAutoSave();
    showToast('Loaded Webflow video asset');
  }
}

async function webflowApiGet(endpoint, token) {
  const base = getAppBasePath();
  const candidateUrls = [
    `${base}/api/webflow/proxy?endpoint=${encodeURIComponent(endpoint)}`,
    `/api/webflow/proxy?endpoint=${encodeURIComponent(endpoint)}`
  ];

  // 1. Try Astro Edge / local Node server proxy first
  for (const proxyUrl of candidateUrls) {
    try {
      const proxyRes = await fetch(proxyUrl, {
        headers: { 'X-Webflow-Token': token }
      });
      const contentType = proxyRes.headers.get('content-type') || '';
      if (contentType.includes('application/json')) {
        const body = await proxyRes.json().catch(() => ({}));
        if (proxyRes.ok) {
          return body;
        }
        if (proxyRes.status !== 404) {
          throw new Error(body.message || body.error || `Webflow API error (${proxyRes.status})`);
        }
      }
    } catch (err) {
      if (err.message && err.message.startsWith('Webflow API')) throw err;
    }
  }

  // 2. Try CORS proxy relay (for static deployments where /api/webflow/proxy is not running)
  const targetUrl = `https://api.webflow.com${endpoint}`;
  const corsProxyUrl = `https://corsproxy.io/?url=${encodeURIComponent(targetUrl)}`;
  try {
    const corsRes = await fetch(corsProxyUrl, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json'
      }
    });
    const corsContentType = corsRes.headers.get('content-type') || '';
    if (corsContentType.includes('application/json')) {
      const corsData = await corsRes.json().catch(() => ({}));
      if (corsRes.ok) return corsData;
      throw new Error(corsData.message || corsData.error || `Webflow API returned ${corsRes.status}`);
    }
  } catch (err) {
    if (err.message && err.message.includes('Webflow API')) throw err;
  }

  throw new Error(
    'Webflow API blocks direct browser requests (CORS). Run "npm start" locally on port 3000 to use the built-in server proxy, or paste Webflow CDN asset URLs directly in the Load box.'
  );
}

function setWfAssetsStatus(msg, type = '') {
  const el = document.getElementById('wf-assets-status');
  if (!el) return;
  el.innerHTML = msg;
  el.classList.remove('connected', 'error');
  if (type) el.classList.add(type);
}

async function openWebflowAssetsModal(mode = 'append') {
  wfAssetsState.mode = mode;
  wfAssetsState.selectedIds.clear();
  const modal = document.getElementById('modal-webflow-assets');
  if (!modal) return;

  const savedToken = localStorage.getItem(WF_TOKEN_STORAGE_KEY) || '';
  const savedSiteId = localStorage.getItem(WF_SITE_ID_STORAGE_KEY) || '';
  const tokenInput = document.getElementById('wf-assets-token-input');
  const siteIdInput = document.getElementById('wf-assets-site-id-input');

  if (tokenInput) tokenInput.value = savedToken;
  if (siteIdInput) siteIdInput.value = savedSiteId;

  modal.classList.remove('hidden');
  updateWfSelectedCountUI();
  refreshIcons(modal);

  if (savedToken && (savedSiteId || wfAssetsState.assets.length === 0)) {
    await connectWebflowAssetsApi();
  } else {
    renderWebflowAssetsGrid();
  }
}

async function connectWebflowAssetsApi() {
  const tokenInput = document.getElementById('wf-assets-token-input');
  const siteIdInput = document.getElementById('wf-assets-site-id-input');
  const siteSelect = document.getElementById('wf-assets-site-select');
  const token = (tokenInput?.value || '').trim();
  let siteId = (siteIdInput?.value || '').trim();

  if (!token) {
    setWfAssetsStatus('Please paste your Webflow Site API Token first.', 'error');
    return;
  }

  try {
    localStorage.setItem(WF_TOKEN_STORAGE_KEY, token);
  } catch (e) {}

  setWfAssetsStatus('Connecting to Webflow API...', '');

  try {
    // If Site ID is already provided by the user, load assets directly first
    if (siteId) {
      try {
        localStorage.setItem(WF_SITE_ID_STORAGE_KEY, siteId);
      } catch (e) {}
      await loadWebflowSiteAssets(siteId, token);
      return;
    }

    // Otherwise auto-discover sites via /v2/sites
    try {
      const sitesData = await webflowApiGet('/v2/sites', token);
      if (sitesData && Array.isArray(sitesData.sites) && sitesData.sites.length > 0) {
        wfAssetsState.sites = sitesData.sites;
        if (siteSelect) {
          siteSelect.innerHTML = '';
          sitesData.sites.forEach(s => {
            const opt = document.createElement('option');
            opt.value = s.id;
            opt.textContent = `${s.displayName || s.shortName || s.id}`;
            siteSelect.appendChild(opt);
          });
          siteSelect.classList.remove('hidden');
          if (siteIdInput) siteIdInput.classList.add('hidden');
          siteId = sitesData.sites[0].id;
          siteSelect.value = siteId;
        }
      }
    } catch (siteErr) {
      // Token may only have assets:read without sites:read — fall back to manual siteId input
    }

    if (!siteId) {
      setWfAssetsStatus('Token connected! Please enter your 24-character Webflow Site ID (or enable <code>sites:read</code> scope on your token).', 'error');
      if (siteIdInput) siteIdInput.classList.remove('hidden');
      return;
    }

    try {
      localStorage.setItem(WF_SITE_ID_STORAGE_KEY, siteId);
    } catch (e) {}

    await loadWebflowSiteAssets(siteId, token);
  } catch (err) {
    setWfAssetsStatus(`Connection failed: ${escapeHtml(err.message || 'Check token & scopes')}`, 'error');
  }
}

async function loadWebflowSiteAssets(siteId, token) {
  setWfAssetsStatus('Loading assets from Webflow...', '');
  const [assetsRes, foldersRes] = await Promise.all([
    webflowApiGet(`/v2/sites/${encodeURIComponent(siteId)}/assets`, token),
    webflowApiGet(`/v2/sites/${encodeURIComponent(siteId)}/asset_folders`, token).catch(() => ({ assetFolders: [] }))
  ]);

  wfAssetsState.assets = Array.isArray(assetsRes.assets) ? assetsRes.assets : [];
  wfAssetsState.folders = Array.isArray(foldersRes.assetFolders) ? foldersRes.assetFolders : [];

  const folderSelect = document.getElementById('wf-assets-folder-select');
  if (folderSelect) {
    folderSelect.innerHTML = `<option value="__ALL__">All Asset Folders (${wfAssetsState.assets.length})</option>`;
    wfAssetsState.folders.forEach(f => {
      const opt = document.createElement('option');
      opt.value = f.id;
      opt.textContent = f.displayName || f.id;
      folderSelect.appendChild(opt);
    });
  }

  setWfAssetsStatus(`Connected — loaded ${wfAssetsState.assets.length} asset(s) from Webflow.`, 'connected');
  renderWebflowAssetsGrid();
  syncExistingDemosToWebflowAssets().catch(() => {});
}

let isSyncingExistingDemos = false;
async function syncExistingDemosToWebflowAssets() {
  if (isSyncingExistingDemos) return;
  const wfCfg = getWebflowConfig();
  if (!wfCfg.apiToken || !wfCfg.siteId) return;

  isSyncingExistingDemos = true;
  try {
    const urlCache = new Map();
    let totalConverted = 0;

    const allDemos = [...(state.demos || [])];
    if (state.activeDemo && !allDemos.some(d => d.id === state.activeDemo.id)) {
      allDemos.push(state.activeDemo);
    }

    for (const demo of allDemos) {
      let changed = false;
      for (const step of (demo.steps || [])) {
        if (!step || typeof step.imageUrl !== 'string' || !step.imageUrl.startsWith('data:image/')) continue;
        const raw = step.imageUrl;
        let hostedUrl = urlCache.get(raw);
        if (!hostedUrl) {
          try {
            const blob = await (await fetch(raw)).blob();
            const ext = (blob.type && blob.type.split('/')[1]) || 'png';
            const file = new File([blob], step.imageName || `step-${step.id}.${ext}`, { type: blob.type || 'image/png' });
            const uploaded = await webflowUploadAsset(file);
            if (uploaded && uploaded.imageUrl) {
              hostedUrl = uploaded.imageUrl;
              urlCache.set(raw, hostedUrl);
            }
          } catch {}
        }
        if (hostedUrl) {
          step.imageUrl = hostedUrl;
          changed = true;
          totalConverted += 1;
        }
      }

      if (changed) {
        if (state.activeDemo && state.activeDemo.id === demo.id) {
          state.activeDemo.steps = demo.steps;
        }
        await apiUpdateDemo(demo);
      }
    }

    if (totalConverted > 0) {
      if (state.currentView === 'editor') {
        renderEditorStepsList();
        renderHotspotOverlay();
      } else {
        renderLibraryView();
      }
      showToast(`Connected ${totalConverted} existing screenshot(s) to Webflow Assets`);
    }
  } finally {
    isSyncingExistingDemos = false;
  }
}

function getWebflowAssetUrl(asset) {
  if (!asset) return '';
  if (asset.hostedUrl) return asset.hostedUrl;
  if (Array.isArray(asset.variants) && asset.variants.length > 0 && asset.variants[0].hostedUrl) {
    return asset.variants[0].hostedUrl;
  }
  return '';
}

function renderWebflowAssetsGrid() {
  const grid = document.getElementById('wf-assets-grid');
  if (!grid) return;
  grid.innerHTML = '';

  const q = wfAssetsState.searchQuery.trim().toLowerCase();
  const folderFilter = wfAssetsState.selectedFolderId;

  const filtered = wfAssetsState.assets.filter(a => {
    const url = getWebflowAssetUrl(a);
    if (!url) return false;
    if (folderFilter !== '__ALL__' && a.folderId !== folderFilter) return false;
    if (q) {
      const name = `${a.displayName || ''} ${a.originalFileName || ''}`.toLowerCase();
      if (!name.includes(q)) return false;
    }
    return true;
  });

  if (filtered.length === 0) {
    grid.innerHTML = `
      <div class="wf-assets-empty">
        <i data-lucide="image"></i>
        <p>${wfAssetsState.assets.length === 0
          ? 'Connect your Webflow API Token above to browse your site assets.'
          : 'No matching assets in this folder.'}</p>
      </div>
    `;
    refreshIcons(grid);
    return;
  }

  filtered.forEach(asset => {
    const url = getWebflowAssetUrl(asset);
    const name = asset.displayName || asset.originalFileName || 'Untitled asset';
    const isImg = isImageAssetUrl(url, asset.contentType || '');
    const ext = (name.split('.').pop() || (isImg ? 'IMG' : 'VIDEO')).slice(0, 5);
    const isSelected = wfAssetsState.selectedIds.has(asset.id);

    const card = document.createElement('div');
    card.className = `wf-asset-card ${isSelected ? 'selected' : ''}`;
    card.innerHTML = `
      <div class="wf-asset-thumb">
        ${isImg
          ? `<img src="${escapeHtml(url)}" alt="${escapeHtml(name)}" loading="lazy" />`
          : `<video src="${escapeHtml(url)}" muted preload="metadata"></video>`}
        <span class="wf-asset-check">✓</span>
        <span class="wf-asset-badge">${escapeHtml(ext)}</span>
      </div>
      <div class="wf-asset-meta" title="${escapeHtml(name)}">${escapeHtml(name)}</div>
    `;

    card.addEventListener('click', () => {
      if (wfAssetsState.mode === 'replace-step' || wfAssetsState.mode === 'flow-replace') {
        wfAssetsState.selectedIds.clear();
        wfAssetsState.selectedIds.add(asset.id);
      } else {
        if (wfAssetsState.selectedIds.has(asset.id)) {
          wfAssetsState.selectedIds.delete(asset.id);
        } else {
          wfAssetsState.selectedIds.add(asset.id);
        }
      }
      updateWfSelectedCountUI();
      renderWebflowAssetsGrid();
    });

    card.addEventListener('dblclick', () => {
      wfAssetsState.selectedIds.clear();
      wfAssetsState.selectedIds.add(asset.id);
      insertSelectedWebflowAssets();
    });

    grid.appendChild(card);
  });
}

function updateWfSelectedCountUI() {
  const count = wfAssetsState.selectedIds.size;
  const label = document.getElementById('wf-assets-selected-count');
  const btn = document.getElementById('btn-wf-assets-insert');
  if (label) label.textContent = `${count} asset${count === 1 ? '' : 's'} selected`;
  if (btn) btn.disabled = count === 0;
}

async function insertSelectedWebflowAssets() {
  if (!state.activeDemo || wfAssetsState.selectedIds.size === 0) return;
  const chosen = wfAssetsState.assets.filter(a => wfAssetsState.selectedIds.has(a.id));
  if (chosen.length === 0) return;

  if (wfAssetsState.mode === 'flow-replace') {
    const asset = chosen[0];
    const url = getWebflowAssetUrl(asset);
    const node = typeof getSelectedFlowNode === 'function' ? getSelectedFlowNode() : null;
    if (node && url) {
      node.imageUrl = url;
      renderFlowCanvas();
      renderFlowInspector();
      scheduleAutoSave();
      showToast('Updated screen image from Webflow Assets');
    }
  } else if (wfAssetsState.mode === 'flow-add') {
    for (const asset of chosen) {
      const url = getWebflowAssetUrl(asset);
      const name = (asset.displayName || asset.originalFileName || 'Screen').replace(/\.[^.]+$/, '');
      if (!url || !isImageAssetUrl(url, asset.contentType || '')) continue;
      const count = (state.activeDemo.nodes || []).length;
      const newNode = {
        id: `node-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 5)}`,
        title: name,
        imageUrl: url,
        flowX: 120 + (count % 4) * 280,
        flowY: 120 + Math.floor(count / 4) * 240,
        hotspots: []
      };
      state.activeDemo.nodes.push(newNode);
      if (!state.activeDemo.startNodeId) state.activeDemo.startNodeId = newNode.id;
      if (typeof flowState !== 'undefined') flowState.selectedNodeId = newNode.id;
    }
    if (typeof renderFlowCanvas === 'function') renderFlowCanvas();
    if (typeof renderFlowInspector === 'function') renderFlowInspector();
    scheduleAutoSave();
    refreshIcons();
    showToast('Added screen(s) from Webflow Assets');
  } else if (wfAssetsState.mode === 'replace-step') {
    const asset = chosen[0];
    const url = getWebflowAssetUrl(asset);
    const name = asset.displayName || asset.originalFileName || 'Webflow Asset';
    const step = getSelectedStep();
    if (step && url) {
      step.imageUrl = url;
      step.imageName = name;
      setupEditorVideoSource();
      renderEditorStepsList();
      renderInspectorPanel();
      renderTimelineMarkers();
      renderHotspotOverlay();
      scheduleAutoSave();
      showToast(`Attached "${name}" from Webflow Assets`);
    }
  } else {
    let firstCreatedId = null;
    for (const asset of chosen) {
      const url = getWebflowAssetUrl(asset);
      const name = asset.displayName || asset.originalFileName || 'Webflow Asset';
      if (!url) continue;
      if (isImageAssetUrl(url, asset.contentType || '')) {
        const created = addScreenshotStepFromUrl(url, name.replace(/\.[^.]+$/, ''));
        if (created && !firstCreatedId) firstCreatedId = created.id;
      } else {
        state.activeDemo.videoUrl = url;
        state.activeDemo.useSampleCanvasVideo = false;
      }
    }
    if (firstCreatedId) state.selectedStepId = firstCreatedId;
    setupEditorVideoSource();
    renderEditorStepsList();
    renderInspectorPanel();
    renderTimelineMarkers();
    renderHotspotOverlay();
    await apiUpdateDemo(state.activeDemo);
    refreshIcons();
    showToast(`Added ${chosen.length} Webflow asset${chosen.length === 1 ? '' : 's'}`);
  }

  document.getElementById('modal-webflow-assets').classList.add('hidden');
}

function bindWebflowAssetsModalEvents() {
  const closeModal = () => {
    document.getElementById('modal-webflow-assets')?.classList.add('hidden');
  };
  document.getElementById('btn-close-wf-assets-modal')?.addEventListener('click', closeModal);
  document.getElementById('btn-cancel-wf-assets')?.addEventListener('click', closeModal);
  document.getElementById('btn-wf-assets-connect')?.addEventListener('click', () => connectWebflowAssetsApi());
  document.getElementById('btn-wf-assets-insert')?.addEventListener('click', () => insertSelectedWebflowAssets());

  document.getElementById('wf-assets-site-select')?.addEventListener('change', async e => {
    const siteId = e.target.value;
    const token = (document.getElementById('wf-assets-token-input')?.value || '').trim();
    if (siteId && token) {
      try {
        localStorage.setItem(WF_SITE_ID_STORAGE_KEY, siteId);
      } catch (err) {}
      await loadWebflowSiteAssets(siteId, token);
    }
  });

  document.getElementById('wf-assets-search')?.addEventListener('input', e => {
    wfAssetsState.searchQuery = e.target.value;
    renderWebflowAssetsGrid();
  });

  document.getElementById('wf-assets-folder-select')?.addEventListener('change', e => {
    wfAssetsState.selectedFolderId = e.target.value;
    renderWebflowAssetsGrid();
  });
}

// Utilities
function formatSeconds(sec) {
  const s = Math.max(0, Number(sec || 0));
  const mins = Math.floor(s / 60);
  const rem = (s % 60).toFixed(1);
  return `${String(mins).padStart(2, '0')}:${rem.padStart(4, '0')}`;
}

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function refreshIcons(root = document) {
  if (window.lucide && typeof window.lucide.createIcons === 'function') {
    try {
      const scope = root && typeof root.querySelector === 'function' ? root : document;
      if (!scope.querySelector('[data-lucide]')) return;
      window.lucide.createIcons();
    } catch (e) {}
  }
}

// =========================================================
// STUDIO AUTHENTICATION GATE (App only, never in embeds)
// =========================================================
const AUTH_STORAGE_KEY = 'bxlearn_auth_session_v1';
const AUTH_USER = 'marcus.saltvik@bxsoftware.no';
const AUTH_PASS = 'SvenToreBowling123@';

function bytesToBase64Url(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlToBytes(str) {
  const b64 = str.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((str.length + 3) % 4);
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

async function encodeSharePayload(demo) {
  if (demo.kind === 'flow') {
    const flowMinimal = {
      v: 2,
      k: 'flow',
      id: demo.id,
      t: demo.title || 'Interactive Demo',
      sn: demo.startNodeId || '',
      n: demo.nodes || []
    };
    const jsonBytes = new TextEncoder().encode(JSON.stringify(flowMinimal));
    if (typeof CompressionStream === 'function') {
      try {
        const cs = new CompressionStream('deflate-raw');
        const writer = cs.writable.getWriter();
        writer.write(jsonBytes);
        writer.close();
        const compressed = new Uint8Array(await new Response(cs.readable).arrayBuffer());
        return 'z_' + bytesToBase64Url(compressed);
      } catch {}
    }
    return 'u_' + bytesToBase64Url(jsonBytes);
  }
  const urlTable = [];
  const urlIndexMap = new Map();
  const compactSteps = (demo.steps || []).map(st => {
    const s = {};
    if (st.type && st.type !== 'hotspot') s.ty = st.type;
    if (st.isExplainer) s.ex = 1;
    if (st.showKicker === false) s.sk = 0;
    if (st.showTitle === false) s.st = 0;
    if (st.showBody === false) s.sb = 0;
    if (st.showPrimaryBtn === false || st.showButtons === false) s.sp = 0;
    if (st.showBackBtn === false || st.showButtons === false) s.sk2 = 0;
    const isExplainer = st.type === 'explainer' || st.isExplainer === true;
    if (st.showProgress !== undefined && Boolean(st.showProgress) !== !isExplainer) {
      s.spg = st.showProgress ? 1 : 0;
    }
    if (st.screenLayout && st.screenLayout !== 'default') s.sl = st.screenLayout;
    if (st.backdrop && st.backdrop !== 'blur') s.bd = st.backdrop;
    if (st.kicker) s.k = st.kicker;
    if (st.timestamp) s.ts = Number(st.timestamp);
    if (st.title) s.t = st.title;
    if (st.body) s.b = st.body;
    if (st.x !== undefined && st.x !== 50) s.x = Number(st.x);
    if (st.y !== undefined && st.y !== 50) s.y = Number(st.y);
    if (st.w) s.w = Number(st.w);
    if (st.h) s.h = Number(st.h);
    if (st.style && st.style !== 'beacon') s.sy = st.style;
    if (st.placement && st.placement !== 'auto') s.pl = st.placement;
    if (st.buttonText) s.bt = st.buttonText;
    if (st.advanceOnHotspotClick === false) s.ah = 0;
    if (st.showTooltip === false) s.stp = 0;
    if (st.zoom && Number(st.zoom) > 1) s.zm = Number(st.zoom);
    if (st.ctaUrl) s.cu = st.ctaUrl;
    if (st.imageUrl) {
      const compactUrl = st.imageUrl.startsWith('https://cdn.prod.website-files.com/')
        ? '~wf/' + st.imageUrl.slice('https://cdn.prod.website-files.com/'.length)
        : st.imageUrl;
      let idx = urlIndexMap.get(compactUrl);
      if (idx === undefined) {
        idx = urlTable.length;
        urlTable.push(compactUrl);
        urlIndexMap.set(compactUrl, idx);
      }
      s.im = idx;
    }
    return s;
  });

  const minimal = {
    v: 2,
    id: demo.id,
    t: demo.title || 'Walkthrough',
    s: compactSteps
  };
  if (demo.description) minimal.d = demo.description;
  if (demo.videoUrl) minimal.vu = demo.videoUrl;
  if (demo.useSampleCanvasVideo) minimal.sc = 1;
  if (demo.manualStepOrder) minimal.mo = 1;
  if (urlTable.length > 0) minimal.u = urlTable;

  const jsonBytes = new TextEncoder().encode(JSON.stringify(minimal));
  if (typeof CompressionStream === 'function') {
    try {
      const cs = new CompressionStream('deflate-raw');
      const writer = cs.writable.getWriter();
      writer.write(jsonBytes);
      writer.close();
      const compressed = new Uint8Array(await new Response(cs.readable).arrayBuffer());
      return 'z_' + bytesToBase64Url(compressed);
    } catch {}
  }
  return 'u_' + bytesToBase64Url(jsonBytes);
}

function expandSharePayload(parsed) {
  if (!parsed || parsed.v !== 2) return parsed;
  if (parsed.k === 'flow') {
    return {
      id: parsed.id || 'shared-flow',
      kind: 'flow',
      title: parsed.t || 'Interactive Demo',
      startNodeId: parsed.sn || '',
      nodes: parsed.n || [],
      steps: []
    };
  }
  const urls = Array.isArray(parsed.u)
    ? parsed.u.map(u => (typeof u === 'string' && u.startsWith('~wf/'))
      ? 'https://cdn.prod.website-files.com/' + u.slice(4)
      : u)
    : [];
  return {
    id: parsed.id || 'shared-demo',
    title: parsed.t || 'Walkthrough',
    description: parsed.d || '',
    videoUrl: parsed.vu || '',
    useSampleCanvasVideo: Boolean(parsed.sc),
    manualStepOrder: Boolean(parsed.mo),
    steps: (parsed.s || []).map((s, idx) => {
      const type = s.ty || 'hotspot';
      const isExplainer = type === 'explainer' || Boolean(s.ex);
      return {
        id: `s${idx}`,
        type,
        isExplainer,
        showKicker: s.sk !== 0,
        showTitle: s.st !== 0,
        showBody: s.sb !== 0,
        showPrimaryBtn: s.sp !== 0,
        showBackBtn: s.sk2 !== 0,
        showProgress: s.spg !== undefined ? Boolean(s.spg) : !isExplainer,
        screenLayout: s.sl || 'default',
        backdrop: s.bd || 'blur',
        kicker: s.k || '',
        timestamp: s.ts || 0,
        title: s.t || '',
        body: s.b || '',
        x: s.x !== undefined ? s.x : 50,
        y: s.y !== undefined ? s.y : 50,
        w: s.w,
        h: s.h,
        style: s.sy || 'beacon',
        placement: s.pl || 'auto',
        buttonText: s.bt || '',
        advanceOnHotspotClick: s.ah !== 0,
        showTooltip: s.stp !== 0,
        zoom: s.zm ? Number(s.zm) : 1,
        ctaUrl: s.cu || '',
        imageUrl: s.im !== undefined ? (urls[s.im] || '') : ''
      };
    })
  };
}

async function decodeSharePayload(token) {
  if (!token) return null;
  try {
    let parsed = null;
    if (token.startsWith('z_') && typeof DecompressionStream === 'function') {
      const bytes = base64UrlToBytes(token.slice(2));
      const ds = new DecompressionStream('deflate-raw');
      const writer = ds.writable.getWriter();
      writer.write(bytes);
      writer.close();
      const text = await new Response(ds.readable).text();
      parsed = JSON.parse(text);
    } else {
      const raw = token.startsWith('u_') ? token.slice(2) : token;
      const bytes = base64UrlToBytes(raw);
      parsed = JSON.parse(new TextDecoder().decode(bytes));
    }
    return expandSharePayload(parsed);
  } catch (err) {
    console.warn('Failed to decode shared preview payload:', err);
    return null;
  }
}

async function copySharePreviewUrl() {
  if (!state.activeDemo) return;

  // Auto-upload any remaining base64 screenshots to Webflow Assets if connected
  const wfCfg = getWebflowConfig();
  const hasWf = Boolean(wfCfg.apiToken && wfCfg.siteId);
  const base64Steps = (state.activeDemo.steps || []).filter(
    s => s && typeof s.imageUrl === 'string' && s.imageUrl.startsWith('data:image/')
  );
  let uploadFailed = false;
  if (hasWf && base64Steps.length > 0) {
    showToast('Uploading screenshots to Webflow Assets...');
    let converted = 0;
    for (const step of base64Steps) {
      try {
        const blob = await (await fetch(step.imageUrl)).blob();
        const ext = (blob.type && blob.type.split('/')[1]) || 'png';
        const file = new File([blob], step.imageName || `step-${step.id}.${ext}`, { type: blob.type || 'image/png' });
        const uploaded = await webflowUploadAsset(file);
        if (uploaded && uploaded.imageUrl) {
          step.imageUrl = uploaded.imageUrl;
          converted += 1;
        } else {
          uploadFailed = true;
        }
      } catch {
        uploadFailed = true;
      }
    }
    if (converted > 0) {
      await apiUpdateDemo(state.activeDemo);
      renderHotspotOverlay();
    }
  }

  const encoded = await encodeSharePayload(state.activeDemo);
  const url = `${window.location.origin}${window.location.pathname}#share=${encoded}`;
  try {
    await navigator.clipboard.writeText(url);
  } catch {
    const ta = document.createElement('textarea');
    ta.value = url;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
  }
  if (uploadFailed) {
    showToast(`Link copied (${url.length} chars), but Webflow upload failed: ${lastWebflowUploadError || 'check assets:write scope'}`);
  } else if (url.length > 8000) {
    showToast(`Preview link copied (${url.length} chars — connect Webflow Assets with assets:write for shorter URLs)`);
  } else {
    showToast(`Preview link copied (${url.length} chars)`);
  }
}

function getSharedPreviewParams() {
  const hash = window.location.hash || '';
  const hashMatch = hash.match(/#share=([^&]+)/);
  const queryId = new URLSearchParams(window.location.search).get('preview');
  return {
    shareToken: hashMatch ? decodeURIComponent(hashMatch[1]) : null,
    previewId: queryId || null
  };
}

function isSharedPreviewUrl() {
  const { shareToken, previewId } = getSharedPreviewParams();
  return Boolean(shareToken || previewId);
}

function openSharedPreviewDemo(demo) {
  if (!demo) return;
  state.isSharedPreviewMode = true;
  document.getElementById('app')?.classList.add('shared-preview-mode');
  const existingIdx = state.demos.findIndex(d => d.id === demo.id);
  if (existingIdx === -1) state.demos.unshift(demo);
  else state.demos[existingIdx] = demo;
  if (demo.kind === 'flow' && typeof openFlowDemo === 'function') {
    openFlowDemo(demo.id, 'preview');
  } else {
    openDemoInEditor(demo.id, 'preview');
  }
}

function isStudioAuthenticated() {
  if (isSharedPreviewUrl()) return true;
  try {
    return localStorage.getItem(AUTH_STORAGE_KEY) === 'authenticated';
  } catch (e) {
    return false;
  }
}

function updateAuthGateUI() {
  const loginScreen = document.getElementById('auth-login-screen');
  if (!loginScreen) return;
  const authed = isStudioAuthenticated();
  loginScreen.classList.toggle('hidden', authed);
  if (!authed) {
    mediaPause();
    setTimeout(() => {
      const userInp = document.getElementById('login-username');
      if (userInp) userInp.focus();
    }, 40);
  }
  refreshIcons(loginScreen);
}

function bindAuthEvents() {
  const loginForm = document.getElementById('auth-login-form');
  const errorEl = document.getElementById('login-error');
  const logoutBtn = document.getElementById('btn-logout');

  if (loginForm) {
    loginForm.addEventListener('submit', e => {
      e.preventDefault();
      const userVal = (document.getElementById('login-username')?.value || '').trim().toLowerCase();
      const passVal = document.getElementById('login-password')?.value || '';

      if (userVal === AUTH_USER && passVal === AUTH_PASS) {
        try {
          localStorage.setItem(AUTH_STORAGE_KEY, 'authenticated');
        } catch (err) {}
        if (errorEl) errorEl.classList.add('hidden');
        document.getElementById('login-password').value = '';
        updateAuthGateUI();
        showToast('Signed in to BxLearn');
      } else {
        if (errorEl) errorEl.classList.remove('hidden');
      }
    });
  }

  if (logoutBtn) {
    logoutBtn.addEventListener('click', () => {
      try {
        localStorage.removeItem(AUTH_STORAGE_KEY);
      } catch (err) {}
      updateAuthGateUI();
      showToast('Signed out');
    });
  }
}

// Boot application
(async function init() {
  bindAuthEvents();
  updateAuthGateUI();
  bindEvents();

  const { shareToken, previewId } = getSharedPreviewParams();
  if (shareToken) {
    const sharedDemo = await decodeSharePayload(shareToken);
    if (sharedDemo) {
      openSharedPreviewDemo(sharedDemo);
      return;
    }
  }

  const fallback = await loadLocalFallbackWorkspace();
  state.folders = fallback.folders || [];
  state.demos = fallback.demos || [];

  if (previewId) {
    const found = state.demos.find(d => d.id === previewId);
    if (found) {
      openSharedPreviewDemo(found);
      return;
    }
  }

  renderLibraryView();
  syncExistingDemosToWebflowAssets().catch(() => {});

  const data = await apiFetchWorkspace();
  if (data && Array.isArray(data.folders) && Array.isArray(data.demos)) {
    state.folders = data.folders;
    state.demos = data.demos;
    if (previewId) {
      const found = state.demos.find(d => d.id === previewId);
      if (found) {
        openSharedPreviewDemo(found);
        return;
      }
    }
    if (state.currentView === 'library') {
      renderLibraryView();
    }
    syncExistingDemosToWebflowAssets().catch(() => {});
  }
})();
