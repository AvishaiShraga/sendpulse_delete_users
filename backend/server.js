require("dotenv").config();
const express = require("express");
const axios = require("axios");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(express.json());

const SENDPULSE_API = "https://api.sendpulse.com";

async function getAccessToken(clientId, clientSecret) {
  const res = await axios.post(`${SENDPULSE_API}/oauth/access_token`, {
    grant_type: "client_credentials",
    client_id: clientId,
    client_secret: clientSecret,
  });
  return res.data.access_token;
}

// Returns list of bots for the given credentials
app.post("/api/bots", async (req, res) => {
  const { clientId, clientSecret } = req.body;
  if (!clientId || !clientSecret) {
    return res.status(400).json({ error: "clientId and clientSecret are required" });
  }

  try {
    const token = await getAccessToken(clientId, clientSecret);
    const botsRes = await axios.get(`${SENDPULSE_API}/chatbots/v1/bots`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    res.json({ bots: botsRes.data.data || [] });
  } catch (err) {
    const msg = err.response?.data || err.message;
    res.status(500).json({ error: msg });
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

    let offset = 0;
    const limit = 100;
    let totalFound = 0;
    let totalDeleted = 0;
    let hasMore = true;

    send({ type: "info", message: `סריקה החלה. תאריך חסימה: ${cutoffDate.toLocaleDateString("he-IL")}` });

    while (hasMore) {
      const contactsRes = await axios.get(`${SENDPULSE_API}/chatbots/v1/contacts`, {
        headers: { Authorization: `Bearer ${token}` },
        params: { bot_id: botId, offset, limit },
      });

      const contacts = contactsRes.data.data || [];
      if (contacts.length === 0) {
        hasMore = false;
        break;
      }

      for (const contact of contacts) {
        const lastActivity = contact.last_activity; // unix timestamp or ISO string
        let lastTs;

        if (typeof lastActivity === "number") {
          lastTs = lastActivity;
        } else if (typeof lastActivity === "string") {
          lastTs = new Date(lastActivity).getTime() / 1000;
        } else {
          // No activity data – treat as inactive
          lastTs = 0;
        }

        if (lastTs < cutoffTs) {
          totalFound++;
          const info = {
            id: contact.id,
            name: contact.name || contact.phone || contact.id,
            phone: contact.phone,
            last_activity: lastActivity,
          };

          if (mode === "live") {
            try {
              await axios.delete(`${SENDPULSE_API}/chatbots/v1/contacts`, {
                headers: { Authorization: `Bearer ${token}` },
                data: { contact_id: contact.id },
              });
              totalDeleted++;
              send({ type: "deleted", contact: info });
            } catch (delErr) {
              send({ type: "error", contact: info, message: delErr.response?.data || delErr.message });
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
        offset += limit;
      }
    }

    send({
      type: "done",
      totalFound,
      totalDeleted: mode === "live" ? totalDeleted : 0,
      mode,
    });
  } catch (err) {
    const msg = err.response?.data || err.message;
    send({ type: "fatal", message: typeof msg === "object" ? JSON.stringify(msg) : msg });
  }

  res.end();
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Backend running on http://localhost:${PORT}`));
