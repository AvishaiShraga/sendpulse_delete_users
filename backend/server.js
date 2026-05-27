require("dotenv").config();
const express = require("express");
const axios = require("axios");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(express.json());

const SENDPULSE_API = "https://api.sendpulse.com";
const API_TIMEOUT = 15000; // 15 seconds per request

async function getAccessToken(clientId, clientSecret) {
  const res = await axios.post(`${SENDPULSE_API}/oauth/access_token`, {
    grant_type: "client_credentials",
    client_id: clientId,
    client_secret: clientSecret,
  });
  return res.data.access_token;
}

// Debug: inspect chats structure for a specific bot
app.post("/api/debug-chats", async (req, res) => {
  const { clientId, clientSecret, botId } = req.body;
  const token = await getAccessToken(clientId, clientSecret).catch(e => null);
  if (!token) return res.json({ error: "auth failed" });

  try {
    const r = await axios.get(`${SENDPULSE_API}/whatsapp/chats`, {
      headers: { Authorization: `Bearer ${token}` },
      params: { bot_id: botId, offset: 0, limit: 2 },
    });
    res.json(r.data);
  } catch (e) {
    res.json({ error: e.response?.data || e.message });
  }
});

// Debug: probe endpoints to find what works
app.post("/api/debug", async (req, res) => {
  const { clientId, clientSecret, botId } = req.body;
  const token = await getAccessToken(clientId, clientSecret).catch(() => null);
  if (!token) return res.json({ error: "auth failed" });

  const staticEndpoints = [
    "/whatsapp/bots",
    "/chatbots/bots",
  ];

  const botEndpoints = botId ? [
    `/whatsapp/contacts?bot_id=${botId}&limit=2`,
    `/whatsapp/chats?bot_id=${botId}&limit=2`,
    `/whatsapp/${botId}/contacts`,
    `/chatbots/${botId}/subscribers?limit=2`,
  ] : [];

  const results = {};
  for (const ep of [...staticEndpoints, ...botEndpoints]) {
    try {
      const r = await axios.get(`${SENDPULSE_API}${ep}`, {
        headers: { Authorization: `Bearer ${token}` },
        timeout: API_TIMEOUT,
      });
      results[ep] = { status: r.status, data: r.data };
    } catch (e) {
      results[ep] = { status: e.response?.status, error: e.response?.data || e.message };
    }
  }
  res.json(results);
});

// Returns list of bots for the given credentials
app.post("/api/bots", async (req, res) => {
  const { clientId, clientSecret } = req.body;
  if (!clientId || !clientSecret) {
    return res.status(400).json({ error: "clientId and clientSecret are required" });
  }

  try {
    const token = await getAccessToken(clientId, clientSecret);
    const botsRes = await axios.get(`${SENDPULSE_API}/whatsapp/bots`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    res.json({ bots: botsRes.data.data || [] });
  } catch (err) {
    const msg = err.response?.data || err.message;
    res.status(500).json({ error: msg });
  }
});

// Normalize a timestamp value (number in ms or seconds, or ISO string) to Unix seconds
function toUnixSeconds(val) {
  if (val == null) return 0;
  if (typeof val === "number") {
    // Heuristic: timestamps > 1e10 are in milliseconds
    return val > 1e10 ? val / 1000 : val;
  }
  if (typeof val === "string") {
    const ms = new Date(val).getTime();
    return isNaN(ms) ? 0 : ms / 1000;
  }
  return 0;
}

// Returns a sample of raw contacts so the caller can inspect the API response structure
app.post("/api/contacts-sample", async (req, res) => {
  const { clientId, clientSecret, botId } = req.body;
  if (!clientId || !clientSecret || !botId) {
    return res.status(400).json({ error: "clientId, clientSecret and botId are required" });
  }
  try {
    const token = await getAccessToken(clientId, clientSecret);
    const r = await axios.get(`${SENDPULSE_API}/whatsapp/contacts`, {
      headers: { Authorization: `Bearer ${token}` },
      params: { bot_id: botId, offset: 0, limit: 3 },
    });
    res.json({ raw: r.data });
  } catch (err) {
    res.status(500).json({ error: err.response?.data || err.message });
  }
});

// Preview or live-delete inactive contacts
// Body: { clientId, clientSecret, botId, days, mode: "preview"|"live" }
app.post("/api/cleanup", async (req, res) => {
  const { clientId, clientSecret, botId, days, mode } = req.body;

  if (!clientId || !clientSecret || !botId || !days || !mode) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - Number(days));
  const cutoffTs = cutoffDate.getTime() / 1000; // unix seconds

  // Set SSE headers for real-time streaming
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  const send = (data) => res.write(`data: ${JSON.stringify(data)}\n\n`);

  try {
    const token = await getAccessToken(clientId, clientSecret);

    let page = 1;
    const limit = 100;
    let totalFound = 0;
    let totalDeleted = 0;
    let totalScanned = 0;
    let hasMore = true;
    const seenIds = new Set();

    send({ type: "info", message: `סריקה החלה. תאריך חסימה: ${cutoffDate.toLocaleDateString("he-IL")}` });

    while (hasMore) {
      const contactsRes = await axios.get(`${SENDPULSE_API}/whatsapp/contacts`, {
        headers: { Authorization: `Bearer ${token}` },
        params: { bot_id: botId, page, limit },
        timeout: API_TIMEOUT,
      });

      const contacts = contactsRes.data.data || contactsRes.data || [];
      if (!Array.isArray(contacts) || contacts.length === 0) {
        hasMore = false;
        break;
      }

      // Detect infinite loop: stop if every ID on this page was already seen
      const newContacts = contacts.filter(c => !seenIds.has(c.id));
      if (newContacts.length === 0) {
        hasMore = false;
        break;
      }
      newContacts.forEach(c => seenIds.add(c.id));

      for (const contact of newContacts) {
        totalScanned++;
        // Try the most common field names for last activity
        const lastActivityRaw =
          contact.last_message_at ??
          contact.last_activity_at ??
          contact.last_activity ??
          contact.updated_at ??
          contact.created_at ??
          null;

        const lastTs = toUnixSeconds(lastActivityRaw);

        if (lastTs < cutoffTs) {
          totalFound++;
          const phone =
            contact.phone ||
            contact.phone_number ||
            contact.msisdn ||
            contact.whatsapp ||
            contact.channel_data?.phone ||
            null;

          const info = {
            id: contact.id,
            name: contact.name || phone || contact.id,
            phone,
            last_activity: lastActivityRaw,
          };

          if (mode === "live") {
            try {
              await axios.delete(`${SENDPULSE_API}/whatsapp/contacts/${contact.id}`, {
                headers: { Authorization: `Bearer ${token}` },
              });
              totalDeleted++;
              send({ type: "deleted", contact: info });
            } catch (delErr) {
              // Fallback: try POST-based delete
              try {
                await axios.post(`${SENDPULSE_API}/whatsapp/contacts/delete`, {
                  id: contact.id,
                }, { headers: { Authorization: `Bearer ${token}` } });
                totalDeleted++;
                send({ type: "deleted", contact: info });
              } catch (delErr2) {
                send({ type: "error", contact: info, message: typeof delErr2.response?.data === "object" ? JSON.stringify(delErr2.response.data) : (delErr2.response?.data || delErr2.message) });
              }
            }
            // Rate-limit guard
            await new Promise((r) => setTimeout(r, 300));
          } else {
            send({ type: "found", contact: info });
          }
        }
      }

      if (contacts.length < limit) {
        hasMore = false;
      } else {
        page++;
      }
    }

    send({
      type: "done",
      totalFound,
      totalScanned,
      totalDeleted: mode === "live" ? totalDeleted : 0,
      mode,
    });
  } catch (err) {
    const msg = err.response?.data || err.message;
    send({ type: "fatal", message: typeof msg === "object" ? JSON.stringify(msg) : msg });
  }

  res.end();
});

// Delete a specific list of contacts (by id) — SSE streaming
// Body: { clientId, clientSecret, contacts: [{id, name, phone, last_activity}] }
app.post("/api/delete-selected", async (req, res) => {
  const { clientId, clientSecret, contacts } = req.body;
  if (!clientId || !clientSecret || !Array.isArray(contacts) || contacts.length === 0) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  const send = (data) => res.write(`data: ${JSON.stringify(data)}\n\n`);

  try {
    const token = await getAccessToken(clientId, clientSecret);
    let totalDeleted = 0;

    for (const contact of contacts) {
      try {
        await axios.delete(`${SENDPULSE_API}/whatsapp/contacts/${contact.id}`, {
          headers: { Authorization: `Bearer ${token}` },
          timeout: API_TIMEOUT,
        });
        totalDeleted++;
        send({ type: "deleted", contact });
      } catch {
        try {
          await axios.post(`${SENDPULSE_API}/whatsapp/contacts/delete`, {
            contact_id: contact.id,
          }, { headers: { Authorization: `Bearer ${token}` }, timeout: API_TIMEOUT });
          totalDeleted++;
          send({ type: "deleted", contact });
        } catch (err2) {
          send({ type: "error", contact, message: typeof err2.response?.data === "object" ? JSON.stringify(err2.response.data) : (err2.response?.data || err2.message) });
        }
      }
      await new Promise((r) => setTimeout(r, 300));
    }

    send({ type: "done", totalDeleted, totalFound: contacts.length, mode: "live" });
  } catch (err) {
    const msg = err.response?.data || err.message;
    send({ type: "fatal", message: typeof msg === "object" ? JSON.stringify(msg) : msg });
  }

  res.end();
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Backend running on http://localhost:${PORT}`));
