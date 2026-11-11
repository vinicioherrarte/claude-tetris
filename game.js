'use strict';

const COLS = 10;
const ROWS = 20;
const BLOCK = 30;

// Cada skin define su paleta (índice 1 = I, 2 = O, 3 = T, 4 = S, 5 = Z, 6 = J, 7 = L)
// y la función que dibuja una celda. drawCell recibe coordenadas en píxeles.
const SKINS = {
  retro: {
    label: 'Retro',
    colors: [null, '#4dd0e1', '#ffd54f', '#ba68c8', '#81c784', '#e57373', '#7986cb', '#ffb74d'],
    drawCell: drawRetroCell,
  },
  neon: {
    label: 'Neón',
    colors: [null, '#00f0ff', '#fff200', '#d400ff', '#39ff14', '#ff2a6d', '#3d7bff', '#ff8c00'],
    drawCell: drawNeonCell,
  },
  pastel: {
    label: 'Pastel',
    colors: [null, '#a8e6ef', '#fff1a8', '#d7b8ef', '#bfeec4', '#f7b2b2', '#b9c3f2', '#ffd1a3'],
    drawCell: drawPastelCell,
  },
  pixel: {
    label: 'Pixel art',
    colors: [null, '#00c8f8', '#f8d000', '#b040e0', '#48d048', '#f04848', '#4060f0', '#f89030'],
    drawCell: drawPixelCell,
  },
};

const SKIN_KEY = 'tetris-skin';
let activeSkin = SKINS.retro;
let COLORS = activeSkin.colors;

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
const restartBtn = document.getElementById('restart-btn');
const themeBtn = document.getElementById('theme-btn');
const skinSelect = document.getElementById('skin-select');

let board, current, next, score, lines, level, paused, gameOver, lastTime, dropAccum, dropInterval, animId;
let gridColor = '#22222e';

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
    level = Math.floor(lines / 10) + 1;
    dropInterval = Math.max(100, 1000 - (level - 1) * 90);
    updateHUD();
  }
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
  clearLines();
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
  context.globalAlpha = alpha ?? 1;
  activeSkin.drawCell(context, x * size, y * size, size, COLORS[colorIndex]);
  context.globalAlpha = 1;
}

// ---- Funciones de dibujo por skin ----

// Retro: bloque cuadrado de color plano con franja clara superior.
function drawRetroCell(ctx, px, py, s, color) {
  ctx.fillStyle = color;
  ctx.fillRect(px + 1, py + 1, s - 2, s - 2);
  ctx.fillStyle = 'rgba(255,255,255,0.12)';
  ctx.fillRect(px + 1, py + 1, s - 2, 4);
}

// Neon: relleno con shadowBlur del mismo color y núcleo claro.
function drawNeonCell(ctx, px, py, s, color) {
  ctx.shadowColor = color;
  ctx.shadowBlur = 12;
  ctx.fillStyle = color;
  ctx.fillRect(px + 3, py + 3, s - 6, s - 6);
  ctx.shadowBlur = 0;
  ctx.fillStyle = 'rgba(255,255,255,0.45)';
  ctx.fillRect(px + 8, py + 8, s - 16, s - 16);
}

// Pastel: rectángulo redondeado con brillo superior y borde suave.
function roundRectPath(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function drawPastelCell(ctx, px, py, s, color) {
  const x = px + 2, y = py + 2, w = s - 4, r = s * 0.28;
  roundRectPath(ctx, x, y, w, w, r);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.10)';
  ctx.lineWidth = 1;
  ctx.stroke();
  roundRectPath(ctx, x + 3, y + 3, w - 6, (w - 6) * 0.35, r * 0.6);
  ctx.fillStyle = 'rgba(255,255,255,0.45)';
  ctx.fill();
}

// Pixel art: bisel de 6x6 píxeles (L = luz, D = sombra, . = color base) y dos puntos de textura.
const PIXEL_PATTERN = [
  'LLLLLD',
  'L....D',
  'L.L..D',
  'L..D.D',
  'L....D',
  'DDDDDD',
];

function drawPixelCell(ctx, px, py, s, color) {
  const inner = s - 2;
  const p = Math.floor(inner / 6);
  const off = Math.floor((inner - p * 6) / 2);
  ctx.fillStyle = color;
  ctx.fillRect(px + 1, py + 1, inner, inner);
  for (let r = 0; r < 6; r++) {
    for (let c = 0; c < 6; c++) {
      const ch = PIXEL_PATTERN[r][c];
      if (ch === '.') continue;
      ctx.fillStyle = ch === 'L' ? 'rgba(255,255,255,0.45)' : 'rgba(0,0,0,0.3)';
      ctx.fillRect(px + 1 + off + c * p, py + 1 + off + r * p, p, p);
    }
  }
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

function endGame() {
  gameOver = true;
  cancelAnimationFrame(animId);
  overlayTitle.textContent = 'GAME OVER';
  overlayScore.textContent = `Puntuación: ${score.toLocaleString()}`;
  overlay.classList.remove('hidden');
}

function togglePause() {
  if (gameOver) return;
  paused = !paused;
  if (!paused) {
    lastTime = performance.now();
    loop(lastTime);
  } else {
    cancelAnimationFrame(animId);
    overlayTitle.textContent = 'PAUSA';
    overlayScore.textContent = '';
    overlay.classList.remove('hidden');
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

function init() {
  board = createBoard();
  score = 0;
  lines = 0;
  level = 1;
  paused = false;
  gameOver = false;
  dropInterval = 1000;
  dropAccum = 0;
  lastTime = performance.now();
  next = randomPiece();
  spawn();
  updateHUD();
  overlay.classList.add('hidden');
  cancelAnimationFrame(animId);
  animId = requestAnimationFrame(loop);
}

document.addEventListener('keydown', e => {
  if (e.code === 'KeyP') { togglePause(); return; }
  if (paused || gameOver) return;
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

function refreshCanvas() {
  gridColor = getComputedStyle(document.documentElement).getPropertyValue('--grid').trim();
  // El loop no corre en pausa ni tras game over, así que se repinta aquí.
  if (current) draw();
  if (next) drawNext();
}

// save = false al cargar, para seguir el tema del sistema mientras no haya elección guardada.
function applyTheme(theme, save = true) {
  document.documentElement.dataset.theme = theme;
  if (save) {
    try { localStorage.setItem('tetris-theme', theme); } catch (e) { /* almacenamiento no disponible */ }
  }
  themeBtn.textContent = theme === 'dark' ? 'Modo claro' : 'Modo oscuro';
  refreshCanvas();
}

function applySkin(id, save = true) {
  const skinId = SKINS[id] ? id : 'retro';
  activeSkin = SKINS[skinId];
  COLORS = activeSkin.colors;
  document.documentElement.dataset.skin = skinId;
  if (save) {
    try { localStorage.setItem(SKIN_KEY, skinId); } catch (e) { /* almacenamiento no disponible */ }
  }
  skinSelect.value = skinId;
  refreshCanvas();
}

restartBtn.addEventListener('click', init);

themeBtn.addEventListener('click', () => {
  applyTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');
  themeBtn.blur(); // evita que Space vuelva a activar el botón además del hard drop
});

skinSelect.addEventListener('change', () => {
  applySkin(skinSelect.value);
  skinSelect.blur(); // evita que las teclas de juego cambien también la opción del selector
});

// Las flechas y Space siguen llegando al juego; aquí solo se evita que cambien la opción.
skinSelect.addEventListener('keydown', e => {
  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
});

applyTheme(document.documentElement.dataset.theme || 'dark', false);
applySkin(document.documentElement.dataset.skin || 'retro', false);
init();
