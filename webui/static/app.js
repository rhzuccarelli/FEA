import * as THREE from 'three';
import { OrbitControls } from './vendor/OrbitControls.js';

const $ = (id) => document.getElementById(id);

// ---------------------------------------------------------------- model state

const FACES = {
  XMIN: { desc: 'End face at x = 0', normal: [-1, 0, 0] },
  XMAX: { desc: 'End face at x = L', normal: [1, 0, 0] },
  YMIN: { desc: 'Side face at y = 0', normal: [0, -1, 0] },
  YMAX: { desc: 'Side face at y = W', normal: [0, 1, 0] },
  ZMIN: { desc: 'Bottom face', normal: [0, 0, -1] },
  ZMAX: { desc: 'Top face', normal: [0, 0, 1] },
};

const SUPPORTS = {
  free: { label: 'Free', color: null },
  fixed: { label: 'Fixed (clamped)', color: '#2563eb' },
  roller: { label: 'Roller (no normal motion)', color: '#0d9488' },
  pinned: { label: 'Sliding (normal motion only)', color: '#7c3aed' },
};
const LOAD_COLOR = '#ea580c';

const MATERIALS = {
  steel: { E: 210, nu: 0.3, rho: 7850 },
  aluminium: { E: 69, nu: 0.33, rho: 2700 },
  titanium: { E: 114, nu: 0.34, rho: 4430 },
  concrete: { E: 33, nu: 0.2, rho: 2400 },
};

// Start with a simple cantilever: clamped at x = 0, 1 kN downward at the free end.
const faceState = Object.fromEntries(Object.keys(FACES).map((f) => [f, {
  support: 'free', load: 'none', pressure: 0.1, fx: 0, fy: 0, fz: 0,
}]));
faceState.XMIN.support = 'fixed';
Object.assign(faceState.XMAX, { load: 'force', fz: -1000 });

let selectedFace = 'XMAX';
let currentMesh = null;     // mesh payload from the server
let currentJob = null;      // job payload when showing results
let viewMode = 'model';

function num(id) { return parseFloat($(id).value); }

function buildStudy() {
  const supports = {};
  const loads = [];
  for (const [face, s] of Object.entries(faceState)) {
    supports[face] = s.support;
    if (s.load === 'pressure') loads.push({ type: 'pressure', face, value: s.pressure * 1e6 });
    if (s.load === 'force') loads.push({ type: 'force', face, fx: s.fx, fy: s.fy, fz: s.fz });
  }
  const analysis = document.querySelector('input[name=analysis]:checked').value;
  return {
    geometry: {
      lx: num('lx'), ly: num('ly'), lz: num('lz'),
      nx: parseInt($('nx').value, 10), ny: parseInt($('ny').value, 10), nz: parseInt($('nz').value, 10),
    },
    material: { E: num('E') * 1e9, nu: num('nu'), rho: num('rho') },
    supports,
    loads,
    gravity: { enabled: $('gravity').checked, g: 9.81, direction: [0, 0, -1] },
    analysis: { type: analysis, modes: parseInt($('modes').value, 10) },
  };
}

// ---------------------------------------------------------------- face editor

function renderFaces() {
  const box = $('faces');
  box.innerHTML = '';
  for (const [face, info] of Object.entries(FACES)) {
    const s = faceState[face];
    const el = document.createElement('div');
    el.className = 'face' + (face === selectedFace ? ' selected' : '');
    const tags = [];
    if (s.support !== 'free') tags.push(SUPPORTS[s.support].label);
    if (s.load === 'pressure') tags.push(`p = ${s.pressure} MPa`);
    if (s.load === 'force') tags.push(`F = (${s.fx}, ${s.fy}, ${s.fz}) N`);
    const color = s.support !== 'free' ? SUPPORTS[s.support].color : (s.load !== 'none' ? LOAD_COLOR : null);
    el.innerHTML = `
      <div class="face-head">
        <span class="swatch" style="${color ? `background:${color};border-color:${color}` : ''}"></span>
        <span class="face-name">${face}</span>
        <span class="face-desc">${tags.length ? tags.join(' · ') : info.desc}</span>
      </div>
      <div class="face-body">
        <label>Support<select data-k="support">
          ${Object.entries(SUPPORTS).map(([k, v]) => `<option value="${k}" ${s.support === k ? 'selected' : ''}>${v.label}</option>`).join('')}
        </select></label>
        <label>Load<select data-k="load">
          <option value="none" ${s.load === 'none' ? 'selected' : ''}>None</option>
          <option value="pressure" ${s.load === 'pressure' ? 'selected' : ''}>Pressure</option>
          <option value="force" ${s.load === 'force' ? 'selected' : ''}>Total force</option>
        </select></label>
        ${s.load === 'pressure' ? `<label class="full">Pressure (MPa, positive pushes into the face)<input data-k="pressure" type="number" step="any" value="${s.pressure}"></label>` : ''}
        ${s.load === 'force' ? `<div class="grid3">
          <label>Fx (N)<input data-k="fx" type="number" step="any" value="${s.fx}"></label>
          <label>Fy (N)<input data-k="fy" type="number" step="any" value="${s.fy}"></label>
          <label>Fz (N)<input data-k="fz" type="number" step="any" value="${s.fz}"></label></div>` : ''}
      </div>`;
    el.querySelector('.face-head').addEventListener('click', () => selectFace(face === selectedFace ? null : face));
    el.querySelectorAll('[data-k]').forEach((input) => {
      input.addEventListener('change', () => {
        const k = input.dataset.k;
        s[k] = input.tagName === 'SELECT' ? input.value : parseFloat(input.value) || 0;
        renderFaces();
        onModelChange();
      });
    });
    box.appendChild(el);
  }
}

function selectFace(face) {
  selectedFace = face;
  renderFaces();
  if (viewMode === 'model') colorModel();
}

// ---------------------------------------------------------------- 3D viewer

const viewerEl = $('viewer');
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(window.devicePixelRatio);
viewerEl.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(40, 1, 0.001, 1000);
camera.up.set(0, 0, 1);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;

scene.add(new THREE.HemisphereLight(0xffffff, 0x8090a0, 1.6));
const sun = new THREE.DirectionalLight(0xffffff, 1.4);
scene.add(sun);

const surfaceMat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide,
  polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 });
const edgeMat = new THREE.LineBasicMaterial({ color: 0x1c2330, transparent: true, opacity: 0.35 });
const surface = new THREE.Mesh(new THREE.BufferGeometry(), surfaceMat);
const edges = new THREE.LineSegments(new THREE.BufferGeometry(), edgeMat);
const ghost = new THREE.LineSegments(new THREE.BufferGeometry(),
  new THREE.LineBasicMaterial({ color: 0x5d6879, transparent: true, opacity: 0.25 }));
const glyphs = new THREE.Group();
scene.add(surface, edges, ghost, glyphs);

let triFace = [];     // face name of every surface triangle
let modelSize = 1;

function resize() {
  const { clientWidth: w, clientHeight: h } = viewerEl;
  if (!w || !h) return;
  renderer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
new ResizeObserver(resize).observe(viewerEl);

function faceOfNormal(n) {
  const a = [Math.abs(n.x), Math.abs(n.y), Math.abs(n.z)];
  const axis = a.indexOf(Math.max(...a));
  return 'XYZ'[axis] + ([n.x, n.y, n.z][axis] < 0 ? 'MIN' : 'MAX');
}

function setMesh(mesh, { refit }) {
  currentMesh = mesh;
  const { nodes, triangles } = mesh;
  const n = triangles.length;
  surface.geometry.dispose();
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
  g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
  surface.geometry = g;

  triFace = [];
  const p = (i) => new THREE.Vector3(nodes[3 * i], nodes[3 * i + 1], nodes[3 * i + 2]);
  for (let t = 0; t < n; t += 3) {
    const a = p(triangles[t]), b = p(triangles[t + 1]), c = p(triangles[t + 2]);
    triFace.push(faceOfNormal(b.sub(a).cross(c.sub(a))));
  }
  edges.geometry.dispose();
  edges.geometry = new THREE.BufferGeometry();
  edges.geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(mesh.edges.length * 3), 3));
  ghost.geometry.dispose();
  ghost.geometry = new THREE.BufferGeometry();
  ghost.geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(mesh.edges.length * 3), 3));
  ghost.visible = false;

  updatePositions(null, 0);
  // ghost (undeformed outline) never moves
  ghost.geometry.attributes.position.array.set(edges.geometry.attributes.position.array);
  ghost.geometry.attributes.position.needsUpdate = true;

  const box = new THREE.Box3().setFromBufferAttribute(g.attributes.position);
  modelSize = box.getSize(new THREE.Vector3()).length();
  if (refit) fitCamera(box);
}

function fitCamera(box) {
  const center = box.getCenter(new THREE.Vector3());
  controls.target.copy(center);
  const d = modelSize * 1.25;
  camera.position.copy(center).add(new THREE.Vector3(0.75 * d, -1.1 * d, 0.7 * d));
  camera.near = modelSize / 1000;
  camera.far = modelSize * 100;
  camera.updateProjectionMatrix();
  sun.position.copy(camera.position).add(new THREE.Vector3(0, 0, d));
}

// Displaced node coordinate i, component c.
function updatePositions(disp, factor) {
  const { nodes, triangles, edges: edgeList } = currentMesh;
  const coord = (i, c) => nodes[3 * i + c] + (disp ? factor * disp[c][i] : 0);
  const pos = surface.geometry.attributes.position.array;
  for (let v = 0; v < triangles.length; v++) {
    for (let c = 0; c < 3; c++) pos[3 * v + c] = coord(triangles[v], c);
  }
  surface.geometry.attributes.position.needsUpdate = true;
  surface.geometry.computeVertexNormals();
  surface.geometry.computeBoundingSphere();
  const epos = edges.geometry.attributes.position.array;
  for (let v = 0; v < edgeList.length; v++) {
    for (let c = 0; c < 3; c++) epos[3 * v + c] = coord(edgeList[v], c);
  }
  edges.geometry.attributes.position.needsUpdate = true;
}

const tmpColor = new THREE.Color();
function faceColor(face) {
  const s = faceState[face];
  let hex = '#b9c1cc';
  if (s.support !== 'free') hex = SUPPORTS[s.support].color;
  else if (s.load !== 'none') hex = LOAD_COLOR;
  tmpColor.set(hex);
  if (face === hoverFace) tmpColor.lerp(new THREE.Color('#ffffff'), 0.25);
  if (face === selectedFace) tmpColor.lerp(new THREE.Color('#facc15'), 0.45);
  return tmpColor;
}

function colorModel() {
  if (!currentMesh) return;
  const col = surface.geometry.attributes.color.array;
  for (let t = 0; t < triFace.length; t++) {
    const c = faceColor(triFace[t]);
    for (let k = 0; k < 3; k++) col.set([c.r, c.g, c.b], 9 * t + 3 * k);
  }
  surface.geometry.attributes.color.needsUpdate = true;
  drawGlyphs();
}

function drawGlyphs() {
  glyphs.clear();
  if (viewMode !== 'model' || !currentMesh) return;
  const g = buildStudy().geometry;
  const len = 0.12 * modelSize;
  for (const [face, s] of Object.entries(faceState)) {
    if (s.load === 'none') continue;
    const n = new THREE.Vector3(...FACES[face].normal);
    let dir;
    if (s.load === 'pressure') dir = n.clone().multiplyScalar(s.pressure >= 0 ? -1 : 1);
    else dir = new THREE.Vector3(s.fx, s.fy, s.fz);
    if (dir.lengthSq() === 0) continue;
    dir.normalize();
    // One arrow for a total force, a 3x3 grid for a pressure, all ending on the face.
    const axis = 'XYZ'.indexOf(face[0]);
    const dims = [g.lx, g.ly, g.lz];
    const others = [0, 1, 2].filter((i) => i !== axis);
    const grid = s.load === 'pressure' ? [0.2, 0.5, 0.8] : [0.5];
    const faceSpan = Math.min(dims[others[0]], dims[others[1]]);
    const l = s.load === 'pressure' ? Math.min(len, 1.2 * faceSpan) : len * 1.4;
    const head = Math.min(0.3 * l, s.load === 'pressure' ? 0.25 * faceSpan : 0.6 * faceSpan);
    for (const u of grid) {
      for (const v of grid) {
        const pt = [0, 0, 0];
        pt[axis] = face.endsWith('MAX') ? dims[axis] : 0;
        pt[others[0]] = u * dims[others[0]];
        pt[others[1]] = v * dims[others[1]];
        const tip = new THREE.Vector3(...pt);
        // keep arrows outside the solid: start on the outer side of the face
        const start = s.load === 'pressure' || dir.dot(n) < 0
          ? tip.clone().addScaledVector(dir, -l) : tip.clone();
        glyphs.add(new THREE.ArrowHelper(dir, start, l, LOAD_COLOR, head, 0.6 * head));
      }
    }
  }
}

// picking
const raycaster = new THREE.Raycaster();
let hoverFace = null;
let downAt = null;
function pickFace(ev) {
  const r = renderer.domElement.getBoundingClientRect();
  const ndc = new THREE.Vector2(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
  const hit = raycaster.intersectObject(surface)[0];
  return hit ? triFace[Math.floor(hit.faceIndex)] : null;
}
renderer.domElement.addEventListener('pointerdown', (ev) => { downAt = [ev.clientX, ev.clientY]; });
renderer.domElement.addEventListener('pointerup', (ev) => {
  if (viewMode !== 'model' || !downAt) return;
  if (Math.hypot(ev.clientX - downAt[0], ev.clientY - downAt[1]) > 4) return;
  const f = pickFace(ev);
  if (f) selectFace(f);
});
renderer.domElement.addEventListener('pointermove', (ev) => {
  if (viewMode !== 'model' || ev.buttons) return;
  const f = pickFace(ev);
  if (f !== hoverFace) {
    hoverFace = f;
    renderer.domElement.style.cursor = f ? 'pointer' : '';
    colorModel();
  }
});

// ---------------------------------------------------------------- results display

const VIRIDIS = ['#440154', '#414487', '#2a788e', '#22a884', '#7ad151', '#fde725'].map((h) => new THREE.Color(h));
function colormap(t, out) {
  t = Math.min(1, Math.max(0, t)) * (VIRIDIS.length - 1);
  const i = Math.min(VIRIDIS.length - 2, Math.floor(t));
  return out.copy(VIRIDIS[i]).lerp(VIRIDIS[i + 1], t - i);
}

let resultFields = {};   // name -> {values, label, unit, scale}
let resultDisp = null;   // [dx[], dy[], dz[]] for the active mode/static
let baseFactor = 1;
let animStart = 0;

function magnitude(d) { return d[0].map((_, i) => Math.hypot(d[0][i], d[1][i], d[2][i])); }

function showResults(job) {
  currentJob = job;
  viewMode = 'result';
  const key = JSON.stringify(job.study.geometry);
  setMesh(job.mesh, { refit: key !== lastGeometryKey });
  lastGeometryKey = key;
  glyphs.clear();
  $('result-tools').hidden = false;
  $('legend').hidden = false;
  $('viewer-hint').textContent = 'Drag to orbit · scroll to zoom · right-drag to pan';
  hoverFace = null;
  renderer.domElement.style.cursor = '';
  ghost.visible = true;

  const fieldSel = $('field');
  fieldSel.innerHTML = '';
  if (job.fields.type === 'static') {
    $('mode-pick').hidden = true;
    $('animate').checked = false;
    selectDisplacement(job.fields.displacement);
    const opts = [['mag', 'Displacement magnitude'], ['dx', 'Displacement X'], ['dy', 'Displacement Y'],
      ['dz', 'Displacement Z'], ['vm', 'Von Mises stress']];
    opts.forEach(([v, l]) => fieldSel.add(new Option(l, v)));
    fieldSel.value = 'vm';
  } else {
    $('mode-pick').hidden = false;
    const modeSel = $('mode');
    modeSel.innerHTML = '';
    job.fields.modes.forEach((m, i) => modeSel.add(new Option(`#${m.rank} — ${m.frequency.toFixed(2)} Hz`, i)));
    fieldSel.add(new Option('Mode shape magnitude', 'mag'));
    $('animate').checked = true;
    selectMode(0);
  }
  renderSummary(job);
  refreshResult();
}

function selectDisplacement(d) {
  resultDisp = d;
  const mag = magnitude(d);
  const maxU = Math.max(...mag) || 1;
  baseFactor = (0.1 * modelSize) / maxU;
  const f = { mag, dx: d[0], dy: d[1], dz: d[2] };
  resultFields = {
    mag: { values: f.mag, label: 'Displacement magnitude', unit: 'mm', k: 1e3 },
    dx: { values: f.dx, label: 'Displacement X', unit: 'mm', k: 1e3 },
    dy: { values: f.dy, label: 'Displacement Y', unit: 'mm', k: 1e3 },
    dz: { values: f.dz, label: 'Displacement Z', unit: 'mm', k: 1e3 },
  };
  if (currentJob.fields.type === 'static') {
    resultFields.vm = { values: currentJob.fields.von_mises, label: 'Von Mises stress', unit: 'MPa', k: 1e-6 };
  } else {
    resultFields.mag = { values: mag, label: 'Mode shape magnitude (normalised)', unit: '', k: 1 / maxU };
  }
}

function selectMode(i) {
  selectDisplacement(currentJob.fields.modes[i].shape);
  refreshResult();
}

function fmt(v) {
  const a = Math.abs(v);
  if (a !== 0 && (a < 1e-3 || a >= 1e5)) return v.toExponential(3);
  const str = v.toPrecision(4);
  return str.includes('.') ? str.replace(/\.?0+$/, '') : str;
}

function refreshResult() {
  if (viewMode !== 'result') return;
  const field = resultFields[$('field').value];
  const vals = field.values;
  let lo = Infinity, hi = -Infinity;
  for (const v of vals) { if (v < lo) lo = v; if (v > hi) hi = v; }
  const span = hi - lo || 1;
  const tris = currentMesh.triangles;
  const col = surface.geometry.attributes.color.array;
  const c = new THREE.Color();
  for (let v = 0; v < tris.length; v++) {
    colormap((vals[tris[v]] - lo) / span, c);
    col[3 * v] = c.r; col[3 * v + 1] = c.g; col[3 * v + 2] = c.b;
  }
  surface.geometry.attributes.color.needsUpdate = true;
  $('legend-title').textContent = field.unit ? `${field.label} (${field.unit})` : field.label;
  $('legend-min').textContent = fmt(lo * field.k);
  $('legend-max').textContent = fmt(hi * field.k);
  if (!$('animate').checked) applyDeformation(1);
}

function applyDeformation(phase) {
  const mult = parseFloat($('scale').value);
  $('scale-val').textContent = mult.toFixed(2);
  updatePositions(resultDisp, baseFactor * mult * phase);
}

function renderSummary(job) {
  const s = job.summary;
  const box = $('summary');
  const stat = (k, v, u) => `<div class="stat"><div class="k">${k}</div><div class="v">${v}<span class="u">${u}</span></div></div>`;
  if (job.fields.type === 'static') {
    const rmax = Math.max(...s.reaction.map(Math.abs));
    const r = s.reaction.map((x) => fmt(Math.abs(x) < 1e-9 * rmax ? 0 : x)).join(', ');
    box.innerHTML = stat('Max displacement', fmt(s.max_displacement * 1e3), 'mm')
      + stat('Max von Mises stress', fmt(s.max_von_mises * 1e-6), 'MPa')
      + stat('Support reaction (X, Y, Z)', r, 'N')
      + stat('Solve time', job.elapsed.toFixed(1), 's');
  } else {
    box.innerHTML = s.frequencies.slice(0, 4).map((f, i) => stat(`Mode ${i + 1}`, fmt(f), 'Hz')).join('')
      + stat('Solve time', job.elapsed.toFixed(1), 's');
  }
  box.hidden = false;
}

function backToModel() {
  viewMode = 'model';
  currentJob = null;
  $('result-tools').hidden = true;
  $('legend').hidden = true;
  $('summary').hidden = true;
  ghost.visible = false;
  $('viewer-hint').textContent = 'Drag to orbit · scroll to zoom · right-drag to pan · click a face to edit it';
  document.querySelectorAll('.jobs li.job').forEach((li) => li.classList.remove('active'));
  refreshPreview(true);
}

$('field').addEventListener('change', refreshResult);
$('mode').addEventListener('change', (e) => selectMode(parseInt(e.target.value, 10)));
$('scale').addEventListener('input', () => { if (!$('animate').checked) applyDeformation(1); });
$('animate').addEventListener('change', () => { animStart = performance.now(); refreshResult(); });
$('back-to-model').addEventListener('click', backToModel);

function animate(now) {
  requestAnimationFrame(animate);
  if (viewMode === 'result' && $('animate').checked && resultDisp) {
    const t = (now - animStart) / 1000;
    const phase = currentJob.fields.type === 'modal' ? Math.sin(2 * Math.PI * 0.8 * t) : 0.5 - 0.5 * Math.cos(2 * Math.PI * 0.5 * t);
    applyDeformation(phase);
  }
  controls.update();
  renderer.render(scene, camera);
}
requestAnimationFrame(animate);

// ---------------------------------------------------------------- server calls

async function api(path, options = {}) {
  const res = await fetch(path, { headers: { 'Content-Type': 'application/json' }, ...options });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.detail || `HTTP ${res.status}`);
  return body;
}

let previewTimer = null;
let lastGeometryKey = null;
function onModelChange() {
  clearTimeout(previewTimer);
  previewTimer = setTimeout(() => refreshPreview(false), 250);
  if (viewMode === 'model') drawGlyphs();
}

async function refreshPreview(forceRefit) {
  const study = buildStudy();
  const key = JSON.stringify(study.geometry);
  try {
    const out = await api('/api/preview', { method: 'POST', body: JSON.stringify({ study }) });
    $('validation').hidden = true;
    if (!$('use-custom').checked) $('comm').value = out.comm;
    $('mesh-info').textContent = `${out.mesh.n_elements.toLocaleString()} hexahedra · ${out.mesh.n_nodes.toLocaleString()} nodes`;
    if (viewMode === 'model') {
      if (key !== lastGeometryKey || forceRefit) setMesh(out.mesh, { refit: key !== lastGeometryKey });
      lastGeometryKey = key;
      colorModel();
    }
  } catch (err) {
    $('validation').textContent = err.message;
    $('validation').hidden = false;
  }
}

async function run() {
  const btn = $('run');
  btn.disabled = true;
  $('validation').hidden = true;
  try {
    const body = { study: buildStudy() };
    if ($('use-custom').checked) body.comm = $('comm').value;
    const job = await api('/api/jobs', { method: 'POST', body: JSON.stringify(body) });
    setBusy(true, 'Solving with code_aster…');
    await refreshJobs();
    await followJob(job.id);
  } catch (err) {
    $('validation').textContent = err.message;
    $('validation').hidden = false;
  } finally {
    btn.disabled = false;
    setBusy(false);
  }
}

async function followJob(id) {
  for (;;) {
    const job = await api(`/api/jobs/${id}`);
    showLog(job);
    if (job.status === 'done' || job.status === 'failed') {
      await refreshJobs();
      openJob(job);
      return;
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
}

function setBusy(on, text) {
  $('busy').hidden = !on;
  if (text) $('busy-text').textContent = text;
}

function showLog(job) {
  $('log').textContent = job.log || '';
  $('log').scrollTop = $('log').scrollHeight;
  $('log-head').textContent = `Run ${job.id} — ${job.status}`;
  $('downloads').innerHTML = job.status === 'done' || job.status === 'failed'
    ? [['comm', 'command file'], ['mail', 'mesh'], ['rmed', 'results (.rmed, ParaView)'], ['mess', 'message file']]
      .map(([k, l]) => `<a href="/api/jobs/${job.id}/files/${k}" download>${l}</a>`).join('')
    : '';
}

function openJob(job) {
  showLog(job);
  document.querySelectorAll('.jobs li.job').forEach((li) => li.classList.toggle('active', li.dataset.id === job.id));
  if (job.status === 'done') {
    showTab('view');
    showResults(job);
  } else if (job.status === 'failed') {
    showTab('log');
    $('validation').textContent = 'code_aster run failed — see the solver log.';
    $('validation').hidden = false;
  }
}

async function refreshJobs() {
  const list = await api('/api/jobs');
  const ul = $('jobs');
  if (!list.length) return;
  ul.innerHTML = '';
  for (const j of list) {
    const li = document.createElement('li');
    li.className = 'job' + (currentJob && currentJob.id === j.id ? ' active' : '');
    li.dataset.id = j.id;
    li.innerHTML = `<span>${j.id.slice(9, 15).replace(/(\d\d)(\d\d)(\d\d)/, '$1:$2:$3')} · ${j.analysis}${j.custom_comm ? ' (edited)' : ''}</span>
      <span class="status ${j.status}">${j.status}</span>`;
    li.addEventListener('click', async () => {
      const full = await api(`/api/jobs/${j.id}`);
      if (full.status === 'running' || full.status === 'queued') showLog(full);
      else openJob(full);
    });
    ul.appendChild(li);
  }
}

// ---------------------------------------------------------------- wiring

function showTab(name) {
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === name));
  document.querySelectorAll('.panel').forEach((p) => p.classList.toggle('active', p.id === `panel-${name}`));
  if (name === 'view') resize();
}
document.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => showTab(t.dataset.tab)));

['lx', 'ly', 'lz', 'nx', 'ny', 'nz', 'E', 'nu', 'rho', 'modes', 'gravity'].forEach((id) => {
  $(id).addEventListener('input', onModelChange);
});
['E', 'nu', 'rho'].forEach((id) => $(id).addEventListener('input', () => { $('material-preset').value = 'custom'; }));
$('material-preset').addEventListener('change', (e) => {
  const m = MATERIALS[e.target.value];
  if (!m) return;
  $('E').value = m.E; $('nu').value = m.nu; $('rho').value = m.rho;
  onModelChange();
});
document.querySelectorAll('input[name=analysis]').forEach((r) => r.addEventListener('change', () => {
  if (r.checked) $('modes-row').hidden = r.value !== 'modal';
  onModelChange();
}));
$('reset-comm').addEventListener('click', () => { $('use-custom').checked = false; refreshPreview(false); });
$('comm').addEventListener('input', () => { $('use-custom').checked = true; });
$('run').addEventListener('click', run);

async function init() {
  renderFaces();
  resize();
  try {
    const st = await api('/api/status');
    const pill = $('solver-status');
    if (st.code_aster) { pill.textContent = st.code_aster; pill.className = 'pill ok'; }
    else { pill.textContent = 'code_aster not found'; pill.className = 'pill bad'; }
  } catch { /* server down: preview will report */ }
  await refreshPreview(true);
  await refreshJobs().catch(() => {});
}
init();
