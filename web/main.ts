import gameScript from '../gen/game.js?raw';
import { FONT_BITMAPS } from '../sdk/font.js';
import { buttonName, color as validColor, coordinate, spriteName, textBytes, toneArguments } from '../sdk/runtime-validation.js';
import './style.css';

const WIDTH = 256;
const HEIGHT = 192;
const keyMap: Record<string, NDSButton> = {
  ArrowUp: 'up', KeyW: 'up', ArrowDown: 'down', KeyS: 'down',
  ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right',
  KeyZ: 'a', Space: 'a', KeyX: 'b', KeyC: 'x', KeyV: 'y',
  KeyQ: 'l', KeyE: 'r', Enter: 'start', ShiftLeft: 'select', ShiftRight: 'select',
};

function rgb15Color(color: number): string {
  validColor(color);
  const channels = [16, 8, 0].map((shift) => {
    const value = ((color >>> shift) & 255) >>> 3;
    return (value << 3) | (value >>> 2);
  });
  return `rgb(${channels.join(',')})`;
}

function createScreen(canvas: HTMLCanvasElement): NDSScreen {
  const context = canvas.getContext('2d', { alpha: false });
  if (!context) throw new Error('Canvas 2D rendering is unavailable.');
  context.imageSmoothingEnabled = false;
  const paint = (color: number) => { context.fillStyle = rgb15Color(color); };
  return {
    clear(color) { paint(color); context.fillRect(0, 0, WIDTH, HEIGHT); },
    rect(x, y, width, height, color) {
      const px = coordinate(x), py = coordinate(y);
      const w = coordinate(width), h = coordinate(height);
      paint(color);
      if (w <= 0 || h <= 0) return;
      context.fillRect(px, py, w, h);
    },
    text(value, x, y, color) {
      const bytes = textBytes(value);
      const originX = coordinate(x);
      let cursorY = coordinate(y);
      paint(color);
      let cursorX = originX;
      for (let code of bytes) {
        if (code === 10) { cursorX = originX; cursorY += 7; continue; }
        if (code >= 97 && code <= 122) code -= 32;
        const bits = FONT_BITMAPS[code - 32];
        for (let bit = 0; bit < 15; bit++) {
          if (bits & (1 << bit)) context.fillRect(cursorX + bit % 3, cursorY + Math.floor(bit / 3), 1, 1);
        }
        cursorX += 4;
      }
    },
    sprite(name, x, y) {
      spriteName(name);
      const originX = coordinate(x);
      const originY = coordinate(y);
      for (let row = 0; row < 16; row++) {
        for (let col = 0; col < 16; col++) {
          const distance = (col - 7.5) ** 2 + (row - 7.5) ** 2;
          if (distance > 56.25) continue;
          let color = distance > 42.25 ? 0x202020 : 0xD6008F;
          if (distance <= 42.25) {
            if (row >= 11) color = 0xA80070;
            if (col >= 3 && col <= 6 && row >= 3 && row <= 5) color = 0xFFC2E9;
            if ((col === 5 || col === 10) && (row === 7 || row === 8)) color = 0x202020;
          }
          paint(color);
          context.fillRect(originX + col, originY + row, 1, 1);
        }
      }
    },
  };
}

const topCanvas = document.querySelector<HTMLCanvasElement>('#top-screen')!;
const bottomCanvas = document.querySelector<HTMLCanvasElement>('#bottom-screen')!;
const soundButton = document.querySelector<HTMLButtonElement>('#sound-toggle')!;
const sources = new Map<string, NDSButton>();
const held = new Set<NDSButton>();
const frameHeld = new Set<NDSButton>();
const pendingHits = new Set<NDSButton>();
const pendingReleases = new Set<NDSButton>();
const hits = new Set<NDSButton>();
const releases = new Set<NDSButton>();
const touch = { x: 0, y: 0, down: false, pressed: false, released: false };
const pointerTouch = { x: 0, y: 0, down: false };
let touchPressed = false;
let touchReleased = false;
let touchPointer: number | null = null;
let audioContext: AudioContext | null = null;
let soundEnabled = false;
let activeTone: OscillatorNode | null = null;

function setSource(source: string, button: NDSButton | null): void {
  if (button) sources.set(source, button);
  else sources.delete(source);
  const previous = new Set(held);
  held.clear();
  for (const active of sources.values()) held.add(active);
  for (const active of held) if (!previous.has(active)) pendingHits.add(active);
  for (const active of previous) if (!held.has(active)) pendingReleases.add(active);
}

async function enableSound(): Promise<void> {
  audioContext ??= new AudioContext();
  await audioContext.resume();
  soundEnabled = true;
  soundButton.textContent = 'Sound on';
  soundButton.setAttribute('aria-pressed', 'true');
}

const runtime: NDSRuntime = {
  width: 256,
  height: 192,
  frame: 0,
  input: {
    down: (button) => frameHeld.has(buttonName(button)),
    hit: (button) => hits.has(buttonName(button)),
    up: (button) => releases.has(buttonName(button)),
    dx: () => Number(frameHeld.has('right')) - Number(frameHeld.has('left')),
    dy: () => Number(frameHeld.has('down')) - Number(frameHeld.has('up')),
  },
  touch,
  top: createScreen(topCanvas),
  bottom: createScreen(bottomCanvas),
  stats: { heapBytes: 0, heapPeakBytes: 0, updateMicros: 0, drawMicros: 0 },
  audio: {
    tone(frequency, frames, volume = 0.3) {
      [frequency, frames, volume] = toneArguments(frequency, frames, volume);
      if (!soundEnabled || !audioContext) return;
      const oscillator = audioContext.createOscillator();
      const gain = audioContext.createGain();
      const now = audioContext.currentTime;
      const end = now + frames / 60;
      activeTone?.stop(now);
      activeTone = oscillator;
      oscillator.type = 'square';
      oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(volume * 0.12, now);
      gain.gain.setTargetAtTime(0, Math.max(now, end - 0.01), 0.003);
      oscillator.connect(gain).connect(audioContext.destination);
      oscillator.start(now);
      oscillator.stop(end);
      oscillator.onended = () => {
        oscillator.disconnect();
        gain.disconnect();
        if (activeTone === oscillator) activeTone = null;
      };
    },
  },
};
const mutableRuntime = runtime as { frame: number; stats: { updateMicros: number; drawMicros: number } };
(globalThis as typeof globalThis & { nds: NDSRuntime }).nds = runtime;

document.addEventListener('keydown', (event) => {
  const button = keyMap[event.code];
  if (!button) return;
  event.preventDefault();
  setSource(event.code, button);
});
document.addEventListener('keyup', (event) => {
  if (!keyMap[event.code]) return;
  event.preventDefault();
  setSource(event.code, null);
});
window.addEventListener('blur', () => {
  for (const source of Array.from(sources.keys())) setSource(source, null);
  if (pointerTouch.down) touchReleased = true;
  pointerTouch.down = false;
  touchPointer = null;
});

function updateTouchPosition(event: PointerEvent): void {
  const bounds = bottomCanvas.getBoundingClientRect();
  pointerTouch.x = Math.max(0, Math.min(WIDTH - 1, Math.round((event.clientX - bounds.left) / bounds.width * WIDTH)));
  pointerTouch.y = Math.max(0, Math.min(HEIGHT - 1, Math.round((event.clientY - bounds.top) / bounds.height * HEIGHT)));
}
bottomCanvas.addEventListener('pointerdown', (event) => {
  if (touchPointer !== null || event.button !== 0) return;
  event.preventDefault();
  touchPointer = event.pointerId;
  bottomCanvas.setPointerCapture(event.pointerId);
  updateTouchPosition(event);
  touchPressed = true;
  pointerTouch.down = true;
});
bottomCanvas.addEventListener('pointermove', (event) => {
  if (event.pointerId === touchPointer) updateTouchPosition(event);
});
function endTouch(event: PointerEvent): void {
  if (event.pointerId !== touchPointer) return;
  pointerTouch.down = false;
  touchReleased = true;
  touchPointer = null;
}
bottomCanvas.addEventListener('pointerup', endTouch);
bottomCanvas.addEventListener('pointercancel', endTouch);
bottomCanvas.addEventListener('lostpointercapture', endTouch);

for (const button of document.querySelectorAll<HTMLButtonElement>('[data-button]')) {
  button.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    button.setPointerCapture(event.pointerId);
    setSource(`pointer-${event.pointerId}`, button.dataset.button as NDSButton);
  });
  button.addEventListener('pointerup', (event) => setSource(`pointer-${event.pointerId}`, null));
  button.addEventListener('pointercancel', (event) => setSource(`pointer-${event.pointerId}`, null));
  button.addEventListener('lostpointercapture', (event) => setSource(`pointer-${event.pointerId}`, null));
}
soundButton.addEventListener('click', () => {
  if (soundEnabled) {
    soundEnabled = false;
    activeTone?.stop();
    soundButton.textContent = 'Sound off';
    soundButton.setAttribute('aria-pressed', 'false');
  } else {
    enableSound().catch(showError);
  }
});

let gameInstance: NDSGame;
let stopped = false;
function showError(error: unknown): void {
  const panel = document.querySelector<HTMLElement>('#runtime-error')!;
  panel.hidden = false;
  panel.textContent = error instanceof Error ? error.message : String(error);
}
function startGame(): void {
  activeTone?.stop();
  gameInstance = new Function('nds', `${gameScript}\nreturn game;`)(runtime) as NDSGame;
  mutableRuntime.frame = 0;
  hits.clear();
  frameHeld.clear();
  releases.clear();
  pendingHits.clear();
  pendingReleases.clear();
  touch.pressed = false;
  touch.released = false;
  touch.x = 0;
  touch.y = 0;
  touch.down = false;
  pointerTouch.x = 0;
  pointerTouch.y = 0;
  pointerTouch.down = false;
  touchPointer = null;
  touchPressed = false;
  touchReleased = false;
  stopped = false;
  document.querySelector<HTMLElement>('#runtime-error')!.hidden = true;
  gameInstance.init?.();
  gameInstance.draw();
}
document.querySelector<HTMLButtonElement>('#restart')!.addEventListener('click', () => {
  try { startGame(); } catch (error) { stopped = true; showError(error); }
});

const metricFrame = document.querySelector<HTMLElement>('#metric-frame')!;
const metricUpdate = document.querySelector<HTMLElement>('#metric-update')!;
const metricDraw = document.querySelector<HTMLElement>('#metric-draw')!;
function tick(): void {
  frameHeld.clear();
  for (const button of held) frameHeld.add(button);
  hits.clear();
  releases.clear();
  for (const button of pendingHits) hits.add(button);
  for (const button of pendingReleases) releases.add(button);
  pendingHits.clear();
  pendingReleases.clear();
  touch.x = pointerTouch.x;
  touch.y = pointerTouch.y;
  touch.down = pointerTouch.down;
  touch.pressed = touchPressed;
  touch.released = touchReleased;
  touchPressed = false;
  touchReleased = false;
  const updateStart = performance.now();
  gameInstance.update();
  const drawStart = performance.now();
  const updateMicros = Math.round((drawStart - updateStart) * 1000);
  gameInstance.draw();
  const drawMicros = Math.round((performance.now() - drawStart) * 1000);
  mutableRuntime.stats.updateMicros = updateMicros;
  mutableRuntime.stats.drawMicros = drawMicros;
  mutableRuntime.frame += 1;
  if (runtime.frame % 15 === 0) {
    metricFrame.textContent = runtime.frame.toLocaleString();
    metricUpdate.textContent = updateMicros.toLocaleString();
    metricDraw.textContent = drawMicros.toLocaleString();
  }
}

let lastTime = performance.now();
let accumulator = 0;
function animate(now: number): void {
  accumulator += Math.min(now - lastTime, 100);
  lastTime = now;
  try {
    while (accumulator >= 1000 / 60) {
      if (!stopped) tick();
      accumulator -= 1000 / 60;
    }
  } catch (error) { stopped = true; showError(error); }
  requestAnimationFrame(animate);
}
try { startGame(); } catch (error) { stopped = true; showError(error); }
requestAnimationFrame(animate);
