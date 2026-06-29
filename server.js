try { require('dotenv').config(); } catch(_) {}
const express   = require('express');
const http      = require('http');
const WebSocket = require('ws');
const path      = require('path');
const fs        = require('fs');

const PORT       = process.env.PORT || 3000;
const GEMINI_KEY = process.env.GEMINI_API_KEY;
const STATS_PASS = process.env.STATS_PASSWORD || 'rockit2026';
const GEMINI_URL = 'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent';
const STATS_FILE = path.join(__dirname, 'data', 'sessions.json');

if (!GEMINI_KEY || GEMINI_KEY === 'paste_your_gemini_key_here') {
  console.error('\n❌  GEMINI_API_KEY not set — proxy will not work but server will still start.\n');
}

// ── Analytics ──────────────────────────────────────────────────────────────
let stats = { total_sessions:0, total_duration_secs:0, by_mode:{}, by_lang:{}, by_day:{}, unique_ips:[], last_updated:null };

function hashIp(ip) {
  let h = 0;
  for (let i = 0; i < ip.length; i++) { h = ((h << 5) - h) + ip.charCodeAt(i); h |= 0; }
  return Math.abs(h).toString(36);
}

function loadStats() {
  try {
    if (!fs.existsSync(path.dirname(STATS_FILE))) fs.mkdirSync(path.dirname(STATS_FILE), { recursive: true });
    if (fs.existsSync(STATS_FILE)) stats = JSON.parse(fs.readFileSync(STATS_FILE, 'utf8'));
  } catch(e) { console.warn('[stats] Could not load:', e.message); }
}

function saveStats() {
  try { stats.last_updated = new Date().toISOString(); fs.writeFileSync(STATS_FILE, JSON.stringify(stats, null, 2)); }
  catch(e) { console.warn('[stats] Could not save:', e.message); }
}

function recordSession({ ip, mode, lang, durationSecs }) {
  const day = new Date().toISOString().slice(0, 10);
  const ipHash = hashIp(ip);
  stats.total_sessions++;
  stats.total_duration_secs += durationSecs;
  stats.by_mode[mode] = (stats.by_mode[mode] || 0) + 1;
  stats.by_lang[lang] = (stats.by_lang[lang] || 0) + 1;
  if (!stats.by_day[day]) stats.by_day[day] = { sessions:0, duration_secs:0 };
  stats.by_day[day].sessions++;
  stats.by_day[day].duration_secs += durationSecs;
  if (!stats.unique_ips.includes(ipHash)) stats.unique_ips.push(ipHash);
  saveStats();
}

loadStats();

// ── Express ────────────────────────────────────────────────────────────────
const app = express();
app.use(express.static(path.join(__dirname, 'public')));
app.get('/', (req, res) => res.redirect('/vision/'));
app.get('/health', (req, res) => res.json({ status:'ok', hasKey:!!GEMINI_KEY }));

// Stats dashboard
app.get('/stats', (req, res) => {
  const pass = req.query.p || req.headers['x-stats-password'];
  if (pass !== STATS_PASS) {
    return res.status(401).send(`<html><body style="font-family:sans-serif;max-width:400px;margin:80px auto;padding:20px"><h2>RockIt Vision Stats</h2><form><input name="p" type="password" placeholder="Password" style="padding:8px;width:200px"><button type="submit" style="padding:8px 16px;margin-left:8px">View</button></form></body></html>`);
  }
  const avgDuration = stats.total_sessions > 0 ? Math.round(stats.total_duration_secs / stats.total_sessions) : 0;
  const days = Object.entries(stats.by_day).sort(([a],[b]) => b.localeCompare(a)).slice(0, 30);
  const modeRows = Object.entries(stats.by_mode).sort(([,a],[,b]) => b-a).map(([m,n]) => `<tr><td>${m}</td><td>${n}</td></tr>`).join('');
  const langRows = Object.entries(stats.by_lang).sort(([,a],[,b]) => b-a).map(([l,n]) => `<tr><td>${l}</td><td>${n}</td></tr>`).join('');
  const dayRows = days.map(([d,v]) => `<tr><td>${d}</td><td>${v.sessions}</td><td>${Math.round(v.duration_secs/60)} min</td></tr>`).join('');
  res.send(`<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>RockIt Vision Stats</title><style>*{box-sizing:border-box}body{font-family:-apple-system,sans-serif;background:#0b0b0d;color:#f2f2f0;margin:0;padding:20px}h1{font-size:20px;margin:0 0 6px}.sub{color:#75756f;font-size:13px;margin:0 0 28px}.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:12px;margin-bottom:28px}.card{background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.1);border-radius:12px;padding:16px}.card .val{font-size:28px;font-weight:700}.card .lbl{font-size:12px;color:#75756f;margin-top:4px}.purple{color:#a78bfa}.pink{color:#f472b6}.green{color:#34d399}.amber{color:#fbbf24}h2{font-size:15px;color:#b5b5b1;margin:24px 0 10px;text-transform:uppercase;letter-spacing:.05em}table{width:100%;border-collapse:collapse;font-size:13px}td,th{padding:8px 10px;text-align:left;border-bottom:1px solid rgba(255,255,255,.06)}th{color:#75756f;font-weight:500}.grid2{display:grid;grid-template-columns:1fr 1fr;gap:20px}@media(max-width:500px){.grid2{grid-template-columns:1fr}}</style></head><body><h1>RockIt Vision</h1><p class="sub">Usage analytics · Last updated ${stats.last_updated ? new Date(stats.last_updated).toLocaleString('en-IN') : 'never'}</p><div class="cards"><div class="card"><div class="val purple">${stats.total_sessions}</div><div class="lbl">Total sessions</div></div><div class="card"><div class="val pink">${stats.unique_ips.length}</div><div class="lbl">Unique users</div></div><div class="card"><div class="val green">${Math.round(stats.total_duration_secs/60)}</div><div class="lbl">Total minutes</div></div><div class="card"><div class="val amber">${avgDuration}s</div><div class="lbl">Avg session</div></div></div><div class="grid2"><div><h2>By mode</h2><table><tr><th>Mode</th><th>Sessions</th></tr>${modeRows||'<tr><td colspan="2" style="color:#4a4a46">No data yet</td></tr>'}</table></div><div><h2>By language</h2><table><tr><th>Language</th><th>Sessions</th></tr>${langRows||'<tr><td colspan="2" style="color:#4a4a46">No data yet</td></tr>'}</table></div></div><h2>Last 30 days</h2><table><tr><th>Date</th><th>Sessions</th><th>Duration</th></tr>${dayRows||'<tr><td colspan="3" style="color:#4a4a46">No data yet</td></tr>'}</table></body></html>`);
});

// ── HTTP + WS server ────────────────────────────────────────────────────────
const server = http.createServer(app);
const wss    = new WebSocket.Server({ noServer: true });
const MAX_PER_IP = 3;
const ipCount    = new Map();

function getIp(req) {
  return ((req.headers['x-forwarded-for'] || '') + ',' + req.socket.remoteAddress).split(',')[0].trim();
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
  const ip      = getIp(req);
  const startAt = Date.now();
  ipCount.set(ip, (ipCount.get(ip) || 0) + 1);
  console.log(`[proxy] Connected: ${ip} (${ipCount.get(ip)} active)`);

  const geminiWs   = new WebSocket(`${GEMINI_URL}?key=${encodeURIComponent(GEMINI_KEY)}`);
  const dataBuffer = [];
  let geminiOpen   = false;
  let setupSent    = false;
  let sessionMode  = 'general';
  let sessionLang  = 'en-IN';
  let sessionLive  = false;

  geminiWs.on('open', () => {
    geminiOpen = true;
    if (setupSent) dataBuffer.splice(0).forEach(m => geminiWs.send(m));
  });

  function sendGeminiSetup(system) {
    if (setupSent) return;
    setupSent = true;
    const setup = { setup: { model:'models/gemini-3.1-flash-live-preview', generationConfig:{ responseModalities:['AUDIO'] }, systemInstruction:{ parts:[{ text:system }] } } };
    if (geminiOpen && geminiWs.readyState === WebSocket.OPEN) {
      geminiWs.send(JSON.stringify(setup));
      dataBuffer.splice(0).forEach(m => geminiWs.send(m));
    } else {
      dataBuffer.unshift(JSON.stringify(setup));
    }
  }

  clientWs.on('message', data => {
    let msg = null;
    try { msg = JSON.parse(data.toString()); } catch(e) {}
    if (msg && msg.rockit_setup) {
      sessionMode = msg.rockit_setup.mode || 'general';
      sessionLang = msg.rockit_setup.lang || 'en-IN';
      sendGeminiSetup(msg.rockit_setup.system || 'You are a helpful assistant.');
      return;
    }
    if (msg && msg.setup) return;
    if (setupSent && geminiOpen && geminiWs.readyState === WebSocket.OPEN) {
      geminiWs.send(data);
    } else {
      dataBuffer.push(data);
    }
  });

  let msgCount = 0;
  geminiWs.on('message', data => {
    msgCount++;
    if (msgCount <= 4) { try { console.log(`[proxy] Gemini msg #${msgCount}: ${data.toString().slice(0,200)}`); } catch(e) {} }
    if (!sessionLive) { try { const m = JSON.parse(data.toString()); if (m.setupComplete) sessionLive = true; } catch(e) {} }
    if (clientWs.readyState === WebSocket.OPEN) clientWs.send(data);
  });

  function cleanup(reason) {
    console.log(`[proxy] Closing ${ip}: ${reason}`);
    ipCount.set(ip, Math.max(0, (ipCount.get(ip) || 1) - 1));
    if (sessionLive) recordSession({ ip, mode:sessionMode, lang:sessionLang, durationSecs:Math.round((Date.now()-startAt)/1000) });
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
