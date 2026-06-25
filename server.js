try { require('dotenv').config(); } catch(_) {}
const express = require('express');
const http    = require('http');
const WebSocket = require('ws');
const path    = require('path');

const PORT        = process.env.PORT || 3000;
const GEMINI_KEY  = process.env.GEMINI_API_KEY;
const GEMINI_URL  = 'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent';

if (!GEMINI_KEY || GEMINI_KEY === 'paste_your_gemini_key_here') {
  console.error('\n❌  GEMINI_API_KEY is not set in .env — server cannot start.\n');
  process.exit(1);
}

// ── Express app ────────────────────────────────────────────────────────────
const app = express();

// Serve all static files from public/
app.use(express.static(path.join(__dirname, 'public')));

// Root → redirect to /vision/
app.get('/', (req, res) => res.redirect('/vision/'));

// Railway healthcheck
app.get('/health', (req, res) => res.json({ status: 'ok', service: 'rockit-vision' }));

// ── HTTP server ────────────────────────────────────────────────────────────
const server = http.createServer(app);

// ── WebSocket proxy ────────────────────────────────────────────────────────
const wss = new WebSocket.Server({ noServer: true });

// Simple per-IP connection limiter
const MAX_PER_IP = 3;
const ipCount    = new Map();

function getIp(req) {
  return ((req.headers['x-forwarded-for'] || '') + ',' + req.socket.remoteAddress)
    .split(',')[0].trim();
}

// Only upgrade requests to /vision-ws
server.on('upgrade', (req, socket, head) => {
  const pathname = new URL(req.url, 'http://localhost').pathname;
  if (pathname !== '/vision-ws') {
    socket.destroy();
    return;
  }

  const ip = getIp(req);
  const n  = ipCount.get(ip) || 0;
  if (n >= MAX_PER_IP) {
    console.warn(`[proxy] Rate limit hit for ${ip}`);
    socket.write('HTTP/1.1 429 Too Many Requests\r\n\r\n');
    socket.destroy();
    return;
  }

  wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws, req));
});

wss.on('connection', (clientWs, req) => {
  const ip = getIp(req);
  ipCount.set(ip, (ipCount.get(ip) || 0) + 1);
  console.log(`[proxy] Connected: ${ip} (${ipCount.get(ip)} active)`);

  const geminiWs   = new WebSocket(`${GEMINI_URL}?key=${encodeURIComponent(GEMINI_KEY)}`);
  const msgBuffer  = [];
  let   geminiOpen = false;

  // Client → Gemini
  clientWs.on('message', data => {
    if (geminiOpen && geminiWs.readyState === WebSocket.OPEN) {
      geminiWs.send(data);
    } else {
      msgBuffer.push(data);
    }
  });

  // Gemini ready — flush buffer
  geminiWs.on('open', () => {
    geminiOpen = true;
    msgBuffer.splice(0).forEach(m => geminiWs.send(m));
    console.log(`[proxy] Gemini open for ${ip}`);
  });

  // Gemini → Client
  geminiWs.on('message', data => {
    if (clientWs.readyState === WebSocket.OPEN) clientWs.send(data);
  });

  function cleanup(reason) {
    console.log(`[proxy] Closing ${ip}: ${reason}`);
    ipCount.set(ip, Math.max(0, (ipCount.get(ip) || 1) - 1));
    if (geminiWs.readyState < 2) try { geminiWs.close(); } catch (_) {}
    if (clientWs.readyState  < 2) try { clientWs.close();  } catch (_) {}
  }

  clientWs.on('close', ()  => cleanup('client closed'));
  clientWs.on('error', e   => cleanup('client error: ' + e.message));
  geminiWs.on('close', ()  => cleanup('gemini closed'));
  geminiWs.on('error', e   => cleanup('gemini error: ' + e.message));
});

// ── Start ──────────────────────────────────────────────────────────────────
server.listen(PORT, () => {
  console.log(`\n✅  RockIt Vision server running on port ${PORT}`);
  console.log(`   App:   http://localhost:${PORT}/vision/`);
  console.log(`   Proxy: ws://localhost:${PORT}/vision-ws\n`);
});
