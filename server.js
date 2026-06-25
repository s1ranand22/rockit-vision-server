try { require('dotenv').config(); } catch(_) {}
const express   = require('express');
const http      = require('http');
const WebSocket = require('ws');
const path      = require('path');

const PORT       = process.env.PORT || 3000;
const GEMINI_KEY = process.env.GEMINI_API_KEY;
const GEMINI_URL = 'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent';

if (!GEMINI_KEY || GEMINI_KEY === 'paste_your_gemini_key_here') {
  console.error('\n❌  GEMINI_API_KEY not set — proxy will not work but server will still start.\n');
}

const app = express();
app.use(express.static(path.join(__dirname, 'public')));
app.get('/', (req, res) => res.redirect('/vision/'));
app.get('/health', (req, res) => res.json({ status: 'ok', hasKey: !!GEMINI_KEY }));

const server = http.createServer(app);
const wss    = new WebSocket.Server({ noServer: true });

const MAX_PER_IP = 3;
const ipCount    = new Map();

function getIp(req) {
  return ((req.headers['x-forwarded-for'] || '') + ',' + req.socket.remoteAddress)
    .split(',')[0].trim();
}

server.on('upgrade', (req, socket, head) => {
  const pathname = new URL(req.url, 'http://localhost').pathname;
  if (pathname !== '/vision-ws') { socket.destroy(); return; }
  const ip = getIp(req);
  if ((ipCount.get(ip) || 0) >= MAX_PER_IP) {
    socket.write('HTTP/1.1 429 Too Many Requests\r\n\r\n');
    socket.destroy(); return;
  }
  wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws, req));
});

wss.on('connection', (clientWs, req) => {
  const ip = getIp(req);
  ipCount.set(ip, (ipCount.get(ip) || 0) + 1);
  console.log(`[proxy] Connected: ${ip} (${ipCount.get(ip)} active)`);

  const geminiWs   = new WebSocket(`${GEMINI_URL}?key=${encodeURIComponent(GEMINI_KEY)}`);
  const dataBuffer = [];  // audio/video chunks buffered until setup is sent
  let geminiOpen   = false;
  let setupSent    = false;
  let systemPrompt = 'You are a helpful assistant.'; // default until client sends it

  // ── Step 1: client sends {"rockit_setup": {system, lang}} as first message
  // ── Step 2: server sends Gemini setup with AUDIO modality
  // ── Step 3: all subsequent client messages are audio/video chunks → forwarded

  geminiWs.on('open', () => {
    geminiOpen = true;
    console.log(`[proxy] Gemini open for ${ip}`);
    // Don't send setup yet — wait for client to send system prompt first
    // If client already sent it (race), flush now
    if (setupSent) {
      dataBuffer.splice(0).forEach(m => geminiWs.send(m));
    }
  });

  function sendGeminiSetup(system) {
    if (setupSent) return;
    setupSent = true;
    console.log(`[proxy] Sending setup to Gemini, system length=${system.length}`);
    const setup = {
      setup: {
        model: 'models/gemini-3.1-flash-live-preview',
        generationConfig: { responseModalities: ['AUDIO'] },
        systemInstruction: { parts: [{ text: system }] }
      }
    };
    if (geminiOpen && geminiWs.readyState === WebSocket.OPEN) {
      geminiWs.send(JSON.stringify(setup));
      dataBuffer.splice(0).forEach(m => geminiWs.send(m));
    } else {
      // Gemini not open yet — prepend setup to buffer
      dataBuffer.unshift(JSON.stringify(setup));
    }
  }

  clientWs.on('message', data => {
    // Try to parse as JSON to check for our setup envelope
    let msg = null;
    try { msg = JSON.parse(data.toString()); } catch(e) {}

    if (msg && msg.rockit_setup) {
      // Client is sending us the system prompt — use it then set up Gemini
      systemPrompt = msg.rockit_setup.system || systemPrompt;
      console.log(`[proxy] Received system prompt from client (${systemPrompt.length} chars)`);
      sendGeminiSetup(systemPrompt);
      return;
    }

    if (msg && msg.setup) {
      // Old-style setup from client — ignore, we handle it
      console.log(`[proxy] Ignoring client setup message`);
      return;
    }

    // Audio/video chunk — buffer until setup is sent, then forward
    if (setupSent && geminiOpen && geminiWs.readyState === WebSocket.OPEN) {
      geminiWs.send(data);
    } else {
      dataBuffer.push(data);
    }
  });

  // Gemini → Client
  let msgCount = 0;
  geminiWs.on('message', data => {
    msgCount++;
    if (msgCount <= 4) {
      try {
        console.log(`[proxy] Gemini msg #${msgCount}: ${data.toString().slice(0, 200)}`);
      } catch(e) {}
    }
    if (clientWs.readyState === WebSocket.OPEN) clientWs.send(data);
  });

  function cleanup(reason) {
    console.log(`[proxy] Closing ${ip}: ${reason}`);
    ipCount.set(ip, Math.max(0, (ipCount.get(ip) || 1) - 1));
    if (geminiWs.readyState < 2) try { geminiWs.close(); } catch(_) {}
    if (clientWs.readyState  < 2) try { clientWs.close();  } catch(_) {}
  }

  clientWs.on('close', ()  => cleanup('client closed'));
  clientWs.on('error', e   => cleanup('client error: ' + e.message));
  geminiWs.on('close', (code, reason) => cleanup(`gemini closed ${code} ${reason}`));
  geminiWs.on('error', e   => cleanup('gemini error: ' + e.message));
});

server.listen(PORT, () => {
  console.log(`\n✅  RockIt Vision running on port ${PORT}`);
  console.log(`   Key: ${GEMINI_KEY ? 'set ✓' : 'MISSING ✗'}\n`);
});
