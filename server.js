try { require('dotenv').config(); } catch(_) {}
const express = require('express');
const http    = require('http');
const WebSocket = require('ws');
const path    = require('path');

const PORT        = process.env.PORT || 3000;
const GEMINI_KEY  = process.env.GEMINI_API_KEY;
const GEMINI_URL  = 'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent';

if (!GEMINI_KEY || GEMINI_KEY === 'paste_your_gemini_key_here') {
  console.error('\n❌  GEMINI_API_KEY is not set — proxy will not work but server will still start.\n');
  // NOTE: do NOT exit — Railway needs the server to stay up
}

// ── Express app ─────────────────────────────────────────────
const app = express();
app.use(express.static(path.join(__dirname, 'public')));
app.get('/', (req, res) => res.redirect('/vision/'));
app.get('/health', (req, res) => res.json({ status: 'ok', service: 'rockit-vision', hasKey: !!GEMINI_KEY }));

// ── HTTP server ──────────────────────────────────────────────
const server = http.createServer(app);

// ── WebSocket proxy ──────────────────────────────────────────
const wss = new WebSocket.Server({ noServer: true });

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

  // Parse the system prompt and language from query params sent by client
  const url    = new URL(req.url, 'http://localhost');
  const mode   = url.searchParams.get('mode')   || 'general';
  const lang   = url.searchParams.get('lang')   || 'en-IN';

  const geminiWs  = new WebSocket(`${GEMINI_URL}?key=${encodeURIComponent(GEMINI_KEY)}`);
  const msgBuffer = [];
  let   geminiOpen = false;
  let   setupSent  = false;

  // When Gemini opens, send our controlled setup message first
  geminiWs.on('open', () => {
    geminiOpen = true;
    console.log(`[proxy] Gemini open for ${ip}, mode=${mode}, lang=${lang}`);

    // Send setup — server controls this, not the client
    // Client will send its own setup too; we intercept and replace it
    // (setup is handled purely server-side now for reliability)
  });

  // Client → Gemini: forward everything, but intercept the first setup message
  clientWs.on('message', data => {
    let msg;
    try {
      msg = JSON.parse(data.toString());
    } catch(e) {
      // binary data (audio/video chunks) — forward directly
      if (geminiOpen && geminiWs.readyState === WebSocket.OPEN) {
        geminiWs.send(data);
      } else {
        msgBuffer.push(data);
      }
      return;
    }

    // If it's the setup message, strip out any unsupported fields before forwarding
    if (msg.setup) {
      console.log(`[proxy] Setup message from client, forwarding cleaned version`);
      const cleanSetup = {
        setup: {
          model: 'models/gemini-3.1-flash-live-preview',
          generationConfig: {
            responseModalities: ['AUDIO']
          },
          systemInstruction: msg.setup.systemInstruction || { parts: [{ text: 'You are a helpful assistant.' }] }
        }
      };
      // Only add transcription if the model supports it (try without first)
      if (geminiOpen && geminiWs.readyState === WebSocket.OPEN) {
        geminiWs.send(JSON.stringify(cleanSetup));
        msgBuffer.splice(0).forEach(m => geminiWs.send(m));
      } else {
        msgBuffer.unshift(JSON.stringify(cleanSetup));
      }
      return;
    }

    // All other messages — forward as-is
    if (geminiOpen && geminiWs.readyState === WebSocket.OPEN) {
      geminiWs.send(data);
    } else {
      msgBuffer.push(data);
    }
  });

  // Gemini → Client: log first few messages for debugging
  let geminiMsgCount = 0;
  geminiWs.on('message', data => {
    geminiMsgCount++;
    if (geminiMsgCount <= 3) {
      try {
        const parsed = JSON.parse(data.toString());
        console.log(`[proxy] Gemini msg #${geminiMsgCount} for ${ip}:`, JSON.stringify(parsed).slice(0, 200));
      } catch(e) {}
    }
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
  geminiWs.on('close', (code, reason) => cleanup(`gemini closed ${code} ${reason}`));
  geminiWs.on('error', e   => cleanup('gemini error: ' + e.message));
});

// ── Start ────────────────────────────────────────────────────
server.listen(PORT, () => {
  console.log(`\n✅  RockIt Vision server running on port ${PORT}`);
  console.log(`   App:   http://localhost:${PORT}/vision/`);
  console.log(`   Proxy: ws://localhost:${PORT}/vision-ws`);
  console.log(`   Key:   ${GEMINI_KEY ? 'set ✓' : 'MISSING ✗'}\n`);
});
