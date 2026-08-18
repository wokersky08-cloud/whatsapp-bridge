import express from "express";
import pino from "pino";
import QRCode from "qrcode";
import { Boom } from "@hapi/boom";
import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  downloadMediaMessage,
} from "@whiskeysockets/baileys";
import fs from "node:fs";
import path from "node:path";

const PORT = process.env.PORT || 3000;
const BRIDGE_TOKEN = process.env.BRIDGE_TOKEN || "";
const APP_URL = (process.env.APP_URL || "").replace(/\/$/, "");
const SESSIONS_DIR = process.env.SESSIONS_DIR || "./sessions";

const logger = pino({ level: "warn" });
const app = express();
app.use(express.json({ limit: "5mb" }));

/** botId -> { sock, status, qr, phone } */
const sessions = new Map();

function auth(req, res, next) {
  if (!BRIDGE_TOKEN) return res.status(500).json({ error: "BRIDGE_TOKEN орнатылмаған" });
  const header = req.headers["authorization"] || "";
  if (header !== `Bearer ${BRIDGE_TOKEN}`) return res.status(401).json({ error: "unauthorized" });
  next();
}

function state(botId) {
  if (!sessions.has(botId)) {
    sessions.set(botId, { sock: null, status: "disconnected", qr: null, phone: null });
  }
  return sessions.get(botId);
}

async function postToApp(botId, payload) {
  if (!APP_URL) return;
  try {
    await fetch(`${APP_URL}/api/public/bridge/webhook/${botId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-bridge-token": BRIDGE_TOKEN },
      body: JSON.stringify(payload),
    });
  } catch (e) {
    logger.error({ e }, "webhook post failed");
  }
}

async function startSession(botId) {
  const s = state(botId);
  if (s.sock) return s;

  const dir = path.join(SESSIONS_DIR, botId);
  fs.mkdirSync(dir, { recursive: true });
  const { state: authState, saveCreds } = await useMultiFileAuthState(dir);
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    auth: authState,
    logger,
    printQRInTerminal: false,
    browser: ["Bot Constructor", "Chrome", "1.0.0"],
    syncFullHistory: false,
  });
  s.sock = sock;
  s.status = "connecting";

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", async (u) => {
    const { connection, lastDisconnect, qr } = u;
    if (qr) {
      s.qr = await QRCode.toDataURL(qr);
      s.status = "qr";
    }
    if (connection === "open") {
      s.status = "connected";
      s.qr = null;
      s.phone = (sock.user?.id || "").split(":")[0] || null;
    }
    if (connection === "close") {
      const code = new Boom(lastDisconnect?.error)?.output?.statusCode;
      s.sock = null;
      if (code === DisconnectReason.loggedOut) {
        s.status = "disconnected";
        s.qr = null;
        s.phone = null;
        fs.rmSync(dir, { recursive: true, force: true });
      } else {
        s.status = "connecting";
        setTimeout(() => startSession(botId).catch(() => {}), 3000);
      }
    }
  });

  sock.ev.on("messages.upsert", async (ev) => {
    if (ev.type !== "notify") return;
    for (const m of ev.messages) {
      if (!m.message || m.key.fromMe) continue;
      const jid = m.key.remoteJid || "";
      if (jid.endsWith("@g.us") || jid === "status@broadcast") continue;
      const chatId = jid.split("@")[0];
      const msg = m.message;
      const text =
        msg.conversation ||
        msg.extendedTextMessage?.text ||
        msg.imageMessage?.caption ||
        msg.buttonsResponseMessage?.selectedButtonId ||
        msg.listResponseMessage?.title ||
        null;

      let audioBase64 = null;
      let audioMime = null;
      if (msg.audioMessage) {
        try {
          const buf = await downloadMediaMessage(m, "buffer", {}, { logger, reuploadRequest: sock.updateMediaMessage });
          audioBase64 = buf.toString("base64");
          audioMime = msg.audioMessage.mimetype || "audio/ogg";
        } catch (e) {
          logger.error({ e }, "audio download failed");
        }
      }

      await postToApp(botId, {
        chatId,
        contactName: m.pushName || null,
        text,
        audioBase64,
        audioMime,
      });
    }
  });

  return s;
}

app.get("/health", (_req, res) => res.json({ ok: true }));

app.get("/session/:botId/status", auth, async (req, res) => {
  const s = state(req.params.botId);
  res.json({ status: s.status, qr: s.qr, phone: s.phone });
});

app.post("/session/:botId/connect", auth, async (req, res) => {
  try {
    const s = await startSession(req.params.botId);
    // Give Baileys a moment to emit the QR code.
    for (let i = 0; i < 25 && !s.qr && s.status !== "connected"; i++) {
      await new Promise((r) => setTimeout(r, 400));
    }
    res.json({ status: s.status, qr: s.qr, phone: s.phone });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

app.post("/session/:botId/send", auth, async (req, res) => {
  const { chatId, text } = req.body || {};
  if (!chatId || !text) return res.status(400).json({ error: "chatId және text қажет" });
  const s = state(req.params.botId);
  if (!s.sock || s.status !== "connected") {
    return res.status(409).json({ error: "сессия қосылмаған" });
  }
  try {
    const jid = String(chatId).includes("@") ? String(chatId) : `${chatId}@s.whatsapp.net`;
    await s.sock.sendMessage(jid, { text: String(text) });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

app.post("/session/:botId/logout", auth, async (req, res) => {
  const botId = req.params.botId;
  const s = state(botId);
  try {
    if (s.sock) await s.sock.logout();
  } catch {
    /* ignore */
  }
  s.sock = null;
  s.status = "disconnected";
  s.qr = null;
  s.phone = null;
  fs.rmSync(path.join(SESSIONS_DIR, botId), { recursive: true, force: true });
  res.json({ ok: true });
});

app.listen(PORT, () => console.log(`WhatsApp bridge listening on ${PORT}`));
