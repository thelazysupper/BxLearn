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
// EXACT MEDIA ASPECT-RATIO VIEWPORT LOCK
// Ensures #video-viewport and #hotspot-overlay match the
// rendered video/screenshot aspect ratio 1:1 with clean corner radius.
// =========================================================
function syncViewportSize() {
  const wrap = document.getElementById('stage-viewport-wrap');
  const viewport = document.getElementById('video-viewport');
  if (!wrap || !viewport) return;

  const cw = wrap.clientWidth;
  const ch = wrap.clientHeight;
  if (!cw || !ch) return;

  const pad = 36;
  const availW = Math.max(200, cw - pad);
  const availH = Math.max(140, ch - pad);
  const ratio = state.videoAspectRatio || (16 / 9);

  let targetW = availW;
  let targetH = targetW / ratio;

  if (targetH > availH) {
    targetH = availH;
    targetW = targetH * ratio;
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
const LOCAL_STORAGE_KEY = 'bxlearn_workspace_v2';

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

function loadLocalFallbackWorkspace() {
  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && Array.isArray(parsed.folders) && Array.isArray(parsed.demos)) {
        return parsed;
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
  } else {
    const dataUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
    return { imageUrl: dataUrl, fileName };
  }
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
    updatePreviewStatusPill(
      isScreen ? `Step ${state.previewStepIndex + 1} — Intro / Text Screen` : `Step ${state.previewStepIndex + 1} — Click hotspot`,
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
      card.innerHTML = `
        <div class="demo-card-preview" data-action="open">
          <div class="demo-card-preview-mock">
            <div class="mock-dots"><span></span><span></span><span></span></div>
            <div class="mock-bars"><div></div><div></div></div>
            <div class="mock-hotspot-dot" style="left:${firstHotspot.x || 50}%; top:${firstHotspot.y || 50}%;"></div>
          </div>
          <span class="demo-card-steps-pill">${stepCount} ${stepCount === 1 ? 'step' : 'steps'}</span>
        </div>
        <div class="demo-card-body">
          <div class="demo-card-folder">${escapeHtml(folderShort)}</div>
          <h3 class="demo-card-title" data-action="open">${escapeHtml(demo.title)}</h3>
          <p class="demo-card-desc">${escapeHtml(demo.description || 'Interactive walkthrough')}</p>
        </div>
        <div class="demo-card-footer">
          <button type="button" class="btn btn-xs btn-ghost" data-action="preview" title="Play Walkthrough">
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
        el.addEventListener('click', () => openDemoInEditor(demo.id, 'edit'));
      });
      card.querySelector('[data-action="preview"]').addEventListener('click', () => {
        openDemoInEditor(demo.id, 'preview');
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
  if (step.type === 'screen' || step.style === 'modal') return 'screen';
  return 'hotspot';
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
  if (!demoHasVideo(state.activeDemo) && demoHasScreenshots(state.activeDemo)) {
    const fallbackStep = state.activeDemo.steps.find(s => s && s.imageUrl);
    return fallbackStep ? fallbackStep.imageUrl : '';
  }
  return '';
}

function syncStageMediaForStep(step) {
  const video = document.getElementById('demo-video');
  const canvas = document.getElementById('sample-video-canvas');
  const img = document.getElementById('demo-step-image');
  const timelineBar = document.getElementById('timeline-bar');
  if (!video || !canvas || !img) return;

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
      img.onload = () => {
        if (img.naturalWidth && img.naturalHeight) {
          state.videoAspectRatio = img.naturalWidth / img.naturalHeight;
          syncViewportSize();
        }
      };
      img.src = imgUrl;
    } else if (img.complete && img.naturalWidth && img.naturalHeight) {
      state.videoAspectRatio = img.naturalWidth / img.naturalHeight;
      syncViewportSize();
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
  }
}

function sortActiveSteps() {
  if (!state.activeDemo || !Array.isArray(state.activeDemo.steps)) return;
  if (!demoHasVideo(state.activeDemo)) return;
  state.activeDemo.steps.sort((a, b) => Number(a.timestamp || 0) - Number(b.timestamp || 0));
}

function openDemoInEditor(demoId, initialMode = 'edit') {
  const found = state.demos.find(d => d.id === demoId);
  if (!found) return;

  mediaPause();
  state.activeDemo = JSON.parse(JSON.stringify(found));
  sortActiveSteps();
  state.selectedStepId = state.activeDemo.steps[0]?.id || null;
  state.currentView = 'editor';

  document.getElementById('view-library').classList.add('hidden');
  document.getElementById('view-editor').classList.remove('hidden');
  document.getElementById('brand-home').classList.add('hidden');
  document.getElementById('btn-new-demo-top').classList.add('hidden');
  document.getElementById('btn-back-library').classList.remove('hidden');
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

function getSelectedStep() {
  if (!state.activeDemo || !Array.isArray(state.activeDemo.steps)) return null;
  return state.activeDemo.steps.find(s => s.id === state.selectedStepId) || null;
}

function renderEditorStepsList() {
  const listEl = document.getElementById('steps-list');
  listEl.innerHTML = '';

  if (!state.activeDemo) return;
  const hasVideo = demoHasVideo(state.activeDemo);

  state.activeDemo.steps.forEach((step, idx) => {
    const isScreen = getStepType(step) === 'screen';
    const hasShot = Boolean(step.imageUrl);
    const metaLabel = hasShot
      ? 'Screenshot'
      : (hasVideo ? formatSeconds(step.timestamp) : `Step ${idx + 1}`);
    const card = document.createElement('div');
    card.className = `step-card ${step.id === state.selectedStepId ? 'active' : ''}`;
    card.innerHTML = `
      <div class="step-num-circle" title="${isScreen ? 'Intro / Text Screen' : (hasShot ? 'Screenshot Step' : 'Hotspot Step')}">
        ${isScreen ? '<i data-lucide="layout-template"></i>' : (idx + 1)}
      </div>
      <div class="step-card-info">
        <div class="step-card-title">${escapeHtml(step.title || `Step ${idx + 1}`)}</div>
        <span class="step-time-pill">${escapeHtml(metaLabel)}</span>
      </div>
    `;
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
  badgeEl.textContent = `${idx + 1} / ${state.activeDemo.steps.length}`;

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

  if (shotBtnLabel) shotBtnLabel.textContent = hasShot ? 'Replace Screenshot' : 'Upload Screenshot';
  if (clearShotBtn) clearShotBtn.classList.toggle('hidden', !hasShot || !hasVideo);
  if (snapFrameBtn) snapFrameBtn.classList.toggle('hidden', !hasVideo);
  if (shotStatus) {
    shotStatus.textContent = hasShot
      ? `Screenshot: ${step.imageName || 'Custom image attached'}`
      : 'Or press ⌘V to paste a screenshot';
    shotStatus.classList.toggle('active-shot', hasShot);
  }
  if (timestampGroup) {
    timestampGroup.classList.toggle('hidden', hasShot || !hasVideo);
  }

  // Toggle fields based on Hotspot vs Intro/Text Screen
  const isScreen = stepType === 'screen';
  const isTrace = !isScreen && step.style === 'trace';
  document.getElementById('screen-kicker-group').classList.toggle('hidden', !isScreen);
  document.getElementById('screen-only-fields').classList.toggle('hidden', !isScreen);
  document.getElementById('hotspot-only-fields').classList.toggle('hidden', isScreen);
  document.getElementById('hotspot-advance-group').classList.toggle('hidden', isScreen);
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
  document.getElementById('step-style-select').value = ['ring', 'trace'].includes(step.style) ? step.style : 'beacon';
  const showTipEl = document.getElementById('step-show-tooltip');
  if (showTipEl) showTipEl.checked = step.showTooltip !== false;
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
    const pct = Math.max(0, Math.min(100, (Number(step.timestamp || 0) / duration) * 100));
    const pin = document.createElement('div');
    pin.className = `timeline-pin ${isScreen ? 'screen-pin' : ''} ${step.id === state.selectedStepId ? 'active' : ''}`;
    pin.style.left = `${pct}%`;
    pin.title = `Step ${idx + 1} (${isScreen ? 'Text Screen' : 'Hotspot'}): ${step.title} (${formatSeconds(step.timestamp)})`;
    pin.textContent = idx + 1;
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

function renderHotspotOverlay() {
  const overlay = document.getElementById('hotspot-overlay');
  if (!overlay || !state.activeDemo) return;
  overlay.innerHTML = '';

  const steps = state.activeDemo.steps || [];
  if (steps.length === 0) return;

  if (state.editorMode === 'edit') {
    const step = getSelectedStep();
    if (!step) return;
    syncStageMediaForStep(step);
    const stepIdx = steps.findIndex(s => s.id === step.id);
    renderStepOnStage(overlay, step, stepIdx, steps.length, false);
  } else {
    const step = steps[state.previewStepIndex];
    if (!state.previewWaitingForClick) {
      // Playing video between steps -> ensure video/canvas is visible, not a static screenshot
      syncStageMediaForStep(null);
      return;
    }
    if (!step) return;
    syncStageMediaForStep(step);
    renderStepOnStage(overlay, step, state.previewStepIndex, steps.length, true);
  }

  refreshIcons(overlay);
}

function renderStepOnStage(overlay, step, stepIndex, totalSteps, isPreview) {
  const stepType = getStepType(step);
  const progressPct = Math.round(((stepIndex + 1) / totalSteps) * 100);
  const isLast = stepIndex === totalSteps - 1;
  const btnText = step.buttonText || (isLast ? 'Finish' : 'Next');

  // CASE 1: INTRO / CHAPTER / OUTRO TEXT SCREEN
  if (stepType === 'screen') {
    const backdropMode = step.backdrop || 'blur';
    const screenEl = document.createElement('div');
    screenEl.className = `demo-text-screen backdrop-${backdropMode}`;
    screenEl.innerHTML = `
      <div class="text-screen-card">
        <div class="tooltip-progress-bar" style="width:100%; margin-bottom:14px;">
          <div class="tooltip-progress-fill" style="width: ${progressPct}%"></div>
        </div>
        <div class="text-screen-kicker" id="active-stage-kicker">${step.kicker ? escapeHtml(step.kicker) : `Step ${stepIndex + 1} of ${totalSteps}`}</div>
        <h2 class="text-screen-title" id="active-stage-title">${escapeHtml(step.title || `Step ${stepIndex + 1}`)}</h2>
        <p class="text-screen-body" id="active-stage-body">${escapeHtml(step.body || '')}</p>
        <div class="text-screen-actions">
          ${stepIndex > 0 ? `<button type="button" class="btn btn-sm btn-ghost" data-step-nav="prev">Back</button>` : ''}
          ${step.ctaUrl ? `<a href="${escapeHtml(step.ctaUrl)}" target="_blank" rel="noopener" class="btn btn-sm btn-outline">Open Link</a>` : ''}
          <button type="button" class="text-screen-btn-primary" data-step-nav="next">
            <span id="active-stage-btn-text">${escapeHtml(btnText)}</span>
            <i data-lucide="arrow-right"></i>
          </button>
        </div>
      </div>
    `;
    screenEl.addEventListener('pointerdown', e => e.stopPropagation());
    screenEl.addEventListener('click', e => e.stopPropagation());
    bindStepCardNavigation(screenEl, stepIndex, totalSteps, isPreview);
    overlay.appendChild(screenEl);
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
  anchor.style.left = `${step.x}%`;
  anchor.style.top = `${step.y}%`;
  if (isTrace) {
    anchor.style.width = `${step.w}%`;
    anchor.style.height = `${step.h}%`;
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
      pin.innerHTML = `<div class="hotspot-beacon">${stepIndex + 1}</div>`;
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

  const shouldShowTooltip = !isTrace || step.showTooltip !== false;
  if (shouldShowTooltip) {
    const tooltip = document.createElement('div');
    tooltip.id = 'active-hotspot-tooltip';
    tooltip.className = `hotspot-tooltip ${resolvePlacementClass(step)}`;
    tooltip.innerHTML = `
      <div class="tooltip-progress-bar">
        <div class="tooltip-progress-fill" style="width: ${progressPct}%"></div>
      </div>
      <div class="tooltip-step-top">
        <span class="tooltip-step-counter">Step ${stepIndex + 1} of ${totalSteps}</span>
      </div>
      <h3 class="tooltip-title" id="active-stage-title">${escapeHtml(step.title || `Step ${stepIndex + 1}`)}</h3>
      <p class="tooltip-body" id="active-stage-body">${escapeHtml(step.body || '')}</p>
      <div class="tooltip-footer">
        ${stepIndex > 0 ? `<button type="button" class="btn btn-xs btn-ghost" data-step-nav="prev">Back</button>` : `<span></span>`}
        <div style="display:flex; gap:6px;">
          ${step.ctaUrl ? `<a href="${escapeHtml(step.ctaUrl)}" target="_blank" rel="noopener" class="btn btn-xs btn-outline">Open Link</a>` : ''}
          <button type="button" class="btn btn-xs btn-primary" data-step-nav="next"><span id="active-stage-btn-text">${escapeHtml(btnText)}</span></button>
        </div>
      </div>
    `;

    tooltip.addEventListener('pointerdown', e => e.stopPropagation());
    tooltip.addEventListener('click', e => e.stopPropagation());
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
    updatePreviewStatusPill(isScreen ? 'Intro Screen' : 'Step 1 — Click hotspot', false);
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
    updatePreviewStatusPill(`Playing to Step ${state.previewStepIndex + 1}...`, true);
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
  updatePreviewStatusPill(isScreen ? `Step ${index + 1} — Text Screen` : `Step ${index + 1} — Click hotspot`, false);
  renderHotspotOverlay();
}

function renderPreviewStepDots() {
  const container = document.getElementById('preview-step-dots');
  if (!container || !state.activeDemo) return;
  container.innerHTML = '';

  state.activeDemo.steps.forEach((step, idx) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `step-dot-btn ${idx === state.previewStepIndex ? 'active' : ''}`;
    btn.title = step.title || `Step ${idx + 1}`;
    btn.textContent = idx + 1;
    btn.addEventListener('click', () => jumpToPreviewStep(idx));
    container.appendChild(btn);
  });
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

function addStepAtCurrentTime(x = 50, y = 50, stepType = 'hotspot') {
  if (!state.activeDemo) return;
  mediaPause();

  const isScreen = stepType === 'screen';
  const hasSteps = state.activeDemo.steps && state.activeDemo.steps.length > 0;
  const timestamp = (isScreen && !hasSteps) ? 0.0 : Number(mediaGetTime().toFixed(1));
  const stepNum = (state.activeDemo.steps?.length || 0) + 1;
  const activeStep = getSelectedStep();
  const inheritedImageUrl = (!demoHasVideo(state.activeDemo) && activeStep && activeStep.imageUrl) ? activeStep.imageUrl : '';
  const inheritedImageName = (!demoHasVideo(state.activeDemo) && activeStep && activeStep.imageName) ? activeStep.imageName : '';

  const newStep = {
    id: `step-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 5)}`,
    type: isScreen ? 'screen' : 'hotspot',
    backdrop: 'blur',
    kicker: isScreen ? (timestamp === 0 ? 'Welcome • Product Tour' : `Chapter ${stepNum}`) : '',
    timestamp,
    title: isScreen
      ? (timestamp === 0 ? `Welcome to ${state.activeDemo.title}` : 'Key Takeaway')
      : `Step ${stepNum}: Click here`,
    body: isScreen
      ? 'Introduce this section of the walkthrough before guiding the user through the next actions.'
      : 'Click the highlighted hotspot to continue.',
    x: Math.round(x * 10) / 10,
    y: Math.round(y * 10) / 10,
    style: 'beacon',
    placement: 'auto',
    buttonText: isScreen && timestamp === 0 ? 'Start Tour' : 'Continue',
    advanceOnHotspotClick: true,
    ctaUrl: '',
    imageUrl: inheritedImageUrl,
    imageName: inheritedImageName
  };

  state.activeDemo.steps.push(newStep);
  sortActiveSteps();
  state.selectedStepId = newStep.id;

  renderEditorStepsList();
  renderInspectorPanel();
  renderTimelineMarkers();
  renderHotspotOverlay();
  scheduleAutoSave();
  refreshIcons();
  showToast(isScreen ? 'Added Text Screen' : 'Added Hotspot Step');
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
      #${widgetId} .bx-wrap { background:#00182C; border-radius:14px; overflow:hidden; box-shadow:0 18px 44px rgba(0,24,44,0.18); position:relative; }
      #${widgetId} .bx-stage { position:relative; aspect-ratio:16/9; width:100%; background:#00101F; overflow:hidden; }
      #${widgetId} video, #${widgetId} .bx-img { width:100%; height:100%; display:block; object-fit:fill; }
      #${widgetId} .bx-overlay { position:absolute; inset:0; pointer-events:none; }
      #${widgetId} .bx-anchor { position:absolute; width:0; height:0; pointer-events:auto; }
      #${widgetId} .bx-pin { position:absolute; left:0; top:0; width:28px; height:28px; border-radius:50%; background:#0076DD; border:2.5px solid #FFF; color:#FFF; font-family:'Host Grotesk',sans-serif; font-weight:600; font-size:12px; display:flex; align-items:center; justify-content:center; transform:translate(-50%,-50%); cursor:pointer; box-shadow:0 0 0 8px rgba(0,118,221,0.28); }
      #${widgetId} .bx-trace { position:absolute; inset:0; border-radius:8px; border:2.5px solid #0076DD; background:rgba(0,118,221,0.10); box-shadow:0 0 0 4px rgba(0,118,221,0.22); cursor:pointer; }
      #${widgetId} .bx-tip { position:absolute; width:270px; background:#FFF; border-radius:12px; padding:15px; box-shadow:0 16px 38px rgba(0,24,44,0.24); }
      #${widgetId} .bx-tip h4 { font-family:'Host Grotesk',sans-serif; font-weight:600; color:#00182C; font-size:15px; margin:0 0 5px; }
      #${widgetId} .bx-tip p { font-family:'Google Sans',sans-serif; color:#324158; font-size:13px; margin:0 0 12px; line-height:1.45; }
      #${widgetId} .bx-screen { position:absolute; inset:0; background:rgba(0,24,44,0.78); display:flex; align-items:center; justify-content:center; padding:24px; pointer-events:auto; }
      #${widgetId} .bx-screen-card { max-width:440px; width:100%; background:#FFF; border-radius:16px; padding:30px; text-align:center; box-shadow:0 24px 52px rgba(0,24,44,0.28); }
      #${widgetId} .bx-btn { background:#0076DD; color:#FFF; border:none; border-radius:7px; padding:8px 16px; font-family:'Host Grotesk',sans-serif; font-weight:600; font-size:13px; cursor:pointer; }
      #${widgetId} .bx-bar { background:#FFF; border-top:1px solid #E2E8F0; padding:10px 16px; display:flex; align-items:center; justify-content:space-between; }
    </style>
    <div class="bx-wrap">
      <div class="bx-stage">
        <video playsinline preload="metadata" src="\${demo.videoUrl}"></video>
        <img class="bx-img" style="display:none;" alt="" />
        <div class="bx-overlay"></div>
      </div>
      <div class="bx-bar">
        <strong style="font-family:'Host Grotesk',sans-serif; color:#00182C; font-size:14px;">\${demo.title}</strong>
        <div class="bx-dots" style="display:flex; gap:6px;"></div>
      </div>
    </div>\`;
  const video = root.querySelector("video");
  const img = root.querySelector(".bx-img");
  const overlay = root.querySelector(".bx-overlay");
  const dots = root.querySelector(".bx-dots");

  function render() {
    overlay.innerHTML = "";
    dots.innerHTML = "";
    demo.steps.forEach((s, i) => {
      const b = document.createElement("button");
      b.textContent = i + 1;
      b.style.cssText = "width:26px;height:26px;border-radius:99px;border:1px solid #CBD5E1;cursor:pointer;font-weight:600;background:" + (i===stepIdx?"#0076DD":"#FFF") + ";color:" + (i===stepIdx?"#FFF":"#324158");
      b.onclick = () => jump(i);
      dots.appendChild(b);
    });
    if (!waiting || !demo.steps[stepIdx]) return;
    const s = demo.steps[stepIdx];
    if (s.imageUrl) {
      video.style.display = "none";
      img.style.display = "block";
      img.src = s.imageUrl;
    } else {
      img.style.display = "none";
      video.style.display = "block";
    }
    if (s.type === "screen" || s.style === "modal") {
      const scr = document.createElement("div");
      scr.className = "bx-screen";
      scr.innerHTML = \`<div class="bx-screen-card"><h3 style="font-family:'Host Grotesk',sans-serif;color:#00182C;font-size:21px;margin:0 0 8px;">\${s.title}</h3><p style="font-size:14px;color:#324158;margin:0 0 18px;line-height:1.5;">\${s.body}</p><button class="bx-btn">\${s.buttonText || 'Continue'}</button></div>\`;
      scr.querySelector("button").onclick = next;
      overlay.appendChild(scr);
      return;
    }
    const anchor = document.createElement("div");
    anchor.className = "bx-anchor";
    anchor.style.left = s.x + "%"; anchor.style.top = s.y + "%";
    if (s.style === "trace") {
      anchor.style.width = (s.w || 16) + "%";
      anchor.style.height = (s.h || 8) + "%";
      anchor.style.transform = "translate(-50%,-50%)";
      const tr = document.createElement("div");
      tr.className = "bx-trace";
      tr.onclick = next;
      anchor.appendChild(tr);
    } else {
      const pin = document.createElement("div");
      pin.className = "bx-pin";
      pin.textContent = stepIdx + 1;
      pin.onclick = next;
      anchor.appendChild(pin);
    }

    if (s.style !== "trace" || s.showTooltip !== false) {
      const tip = document.createElement("div");
      tip.className = "bx-tip";
      if (s.x > 62) { tip.style.right = s.style === "trace" ? "calc(100% + 14px)" : "24px"; tip.style.top = "50%"; tip.style.transform = "translateY(-50%)"; }
      else { tip.style.left = s.style === "trace" ? "calc(100% + 14px)" : "24px"; tip.style.top = "50%"; tip.style.transform = "translateY(-50%)"; }
      tip.innerHTML = \`<h4>\${s.title}</h4><p>\${s.body}</p><button class="bx-btn">\${s.buttonText || 'Next'}</button>\`;
      tip.querySelector("button").onclick = next;
      anchor.appendChild(tip);
    }
    overlay.appendChild(anchor);
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
          <div style="position:relative; aspect-ratio:16/9; background:#00182C; border-radius:12px; overflow:hidden;">
            \${step && step.imageUrl ? \`<img src="\${step.imageUrl}" alt="" style="width:100%;height:100%;object-fit:fill;display:block;" />\` : \`<video id="bx-hub-video" src="\${activeDemo.videoUrl || ''}" playsinline style="width:100%;height:100%;object-fit:fill;"></video>\`}
            \${step ? (isScreen ? \`
              <div style="position:absolute;inset:0;background:rgba(0,24,44,0.78);display:flex;align-items:center;justify-content:center;padding:20px;">
                <div style="background:#FFF;padding:28px;border-radius:14px;max-width:420px;text-align:center;box-shadow:0 20px 44px rgba(0,24,44,0.26);">
                  <div style="font-family:'Host Grotesk',sans-serif;font-weight:600;color:#00182C;font-size:20px;margin-bottom:8px;">\${step.title}</div>
                  <div style="font-size:13.5px;color:#324158;margin-bottom:16px;">\${step.body}</div>
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
  const select = document.getElementById('wf-select-demo');
  const urlOverride = document.getElementById('wf-video-override').value.trim();
  const chosenDemo = state.demos.find(d => d.id === select.value) || state.activeDemo || state.demos[0];

  if (state.activeWfTab === 'hub') {
    codeOutput.value = generateHubWebflowSnippet();
  } else {
    codeOutput.value = generateSingleDemoWebflowSnippet(chosenDemo, urlOverride);
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
    document.getElementById('view-editor').classList.add('hidden');
    document.getElementById('view-library').classList.remove('hidden');
    document.getElementById('brand-home').classList.remove('hidden');
    document.getElementById('btn-new-demo-top').classList.remove('hidden');
    document.getElementById('btn-back-library').classList.add('hidden');
    document.getElementById('editor-breadcrumb').classList.add('hidden');
    document.getElementById('editor-mode-switcher').classList.add('hidden');
    document.getElementById('save-status').classList.add('hidden');
    renderLibraryView();
  };

  document.getElementById('btn-back-library').addEventListener('click', goHome);
  document.getElementById('brand-home').addEventListener('click', goHome);

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
    state.activeDemo.videoUrl = url;
    state.activeDemo.useSampleCanvasVideo = false;
    setupEditorVideoSource();
    if (state.activeDemo.steps.length === 0) addStepAtCurrentTime(50, 50, 'hotspot');
    scheduleAutoSave();
    showToast('Loaded video URL');
  });

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

  // Add Hotspot Step vs Add Intro/Text Screen buttons
  document.getElementById('btn-add-step').addEventListener('click', () => addStepAtCurrentTime(50, 50, 'hotspot'));
  document.getElementById('btn-add-step-timeline').addEventListener('click', () => addStepAtCurrentTime(50, 50, 'hotspot'));
  document.getElementById('btn-add-text-step').addEventListener('click', () => addStepAtCurrentTime(50, 50, 'screen'));
  document.getElementById('btn-add-text-timeline').addEventListener('click', () => addStepAtCurrentTime(50, 50, 'screen'));

  // Step Type Switcher inside Inspector (Hotspot <-> Text Screen)
  document.querySelectorAll('#step-type-switcher .type-pill-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const step = getSelectedStep();
      if (!step) return;
      const nextType = btn.dataset.stepType;
      step.type = nextType;
      if (nextType === 'screen' && !step.kicker) {
        step.kicker = 'Product Tour';
      }
      if (nextType === 'hotspot' && step.style === 'modal') {
        step.style = 'beacon';
      }
      renderEditorStepsList();
      renderInspectorPanel();
      renderTimelineMarkers();
      renderHotspotOverlay();
      scheduleAutoSave();
      refreshIcons();
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
    const viewport = document.getElementById('video-viewport');
    if (viewport.requestFullscreen) viewport.requestFullscreen();
  });

  window.addEventListener('keydown', e => {
    if (state.currentView !== 'editor' || state.editorMode !== 'preview') return;
    if (e.target.matches('input, textarea, select')) return;
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

// Boot application
(async function init() {
  bindEvents();

  const fallback = loadLocalFallbackWorkspace();
  state.folders = fallback.folders || [];
  state.demos = fallback.demos || [];
  renderLibraryView();

  const data = await apiFetchWorkspace();
  if (data && Array.isArray(data.folders) && Array.isArray(data.demos)) {
    state.folders = data.folders;
    state.demos = data.demos;
    if (state.currentView === 'library') {
      renderLibraryView();
    }
  }
})();
