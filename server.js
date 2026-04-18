// ============================================================
//  Phone Keyboard — Server
//  Express + WebSocket server that bridges the phone UI
//  to the Windows SendInput helper (PowerShell child process).
// ============================================================

const express  = require('express');
const http     = require('http');
const { WebSocketServer } = require('ws');
const { spawn } = require('child_process');
const os       = require('os');
const path     = require('path');

// ── Helpers ──────────────────────────────────────────────────
function getLocalIPs() {
  const results = [];
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        results.push({ name, address: iface.address });
      }
    }
  }
  return results;
}

// ── Configuration ────────────────────────────────────────────
const PORT = parseInt(process.env.PORT || '3333', 10);
const HOST = '0.0.0.0';

// ── Express ──────────────────────────────────────────────────
const app    = express();
// Disable caching so phone always gets latest CSS/JS
app.use((req, res, next) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  next();
});
app.use(express.static(path.join(__dirname, 'public')));
const server = http.createServer(app);

// ── WebSocket ────────────────────────────────────────────────
const wss = new WebSocketServer({ server });

// ── PowerShell SendInput Helper ──────────────────────────────
let psReady = false;
const psHelper = spawn('powershell.exe', [
  '-NoProfile',
  '-ExecutionPolicy', 'Bypass',
  '-File', path.join(__dirname, 'keystroke-helper.ps1')
], {
  stdio: ['pipe', 'pipe', 'pipe'],
  windowsHide: true
});

psHelper.stdout.on('data', (data) => {
  const msg = data.toString().trim();
  if (msg === 'READY') {
    psReady = true;
    console.log('  ✅ Keystroke helper ready\n');
  }
});

psHelper.stderr.on('data', (data) => {
  console.error(`  [PS] ${data.toString().trim()}`);
});

psHelper.on('close', (code) => {
  console.error(`\n  ❌ PowerShell helper exited (code ${code})`);
  process.exit(1);
});

function sendToPS(cmd) {
  if (!psReady) return;
  try {
    psHelper.stdin.write(JSON.stringify(cmd) + '\n');
  } catch (err) {
    console.error('  [PS Write Error]', err.message);
  }
}

// ── WebSocket Connection Handler ─────────────────────────────
let clientCount = 0;

wss.on('connection', (ws, req) => {
  const clientIP = req.socket.remoteAddress?.replace('::ffff:', '') || 'unknown';
  clientCount++;
  console.log(`  📱 Connected: ${clientIP}  (${clientCount} client${clientCount > 1 ? 's' : ''})`);

  ws.send(JSON.stringify({ type: 'connected', psReady }));

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }

    // Ping / pong for latency
    if (msg.type === 'ping') {
      ws.send(JSON.stringify({ type: 'pong', timestamp: msg.timestamp }));
      return;
    }

    handleMessage(msg);
  });

  ws.on('close', () => {
    clientCount--;
    console.log(`  📱 Disconnected: ${clientIP}  (${clientCount} client${clientCount > 1 ? 's' : ''})`);
  });
});

// ── Message Router ───────────────────────────────────────────
function handleMessage(msg) {
  switch (msg.type) {
    case 'text':
      sendToPS({ action: 'type', text: msg.data });
      break;

    case 'key':
      sendToPS({ action: 'key', vk: msg.vk });
      break;

    case 'combo':
      sendToPS({ action: 'combo', modifiers: msg.modifiers, key: msg.key });
      break;

    case 'backspace':
      sendToPS({ action: 'backspace', count: msg.count || 1 });
      break;

    case 'diff':
      sendToPS({
        action:      'diff',
        leftMoves:   msg.leftMoves   || 0,
        deleteCount: msg.deleteCount || 0,
        insertText:  msg.insertText  || '',
        rightMoves:  msg.rightMoves  || 0
      });
      break;

    case 'mouse_move':
      sendToPS({ action: 'mouse_move', dx: msg.dx || 0, dy: msg.dy || 0 });
      break;

    case 'mouse_click':
      sendToPS({ action: 'mouse_click', button: msg.button || 'left' });
      break;

    case 'mouse_scroll':
      sendToPS({ action: 'mouse_scroll', delta: msg.delta || 0 });
      break;

    default:
      break;
  }
}

// ── Start Server ─────────────────────────────────────────────
server.listen(PORT, HOST, () => {
  const ips = getLocalIPs();
  const primaryIP = ips.length > 0 ? ips[0].address : '127.0.0.1';
  const url = `http://${primaryIP}:${PORT}`;

  console.log('');
  console.log('  ╔═══════════════════════════════════════════╗');
  console.log('  ║        📱  Phone Keyboard Server          ║');
  console.log('  ╚═══════════════════════════════════════════╝');
  console.log('');
  console.log(`  Open on your phone:  ${url}`);
  if (ips.length > 1) {
    console.log('');
    console.log('  All network interfaces:');
    ips.forEach(ip => {
      console.log(`    • ${ip.name}: http://${ip.address}:${PORT}`);
    });
  }
  console.log('');
  console.log('  ⚡ Both devices must be on the same Wi-Fi network');
  console.log('');

  // QR code (optional, best-effort)
  try {
    const qrcode = require('qrcode-terminal');
    console.log('  Scan with your phone camera:');
    console.log('');
    qrcode.generate(url, { small: true }, (qr) => {
      // Indent every line of the QR code
      const indented = qr.split('\n').map(l => '    ' + l).join('\n');
      console.log(indented);
      console.log('');
    });
  } catch {
    // qrcode-terminal not installed — no problem
  }

  console.log('  Waiting for phone to connect …');
  console.log('');

  // ── Auto-tunnel (best-effort, never crashes the server) ─────
  // The localtunnel package has known compatibility issues with
  // newer Node versions.  We skip it entirely to keep the server
  // stable.  Use the local Wi-Fi URL or scan the QR code above.
  console.log('  💡 Tip: Both devices must be on the same Wi-Fi.');
  console.log('      Use the local URL / QR code above on your phone.');
  console.log('');
});

// ── Graceful Shutdown ────────────────────────────────────────
function shutdown() {
  console.log('\n  Shutting down …');
  try { psHelper.kill(); } catch {}
  server.close();
  process.exit(0);
}
process.on('SIGINT',  shutdown);
process.on('SIGTERM', shutdown);
