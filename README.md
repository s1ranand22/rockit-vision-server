# RockIt Vision Server

Standalone Node.js server for the RockIt Vision AI assistant.
Proxies Gemini Live API WebSocket connections — your API key stays server-side.

---

## Deploy to Hostinger (subdomain)

### Step 1 — Create the subdomain

1. Log in to Hostinger hPanel
2. Domains → Subdomains → Create subdomain
3. Enter: `vision` → subdomain will be `vision.rockit-web.in`
4. Point it to a new directory e.g. `public_html/vision-server`

### Step 2 — Upload files

Upload the entire contents of this zip to your subdomain root.
The folder structure should be:

```
vision-server/
├── server.js
├── package.json
├── .env.example
├── public/
│   └── vision/
│       ├── index.html
│       ├── manifest.json
│       ├── icon-192.png
│       └── icon-512.png
└── README.md
```

### Step 3 — Set environment variables

In Hostinger hPanel → Node.js → your app → Environment Variables, add:

```
GEMINI_API_KEY = your_gemini_api_key_here
PORT           = (Hostinger assigns this — leave blank or use what hPanel shows)
```

Or: copy `.env.example` → `.env` and fill in your key.

### Step 4 — Install dependencies

In Hostinger hPanel → Node.js → your app:
- Set entry point: `server.js`
- Click "Install dependencies" (runs npm install)
- Click "Restart"

Or via SSH:
```bash
cd ~/domains/vision.rockit-web.in/vision-server
npm install
```

### Step 5 — Enable WebSocket support

Hostinger's nginx needs to pass WebSocket upgrade headers through.
In hPanel → Hosting → your domain → .htaccess or Nginx Config, add:

```nginx
location /vision-ws {
    proxy_pass http://localhost:PORT;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_read_timeout 3600;
}
```

Replace PORT with the port Hostinger assigned to your Node.js app.

> Note: Hostinger's shared Node.js hosting does support WebSockets.
> If you're on a VPS, you control nginx directly.

### Step 6 — Test

Open `https://vision.rockit-web.in` in Chrome on your phone.
You should see the RockIt Vision setup screen immediately.

---

## Add to phone home screen (PWA)

**Android Chrome:**
1. Open `https://vision.rockit-web.in` in Chrome
2. Tap ⋮ menu → "Add to Home screen"
3. Purple eye icon appears on your home screen

**iPhone Safari:**
1. Open `https://vision.rockit-web.in` in Safari
2. Tap Share button → "Add to Home Screen"
3. Same icon appears

Tapping the icon opens the app full-screen with no browser chrome,
exactly like a native app.

---

## How the proxy works

```
Phone browser ──wss──▶ vision.rockit-web.in/vision-ws
                              │
                         server.js
                         (your Gemini key here)
                              │
                        ──wss──▶ Gemini Live API
```

Your Gemini API key is in `.env` on the server — never sent to or visible
in the browser. Users cannot extract it.

---

## Costs to watch

Gemini Live API charges per second of audio + per video frame.
With 1 frame/sec JPEG at 480px wide (our current setting):
- Audio input:  ~25 tokens/sec
- Video input:  ~258 tokens/sec (Gemini 2.0 rate)
- Audio output: ~25 tokens/sec

A 10-minute session ≈ 170,000 tokens total input+output.
At current Gemini 3.1 Flash Live rates: roughly ₹1-3 per 10-min session.

Consider adding Firebase Auth from your existing RockIt Web setup
to gate access if usage grows beyond friends/family testing.

---

## Troubleshooting

**"Connection error" on the app:**
→ Check that the Node.js app is running in hPanel
→ Check that GEMINI_API_KEY is set correctly (no quotes, no spaces)
→ Check the WebSocket nginx config is in place

**App opens but camera/mic denied:**
→ Must be served over HTTPS — the subdomain SSL cert must be active
→ In hPanel → SSL → make sure Let's Encrypt is installed for vision.rockit-web.in

**Session closes immediately:**
→ Check server logs in hPanel → Node.js → Logs
→ Usually means the Gemini model string has changed — update in index.html

**PWA icon not showing on "Add to Home Screen":**
→ Open DevTools → Application → Manifest — check for errors
→ Make sure manifest.json is accessible at /vision/manifest.json
