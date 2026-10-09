import './fonts.css';
import './style.css';
import cartridges from 'virtual:cartridges';
import { API_GROUPS } from './api.js';
import { CARTRIDGES, type CartridgeInfo } from './cartridges.js';
import { BrowserConsole, type Program } from './console.js';
import { Device, fitDevice } from './device.js';
import { Editor } from './editor.js';
import { insertSplash, safetyNotice } from './firmware.js';
import { icon, type IconName } from './icons.js';
import { pixelText } from './pixel-font.js';

const $ = <T extends HTMLElement = HTMLElement>(selector: string) => document.querySelector<T>(selector)!;
const number = (value: number) => value.toLocaleString('en-US');
const bytesOf = (text: string) => new TextEncoder().encode(text).length;
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

for (const element of document.querySelectorAll<HTMLElement>('[data-pixel-text]')) {
  element.innerHTML = pixelText(element.dataset.pixelText!);
}
for (const element of document.querySelectorAll<HTMLElement>('[data-icon]')) {
  element.insertAdjacentHTML('afterbegin', icon(element.dataset.icon as IconName));
}

/* ---------- Console ---------- */
const ds = $('#console');
const host = $('#device-host');
const errorBox = $<HTMLParagraphElement>('#console-error');
const nowPlaying = $('#now-playing');
const miniTop = $<HTMLCanvasElement>('#mini-top');
const miniBottom = $<HTMLCanvasElement>('#mini-bottom');
const screens = { top: $<HTMLCanvasElement>('#screen-top'), bottom: $<HTMLCanvasElement>('#screen-bottom') };

const machine = new BrowserConsole(screens, {
  stats(stats) {
    $('#stat-rate').textContent = String(stats.ticksPerSecond);
    $('#stat-quads').textContent = number(stats.quads);
    $('#stat-draw').textContent = number(stats.drawMicros);
  },
  error(message) {
    errorBox.textContent = message;
    errorBox.hidden = false;
    ds.dataset.power = 'error';
    editor.runtimeError(message);
  },
  booted() {
    errorBox.hidden = true;
    if (ds.dataset.lid === 'open') ds.dataset.power = 'on';
  },
});

const hint = $('#keyboard-hint');
const device = new Device(ds, machine, (active) => {
  host.classList.toggle('ds-host-keyboard', active);
  hint.textContent = active ? 'Keyboard on: arrows, Z, X, C, V, Q, E, Enter and Shift.' : 'Click the console to play with your keyboard.';
});
const mini = $('#mini');
device.addTouchSurface(miniBottom, mini);
device.addKeyboardTarget(mini, (active) => mini.classList.toggle('mini-keyboard', active));

const fit = () => fitDevice(host, ds, $('.hero-grid'));
fit();
window.addEventListener('resize', fit);
new ResizeObserver(fit).observe($('.hero-grid'));

let lidOpen = false;
let deviceVisible = true;
let miniVisible = false;
const updatePause = () => machine.setPaused(!lidOpen || document.hidden || (!deviceVisible && !miniVisible));
new IntersectionObserver(([entry]) => {
  deviceVisible = entry.isIntersecting;
  updatePause();
}, { threshold: 0.02 }).observe(ds);
new IntersectionObserver(([entry]) => {
  miniVisible = entry.isIntersecting;
  updatePause();
}, { threshold: 0.02 }).observe(mini);
document.addEventListener('visibilitychange', updatePause);

const miniTopContext = miniTop.getContext('2d')!;
const miniBottomContext = miniBottom.getContext('2d')!;
function loop(now: number): void {
  device.frame();
  machine.frame(now);
  if (miniVisible) {
    miniTopContext.drawImage(screens.top, 0, 0);
    miniBottomContext.drawImage(screens.bottom, 0, 0);
  }
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

/* ---------- Cartridges ---------- */
const compiledById = new Map(cartridges.map((cartridge) => [cartridge.id, cartridge]));
const programOf = (info: CartridgeInfo): Program => {
  const compiled = compiledById.get(info.id)!;
  return { script: compiled.script, boot: compiled.boot };
};
let current = CARTRIDGES[0];
let powered = false;

const editor = new Editor({
  run(program, edited) {
    if (!lidOpen) openLid(false);
    powered = true;
    machine.insert(program);
    nowPlaying.textContent = edited ? `${current.title}, edited` : current.title;
  },
  compiled(bytes) {
    $('#flow-bytes').textContent = number(bytes);
  },
});

const rack = $('#rack');
const cards = new Map<string, HTMLButtonElement>();
for (const info of CARTRIDGES) {
  const item = document.createElement('li');
  item.innerHTML = `<button class="cart" type="button" aria-pressed="false" style="--cart-color: ${info.color}">
      <span class="cart-shell">
        <svg class="cart-outline" viewBox="0 0 66 70" preserveAspectRatio="none" aria-hidden="true">
          <path class="cart-body" d="M5 1H51L65 15V65Q65 69 61 69H5Q1 69 1 65V5Q1 1 5 1Z"/>
          <path class="cart-grip" d="M9 5V10M13 5V10M17 5V10M21 5V10M25 5V10M29 5V10M33 5V10M37 5V10"/>
        </svg>
        <canvas class="cart-label" width="256" height="192" aria-hidden="true"></canvas>
      </span>
      <span class="cart-title">${info.title}<span class="cart-state">Insert</span></span>
    </button>`;
  const card = item.querySelector('button')!;
  card.setAttribute('aria-label', `${info.title}. ${info.blurb}`);
  card.addEventListener('click', () => insert(info, card));
  cards.set(info.id, card);
  rack.append(item);
  paintLabel(info, card.querySelector('canvas')!);
}

/** Label art is the game itself: a few seconds of play, rendered off screen. */
function paintLabel(info: CartridgeInfo, canvas: HTMLCanvasElement): void {
  const preview = new BrowserConsole(null);
  preview.insert(programOf(info));
  preview.fastForward(info.id === 'hinge-breakout' ? 200 : 90);
  const pixels = new Uint8ClampedArray(preview.top.pixels.buffer.slice(0));
  canvas.getContext('2d')!.putImageData(new ImageData(pixels, 256, 192), 0, 0);
}

function select(info: CartridgeInfo): void {
  current = info;
  for (const [id, card] of cards) {
    const active = id === info.id;
    card.setAttribute('aria-pressed', String(active));
    card.querySelector('.cart-state')!.textContent = active ? 'In the console' : 'Insert';
  }
  nowPlaying.textContent = info.title;
  $('#controls').innerHTML = info.controls.map((control) =>
    `<li><b>${control.input}</b>${control.keys ? `<kbd>${control.keys}</kbd>` : ''}<span>${control.action}</span></li>`).join('');
  const compiled = compiledById.get(info.id)!;
  editor.load({ info, source: compiled.source, script: compiled.script, boot: compiled.boot });
  $('#flow-bytes').textContent = number(bytesOf(compiled.script));
  for (const line of document.querySelectorAll('[data-example-path]')) line.textContent = `examples/${info.id}/main.ts`;
}

function insert(info: CartridgeInfo, card?: HTMLElement): void {
  select(info);
  if (card) flyToConsole(card);
  if (!lidOpen) openLid(false);
  powered = true;
  machine.insert(programOf(info), insertSplash(info.title));
}

function flyToConsole(card: HTMLElement): void {
  const label = card.querySelector('canvas')!;
  if (reducedMotion.matches || !ds.getBoundingClientRect().height) return;
  const from = card.querySelector('.cart-shell')!.getBoundingClientRect();
  const to = $('.ds-hinge').getBoundingClientRect();
  const flight = document.createElement('canvas');
  flight.width = 256;
  flight.height = 192;
  flight.className = 'cart-flight';
  flight.getContext('2d')!.drawImage(label, 0, 0);
  Object.assign(flight.style, { left: `${from.left}px`, top: `${from.top}px`, width: `${from.width}px`, height: `${from.width * 0.75}px` });
  document.body.append(flight);
  const dx = to.left + to.width / 2 - (from.left + from.width / 2);
  const dy = to.top + to.height / 2 - (from.top + from.width * 0.375);
  flight.animate([
    { transform: 'translate(0, 0) scale(1) rotate(0deg)', opacity: 1 },
    { transform: `translate(${dx * 0.6}px, ${dy * 0.6 - 40}px) scale(0.8) rotate(-6deg)`, opacity: 1, offset: 0.6 },
    { transform: `translate(${dx}px, ${dy}px) scale(0.25) rotate(0deg)`, opacity: 0 },
  ], { duration: 520, easing: 'cubic-bezier(.3, .7, .2, 1)' }).finished.then(() => flight.remove(), () => flight.remove());
}

/* ---------- Lid and power ---------- */
function openLid(withNotice: boolean): void {
  lidOpen = true;
  ds.dataset.lid = 'open';
  $('#lid-toggle').textContent = 'Close lid';
  $('#lid-toggle').setAttribute('aria-pressed', 'false');
  host.classList.add('ds-host-on');
  ds.dataset.power = errorBox.hidden ? 'on' : 'error';
  updatePause();
  if (withNotice) {
    powered = true;
    machine.insert(programOf(current), safetyNotice);
  }
}

function closeLid(): void {
  lidOpen = false;
  ds.dataset.lid = 'closed';
  ds.dataset.power = 'sleep';
  $('#lid-toggle').textContent = 'Open lid';
  $('#lid-toggle').setAttribute('aria-pressed', 'true');
  updatePause();
}

$('#lid-toggle').addEventListener('click', () => {
  if (lidOpen) closeLid();
  else openLid(!powered);
});
$('.ds-hinge').addEventListener('click', () => (lidOpen ? closeLid() : openLid(!powered)));
$('#reset-console').addEventListener('click', () => {
  if (!lidOpen) openLid(false);
  powered = true;
  machine.restart();
});

const soundButton = $<HTMLButtonElement>('#sound-toggle');
soundButton.addEventListener('click', async () => {
  if (machine.soundEnabled) {
    machine.disableSound();
  } else {
    try {
      await machine.enableSound();
    } catch {
      soundButton.textContent = 'Sound unavailable';
      return;
    }
  }
  const on = machine.soundEnabled;
  soundButton.setAttribute('aria-pressed', String(on));
  soundButton.innerHTML = `${icon(on ? 'volume' : 'volumeX')}${on ? 'Sound on' : 'Sound off'}`;
  ds.dataset.sound = on ? 'on' : 'off';
});

select(current);
// The lid opens a moment after load, then the console powers on.
window.setTimeout(() => {
  openLid(true);
}, reducedMotion.matches ? 0 : 450);

/* ---------- Editor warm-up ---------- */
new IntersectionObserver(([entry], observer) => {
  if (!entry.isIntersecting) return;
  editor.prefetch();
  observer.disconnect();
}, { rootMargin: '400px 0px' }).observe($('#editor'));

/* ---------- API ---------- */
const menu = $('#api-menu');
const pane = $('#api-pane');
function showGroup(id: string, focus = false): void {
  const group = API_GROUPS.find((candidate) => candidate.id === id) ?? API_GROUPS[0];
  for (const tab of menu.querySelectorAll<HTMLButtonElement>('button')) {
    const selected = tab.dataset.group === group.id;
    tab.setAttribute('aria-selected', String(selected));
    tab.tabIndex = selected ? 0 : -1;
    if (selected && focus) tab.focus();
  }
  pane.setAttribute('aria-labelledby', `api-tab-${group.id}`);
  pane.innerHTML = `<h3>${group.title}</h3><p>${group.intro}</p>
    <dl class="api-list">${group.items.map(([signature, description]) =>
      `<div><dt>${escapeHtml(signature)}</dt><dd>${description}</dd></div>`).join('')}</dl>
    ${group.tags ? `<div class="api-tags" aria-label="Button names">${group.tags.map((tag) => `<code>'${tag}'</code>`).join('')}</div>` : ''}
    ${group.note ? `<p class="api-note">${group.note}</p>` : ''}`;
}
menu.innerHTML = API_GROUPS.map((group) =>
  `<button type="button" role="tab" id="api-tab-${group.id}" aria-controls="api-pane" data-group="${group.id}">${group.title}<small>${group.path}</small></button>`).join('');
menu.addEventListener('click', (event) => {
  const tab = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-group]');
  if (tab) showGroup(tab.dataset.group!);
});
menu.addEventListener('keydown', (event) => {
  const keys = ['ArrowDown', 'ArrowRight', 'ArrowUp', 'ArrowLeft'];
  if (!keys.includes(event.key)) return;
  event.preventDefault();
  const tabs = [...menu.querySelectorAll<HTMLButtonElement>('button')];
  const index = tabs.findIndex((tab) => tab.getAttribute('aria-selected') === 'true');
  const step = event.key === 'ArrowDown' || event.key === 'ArrowRight' ? 1 : tabs.length - 1;
  showGroup(tabs[(index + step) % tabs.length].dataset.group!, true);
});
showGroup('screens');

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/* ---------- Measurements ---------- */
$('.tick-strip').innerHTML = '<i class="lit"></i>'.repeat(60);
$('.heap-map').innerHTML = '<i class="used"></i>'.repeat(82) + '<i></i>'.repeat(512 - 82);

/* ---------- Quick start ---------- */
const lines = [...document.querySelectorAll<HTMLElement>('#terminal-body .line')];
for (const step of document.querySelectorAll<HTMLElement>('#steps li')) {
  const [first, last = first] = step.dataset.lines!.split('-').map(Number);
  const mark = (on: boolean) => {
    step.classList.toggle('active', on);
    lines.forEach((line, index) => line.classList.toggle('active', on && index >= first && index <= last));
  };
  step.tabIndex = 0;
  step.addEventListener('pointerenter', () => mark(true));
  step.addEventListener('pointerleave', () => mark(false));
  step.addEventListener('focus', () => mark(true));
  step.addEventListener('blur', () => mark(false));
}
const copyButton = $<HTMLButtonElement>('#copy-commands');
copyButton.addEventListener('click', async () => {
  const text = lines.map((line) => line.textContent!.replace(/^\$\s*/, '')).join('\n');
  try {
    await navigator.clipboard.writeText(text);
    copyButton.innerHTML = `${icon('check')}Copied`;
  } catch {
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents($('#terminal-body'));
    selection?.removeAllRanges();
    selection?.addRange(range);
    copyButton.innerHTML = `${icon('copy')}Selected, press Ctrl+C`;
  }
  window.setTimeout(() => { copyButton.innerHTML = `${icon('copy')}Copy`; }, 2400);
});
