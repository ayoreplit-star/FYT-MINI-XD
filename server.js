const express = require('express');
const cors = require('cors');
const NodeCache = require('node-cache');
const pino = require('pino');
const path = require('path');
const fs = require('fs');

const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  makeCacheableSignalKeyStore,
  Browsers,
  fetchLatestBaileysVersion
} = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const logger = pino({ level: 'silent' });
const sessionCache = new NodeCache({ stdTTL: 300 });
const pairingSessions = new Map();

const SESSIONS_DIR = './sessions';
if (!fs.existsSync(SESSIONS_DIR)) fs.mkdirSync(SESSIONS_DIR, { recursive: true });

function formatPhoneNumber(phone) {
  let cleaned = phone.replace(/\D/g, '');
  if (cleaned.startsWith('0')) cleaned = cleaned.slice(1);
  return cleaned;
}

async function generatePairingCode(phoneNumber) {
  const sessionId = `session_${phoneNumber}_${Date.now()}`;
  const sessionPath = path.join(SESSIONS_DIR, sessionId);

  if (!fs.existsSync(sessionPath)) fs.mkdirSync(sessionPath, { recursive: true });

  const { state, saveCreds } = await useMultiFileAuthState(sessionPath);
  const { version } = await fetchLatestBaileysVersion();

  return new Promise((resolve, reject) => {
    let resolved = false;
    let socket;

    const timeout = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        try { socket?.end(); } catch (e) {}
        cleanup(sessionPath);
        reject(new Error('Pairing timed out. Please try again.'));
      }
    }, 60000);

    try {
      socket = makeWASocket({
        version,
        logger,
        printQRInTerminal: false,
        mobile: false,
        auth: {
          creds: state.creds,
          keys: makeCacheableSignalKeyStore(state.keys, logger)
        },
        browser: Browsers.ubuntu('Chrome'),
        markOnlineOnConnect: false,
        generateHighQualityLinkPreview: false,
        getMessage: async () => { return { conversation: '' }; }
      });

      socket.ev.on('creds.update', saveCreds);

      socket.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect } = update;

        if (!socket.authState.creds.registered && !resolved) {
          try {
            const code = await socket.requestPairingCode(phoneNumber);
            if (code && !resolved) {
              resolved = true;
              clearTimeout(timeout);
              const formatted = code.match(/.{1,4}/g)?.join('-') || code;
              setTimeout(() => {
                try { socket?.end(); } catch (e) {}
                cleanup(sessionPath);
              }, 5000);
              resolve({ code: formatted });
            }
          } catch (e) {
          }
        }

        if (connection === 'close') {
          const reason = new Boom(lastDisconnect?.error)?.output?.statusCode;
          if (!resolved) {
            resolved = true;
            clearTimeout(timeout);
            cleanup(sessionPath);
            reject(new Error(`Connection closed. Reason: ${reason}`));
          }
        }
      });
    } catch (err) {
      if (!resolved) {
        resolved = true;
        clearTimeout(timeout);
        cleanup(sessionPath);
        reject(err);
      }
    }
  });
}

function cleanup(sessionPath) {
  setTimeout(() => {
    try {
      if (fs.existsSync(sessionPath)) {
        fs.rmSync(sessionPath, { recursive: true, force: true });
      }
    } catch (e) {}
  }, 3000);
}

app.get('/api/pair', async (req, res) => {
  const { phone } = req.query;
  if (!phone) return res.status(400).json({ success: false, error: 'Phone number is required' });

  const cleaned = formatPhoneNumber(phone);
  if (cleaned.length < 7 || cleaned.length > 15) {
    return res.status(400).json({ success: false, error: 'Invalid phone number format' });
  }

  const cached = sessionCache.get(cleaned);
  if (cached) return res.json({ success: true, code: cached, cached: true });

  try {
    const result = await generatePairingCode(cleaned);
    sessionCache.set(cleaned, result.code);
    res.json({ success: true, code: result.code });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message || 'Failed to generate pairing code' });
  }
});

app.get('/', (req, res) => {
  res.send(getHTML());
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

function getHTML() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>WhatsApp Pairing - AMZY XD</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800;900&display=swap" rel="stylesheet" />
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    :root {
      --green: #25D366;
      --green-dark: #128C7E;
      --green-light: #DCF8C6;
      --accent: #00E676;
      --bg: #0a0a0a;
      --bg2: #111111;
      --bg3: #1a1a1a;
      --card: #161616;
      --border: rgba(255,255,255,0.07);
      --text: #ffffff;
      --text2: rgba(255,255,255,0.6);
      --text3: rgba(255,255,255,0.35);
      --radius: 18px;
      --glow: 0 0 40px rgba(37,211,102,0.15);
    }

    html { scroll-behavior: smooth; }

    body {
      font-family: 'Inter', sans-serif;
      background: var(--bg);
      color: var(--text);
      min-height: 100vh;
      overflow-x: hidden;
    }

    /* Animated background */
    body::before {
      content: '';
      position: fixed;
      inset: 0;
      background:
        radial-gradient(ellipse 80% 60% at 50% -10%, rgba(37,211,102,0.12) 0%, transparent 70%),
        radial-gradient(ellipse 60% 40% at 100% 80%, rgba(18,140,126,0.08) 0%, transparent 70%),
        radial-gradient(ellipse 50% 50% at 0% 100%, rgba(0,230,118,0.06) 0%, transparent 70%);
      pointer-events: none;
      z-index: 0;
    }

    .particles {
      position: fixed;
      inset: 0;
      pointer-events: none;
      z-index: 0;
      overflow: hidden;
    }

    .particle {
      position: absolute;
      width: 2px;
      height: 2px;
      border-radius: 50%;
      background: var(--green);
      opacity: 0;
      animation: float-particle linear infinite;
    }

    @keyframes float-particle {
      0% { transform: translateY(100vh) rotate(0deg); opacity: 0; }
      10% { opacity: 0.6; }
      90% { opacity: 0.3; }
      100% { transform: translateY(-10vh) rotate(360deg); opacity: 0; }
    }

    .container {
      position: relative;
      z-index: 1;
      max-width: 1100px;
      margin: 0 auto;
      padding: 0 24px;
    }

    /* NAV */
    nav {
      position: sticky;
      top: 0;
      z-index: 100;
      backdrop-filter: blur(20px);
      -webkit-backdrop-filter: blur(20px);
      background: rgba(10,10,10,0.8);
      border-bottom: 1px solid var(--border);
    }

    .nav-inner {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 16px 24px;
      max-width: 1100px;
      margin: 0 auto;
    }

    .logo {
      display: flex;
      align-items: center;
      gap: 10px;
      font-size: 1.2rem;
      font-weight: 800;
      color: var(--text);
      text-decoration: none;
    }

    .logo-icon {
      width: 36px;
      height: 36px;
      background: linear-gradient(135deg, var(--green), var(--green-dark));
      border-radius: 10px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 18px;
    }

    .logo span { color: var(--green); }

    .nav-badge {
      display: flex;
      align-items: center;
      gap: 6px;
      background: rgba(37,211,102,0.1);
      border: 1px solid rgba(37,211,102,0.2);
      border-radius: 50px;
      padding: 6px 14px;
      font-size: 0.78rem;
      font-weight: 600;
      color: var(--green);
    }

    .nav-badge::before {
      content: '';
      width: 7px;
      height: 7px;
      border-radius: 50%;
      background: var(--green);
      animation: pulse-dot 2s infinite;
    }

    @keyframes pulse-dot {
      0%, 100% { opacity: 1; transform: scale(1); }
      50% { opacity: 0.4; transform: scale(0.8); }
    }

    /* HERO */
    .hero {
      padding: 100px 0 60px;
      text-align: center;
    }

    .hero-tag {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      background: rgba(37,211,102,0.08);
      border: 1px solid rgba(37,211,102,0.18);
      border-radius: 50px;
      padding: 8px 20px;
      font-size: 0.82rem;
      font-weight: 600;
      color: var(--green);
      margin-bottom: 32px;
      letter-spacing: 0.5px;
    }

    .hero h1 {
      font-size: clamp(2.4rem, 6vw, 4.2rem);
      font-weight: 900;
      line-height: 1.1;
      margin-bottom: 24px;
      letter-spacing: -2px;
    }

    .hero h1 .highlight {
      background: linear-gradient(135deg, var(--green) 0%, #00BFA5 50%, var(--accent) 100%);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      background-clip: text;
    }

    .hero p {
      font-size: 1.15rem;
      color: var(--text2);
      max-width: 560px;
      margin: 0 auto 56px;
      line-height: 1.7;
    }

    /* CARD */
    .card {
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      max-width: 480px;
      margin: 0 auto;
      overflow: hidden;
      box-shadow: var(--glow), 0 40px 80px rgba(0,0,0,0.5);
      position: relative;
    }

    .card::before {
      content: '';
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      height: 3px;
      background: linear-gradient(90deg, var(--green-dark), var(--green), var(--accent));
    }

    .card-header {
      padding: 32px 32px 0;
      display: flex;
      align-items: center;
      gap: 14px;
    }

    .card-icon {
      width: 48px;
      height: 48px;
      background: linear-gradient(135deg, rgba(37,211,102,0.2), rgba(18,140,126,0.2));
      border: 1px solid rgba(37,211,102,0.2);
      border-radius: 14px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 22px;
      flex-shrink: 0;
    }

    .card-header-text h3 {
      font-size: 1.05rem;
      font-weight: 700;
      margin-bottom: 2px;
    }

    .card-header-text p {
      font-size: 0.8rem;
      color: var(--text3);
    }

    .card-body { padding: 28px 32px 32px; }

    .steps {
      display: flex;
      gap: 8px;
      margin-bottom: 28px;
    }

    .step {
      flex: 1;
      text-align: center;
      position: relative;
    }

    .step:not(:last-child)::after {
      content: '';
      position: absolute;
      top: 14px;
      left: calc(50% + 18px);
      right: calc(-50% + 18px);
      height: 1px;
      background: var(--border);
    }

    .step-num {
      width: 28px;
      height: 28px;
      border-radius: 50%;
      background: var(--bg3);
      border: 1px solid var(--border);
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 0.72rem;
      font-weight: 700;
      color: var(--text3);
      margin: 0 auto 6px;
    }

    .step.active .step-num {
      background: linear-gradient(135deg, var(--green), var(--green-dark));
      border-color: var(--green);
      color: #fff;
    }

    .step-label {
      font-size: 0.7rem;
      color: var(--text3);
    }

    .step.active .step-label { color: var(--green); }

    .input-group {
      margin-bottom: 16px;
    }

    .input-label {
      display: block;
      font-size: 0.82rem;
      font-weight: 600;
      color: var(--text2);
      margin-bottom: 8px;
    }

    .input-wrap {
      position: relative;
      display: flex;
      align-items: center;
    }

    .input-prefix {
      position: absolute;
      left: 14px;
      font-size: 0.9rem;
      color: var(--text3);
      font-weight: 500;
      user-select: none;
    }

    .phone-input {
      width: 100%;
      background: var(--bg3);
      border: 1.5px solid var(--border);
      border-radius: 12px;
      padding: 14px 14px 14px 34px;
      font-size: 1rem;
      font-weight: 500;
      color: var(--text);
      font-family: inherit;
      outline: none;
      transition: border-color 0.2s, box-shadow 0.2s, background 0.2s;
      letter-spacing: 0.5px;
    }

    .phone-input::placeholder { color: var(--text3); }

    .phone-input:focus {
      border-color: var(--green);
      box-shadow: 0 0 0 3px rgba(37,211,102,0.12);
      background: rgba(37,211,102,0.03);
    }

    .phone-input.error {
      border-color: #ff4757;
      box-shadow: 0 0 0 3px rgba(255,71,87,0.12);
    }

    .error-text {
      font-size: 0.78rem;
      color: #ff4757;
      margin-top: 6px;
      display: none;
    }

    .error-text.show { display: block; }

    .hint {
      font-size: 0.76rem;
      color: var(--text3);
      margin-top: 6px;
    }

    .btn {
      width: 100%;
      padding: 15px;
      background: linear-gradient(135deg, var(--green) 0%, var(--green-dark) 100%);
      border: none;
      border-radius: 12px;
      color: #fff;
      font-size: 1rem;
      font-weight: 700;
      font-family: inherit;
      cursor: pointer;
      transition: transform 0.2s, box-shadow 0.2s, opacity 0.2s;
      position: relative;
      overflow: hidden;
      margin-top: 8px;
      letter-spacing: 0.3px;
    }

    .btn::before {
      content: '';
      position: absolute;
      inset: 0;
      background: linear-gradient(135deg, rgba(255,255,255,0.15), transparent);
      opacity: 0;
      transition: opacity 0.2s;
    }

    .btn:hover:not(:disabled) { transform: translateY(-2px); box-shadow: 0 8px 25px rgba(37,211,102,0.35); }
    .btn:hover::before { opacity: 1; }
    .btn:active:not(:disabled) { transform: translateY(0); }
    .btn:disabled { opacity: 0.7; cursor: not-allowed; transform: none; }

    .btn-text { display: flex; align-items: center; justify-content: center; gap: 8px; }

    /* LOADING */
    .loading-bar {
      height: 2px;
      background: var(--border);
      border-radius: 2px;
      overflow: hidden;
      margin-top: 16px;
      display: none;
    }

    .loading-bar.show { display: block; }

    .loading-bar-fill {
      height: 100%;
      background: linear-gradient(90deg, var(--green), var(--accent));
      border-radius: 2px;
      animation: loading 2.5s ease-in-out infinite;
    }

    @keyframes loading {
      0% { width: 0%; margin-left: 0; }
      50% { width: 70%; margin-left: 10%; }
      100% { width: 0%; margin-left: 100%; }
    }

    .status-box {
      margin-top: 16px;
      padding: 14px 16px;
      border-radius: 10px;
      font-size: 0.85rem;
      font-weight: 500;
      display: none;
      align-items: center;
      gap: 10px;
    }

    .status-box.show { display: flex; }

    .status-box.loading {
      background: rgba(37,211,102,0.06);
      border: 1px solid rgba(37,211,102,0.15);
      color: var(--green);
    }

    .status-box.error-box {
      background: rgba(255,71,87,0.06);
      border: 1px solid rgba(255,71,87,0.15);
      color: #ff4757;
    }

    /* RESULT */
    .result-box {
      margin-top: 16px;
      padding: 24px;
      background: rgba(37,211,102,0.06);
      border: 1px solid rgba(37,211,102,0.2);
      border-radius: 14px;
      text-align: center;
      display: none;
      animation: slide-up 0.4s ease;
    }

    .result-box.show { display: block; }

    @keyframes slide-up {
      from { opacity: 0; transform: translateY(12px); }
      to { opacity: 1; transform: translateY(0); }
    }

    .result-label {
      font-size: 0.78rem;
      color: var(--text3);
      font-weight: 600;
      letter-spacing: 1px;
      text-transform: uppercase;
      margin-bottom: 12px;
    }

    .code-display {
      font-size: 2.2rem;
      font-weight: 900;
      letter-spacing: 6px;
      color: var(--green);
      font-variant-numeric: tabular-nums;
      margin-bottom: 16px;
      text-shadow: 0 0 20px rgba(37,211,102,0.3);
    }

    .copy-btn {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      background: rgba(37,211,102,0.15);
      border: 1px solid rgba(37,211,102,0.25);
      border-radius: 8px;
      padding: 8px 18px;
      color: var(--green);
      font-size: 0.82rem;
      font-weight: 600;
      font-family: inherit;
      cursor: pointer;
      transition: all 0.2s;
    }

    .copy-btn:hover { background: rgba(37,211,102,0.25); transform: translateY(-1px); }
    .copy-btn.copied { background: rgba(37,211,102,0.3); }

    .timer-text {
      font-size: 0.76rem;
      color: var(--text3);
      margin-top: 10px;
    }

    /* HOW TO */
    .instructions {
      background: rgba(255,255,255,0.02);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 18px;
      margin-top: 20px;
    }

    .instructions-title {
      font-size: 0.8rem;
      font-weight: 700;
      color: var(--text2);
      margin-bottom: 12px;
      display: flex;
      align-items: center;
      gap: 6px;
    }

    .instruction-step {
      display: flex;
      align-items: flex-start;
      gap: 10px;
      margin-bottom: 10px;
    }

    .instruction-step:last-child { margin-bottom: 0; }

    .step-dot {
      width: 20px;
      height: 20px;
      border-radius: 50%;
      background: linear-gradient(135deg, var(--green), var(--green-dark));
      color: #fff;
      font-size: 0.65rem;
      font-weight: 800;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
      margin-top: 1px;
    }

    .instruction-text {
      font-size: 0.8rem;
      color: var(--text3);
      line-height: 1.5;
    }

    .instruction-text strong { color: var(--text2); }

    /* FEATURES */
    .features {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
      gap: 20px;
      padding: 60px 0;
    }

    .feature-card {
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      padding: 28px;
      transition: transform 0.3s, box-shadow 0.3s, border-color 0.3s;
    }

    .feature-card:hover {
      transform: translateY(-4px);
      box-shadow: 0 20px 40px rgba(0,0,0,0.3), var(--glow);
      border-color: rgba(37,211,102,0.2);
    }

    .feature-icon {
      width: 46px;
      height: 46px;
      border-radius: 12px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 22px;
      margin-bottom: 18px;
    }

    .feature-icon.g { background: rgba(37,211,102,0.1); }
    .feature-icon.b { background: rgba(0,150,255,0.1); }
    .feature-icon.p { background: rgba(180,0,255,0.1); }

    .feature-card h4 {
      font-size: 1rem;
      font-weight: 700;
      margin-bottom: 8px;
    }

    .feature-card p {
      font-size: 0.85rem;
      color: var(--text3);
      line-height: 1.6;
    }

    /* FOOTER */
    footer {
      border-top: 1px solid var(--border);
      padding: 32px 24px;
      text-align: center;
      position: relative;
      z-index: 1;
    }

    .footer-inner {
      max-width: 1100px;
      margin: 0 auto;
      display: flex;
      align-items: center;
      justify-content: space-between;
      flex-wrap: wrap;
      gap: 12px;
    }

    .footer-logo {
      font-size: 0.9rem;
      font-weight: 700;
      color: var(--text2);
    }

    .footer-logo span { color: var(--green); }

    .footer-text {
      font-size: 0.78rem;
      color: var(--text3);
    }

    /* Spinner */
    .spinner {
      width: 16px;
      height: 16px;
      border: 2px solid rgba(255,255,255,0.3);
      border-top-color: #fff;
      border-radius: 50%;
      animation: spin 0.7s linear infinite;
      flex-shrink: 0;
    }

    @keyframes spin { to { transform: rotate(360deg); } }

    /* Divider */
    .section-divider {
      text-align: center;
      position: relative;
      padding: 20px 0 40px;
    }

    .section-divider::before {
      content: '';
      position: absolute;
      top: 36px;
      left: 0;
      right: 0;
      height: 1px;
      background: var(--border);
    }

    .divider-label {
      position: relative;
      display: inline-block;
      background: var(--bg);
      padding: 0 20px;
      font-size: 0.78rem;
      color: var(--text3);
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 2px;
    }

    @media (max-width: 600px) {
      .hero { padding: 70px 0 40px; }
      .hero h1 { letter-spacing: -1px; }
      .card-body { padding: 20px 20px 24px; }
      .card-header { padding: 24px 20px 0; }
      .code-display { font-size: 1.8rem; letter-spacing: 4px; }
      .features { grid-template-columns: 1fr; }
      .footer-inner { justify-content: center; text-align: center; }
    }
  </style>
</head>
<body>

<div class="particles" id="particles"></div>

<nav>
  <div class="nav-inner">
    <a class="logo" href="/">
      <div class="logo-icon">💬</div>
      AMZY <span>XD</span>
    </a>
    <div class="nav-badge">● Online</div>
  </div>
</nav>

<div class="container">
  <section class="hero">
    <div class="hero-tag">⚡ Fast &amp; Secure Pairing</div>
    <h1>Connect Your WhatsApp<br /><span class="highlight">In Seconds</span></h1>
    <p>Enter your WhatsApp number below to generate a pairing code. Open WhatsApp on your phone and link the device instantly.</p>

    <div class="card">
      <div class="card-header">
        <div class="card-icon">📱</div>
        <div class="card-header-text">
          <h3>WhatsApp Pairing</h3>
          <p>Secure device linking</p>
        </div>
      </div>
      <div class="card-body">

        <div class="steps">
          <div class="step active" id="step1">
            <div class="step-num">1</div>
            <div class="step-label">Enter</div>
          </div>
          <div class="step" id="step2">
            <div class="step-num">2</div>
            <div class="step-label">Generate</div>
          </div>
          <div class="step" id="step3">
            <div class="step-num">3</div>
            <div class="step-label">Pair</div>
          </div>
        </div>

        <div class="input-group">
          <label class="input-label" for="phone">Phone Number</label>
          <div class="input-wrap">
            <span class="input-prefix">+</span>
            <input
              type="tel"
              id="phone"
              class="phone-input"
              placeholder="1234567890"
              maxlength="15"
              autocomplete="tel"
              inputmode="numeric"
            />
          </div>
          <div class="error-text" id="phoneError">Please enter a valid phone number with country code</div>
          <div class="hint">Include country code. Example: <strong>2348012345678</strong></div>
        </div>

        <button class="btn" id="pairBtn" onclick="requestPairing()">
          <div class="btn-text" id="btnContent">
            <span>Generate Pairing Code</span>
            <span>→</span>
          </div>
        </button>

        <div class="loading-bar" id="loadingBar">
          <div class="loading-bar-fill"></div>
        </div>

        <div class="status-box loading" id="statusBox">
          <div class="spinner"></div>
          <span id="statusText">Connecting to WhatsApp...</span>
        </div>

        <div class="result-box" id="resultBox">
          <div class="result-label">🔐 Your Pairing Code</div>
          <div class="code-display" id="codeDisplay"></div>
          <button class="copy-btn" id="copyBtn" onclick="copyCode()">
            <span>📋</span> <span id="copyText">Copy Code</span>
          </button>
          <div class="timer-text" id="timerText">⏱ Code expires in <span id="countdown">5:00</span></div>
        </div>

        <div class="status-box error-box" id="errorBox">
          <span>⚠️</span>
          <span id="errorText">An error occurred. Please try again.</span>
        </div>

        <div class="instructions" id="instructions">
          <div class="instructions-title">📖 How to use the code</div>
          <div class="instruction-step">
            <div class="step-dot">1</div>
            <div class="instruction-text">Open <strong>WhatsApp</strong> on your phone</div>
          </div>
          <div class="instruction-step">
            <div class="step-dot">2</div>
            <div class="instruction-text">Go to <strong>Settings → Linked Devices → Link a Device</strong></div>
          </div>
          <div class="instruction-step">
            <div class="step-dot">3</div>
            <div class="instruction-text">Tap <strong>"Link with phone number instead"</strong></div>
          </div>
          <div class="instruction-step">
            <div class="step-dot">4</div>
            <div class="instruction-text">Enter the <strong>8-digit pairing code</strong> shown above</div>
          </div>
        </div>

      </div>
    </div>
  </section>

  <div class="section-divider">
    <span class="divider-label">Why Choose Us</span>
  </div>

  <section class="features">
    <div class="feature-card">
      <div class="feature-icon g">⚡</div>
      <h4>Lightning Fast</h4>
      <p>Get your pairing code in under 30 seconds. No complicated setup required.</p>
    </div>
    <div class="feature-card">
      <div class="feature-icon b">🔒</div>
      <h4>Secure & Private</h4>
      <p>Sessions are temporary and auto-deleted after pairing. Your data is never stored.</p>
    </div>
    <div class="feature-card">
      <div class="feature-icon p">🌐</div>
      <h4>Always Online</h4>
      <p>Hosted on reliable cloud infrastructure with 99.9% uptime guarantee.</p>
    </div>
  </section>
</div>

<footer>
  <div class="footer-inner">
    <div class="footer-logo">AMZY <span>XD</span></div>
    <div class="footer-text">© 2025 AMZY XD — WhatsApp Pairing Service</div>
    <div class="footer-text">Made with 💚</div>
  </div>
</footer>

<script>
  // Particles
  (function () {
    const container = document.getElementById('particles');
    for (let i = 0; i < 30; i++) {
      const p = document.createElement('div');
      p.className = 'particle';
      p.style.left = Math.random() * 100 + '%';
      p.style.width = p.style.height = (Math.random() * 3 + 1) + 'px';
      p.style.animationDuration = (Math.random() * 15 + 10) + 's';
      p.style.animationDelay = (Math.random() * 10) + 's';
      p.style.opacity = Math.random() * 0.6 + 0.1;
      container.appendChild(p);
    }
  })();

  let currentCode = '';
  let countdownInterval = null;

  function setStep(n) {
    for (let i = 1; i <= 3; i++) {
      document.getElementById('step' + i).classList.toggle('active', i <= n);
    }
  }

  function showStatus(msg) {
    hide('errorBox');
    hide('resultBox');
    show('statusBox', 'flex');
    show('loadingBar');
    document.getElementById('statusText').textContent = msg;
    setStep(2);
  }

  function showResult(code) {
    hide('statusBox');
    hide('loadingBar');
    hide('errorBox');
    currentCode = code;
    document.getElementById('codeDisplay').textContent = code;
    show('resultBox');
    show('instructions');
    setStep(3);
    startCountdown(300);
  }

  function showError(msg) {
    hide('statusBox');
    hide('loadingBar');
    hide('resultBox');
    show('errorBox', 'flex');
    document.getElementById('errorText').textContent = msg;
    setStep(1);
    resetBtn();
  }

  function show(id, display) {
    const el = document.getElementById(id);
    el.classList.add('show');
    if (display) el.style.display = display;
  }

  function hide(id) {
    const el = document.getElementById(id);
    el.classList.remove('show');
    el.style.display = '';
  }

  function resetBtn() {
    const btn = document.getElementById('pairBtn');
    btn.disabled = false;
    document.getElementById('btnContent').innerHTML = '<span>Generate Pairing Code</span><span>→</span>';
  }

  function setLoadingBtn() {
    const btn = document.getElementById('pairBtn');
    btn.disabled = true;
    document.getElementById('btnContent').innerHTML = '<div class="spinner"></div><span>Generating...</span>';
  }

  function startCountdown(seconds) {
    if (countdownInterval) clearInterval(countdownInterval);
    let remaining = seconds;
    const el = document.getElementById('countdown');

    function update() {
      const m = Math.floor(remaining / 60);
      const s = remaining % 60;
      el.textContent = m + ':' + String(s).padStart(2, '0');
      if (remaining <= 0) {
        clearInterval(countdownInterval);
        document.getElementById('timerText').textContent = '⚠️ Code may have expired. Generate a new one.';
      }
      remaining--;
    }
    update();
    countdownInterval = setInterval(update, 1000);
  }

  async function requestPairing() {
    const phone = document.getElementById('phone').value.trim().replace(/\D/g, '');
    const phoneInput = document.getElementById('phone');
    const errEl = document.getElementById('phoneError');

    phoneInput.classList.remove('error');
    errEl.classList.remove('show');
    hide('errorBox');
    hide('resultBox');

    if (!phone || phone.length < 7 || phone.length > 15) {
      phoneInput.classList.add('error');
      errEl.classList.add('show');
      return;
    }

    setLoadingBtn();
    showStatus('Connecting to WhatsApp servers...');

    const messages = [
      'Connecting to WhatsApp servers...',
      'Initializing secure session...',
      'Requesting pairing code...',
      'Almost there, please wait...'
    ];
    let msgIdx = 0;
    const msgInterval = setInterval(() => {
      msgIdx = (msgIdx + 1) % messages.length;
      const sb = document.getElementById('statusBox');
      if (sb.classList.contains('show')) {
        document.getElementById('statusText').textContent = messages[msgIdx];
      }
    }, 4000);

    try {
      const res = await fetch('/api/pair?phone=' + encodeURIComponent(phone));
      const data = await res.json();
      clearInterval(msgInterval);

      if (data.success && data.code) {
        showResult(data.code);
        resetBtn();
      } else {
        showError(data.error || 'Failed to generate pairing code. Please try again.');
        resetBtn();
      }
    } catch (err) {
      clearInterval(msgInterval);
      showError('Network error. Please check your connection and try again.');
      resetBtn();
    }
  }

  function copyCode() {
    if (!currentCode) return;
    navigator.clipboard.writeText(currentCode.replace(/-/g, '')).then(() => {
      const btn = document.getElementById('copyBtn');
      const txt = document.getElementById('copyText');
      btn.classList.add('copied');
      txt.textContent = 'Copied!';
      setTimeout(() => {
        btn.classList.remove('copied');
        txt.textContent = 'Copy Code';
      }, 2000);
    });
  }

  // Enter key support
  document.getElementById('phone').addEventListener('keydown', function(e) {
    if (e.key === 'Enter') requestPairing();
  });

  // Only allow digits
  document.getElementById('phone').addEventListener('input', function() {
    this.value = this.value.replace(/[^\d]/g, '');
  });
</script>
</body>
</html>`;
}

app.listen(PORT, '0.0.0.0', () => {
  console.log(`WhatsApp Pairing server running on port ${PORT}`);
});
