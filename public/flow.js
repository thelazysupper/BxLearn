/**
 * BxLearn — Interactive Demo Flow Canvas & Branching Player
 * Separate from linear Walkthroughs (demo.kind === 'flow').
 */

const flowState = {
  mode: 'canvas', // 'canvas' | 'preview'
  selectedNodeId: null,
  selectedHotspotId: null,
  zoom: 1,
  panX: 40,
  panY: 40,
  isPanning: false,
  panStart: null,
  draggingNode: null,
  connecting: null, // { fromNodeId, hotspotId, startX, startY }
  drawingHotspot: null,
  previewNodeId: null,
  previewHistory: []
};

function isFlowDemo(demo) {
  return Boolean(demo && demo.kind === 'flow');
}

function createFlowDemoObject(title, folderPath = '') {
  const n1Id = `node-${Date.now().toString(36)}-1`;
  const n2Id = `node-${Date.now().toString(36)}-2`;
  return {
    id: `flow-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 5)}`,
    kind: 'flow',
    title: title || 'Untitled Interactive Demo',
    description: '',
    folderPath: folderPath || '',
    videoUrl: '',
    startNodeId: n1Id,
    nodes: [
      {
        id: n1Id,
        title: 'Start Screen',
        imageUrl: '',
        flowX: 80,
        flowY: 120,
        hotspots: [
          { id: `hs-${Date.now().toString(36)}-1`, label: 'Next Screen', x: 35, y: 42, w: 30, h: 16, targetNodeId: n2Id, tooltip: 'Click to explore' }
        ]
      },
      {
        id: n2Id,
        title: 'Second Screen',
        imageUrl: '',
        flowX: 400,
        flowY: 120,
        hotspots: []
      }
    ],
    steps: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
}

function openFlowDemo(demoId, initialMode = 'canvas') {
  const found = state.demos.find(d => d.id === demoId);
  if (!found) return;

  mediaPause();
  state.activeDemo = JSON.parse(JSON.stringify(found));
  if (!Array.isArray(state.activeDemo.nodes)) state.activeDemo.nodes = [];
  if (!state.activeDemo.startNodeId && state.activeDemo.nodes[0]) {
    state.activeDemo.startNodeId = state.activeDemo.nodes[0].id;
  }

  state.currentView = 'flow';
  flowState.selectedNodeId = state.activeDemo.nodes[0]?.id || null;
  flowState.selectedHotspotId = state.activeDemo.nodes[0]?.hotspots?.[0]?.id || null;
  flowState.previewNodeId = state.activeDemo.startNodeId || state.activeDemo.nodes[0]?.id || null;
  flowState.previewHistory = [];

  document.getElementById('view-library').classList.add('hidden');
  document.getElementById('view-editor').classList.add('hidden');
  document.getElementById('view-flow')?.classList.remove('hidden');
  document.getElementById('brand-home').classList.add('hidden');
  document.getElementById('btn-back-library').classList.remove('hidden');
  document.getElementById('btn-share-preview')?.classList.remove('hidden');
  document.getElementById('editor-breadcrumb').classList.remove('hidden');
  document.getElementById('editor-mode-switcher-wrap')?.classList.add('hidden');
  document.getElementById('editor-mode-switcher').classList.add('hidden');
  document.getElementById('btn-new-demo-top')?.closest('.add-step-dropdown')?.classList.add('hidden');

  document.getElementById('editor-demo-title').value = state.activeDemo.title;
  document.getElementById('editor-folder-label').textContent = state.activeDemo.folderPath || 'Root';

  setFlowMode(initialMode);
  refreshIcons();
}

function closeFlowView() {
  document.getElementById('view-flow')?.classList.add('hidden');
  document.getElementById('editor-mode-switcher-wrap')?.classList.remove('hidden');
  document.getElementById('btn-new-demo-top')?.closest('.add-step-dropdown')?.classList.remove('hidden');
}

function setFlowMode(mode) {
  flowState.mode = mode === 'preview' ? 'preview' : 'canvas';
  document.querySelectorAll('#flow-mode-switcher .seg-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.flowMode === flowState.mode);
  });
  const canvasWs = document.getElementById('flow-canvas-workspace');
  const previewWs = document.getElementById('flow-preview-workspace');
  if (canvasWs) canvasWs.classList.toggle('hidden', flowState.mode !== 'canvas');
  if (previewWs) previewWs.classList.toggle('hidden', flowState.mode !== 'preview');

  if (flowState.mode === 'preview') {
    startFlowPreview();
  } else {
    applyFlowTransform();
    renderFlowCanvas();
    renderFlowInspector();
  }
  refreshIcons();
}

function applyFlowTransform() {
  const world = document.getElementById('flow-canvas-world');
  const zoomLabel = document.getElementById('flow-zoom-label');
  if (world) {
    world.style.transform = `translate(${flowState.panX}px, ${flowState.panY}px) scale(${flowState.zoom})`;
  }
  if (zoomLabel) {
    zoomLabel.textContent = `${Math.round(flowState.zoom * 100)}%`;
  }
}

function getSelectedFlowNode() {
  if (!state.activeDemo || !Array.isArray(state.activeDemo.nodes)) return null;
  return state.activeDemo.nodes.find(n => n.id === flowState.selectedNodeId) || null;
}

function renderFlowCanvas() {
  const layer = document.getElementById('flow-nodes-layer');
  if (!layer || !state.activeDemo) return;
  layer.innerHTML = '';

  const nodes = state.activeDemo.nodes || [];
  nodes.forEach((node, idx) => {
    if (typeof node.flowX !== 'number') node.flowX = 80 + (idx % 4) * 280;
    if (typeof node.flowY !== 'number') node.flowY = 100 + Math.floor(idx / 4) * 240;
    if (!Array.isArray(node.hotspots)) node.hotspots = [];

    const isStart = state.activeDemo.startNodeId === node.id;
    const isSelected = flowState.selectedNodeId === node.id;
    const el = document.createElement('div');
    el.className = `flow-node ${isSelected ? 'selected' : ''}`;
    el.dataset.nodeId = node.id;
    el.style.left = `${node.flowX}px`;
    el.style.top = `${node.flowY}px`;

    const portsHtml = node.hotspots.length > 0
      ? node.hotspots.map(hs => {
          const target = nodes.find(n => n.id === hs.targetNodeId);
          return `
            <div class="flow-node-port-row" data-hs-id="${hs.id}">
              <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;">${escapeHtml(hs.label || 'Hotspot')}</span>
              <span style="font-size:10px;color:var(--muted-color);flex-shrink:0;">${target ? `→ ${escapeHtml(target.title || 'Screen')}` : 'Unlinked'}</span>
              <button type="button" class="flow-hs-del-btn" data-del-node="${node.id}" data-del-hs="${hs.id}" title="Delete hotspot">×</button>
              <div class="flow-port-out" data-from-node="${node.id}" data-from-hs="${hs.id}" title="Drag to connect"></div>
            </div>
          `;
        }).join('')
      : `<div class="flow-node-port-row is-empty">No hotspots yet</div>`;

    el.innerHTML = `
      <div class="flow-port-in" title="Input"></div>
      <div class="flow-node-header">
        <span class="flow-node-title">${escapeHtml(node.title || `Screen ${idx + 1}`)}</span>
        ${isStart ? '<span class="flow-node-start-pill">Start</span>' : ''}
      </div>
      <div class="flow-node-thumb-wrap">
        ${node.imageUrl
          ? `<img src="${escapeHtml(node.imageUrl)}" class="flow-node-thumb" alt="" draggable="false" />`
          : '<span class="flow-node-thumb-empty">No image</span>'}
      </div>
      <div class="flow-node-ports">${portsHtml}</div>
    `;

    el.addEventListener('pointerdown', e => {
      if (e.target.closest('.flow-port-out') || e.target.closest('.flow-hs-del-btn')) return;
      flowState.selectedNodeId = node.id;
      const clickedRow = e.target.closest('.flow-node-port-row[data-hs-id]');
      if (clickedRow) {
        flowState.selectedHotspotId = clickedRow.dataset.hsId;
      } else if (!node.hotspots.some(h => h.id === flowState.selectedHotspotId)) {
        flowState.selectedHotspotId = node.hotspots[0]?.id || null;
      }
      layer.querySelectorAll('.flow-node').forEach(n => n.classList.toggle('selected', n.dataset.nodeId === node.id));
      renderFlowInspector();
    });

    el.querySelectorAll('.flow-hs-del-btn').forEach(delBtn => {
      delBtn.addEventListener('click', e => {
        e.stopPropagation();
        deleteFlowHotspot(delBtn.dataset.delNode, delBtn.dataset.delHs);
      });
    });

    const header = el.querySelector('.flow-node-header');
    header.addEventListener('pointerdown', e => {
      e.stopPropagation();
      flowState.selectedNodeId = node.id;
      if (!node.hotspots.some(h => h.id === flowState.selectedHotspotId)) {
        flowState.selectedHotspotId = node.hotspots[0]?.id || null;
      }
      layer.querySelectorAll('.flow-node').forEach(n => n.classList.toggle('selected', n.dataset.nodeId === node.id));
      renderFlowInspector();
      flowState.draggingNode = {
        nodeId: node.id,
        startClientX: e.clientX,
        startClientY: e.clientY,
        startX: node.flowX,
        startY: node.flowY
      };
    });

    el.querySelectorAll('.flow-port-out').forEach(port => {
      port.addEventListener('pointerdown', e => {
        e.stopPropagation();
        e.preventDefault();
        const worldRect = document.getElementById('flow-canvas-world').getBoundingClientRect();
        const portRect = port.getBoundingClientRect();
        flowState.connecting = {
          fromNodeId: port.dataset.fromNode,
          hotspotId: port.dataset.fromHs,
          startX: (portRect.left + portRect.width / 2 - worldRect.left) / flowState.zoom,
          startY: (portRect.top + portRect.height / 2 - worldRect.top) / flowState.zoom
        };
      });
    });

    layer.appendChild(el);
  });

  renderFlowConnectors();
}

function renderFlowConnectors(draftEnd = null) {
  const svg = document.getElementById('flow-connectors-svg');
  const world = document.getElementById('flow-canvas-world');
  if (!svg || !world || !state.activeDemo) return;

  svg.querySelectorAll('path').forEach(p => p.remove());
  const worldRect = world.getBoundingClientRect();
  const nodes = state.activeDemo.nodes || [];

  nodes.forEach(node => {
    (node.hotspots || []).forEach(hs => {
      if (!hs.targetNodeId) return;
      const portEl = world.querySelector(`.flow-port-out[data-from-hs="${hs.id}"]`);
      const targetEl = world.querySelector(`.flow-node[data-node-id="${hs.targetNodeId}"] .flow-port-in`);
      if (!portEl || !targetEl) return;

      const pRect = portEl.getBoundingClientRect();
      const tRect = targetEl.getBoundingClientRect();
      const x1 = (pRect.left + pRect.width / 2 - worldRect.left) / flowState.zoom;
      const y1 = (pRect.top + pRect.height / 2 - worldRect.top) / flowState.zoom;
      const x2 = (tRect.left + tRect.width / 2 - worldRect.left) / flowState.zoom;
      const y2 = (tRect.top + tRect.height / 2 - worldRect.top) / flowState.zoom;

      const dx = Math.max(50, Math.abs(x2 - x1) * 0.5);
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('class', 'flow-connector-path');
      path.setAttribute('marker-end', 'url(#flow-arrow)');
      path.setAttribute('d', `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`);
      path.addEventListener('click', e => {
        e.stopPropagation();
        hs.targetNodeId = '';
        renderFlowCanvas();
        renderFlowInspector();
        scheduleAutoSave();
        showToast('Disconnected link');
      });
      svg.appendChild(path);
    });
  });

  if (flowState.connecting && draftEnd) {
    const { startX: x1, startY: y1 } = flowState.connecting;
    const { x: x2, y: y2 } = draftEnd;
    const dx = Math.max(40, Math.abs(x2 - x1) * 0.5);
    const draft = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    draft.setAttribute('class', 'flow-connector-draft');
    draft.setAttribute('d', `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`);
    svg.appendChild(draft);
  }
}

function deleteFlowHotspot(nodeId, hotspotId) {
  if (!state.activeDemo || !hotspotId) return;
  const node = (state.activeDemo.nodes || []).find(n => n.id === nodeId) || getSelectedFlowNode();
  if (!node) return;
  node.hotspots = (node.hotspots || []).filter(h => h.id !== hotspotId);
  if (flowState.selectedHotspotId === hotspotId) {
    flowState.selectedHotspotId = node.hotspots[0]?.id || null;
  }
  renderFlowCanvas();
  renderFlowInspector();
  scheduleAutoSave();
  refreshIcons();
  showToast('Hotspot deleted');
}

function renderFlowInspector() {
  const node = getSelectedFlowNode();
  const emptyEl = document.getElementById('flow-inspector-empty');
  const formEl = document.getElementById('flow-inspector-form');
  const startBadge = document.getElementById('flow-start-badge');
  const delBtn = document.getElementById('btn-flow-delete-node');

  if (!node) {
    emptyEl?.classList.remove('hidden');
    formEl?.classList.add('hidden');
    startBadge?.classList.add('hidden');
    delBtn?.classList.add('hidden');
    return;
  }

  emptyEl?.classList.add('hidden');
  formEl?.classList.remove('hidden');
  delBtn?.classList.remove('hidden');

  const isStart = state.activeDemo.startNodeId === node.id;
  startBadge?.classList.toggle('hidden', !isStart);

  document.getElementById('flow-node-title-input').value = node.title || '';

  const stageBox = document.getElementById('flow-stage-box');
  const stageImg = document.getElementById('flow-stage-img');
  const stageEmpty = document.getElementById('flow-stage-empty');
  if (node.imageUrl) {
    stageImg.src = node.imageUrl;
    stageImg.classList.remove('hidden');
    stageEmpty.classList.add('hidden');
    stageImg.onload = () => {
      if (stageImg.naturalWidth && stageImg.naturalHeight) {
        stageBox.style.aspectRatio = `${stageImg.naturalWidth} / ${stageImg.naturalHeight}`;
      }
    };
    if (stageImg.complete && stageImg.naturalWidth && stageImg.naturalHeight) {
      stageBox.style.aspectRatio = `${stageImg.naturalWidth} / ${stageImg.naturalHeight}`;
    }
  } else {
    stageImg.classList.add('hidden');
    stageEmpty.classList.remove('hidden');
    stageBox.style.aspectRatio = '16 / 10';
  }

  const drawLayer = document.getElementById('flow-hotspot-draw-layer');
  drawLayer.innerHTML = '';
  (node.hotspots || []).forEach(hs => {
    const box = document.createElement('div');
    const isSel = hs.id === flowState.selectedHotspotId;
    box.className = `flow-hs-box ${isSel ? 'selected' : ''}`;
    box.style.left = `${hs.x}%`;
    box.style.top = `${hs.y}%`;
    box.style.width = `${hs.w}%`;
    box.style.height = `${hs.h}%`;
    box.innerHTML = `
      <span class="flow-hs-tag">${escapeHtml(hs.label || 'Hotspot')}</span>
      ${isSel ? `<button type="button" class="flow-hs-box-del" title="Delete hotspot">×</button>` : ''}
    `;
    const boxDel = box.querySelector('.flow-hs-box-del');
    if (boxDel) {
      boxDel.addEventListener('pointerdown', e => e.stopPropagation());
      boxDel.addEventListener('click', e => {
        e.stopPropagation();
        deleteFlowHotspot(node.id, hs.id);
      });
    }
    box.addEventListener('pointerdown', e => {
      if (e.target.closest('.flow-hs-box-del')) return;
      e.stopPropagation();
      flowState.selectedHotspotId = hs.id;
      renderFlowInspector();
    });
    drawLayer.appendChild(box);
  });

  const propsEl = document.getElementById('flow-hotspot-props');
  const selectedHs = (node.hotspots || []).find(h => h.id === flowState.selectedHotspotId) || null;
  if (!selectedHs) {
    propsEl.classList.add('hidden');
    return;
  }

  propsEl.classList.remove('hidden');
  document.getElementById('flow-hs-label-input').value = selectedHs.label || '';
  document.getElementById('flow-hs-tooltip-input').value = selectedHs.tooltip || '';

  const targetSelect = document.getElementById('flow-hs-target-select');
  targetSelect.innerHTML = '<option value="">-- Select target screen --</option>';
  (state.activeDemo.nodes || []).forEach(n => {
    if (n.id === node.id) return;
    const opt = document.createElement('option');
    opt.value = n.id;
    opt.textContent = n.title || 'Untitled Screen';
    targetSelect.appendChild(opt);
  });
  targetSelect.value = selectedHs.targetNodeId || '';
}

function autoLayoutFlowNodes() {
  if (!state.activeDemo || !Array.isArray(state.activeDemo.nodes)) return;
  const nodes = state.activeDemo.nodes;
  const visited = new Set();
  const levels = [];
  const startId = state.activeDemo.startNodeId || nodes[0]?.id;

  const queue = startId ? [{ id: startId, depth: 0 }] : [];
  while (queue.length > 0) {
    const { id, depth } = queue.shift();
    if (visited.has(id)) continue;
    const node = nodes.find(n => n.id === id);
    if (!node) continue;
    visited.add(id);
    if (!levels[depth]) levels[depth] = [];
    levels[depth].push(node);
    (node.hotspots || []).forEach(hs => {
      if (hs.targetNodeId && !visited.has(hs.targetNodeId)) {
        queue.push({ id: hs.targetNodeId, depth: depth + 1 });
      }
    });
  }

  nodes.forEach(n => {
    if (!visited.has(n.id)) {
      const last = levels.length;
      if (!levels[last]) levels[last] = [];
      levels[last].push(n);
    }
  });

  levels.forEach((col, colIdx) => {
    col.forEach((node, rowIdx) => {
      node.flowX = 80 + colIdx * 300;
      node.flowY = 80 + rowIdx * 250;
    });
  });

  flowState.panX = 30;
  flowState.panY = 30;
  flowState.zoom = 1;
  applyFlowTransform();
  renderFlowCanvas();
  scheduleAutoSave();
}

function startFlowPreview() {
  if (!state.activeDemo) return;
  (state.activeDemo.nodes || []).forEach(n => {
    if (n && n.imageUrl) {
      const pre = new Image();
      pre.src = n.imageUrl;
    }
  });
  flowState.previewNodeId = state.activeDemo.startNodeId || state.activeDemo.nodes?.[0]?.id || null;
  flowState.previewHistory = [];
  renderFlowPreview();
}

function syncFlowPreviewSize() {
  const wrap = document.getElementById('flow-preview-stage-wrap');
  const backdrop = document.getElementById('flow-preview-backdrop');
  const inner = document.getElementById('flow-preview-inner');
  const img = document.getElementById('flow-preview-img');
  if (!wrap || !backdrop || !inner) return;

  const cw = wrap.clientWidth;
  const ch = wrap.clientHeight;
  if (!cw || !ch) return;

  const maxW = Math.max(240, cw - 32);
  const maxH = Math.max(160, ch - 32);
  let outerW = maxW;
  let outerH = outerW / (16 / 9);
  if (outerH > maxH) {
    outerH = maxH;
    outerW = outerH * (16 / 9);
  }
  outerW = Math.floor(outerW);
  outerH = Math.floor(outerH);
  backdrop.style.width = `${outerW}px`;
  backdrop.style.height = `${outerH}px`;

  const pad = Math.max(20, Math.round(Math.min(outerW, outerH) * 0.06));
  const availW = Math.max(100, outerW - pad * 2);
  const availH = Math.max(100, outerH - pad * 2);
  const ratio = (img && img.naturalWidth && img.naturalHeight) ? (img.naturalWidth / img.naturalHeight) : (16 / 9);
  let w = availW;
  let h = w / ratio;
  if (h > availH) {
    h = availH;
    w = h * ratio;
  }
  inner.style.width = `${Math.floor(w)}px`;
  inner.style.height = `${Math.floor(h)}px`;
}

function renderFlowPreview() {
  if (!state.activeDemo) return;
  const node = (state.activeDemo.nodes || []).find(n => n.id === flowState.previewNodeId) || state.activeDemo.nodes?.[0];
  const img = document.getElementById('flow-preview-img');
  const hsLayer = document.getElementById('flow-preview-hotspots');
  const statusEl = document.getElementById('flow-preview-status');
  const backBtn = document.getElementById('btn-flow-preview-back');
  if (!node || !img || !hsLayer) return;

  if (statusEl) statusEl.textContent = node.title || 'Screen';
  if (backBtn) backBtn.disabled = flowState.previewHistory.length === 0;

  img.onload = syncFlowPreviewSize;
  img.src = node.imageUrl || '';
  img.classList.toggle('hidden', !node.imageUrl);
  syncFlowPreviewSize();

  hsLayer.innerHTML = '';
  (node.hotspots || []).forEach(hs => {
    const btn = document.createElement('div');
    btn.className = 'flow-preview-hotspot';
    btn.style.left = `${hs.x}%`;
    btn.style.top = `${hs.y}%`;
    btn.style.width = `${hs.w}%`;
    btn.style.height = `${hs.h}%`;
    const tipText = hs.tooltip || hs.label;
    if (tipText) {
      btn.innerHTML = `<span class="flow-preview-hotspot-tip">${escapeHtml(tipText)}</span>`;
    }
    btn.addEventListener('click', () => {
      if (!hs.targetNodeId) {
        showToast('This hotspot is not connected to a screen yet');
        return;
      }
      flowState.previewHistory.push(node.id);
      flowState.previewNodeId = hs.targetNodeId;
      renderFlowPreview();
    });
    hsLayer.appendChild(btn);
  });
}

function generateFlowWebflowSnippet(demo) {
  const widgetId = `bxflow-${demo.id.replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const serialized = JSON.stringify({
    id: demo.id,
    title: demo.title,
    startNodeId: demo.startNodeId || demo.nodes?.[0]?.id || '',
    nodes: demo.nodes || []
  });

  return `<!-- BxSoftware Interactive Flow Demo Embed for Webflow (${demo.title}) -->
<link href="https://fonts.googleapis.com/css2?family=Host+Grotesk:wght@600&family=Google+Sans:wght@400;500&display=swap" rel="stylesheet">
<div id="${widgetId}" style="font-family:'Google Sans',sans-serif; color:#324158; max-width:960px; margin:0 auto;"></div>
<script>
(function(){
  const flow = ${serialized};
  const root = document.getElementById("${widgetId}");
  if (!root || !flow.nodes.length) return;
  let currId = flow.startNodeId || flow.nodes[0].id;
  const hist = [];
  root.innerHTML = \`
    <style>
      #${widgetId} .bf-wrap { background:#00182C; border-radius:16px; overflow:hidden; box-shadow:0 18px 44px rgba(0,24,44,0.18); }
      #${widgetId} .bf-stage { position:relative; aspect-ratio:16/9; width:100%; background:radial-gradient(circle at 50% 18%, #0B2B4C 0%, #00182C 100%); display:flex; align-items:center; justify-content:center; overflow:hidden; }
      #${widgetId} .bf-inner { position:relative; border-radius:12px; overflow:hidden; box-shadow:0 16px 40px rgba(0,10,22,0.42), 0 0 0 1px rgba(255,255,255,0.14); }
      #${widgetId} .bf-img { width:100%; height:100%; display:block; object-fit:fill; }
      #${widgetId} .bf-hs { position:absolute; border:2px solid rgba(0,118,221,0.85); background:rgba(0,118,221,0.14); border-radius:7px; cursor:pointer; box-shadow:0 0 0 4px rgba(0,118,221,0.18); transition:background 0.15s; }
      #${widgetId} .bf-hs:hover { background:rgba(0,118,221,0.28); }
      #${widgetId} .bf-bar { background:#FFF; border-top:1px solid #E2E8F0; padding:10px 16px; display:flex; align-items:center; justify-content:space-between; }
      #${widgetId} .bf-btn { background:#F1F5F9; color:#00182C; border:1px solid #CBD5E1; border-radius:7px; padding:5px 11px; font-size:12px; font-weight:600; cursor:pointer; }
    </style>
    <div class="bf-wrap">
      <div class="bf-stage"><div class="bf-inner"><img class="bf-img" alt="" /><div class="bf-overlay" style="position:absolute;inset:0;"></div></div></div>
      <div class="bf-bar">
        <strong class="bf-title" style="font-family:'Host Grotesk',sans-serif; color:#00182C; font-size:14px;"></strong>
        <div style="display:flex; gap:6px;">
          <button class="bf-btn bf-back">Back</button>
          <button class="bf-btn bf-restart">Restart</button>
        </div>
      </div>
    </div>\`;
  const stage = root.querySelector(".bf-stage"), inner = root.querySelector(".bf-inner"), img = root.querySelector(".bf-img"), overlay = root.querySelector(".bf-overlay"), titleEl = root.querySelector(".bf-title"), backBtn = root.querySelector(".bf-back"), restartBtn = root.querySelector(".bf-restart");
  function fit() {
    const sw = stage.clientWidth * 0.88, sh = stage.clientHeight * 0.88;
    const ratio = (img.naturalWidth && img.naturalHeight) ? (img.naturalWidth / img.naturalHeight) : (16 / 9);
    let w = sw, h = w / ratio; if (h > sh) { h = sh; w = h * ratio; }
    inner.style.width = Math.floor(w) + "px"; inner.style.height = Math.floor(h) + "px";
  }
  window.addEventListener("resize", fit);
  img.addEventListener("load", fit);
  function render() {
    const node = flow.nodes.find(n => n.id === currId) || flow.nodes[0];
    if (!node) return;
    titleEl.textContent = node.title || flow.title;
    backBtn.disabled = hist.length === 0;
    img.src = node.imageUrl || "";
    fit();
    overlay.innerHTML = "";
    (node.hotspots || []).forEach(hs => {
      const b = document.createElement("div");
      b.className = "bf-hs";
      b.title = hs.tooltip || hs.label || "";
      b.style.left = hs.x + "%"; b.style.top = hs.y + "%"; b.style.width = hs.w + "%"; b.style.height = hs.h + "%";
      b.onclick = () => { if (hs.targetNodeId) { hist.push(node.id); currId = hs.targetNodeId; render(); } };
      overlay.appendChild(b);
    });
  }
  backBtn.onclick = () => { if (hist.length) { currId = hist.pop(); render(); } };
  restartBtn.onclick = () => { hist.length = 0; currId = flow.startNodeId || flow.nodes[0].id; render(); };
  render();
})();
</script>`;
}

function bindFlowEvents() {
  // New Demo Dropdown (+ New -> Walkthrough vs Interactive Demo)
  const newMenuBtn = document.getElementById('btn-new-demo-menu');
  const newMenuEl = document.getElementById('new-demo-menu');
  if (newMenuBtn && newMenuEl) {
    newMenuBtn.addEventListener('click', e => {
      e.stopPropagation();
      newMenuEl.classList.toggle('hidden');
    });
    newMenuEl.addEventListener('click', e => {
      if (e.target.closest('.add-step-menu-item')) newMenuEl.classList.add('hidden');
    });
    document.addEventListener('click', e => {
      if (!e.target.closest('#new-demo-dropdown')) newMenuEl.classList.add('hidden');
    });
  }

  document.getElementById('btn-new-flow-demo')?.addEventListener('click', async () => {
    const folder = state.selectedFolder === '__ALL__' ? '' : state.selectedFolder;
    const flowDemo = createFlowDemoObject('Untitled Interactive Demo', folder);
    state.demos.unshift(flowDemo);
    await apiUpdateDemo(flowDemo);
    openFlowDemo(flowDemo.id, 'canvas');
    showToast('Created Interactive Demo');
  });

  // Flow mode switcher
  document.querySelectorAll('#flow-mode-switcher .seg-btn').forEach(btn => {
    btn.addEventListener('click', () => setFlowMode(btn.dataset.flowMode));
  });

  // Zoom controls
  document.getElementById('btn-flow-zoom-in')?.addEventListener('click', () => {
    flowState.zoom = Math.min(1.6, Number((flowState.zoom + 0.1).toFixed(2)));
    applyFlowTransform();
  });
  document.getElementById('btn-flow-zoom-out')?.addEventListener('click', () => {
    flowState.zoom = Math.max(0.4, Number((flowState.zoom - 0.1).toFixed(2)));
    applyFlowTransform();
  });
  document.getElementById('btn-flow-autolayout')?.addEventListener('click', autoLayoutFlowNodes);

  // Add blank screen
  document.getElementById('btn-flow-add-blank')?.addEventListener('click', () => {
    if (!state.activeDemo) return;
    const count = (state.activeDemo.nodes || []).length;
    const newNode = {
      id: `node-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 5)}`,
      title: `Screen ${count + 1}`,
      imageUrl: '',
      flowX: 120 + (count % 4) * 280,
      flowY: 120 + Math.floor(count / 4) * 240,
      hotspots: []
    };
    state.activeDemo.nodes.push(newNode);
    if (!state.activeDemo.startNodeId) state.activeDemo.startNodeId = newNode.id;
    flowState.selectedNodeId = newNode.id;
    flowState.selectedHotspotId = null;
    renderFlowCanvas();
    renderFlowInspector();
    scheduleAutoSave();
    refreshIcons();
  });

  // Upload screen(s)
  document.getElementById('flow-add-screen-input')?.addEventListener('change', async e => {
    const files = Array.from(e.target.files || []).filter(f => f && f.type && f.type.startsWith('image/'));
    if (!state.activeDemo || files.length === 0) return;
    for (const file of files) {
      const uploaded = await apiUploadScreenshot(state.activeDemo.id, file);
      const count = (state.activeDemo.nodes || []).length;
      const cleanName = file.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ');
      const newNode = {
        id: `node-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 5)}`,
        title: cleanName || `Screen ${count + 1}`,
        imageUrl: uploaded.imageUrl,
        flowX: 120 + (count % 4) * 280,
        flowY: 120 + Math.floor(count / 4) * 240,
        hotspots: []
      };
      state.activeDemo.nodes.push(newNode);
      if (!state.activeDemo.startNodeId) state.activeDemo.startNodeId = newNode.id;
      flowState.selectedNodeId = newNode.id;
    }
    e.target.value = '';
    renderFlowCanvas();
    renderFlowInspector();
    scheduleAutoSave();
    refreshIcons();
    showToast(`Added ${files.length} screen(s)`);
  });

  // Replace image on selected node
  document.getElementById('flow-node-image-input')?.addEventListener('change', async e => {
    const file = e.target.files?.[0];
    const node = getSelectedFlowNode();
    if (!file || !node || !state.activeDemo) return;
    const uploaded = await apiUploadScreenshot(state.activeDemo.id, file);
    node.imageUrl = uploaded.imageUrl;
    e.target.value = '';
    renderFlowCanvas();
    renderFlowInspector();
    scheduleAutoSave();
  });

  document.getElementById('btn-flow-wf-assets')?.addEventListener('click', () => openWebflowAssetsModal('flow-add'));
  document.getElementById('btn-flow-node-wf-assets')?.addEventListener('click', () => openWebflowAssetsModal('flow-replace'));

  // Inspector controls
  document.getElementById('flow-node-title-input')?.addEventListener('input', e => {
    const node = getSelectedFlowNode();
    if (!node) return;
    node.title = e.target.value;
    const cardTitle = document.querySelector(`.flow-node[data-node-id="${node.id}"] .flow-node-title`);
    if (cardTitle) cardTitle.textContent = node.title || 'Screen';
    scheduleAutoSave();
  });

  document.getElementById('btn-flow-set-start')?.addEventListener('click', () => {
    const node = getSelectedFlowNode();
    if (!node || !state.activeDemo) return;
    state.activeDemo.startNodeId = node.id;
    renderFlowCanvas();
    renderFlowInspector();
    scheduleAutoSave();
    showToast('Set as Start screen');
  });

  document.getElementById('btn-flow-delete-node')?.addEventListener('click', () => {
    const node = getSelectedFlowNode();
    if (!node || !state.activeDemo) return;
    state.activeDemo.nodes = state.activeDemo.nodes.filter(n => n.id !== node.id);
    state.activeDemo.nodes.forEach(n => {
      n.hotspots = (n.hotspots || []).map(h => h.targetNodeId === node.id ? { ...h, targetNodeId: '' } : h);
    });
    if (state.activeDemo.startNodeId === node.id) {
      state.activeDemo.startNodeId = state.activeDemo.nodes[0]?.id || '';
    }
    flowState.selectedNodeId = state.activeDemo.nodes[0]?.id || null;
    flowState.selectedHotspotId = null;
    renderFlowCanvas();
    renderFlowInspector();
    scheduleAutoSave();
    refreshIcons();
  });

  // Hotspot drawing on inspector stage
  const drawLayer = document.getElementById('flow-hotspot-draw-layer');
  if (drawLayer) {
    drawLayer.addEventListener('pointerdown', e => {
      const node = getSelectedFlowNode();
      if (!node) return;
      const rect = drawLayer.getBoundingClientRect();
      const startX = Math.max(0, Math.min(100, ((e.clientX - rect.left) / rect.width) * 100));
      const startY = Math.max(0, Math.min(100, ((e.clientY - rect.top) / rect.height) * 100));
      const newHs = {
        id: `hs-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 5)}`,
        label: `Hotspot ${(node.hotspots?.length || 0) + 1}`,
        x: startX,
        y: startY,
        w: 8,
        h: 8,
        targetNodeId: '',
        tooltip: ''
      };
      node.hotspots.push(newHs);
      flowState.selectedHotspotId = newHs.id;
      flowState.drawingHotspot = { hs: newHs, rect, startX, startY };
      renderFlowInspector();
    });
  }

  document.getElementById('flow-hs-label-input')?.addEventListener('input', e => {
    const node = getSelectedFlowNode();
    const hs = node?.hotspots?.find(h => h.id === flowState.selectedHotspotId);
    if (!hs) return;
    hs.label = e.target.value;
    renderFlowCanvas();
    const tag = document.querySelector(`.flow-hs-box.selected .flow-hs-tag`);
    if (tag) tag.textContent = hs.label || 'Hotspot';
    scheduleAutoSave();
  });

  document.getElementById('flow-hs-tooltip-input')?.addEventListener('input', e => {
    const node = getSelectedFlowNode();
    const hs = node?.hotspots?.find(h => h.id === flowState.selectedHotspotId);
    if (!hs) return;
    hs.tooltip = e.target.value;
    scheduleAutoSave();
  });

  document.getElementById('flow-hs-target-select')?.addEventListener('change', e => {
    const node = getSelectedFlowNode();
    const hs = node?.hotspots?.find(h => h.id === flowState.selectedHotspotId);
    if (!hs) return;
    hs.targetNodeId = e.target.value;
    renderFlowCanvas();
    scheduleAutoSave();
  });

  document.getElementById('btn-flow-delete-hotspot')?.addEventListener('click', () => {
    const node = getSelectedFlowNode();
    if (!node || !flowState.selectedHotspotId) return;
    deleteFlowHotspot(node.id, flowState.selectedHotspotId);
  });

  window.addEventListener('keydown', e => {
    if (state.currentView !== 'flow' || flowState.mode !== 'canvas') return;
    if (e.target.matches('input, textarea, select')) return;
    if ((e.key === 'Delete' || e.key === 'Backspace') && flowState.selectedHotspotId && flowState.selectedNodeId) {
      e.preventDefault();
      deleteFlowHotspot(flowState.selectedNodeId, flowState.selectedHotspotId);
    }
  });

  // Canvas pan, node drag, connector drag
  const viewport = document.getElementById('flow-canvas-viewport');
  if (viewport) {
    viewport.addEventListener('pointerdown', e => {
      if (e.target.closest('.flow-node') || e.target.closest('.flow-connector-path')) return;
      flowState.isPanning = true;
      viewport.classList.add('is-panning');
      flowState.panStart = { x: e.clientX - flowState.panX, y: e.clientY - flowState.panY };
    });
    viewport.addEventListener('wheel', e => {
      e.preventDefault();
      const delta = e.deltaY > 0 ? -0.06 : 0.06;
      flowState.zoom = Math.max(0.4, Math.min(1.6, Number((flowState.zoom + delta).toFixed(2))));
      applyFlowTransform();
    }, { passive: false });
  }

  window.addEventListener('pointermove', e => {
    if (flowState.isPanning && flowState.panStart) {
      flowState.panX = e.clientX - flowState.panStart.x;
      flowState.panY = e.clientY - flowState.panStart.y;
      applyFlowTransform();
    } else if (flowState.draggingNode) {
      const node = state.activeDemo?.nodes?.find(n => n.id === flowState.draggingNode.nodeId);
      if (!node) return;
      const dx = (e.clientX - flowState.draggingNode.startClientX) / flowState.zoom;
      const dy = (e.clientY - flowState.draggingNode.startClientY) / flowState.zoom;
      node.flowX = Math.max(20, Math.round(flowState.draggingNode.startX + dx));
      node.flowY = Math.max(20, Math.round(flowState.draggingNode.startY + dy));
      const el = document.querySelector(`.flow-node[data-node-id="${node.id}"]`);
      if (el) {
        el.style.left = `${node.flowX}px`;
        el.style.top = `${node.flowY}px`;
      }
      renderFlowConnectors();
    } else if (flowState.connecting) {
      const worldRect = document.getElementById('flow-canvas-world').getBoundingClientRect();
      const x = (e.clientX - worldRect.left) / flowState.zoom;
      const y = (e.clientY - worldRect.top) / flowState.zoom;
      const hoveredNode = e.target.closest?.('.flow-node');
      document.querySelectorAll('.flow-node').forEach(n => {
        n.classList.toggle('is-connect-target', Boolean(hoveredNode && hoveredNode === n && n.dataset.nodeId !== flowState.connecting.fromNodeId));
      });
      renderFlowConnectors({ x, y });
    } else if (flowState.drawingHotspot) {
      const { hs, rect, startX, startY } = flowState.drawingHotspot;
      const currX = Math.max(0, Math.min(100, ((e.clientX - rect.left) / rect.width) * 100));
      const currY = Math.max(0, Math.min(100, ((e.clientY - rect.top) / rect.height) * 100));
      hs.x = Math.round(Math.min(startX, currX) * 10) / 10;
      hs.y = Math.round(Math.min(startY, currY) * 10) / 10;
      hs.w = Math.max(3, Math.round(Math.abs(currX - startX) * 10) / 10);
      hs.h = Math.max(3, Math.round(Math.abs(currY - startY) * 10) / 10);
      const box = document.querySelector('.flow-hs-box.selected');
      if (box) {
        box.style.left = `${hs.x}%`;
        box.style.top = `${hs.y}%`;
        box.style.width = `${hs.w}%`;
        box.style.height = `${hs.h}%`;
      }
    }
  });

  window.addEventListener('pointerup', e => {
    if (flowState.isPanning) {
      flowState.isPanning = false;
      document.getElementById('flow-canvas-viewport')?.classList.remove('is-panning');
      flowState.panStart = null;
    }
    if (flowState.draggingNode) {
      flowState.draggingNode = null;
      scheduleAutoSave();
    }
    if (flowState.connecting) {
      const targetNodeEl = e.target.closest?.('.flow-node');
      if (targetNodeEl && targetNodeEl.dataset.nodeId !== flowState.connecting.fromNodeId) {
        const fromNode = state.activeDemo?.nodes?.find(n => n.id === flowState.connecting.fromNodeId);
        const hs = fromNode?.hotspots?.find(h => h.id === flowState.connecting.hotspotId);
        if (hs) {
          hs.targetNodeId = targetNodeEl.dataset.nodeId;
          scheduleAutoSave();
        }
      }
      document.querySelectorAll('.flow-node').forEach(n => n.classList.remove('is-connect-target'));
      flowState.connecting = null;
      renderFlowCanvas();
      renderFlowInspector();
    }
    if (flowState.drawingHotspot) {
      flowState.drawingHotspot = null;
      renderFlowCanvas();
      renderFlowInspector();
      scheduleAutoSave();
    }
  });

  // Preview bar controls
  document.getElementById('btn-flow-preview-restart')?.addEventListener('click', startFlowPreview);
  document.getElementById('btn-flow-preview-back')?.addEventListener('click', () => {
    if (flowState.previewHistory.length === 0) return;
    flowState.previewNodeId = flowState.previewHistory.pop();
    renderFlowPreview();
  });
  document.getElementById('btn-flow-preview-fullscreen')?.addEventListener('click', () => {
    const wrap = document.getElementById('flow-preview-stage-wrap');
    if (!wrap) return;
    if (document.fullscreenElement) document.exitFullscreen?.();
    else wrap.requestFullscreen?.();
  });
  window.addEventListener('resize', () => {
    if (state.currentView === 'flow' && flowState.mode === 'preview') syncFlowPreviewSize();
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bindFlowEvents);
} else {
  bindFlowEvents();
}
