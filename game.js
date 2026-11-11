'use strict';

const COLS = 10;
const ROWS = 20;
const BLOCK = 30;

const COLORS = [
  null,
  '#4dd0e1', // I - cyan
  '#ffd54f', // O - yellow
  '#ba68c8', // T - purple
  '#81c784', // S - green
  '#e57373', // Z - red
  '#7986cb', // J - indigo
  '#ffb74d', // L - orange
];

const PIECES = [
  null,
  [[0,0,0,0],[1,1,1,1],[0,0,0,0],[0,0,0,0]], // I
  [[2,2],[2,2]],                               // O
  [[0,3,0],[3,3,3],[0,0,0]],                  // T
  [[0,4,4],[4,4,0],[0,0,0]],                  // S
  [[5,5,0],[0,5,5],[0,0,0]],                  // Z
  [[6,0,0],[6,6,6],[0,0,0]],                  // J
  [[0,0,7],[7,7,7],[0,0,0]],                  // L
];

const LINE_SCORES = [0, 100, 300, 500, 800];
const MAX_START_LEVEL = 10;
const RESUME_LOCK_MS = 300; // ignora teclas de juego un instante al reanudar

function speedFor(lvl) {
  return Math.max(100, 1000 - (lvl - 1) * 90);
}

const canvas = document.getElementById('board');
const ctx = canvas.getContext('2d');
const nextCanvas = document.getElementById('next-canvas');
const nextCtx = nextCanvas.getContext('2d');
const scoreEl = document.getElementById('score');
const linesEl = document.getElementById('lines');
const levelEl = document.getElementById('level');
const overlay = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlayScore = document.getElementById('overlay-score');
const overlayRank = document.getElementById('overlay-rank');
const recordsSection = document.getElementById('records');
const recordsBody = document.getElementById('records-body');
const recordsStats = document.getElementById('records-stats');
const saveBtn = document.getElementById('save-btn');
const resetBtn = document.getElementById('reset-records-btn');
const restartBtn = document.getElementById('restart-btn');
const themeBtn = document.getElementById('theme-btn');
const menuMain = document.getElementById('menu-main');
const menuControls = document.getElementById('menu-controls');
const resumeBtn = document.getElementById('resume-btn');
const controlsBtn = document.getElementById('controls-btn');
const levelBtn = document.getElementById('level-btn');
const backBtn = document.getElementById('back-btn');

let board, current, next, score, lines, level, paused, gameOver, lastTime, dropAccum, dropInterval, animId;
let waiting = true, combo = 0, maxCombo = 0, pendingEntry = null, nameInput = null;
let gridColor = '#22222e';
let startLevel = 1;
let inputLockUntil = 0;

// ---- Récords (localStorage) ----
const RECORDS_KEY = 'tetris-records';
const MAX_RECORDS = 5;
const DEFAULT_NAME = 'Anónimo';
let records = { top: [], bestCombo: 0, maxLines: 0 };

function isValidEntry(e) {
  return !!e && typeof e.name === 'string' && Number.isFinite(e.score) && Number.isFinite(e.lines);
}

function loadRecords() {
  const empty = { top: [], bestCombo: 0, maxLines: 0 };
  try {
    const data = JSON.parse(localStorage.getItem(RECORDS_KEY));
    if (!data || typeof data !== 'object') return empty;
    return {
      top: Array.isArray(data.top) ? data.top.filter(isValidEntry).slice(0, MAX_RECORDS) : [],
      bestCombo: Number(data.bestCombo) || 0,
      maxLines: Number(data.maxLines) || 0,
    };
  } catch (e) {
    return empty;
  }
}

function saveRecords() {
  try { localStorage.setItem(RECORDS_KEY, JSON.stringify(records)); } catch (e) { /* almacenamiento no disponible */ }
}

// Posición (0 a 4) que ocuparía la puntuación en el top, o -1 si no entra.
// Con empate, el registro que ya existía conserva su lugar.
function insertionIndex(value) {
  const idx = records.top.findIndex(r => value > r.score);
  if (idx !== -1) return idx;
  return records.top.length < MAX_RECORDS ? records.top.length : -1;
}

function createBoard() {
  return Array.from({ length: ROWS }, () => new Array(COLS).fill(0));
}

function randomPiece() {
  const type = Math.floor(Math.random() * 7) + 1;
  const shape = PIECES[type].map(row => [...row]);
  return { type, shape, x: Math.floor(COLS / 2) - Math.floor(shape[0].length / 2), y: 0 };
}

function collide(shape, ox, oy) {
  for (let r = 0; r < shape.length; r++) {
    for (let c = 0; c < shape[r].length; c++) {
      if (!shape[r][c]) continue;
      const nx = ox + c;
      const ny = oy + r;
      if (nx < 0 || nx >= COLS || ny >= ROWS) return true;
      if (ny >= 0 && board[ny][nx]) return true;
    }
  }
  return false;
}

function rotateCW(shape) {
  const rows = shape.length, cols = shape[0].length;
  const result = Array.from({ length: cols }, () => new Array(rows).fill(0));
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++)
      result[c][rows - 1 - r] = shape[r][c];
  return result;
}

function tryRotate() {
  const rotated = rotateCW(current.shape);
  const kicks = [0, -1, 1, -2, 2];
  for (const kick of kicks) {
    if (!collide(rotated, current.x + kick, current.y)) {
      current.shape = rotated;
      current.x += kick;
      return;
    }
  }
}

function merge() {
  for (let r = 0; r < current.shape.length; r++)
    for (let c = 0; c < current.shape[r].length; c++)
      if (current.shape[r][c])
        board[current.y + r][current.x + c] = current.shape[r][c];
}

function clearLines() {
  let cleared = 0;
  for (let r = ROWS - 1; r >= 0; r--) {
    if (board[r].every(v => v !== 0)) {
      board.splice(r, 1);
      board.unshift(new Array(COLS).fill(0));
      cleared++;
      r++;
    }
  }
  if (cleared) {
    lines += cleared;
    score += (LINE_SCORES[cleared] || 0) * level;
    level = startLevel + Math.floor(lines / 10);
    dropInterval = speedFor(level);
    updateHUD();
  }
  return cleared;
}

function ghostY() {
  let gy = current.y;
  while (!collide(current.shape, current.x, gy + 1)) gy++;
  return gy;
}

function hardDrop() {
  const gy = ghostY();
  score += (gy - current.y) * 2;
  current.y = gy;
  lockPiece();
}

function softDrop() {
  if (!collide(current.shape, current.x, current.y + 1)) {
    current.y++;
    score += 1;
    updateHUD();
  } else {
    lockPiece();
  }
}

function lockPiece() {
  merge();
  const cleared = clearLines();
  // Combo: piezas consecutivas que completan al menos una línea.
  combo = cleared ? combo + 1 : 0;
  maxCombo = Math.max(maxCombo, combo);
  spawn();
}

function spawn() {
  current = next;
  next = randomPiece();
  if (collide(current.shape, current.x, current.y)) {
    endGame();
  }
  drawNext();
}

function updateHUD() {
  scoreEl.textContent = score.toLocaleString();
  linesEl.textContent = lines;
  levelEl.textContent = level;
}

function drawBlock(context, x, y, colorIndex, size, alpha) {
  if (!colorIndex) return;
  const color = COLORS[colorIndex];
  context.globalAlpha = alpha ?? 1;
  context.fillStyle = color;
  context.fillRect(x * size + 1, y * size + 1, size - 2, size - 2);
  // highlight
  context.fillStyle = 'rgba(255,255,255,0.12)';
  context.fillRect(x * size + 1, y * size + 1, size - 2, 4);
  context.globalAlpha = 1;
}

function drawGrid() {
  ctx.strokeStyle = gridColor;
  ctx.lineWidth = 0.5;
  for (let c = 1; c < COLS; c++) {
    ctx.beginPath();
    ctx.moveTo(c * BLOCK, 0);
    ctx.lineTo(c * BLOCK, ROWS * BLOCK);
    ctx.stroke();
  }
  for (let r = 1; r < ROWS; r++) {
    ctx.beginPath();
    ctx.moveTo(0, r * BLOCK);
    ctx.lineTo(COLS * BLOCK, r * BLOCK);
    ctx.stroke();
  }
}

function draw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  drawGrid();

  // board
  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c < COLS; c++)
      drawBlock(ctx, c, r, board[r][c], BLOCK);

  // ghost
  const gy = ghostY();
  for (let r = 0; r < current.shape.length; r++)
    for (let c = 0; c < current.shape[r].length; c++)
      if (current.shape[r][c])
        drawBlock(ctx, current.x + c, gy + r, current.shape[r][c], BLOCK, 0.2);

  // current piece
  for (let r = 0; r < current.shape.length; r++)
    for (let c = 0; c < current.shape[r].length; c++)
      drawBlock(ctx, current.x + c, current.y + r, current.shape[r][c], BLOCK);
}

function drawNext() {
  const NB = 30;
  nextCtx.clearRect(0, 0, nextCanvas.width, nextCanvas.height);
  const shape = next.shape;
  const offX = Math.floor((4 - shape[0].length) / 2);
  const offY = Math.floor((4 - shape.length) / 2);
  for (let r = 0; r < shape.length; r++)
    for (let c = 0; c < shape[r].length; c++)
      drawBlock(nextCtx, offX + c, offY + r, shape[r][c], NB);
}

// ---- Tabla de récords (UI) ----

function setText(el, text) {
  el.textContent = text;
  el.classList.toggle('hidden', !text);
}

function renderRecords(highlightIdx = -1) {
  const draft = nameInput ? nameInput.value : '';
  nameInput = null;

  const rows = records.top.slice();
  const pendingIdx = pendingEntry ? insertionIndex(pendingEntry.score) : -1;
  if (pendingIdx !== -1) rows.splice(pendingIdx, 0, { ...pendingEntry, pending: true });

  recordsBody.replaceChildren();
  for (let i = 0; i < MAX_RECORDS; i++) {
    const entry = rows[i];
    const tr = document.createElement('tr');
    if (entry && (entry.pending || i === highlightIdx)) tr.className = 'hl';

    const rank = document.createElement('td');
    rank.textContent = i + 1;

    const name = document.createElement('td');
    if (entry && entry.pending) {
      nameInput = document.createElement('input');
      nameInput.type = 'text';
      nameInput.maxLength = 12;
      nameInput.placeholder = 'Tu nombre';
      nameInput.setAttribute('aria-label', 'Tu nombre');
      nameInput.value = draft;
      nameInput.addEventListener('keydown', e => {
        if (e.key === 'Enter') { e.preventDefault(); handleSave(); }
      });
      name.appendChild(nameInput);
    } else {
      name.textContent = entry ? entry.name : '—';
    }

    const pts = document.createElement('td');
    pts.className = 'num';
    pts.textContent = entry ? entry.score.toLocaleString() : '—';

    const ln = document.createElement('td');
    ln.className = 'num';
    ln.textContent = entry ? entry.lines : '—';

    tr.append(rank, name, pts, ln);
    recordsBody.appendChild(tr);
  }

  recordsStats.textContent = `Mejor combo: ${records.bestCombo} · Líneas máx.: ${records.maxLines}`;
}

// Guarda la puntuación pendiente con el nombre dado. Devuelve la posición (0 a 4) o -1.
function saveRecord(rawName) {
  if (!pendingEntry) return -1;
  const idx = insertionIndex(pendingEntry.score);
  const entry = pendingEntry;
  pendingEntry = null;
  if (idx === -1) return -1;
  const name = (rawName || '').trim().slice(0, 12) || DEFAULT_NAME;
  records.top.splice(idx, 0, { name, score: entry.score, lines: entry.lines });
  records.top = records.top.slice(0, MAX_RECORDS);
  saveRecords();
  return idx;
}

function handleSave() {
  if (!pendingEntry || !nameInput) return;
  const idx = saveRecord(nameInput.value);
  if (idx === -1) return;
  setText(overlayRank, `Récord guardado en el puesto ${idx + 1}.`);
  saveBtn.classList.add('hidden');
  renderRecords(idx);
}

function resetRecords() {
  if (!confirm('¿Borrar todos los récords guardados? Esta acción no se puede deshacer.')) return;
  records = { top: [], bestCombo: 0, maxLines: 0 };
  saveRecords();
  renderRecords();
}

// ---- Menú y overlay ----

function updateLevelLabel() {
  levelBtn.textContent = `Nivel inicial: ${startLevel}`;
}

function cycleStartLevel() {
  startLevel = startLevel % MAX_START_LEVEL + 1;
  updateLevelLabel();
}

function setView(name) {
  menuMain.classList.toggle('hidden', name !== 'main');
  menuControls.classList.toggle('hidden', name !== 'controls');
}

// mode: 'start' (pantalla de inicio), 'over' (game over) o 'pause'.
// No enfoca ningún botón salvo en pausa: un Space del hard drop soltado
// podría activar "Reiniciar" al instante.
function showOverlay(mode) {
  const over = mode === 'over';
  const start = mode === 'start';
  const pause = mode === 'pause';
  setView('main');
  overlayTitle.textContent = start ? 'TETRIS' : over ? 'GAME OVER' : 'PAUSA';
  setText(overlayScore, over ? `Puntuación: ${score.toLocaleString()}` : '');
  setText(overlayRank, over && pendingEntry ? '¡Tu puntuación entra en el Top 5! Escribe tu nombre para guardarla.' : '');
  recordsSection.classList.toggle('hidden', pause);
  resetBtn.classList.toggle('hidden', pause);
  saveBtn.classList.toggle('hidden', !(over && pendingEntry));
  resumeBtn.classList.toggle('hidden', !pause);
  restartBtn.textContent = start ? 'Jugar' : 'Reiniciar';
  renderRecords();
  overlay.classList.remove('hidden');
  if (nameInput) nameInput.focus();
}

function hideOverlay() {
  if (overlay.contains(document.activeElement)) document.activeElement.blur();
  overlay.classList.add('hidden');
}

function showControls() {
  setView('controls');
  backBtn.focus();
}

function showMainMenu() {
  setView('main');
  controlsBtn.focus();
}

function endGame() {
  gameOver = true;
  cancelAnimationFrame(animId);
  records.bestCombo = Math.max(records.bestCombo, maxCombo);
  records.maxLines = Math.max(records.maxLines, lines);
  pendingEntry = score > 0 && insertionIndex(score) !== -1 ? { score, lines } : null;
  saveRecords();
  showOverlay('over');
}

function resumeGame() {
  if (!paused) return;
  paused = false;
  hideOverlay();
  inputLockUntil = performance.now() + RESUME_LOCK_MS;
  lastTime = performance.now();
  loop(lastTime);
}

function togglePause() {
  if (gameOver || waiting) return;
  if (paused) {
    resumeGame();
    return;
  }
  paused = true;
  cancelAnimationFrame(animId);
  showOverlay('pause');
  resumeBtn.focus();
}

// Con el overlay abierto (inicio, pausa o game over), las flechas navegan el menú y no mueven piezas.
function moveMenuFocus(dir) {
  const items = Array.from(overlay.querySelectorAll('.menu:not(.hidden) button:not(.hidden)'));
  if (!items.length) return;
  const i = items.indexOf(document.activeElement);
  const next = i === -1
    ? (dir > 0 ? 0 : items.length - 1)
    : (i + dir + items.length) % items.length;
  items[next].focus();
}

function handleOverlayKey(e) {
  switch (e.code) {
    case 'KeyP':
      if (!e.repeat) togglePause();
      break;
    case 'Escape':
      if (e.repeat) break;
      if (!menuControls.classList.contains('hidden')) showMainMenu();
      else togglePause();
      break;
    case 'ArrowUp':
      e.preventDefault();
      moveMenuFocus(-1);
      break;
    case 'ArrowDown':
      e.preventDefault();
      moveMenuFocus(1);
      break;
    case 'ArrowLeft':
    case 'ArrowRight':
      e.preventDefault();
      break;
    case 'Space':
      // Space solo activa un botón enfocado; en otro caso no hace hard drop ni scroll.
      if (!(e.target instanceof HTMLButtonElement)) e.preventDefault();
      break;
  }
}

function loop(ts) {
  if (gameOver) return;
  const dt = ts - lastTime;
  lastTime = ts;
  dropAccum += dt;
  if (dropAccum >= dropInterval) {
    dropAccum = 0;
    if (!collide(current.shape, current.x, current.y + 1)) {
      current.y++;
    } else {
      lockPiece();
      if (gameOver) return;
    }
  }
  draw();
  animId = requestAnimationFrame(loop);
}

// Reinicia el tablero y el estado de partida, sin arrancar el loop.
function resetGame() {
  board = createBoard();
  score = 0;
  lines = 0;
  level = startLevel;
  paused = false;
  gameOver = false;
  dropInterval = speedFor(level);
  dropAccum = 0;
  combo = 0;
  maxCombo = 0;
  pendingEntry = null;
  nameInput = null;
  inputLockUntil = 0;
  next = randomPiece();
  spawn();
  updateHUD();
}

// "Jugar" y "Reiniciar". Si hay una puntuación pendiente de guardar, se guarda antes.
function init() {
  if (pendingEntry) saveRecord(nameInput ? nameInput.value : '');
  resetGame();
  waiting = false;
  hideOverlay();
  cancelAnimationFrame(animId);
  lastTime = performance.now();
  animId = requestAnimationFrame(loop);
}

document.addEventListener('keydown', e => {
  if (e.target.tagName === 'INPUT') return; // permite escribir el nombre
  if (waiting || paused || gameOver) { handleOverlayKey(e); return; }
  if (e.code === 'KeyP' || e.code === 'Escape') {
    if (!e.repeat) togglePause();
    return;
  }
  if (performance.now() < inputLockUntil) return;
  switch (e.code) {
    case 'ArrowLeft':
      if (!collide(current.shape, current.x - 1, current.y)) current.x--;
      break;
    case 'ArrowRight':
      if (!collide(current.shape, current.x + 1, current.y)) current.x++;
      break;
    case 'ArrowDown':
      softDrop();
      break;
    case 'ArrowUp':
    case 'KeyX':
      tryRotate();
      break;
    case 'Space':
      e.preventDefault();
      hardDrop();
      break;
  }
  updateHUD();
});

// save = false al cargar, para seguir el tema del sistema mientras no haya elección guardada.
function applyTheme(theme, save = true) {
  document.documentElement.dataset.theme = theme;
  if (save) {
    try { localStorage.setItem('tetris-theme', theme); } catch (e) { /* almacenamiento no disponible */ }
  }
  themeBtn.textContent = theme === 'dark' ? 'Modo claro' : 'Modo oscuro';
  gridColor = getComputedStyle(document.documentElement).getPropertyValue('--grid').trim();
  // El loop no corre en pausa ni tras game over, así que se repinta aquí.
  if (current) draw();
}

restartBtn.addEventListener('click', () => {
  init();
  restartBtn.blur();
});

resumeBtn.addEventListener('click', resumeGame);
controlsBtn.addEventListener('click', showControls);
backBtn.addEventListener('click', showMainMenu);
levelBtn.addEventListener('click', cycleStartLevel);

saveBtn.addEventListener('click', () => {
  handleSave();
  saveBtn.blur();
});

resetBtn.addEventListener('click', () => {
  resetRecords();
  resetBtn.blur();
});

themeBtn.addEventListener('click', () => {
  applyTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');
  themeBtn.blur(); // evita que Space vuelva a activar el botón además del hard drop
});

applyTheme(document.documentElement.dataset.theme || 'dark', false);
records = loadRecords();
updateLevelLabel();
resetGame();
draw();
showOverlay('start');
