let socket;
let lastSentValue = '';
let sensitivity = 1.0;

// ── MONETIZATION LOGIC ──────────────────────────────────────
const TRIAL_DURATION = 24 * 60 * 60 * 1000; // 24 Hours
const landing = document.getElementById('landing-screen');
const appContainer = document.getElementById('app-container');
const statusBox = document.getElementById('status-box');
const trialBtn = document.getElementById('start-trial-btn');
const buyBtn = document.getElementById('buy-now-btn');

function initHub() {
  const isPaid = localStorage.getItem('hub-paid') === 'true';
  const trialStart = localStorage.getItem('hub-trial-start');
  const now = Date.now();

  if (isPaid) {
    launchApp();
  } else if (trialStart) {
    const elapsed = now - parseInt(trialStart);
    if (elapsed < TRIAL_DURATION) {
      const remaining = TRIAL_DURATION - elapsed;
      const hours = Math.floor(remaining / (3600 * 1000));
      statusBox.innerHTML = `<h2>TRIAL ACTIVE</h2><div class="time">${hours}h REMAINING</div>`;
      trialBtn.innerText = "CONTINUE TO HUB";
      trialBtn.onclick = () => launchApp();
    } else {
      statusBox.innerHTML = `<h2>TRIAL EXPIRED</h2><div class="time">LIFETIME ACCESS REQUIRED</div>`;
      trialBtn.style.display = 'none';
    }
  } else {
    statusBox.innerHTML = `<h2>WELCOME</h2><div class="time">24-HOUR FREE TRIAL</div>`;
    trialBtn.onclick = () => {
      localStorage.setItem('hub-trial-start', Date.now());
      launchApp();
    };
  }
}

function launchApp() {
  landing.classList.remove('active');
  appContainer.style.display = 'flex';
  connect();
}

buyBtn.onclick = () => {
  window.location.href = "https://buy.stripe.com/dRm00lfnn2nR77ZbhC1VK0f";
};

// Mock payment verification (for testing/demo)
// In production, your webhook would update your server/db
if (window.location.search.includes('session=success')) {
  localStorage.setItem('hub-paid', 'true');
  window.location.href = window.location.origin; // Clear URL
}

// ── SOCKET & CORE ───────────────────────────────────────────
function connect() {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  socket = new WebSocket(`${protocol}//${window.location.host}`);
  socket.onopen = () => console.log('✅ Ready');
  socket.onclose = () => setTimeout(connect, 1000);
}

function send(data) {
  if (socket && socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(data));
}

function vibrate() { if (navigator.vibrate) navigator.vibrate(12); }

function dismissKeyboard() {
  if (document.activeElement && document.activeElement.tagName === 'TEXTAREA') {
    document.activeElement.blur();
  }
}

// ── Trackpad ────────────────────────────────────────────────
const trackpad = document.getElementById('trackpad');
let LTX = 0, LTY = 0, isM = false, startTime = 0;

trackpad.addEventListener('touchstart', (e) => {
  e.preventDefault(); dismissKeyboard();
  LTX = e.touches[0].clientX; LTY = e.touches[0].clientY;
  isM = false; startTime = Date.now();
});

trackpad.addEventListener('touchmove', (e) => {
  e.preventDefault();
  const t = e.touches[0];
  if (e.touches.length === 1) {
    const dx = (t.clientX - LTX) * sensitivity;
    const dy = (t.clientY - LTY) * sensitivity;
    if (Math.abs(dx) > 0.4 || Math.abs(dy) > 0.4) {
      send({ type: 'mouse_move', dx, dy });
      isM = true;
    }
  } else if (e.touches.length === 2) {
    send({ type: 'mouse_scroll', delta: -(t.clientY - LTY) * 2 });
  }
  LTX = t.clientX; LTY = t.clientY;
});

trackpad.addEventListener('touchend', (e) => {
  e.preventDefault();
  if (!isM && (Date.now() - startTime) < 200) {
    send({ type: 'mouse_click', button: 'left' });
    vibrate();
  }
});

// ── Input ───────────────────────────────────────────────────
const typeInput = document.getElementById('type-input');
typeInput.addEventListener('input', (e) => {
  const el = e.target;
  const val = el.value;
  if (val.length > lastSentValue.length) send({ type: 'text', data: val.slice(lastSentValue.length) });
  else if (val.length < lastSentValue.length) send({ type: 'backspace', count: lastSentValue.length - val.length });
  lastSentValue = val;
  el.style.height = 'auto'; el.style.height = el.scrollHeight + 'px';
});

document.getElementById('enter-btn').addEventListener('touchstart', (e) => {
  e.preventDefault(); send({ type: 'key', vk: 0x0D }); vibrate();
});

document.getElementById('clear-btn').addEventListener('touchstart', (e) => {
  e.preventDefault(); typeInput.value = ''; lastSentValue = ''; typeInput.style.height = 'auto'; vibrate();
});

// ── Mouse & Keys ─────────────────────────────────────────────
['left', 'middle', 'right'].forEach(b => {
  document.getElementById(`mouse-${b}`).addEventListener('touchstart', (e) => {
    e.preventDefault(); dismissKeyboard(); send({ type: 'mouse_click', button: b }); vibrate();
  });
});

const VK_MAP = {
  'ctrl': 0x11, 'alt': 0x12, 'shift': 0x10, 'win': 0x5B,
  'esc': 0x1B, 'tab': 0x09, 'del': 0x2E, 'ins': 0x2D, 'home': 0x24, 'end': 0x23,
  'pgup': 0x21, 'pgdn': 0x22, 'up': 0x26, 'down': 0x28, 'left': 0x25, 'right': 0x27
};

document.querySelectorAll('[data-key]').forEach(btn => {
  btn.addEventListener('touchstart', (e) => {
    e.preventDefault(); dismissKeyboard();
    const k = btn.dataset.key;
    if (VK_MAP[k]) send({ type: 'key', vk: VK_MAP[k] });
    else if (k === 'undo') send({ type: 'combo', modifiers: [0x11], key: 0x5A });
    else if (k === 'copy') send({ type: 'combo', modifiers: [0x11], key: 0x43 });
    else if (k === 'paste') send({ type: 'combo', modifiers: [0x11], key: 0x56 });
    vibrate();
  });
});

// ── Settings ────────────────────────────────────────────────
const modal = document.getElementById('settings-modal');
document.getElementById('settings-toggle-btn').addEventListener('touchstart', (e) => {
  e.preventDefault(); dismissKeyboard(); modal.classList.add('active');
});
document.getElementById('close-settings').addEventListener('touchstart', (e) => {
  e.preventDefault(); modal.classList.remove('active');
});

const fontS = document.getElementById('font-scale-slider');
fontS.addEventListener('input', (e) => { document.documentElement.style.setProperty('--font-scale', e.target.value); localStorage.setItem('hub-font-scale', e.target.value); });
const btnS = document.getElementById('btn-scale-slider');
btnS.addEventListener('input', (e) => { document.documentElement.style.setProperty('--btn-scale', e.target.value); localStorage.setItem('hub-btn-scale', e.target.value); });
const sensS = document.getElementById('sensitivity-slider');
sensS.addEventListener('input', (e) => { sensitivity = parseFloat(e.target.value); localStorage.setItem('hub-sens', sensitivity); });

const sF = localStorage.getItem('hub-font-scale'); if (sF) { document.documentElement.style.setProperty('--font-scale', sF); fontS.value = sF; }
const sB = localStorage.getItem('hub-btn-scale'); if (sB) { document.documentElement.style.setProperty('--btn-scale', sB); btnS.value = sB; }
const sS = localStorage.getItem('hub-sens'); if (sS) { sensitivity = parseFloat(sS); sensS.value = sS; }

initHub();
