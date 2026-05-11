import { useState, useRef } from "react";

const API = "";

function formatDate(val) {
  if (!val) return "—";
  const d = typeof val === "number" ? new Date(val * 1000) : new Date(val);
  if (isNaN(d)) return String(val);
  return d.toLocaleDateString("he-IL", { year: "numeric", month: "2-digit", day: "2-digit" });
}

function StatusBadge({ type }) {
  const map = {
    found: { label: "נמצא", cls: "bg-yellow-100 text-yellow-800" },
    deleted: { label: "נמחק", cls: "bg-red-100 text-red-700" },
    error: { label: "שגיאה", cls: "bg-orange-100 text-orange-700" },
  };
  const s = map[type] || { label: type, cls: "bg-gray-100 text-gray-600" };
  return (
    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${s.cls}`}>
      {s.label}
    </span>
  );
}

export default function App() {
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [bots, setBots] = useState([]);
  const [selectedBot, setSelectedBot] = useState("");
  const [days, setDays] = useState(30);
  const [customDate, setCustomDate] = useState("");
  const [dateMode, setDateMode] = useState("days"); // "days" | "custom"
  const [loading, setLoading] = useState(false);
  const [botsLoading, setBotsLoading] = useState(false);
  const [log, setLog] = useState([]);
  const [summary, setSummary] = useState(null);
  const [error, setError] = useState("");
  const logEndRef = useRef(null);

  const scrollToBottom = () =>
    logEndRef.current?.scrollIntoView({ behavior: "smooth" });

  async function loadBots() {
    setError("");
    setBots([]);
    setSelectedBot("");
    setSummary(null);
    setLog([]);
    if (!clientId || !clientSecret) {
      setError("יש להזין Client ID ו-Client Secret");
      return;
    }
    setBotsLoading(true);
    try {
      const res = await fetch(`${API}/api/bots`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId, clientSecret }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(JSON.stringify(data.error));
      setBots(data.bots);
      if (data.bots.length === 0) setError("לא נמצאו בוטים בחשבון זה");
    } catch (e) {
      setError(`שגיאה בטעינת בוטים: ${e.message}`);
    } finally {
      setBotsLoading(false);
    }
  }

  function computeCutoffDate() {
    if (dateMode === "custom" && customDate) {
      return new Date(customDate);
    }
    const d = new Date();
    d.setDate(d.getDate() - Number(days));
    return d;
  }

  async function runCleanup(mode) {
    setError("");
    setSummary(null);
    setLog([]);
    if (!selectedBot) {
      setError("יש לבחור בוט");
      return;
    }

    const cutoff = computeCutoffDate();
    const daysEquiv =
      dateMode === "custom" && customDate
        ? Math.ceil((Date.now() - cutoff.getTime()) / 86400000)
        : Number(days);

    setLoading(true);

    try {
      const res = await fetch(`${API}/api/cleanup`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientId,
          clientSecret,
          botId: selectedBot,
          days: daysEquiv,
          mode,
        }),
      });

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split("\n\n");
        buffer = parts.pop();
        for (const part of parts) {
          const line = part.replace(/^data: /, "").trim();
          if (!line) continue;
          try {
            const event = JSON.parse(line);
            if (event.type === "done") {
              setSummary(event);
            } else {
              setLog((prev) => [...prev, event]);
              setTimeout(scrollToBottom, 50);
            }
          } catch {}
        }
      }
    } catch (e) {
      setError(`שגיאת חיבור: ${e.message}`);
    } finally {
      setLoading(false);
    }
  }

  const cutoffDisplay = computeCutoffDate().toLocaleDateString("he-IL");

  return (
    <div dir="rtl" className="min-h-screen bg-gray-50 py-10 px-4">
      <div className="max-w-3xl mx-auto space-y-6">

        {/* Header */}
        <div className="text-center">
          <h1 className="text-3xl font-bold text-gray-800">
            SendPulse – ניקוי אנשי קשר
          </h1>
          <p className="text-gray-500 mt-1 text-sm">
            מחק אנשי קשר לא פעילים מ-WhatsApp Bot שלך
          </p>
        </div>

        {/* Credentials */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 space-y-4">
          <h2 className="font-semibold text-gray-700 text-lg border-b pb-2">אישורי API</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-600 mb-1">Client ID</label>
              <input
                type="text"
                value={clientId}
                onChange={(e) => setClientId(e.target.value)}
                placeholder="הזן Client ID"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-600 mb-1">Client Secret</label>
              <input
                type="password"
                value={clientSecret}
                onChange={(e) => setClientSecret(e.target.value)}
                placeholder="הזן Client Secret"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
              />
            </div>
          </div>
          <button
            onClick={loadBots}
            disabled={botsLoading}
            className="bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white rounded-lg px-5 py-2 text-sm font-medium transition-colors"
          >
            {botsLoading ? "טוען..." : "טען בוטים"}
          </button>
        </div>

        {/* Bot + Settings */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 space-y-5">
          <h2 className="font-semibold text-gray-700 text-lg border-b pb-2">הגדרות ניקוי</h2>

          {/* Bot select */}
          <div>
            <label className="block text-sm font-medium text-gray-600 mb-1">בחר בוט</label>
            <select
              value={selectedBot}
              onChange={(e) => setSelectedBot(e.target.value)}
              disabled={bots.length === 0}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 disabled:bg-gray-100"
            >
              <option value="">-- בחר בוט --</option>
              {bots.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name || b.id}
                </option>
              ))}
            </select>
          </div>

          {/* Date filter mode */}
          <div>
            <label className="block text-sm font-medium text-gray-600 mb-2">סינון לפי אי-פעילות</label>
            <div className="flex gap-4 text-sm mb-3">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="dateMode"
                  value="days"
                  checked={dateMode === "days"}
                  onChange={() => setDateMode("days")}
                  className="accent-blue-600"
                />
                לפי מספר ימים
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="dateMode"
                  value="custom"
                  checked={dateMode === "custom"}
                  onChange={() => setDateMode("custom")}
                  className="accent-blue-600"
                />
                לפי תאריך ספציפי
              </label>
            </div>

            {dateMode === "days" ? (
              <div className="flex items-center gap-3">
                <input
                  type="number"
                  min="1"
                  max="3650"
                  value={days}
                  onChange={(e) => setDays(e.target.value)}
                  className="w-24 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                />
                <span className="text-sm text-gray-500">ימים ללא פעילות</span>
              </div>
            ) : (
              <div className="flex items-center gap-3">
                <input
                  type="date"
                  value={customDate}
                  onChange={(e) => setCustomDate(e.target.value)}
                  className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                />
                <span className="text-sm text-gray-500">ימחקו איש קשר שלא היה פעיל מאז תאריך זה</span>
              </div>
            )}

            <p className="mt-2 text-xs text-gray-400">
              תאריך חסימה: <span className="font-semibold text-gray-600">{cutoffDisplay}</span> — ימחקו אנשי קשר שלא היו פעילים לפני תאריך זה
            </p>
          </div>

          {/* Action buttons */}
          <div className="flex gap-3 flex-wrap pt-2">
            <button
              onClick={() => runCleanup("preview")}
              disabled={loading}
              className="bg-amber-500 hover:bg-amber-600 disabled:bg-amber-300 text-white rounded-lg px-5 py-2 text-sm font-medium transition-colors"
            >
              {loading ? "סורק..." : "סריקה (Preview)"}
            </button>
            <button
              onClick={() => {
                if (
                  window.confirm(
                    "האם אתה בטוח? פעולה זו תמחק לצמיתות את כל אנשי הקשר הלא פעילים!"
                  )
                ) {
                  runCleanup("live");
                }
              }}
              disabled={loading}
              className="bg-red-600 hover:bg-red-700 disabled:bg-red-300 text-white rounded-lg px-5 py-2 text-sm font-medium transition-colors"
            >
              מחיקה סופית (Live Delete)
            </button>
          </div>
        </div>

        {/* Error */}
        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl px-4 py-3 text-sm">
            {error}
          </div>
        )}

        {/* Summary */}
        {summary && (
          <div className={`rounded-2xl border p-4 text-sm font-medium ${summary.mode === "live" ? "bg-red-50 border-red-200 text-red-800" : "bg-amber-50 border-amber-200 text-amber-800"}`}>
            {summary.mode === "live"
              ? `הסתיים. נמחקו ${summary.totalDeleted} מתוך ${summary.totalFound} אנשי קשר לא פעילים.`
              : `סריקה הסתיימה. נמצאו ${summary.totalFound} אנשי קשר לא פעילים.`}
          </div>
        )}

        {/* Log table */}
        {log.length > 0 && (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
              <h2 className="font-semibold text-gray-700">לוג פעולות</h2>
              <span className="text-xs text-gray-400">{log.length} רשומות</span>
            </div>
            <div className="overflow-auto max-h-96">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-gray-500 text-xs">
                  <tr>
                    <th className="text-right px-4 py-2 font-medium">סטטוס</th>
                    <th className="text-right px-4 py-2 font-medium">שם</th>
                    <th className="text-right px-4 py-2 font-medium">טלפון</th>
                    <th className="text-right px-4 py-2 font-medium">פעילות אחרונה</th>
                    <th className="text-right px-4 py-2 font-medium">הודעה</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {log.map((entry, i) => (
                    <tr key={i} className="hover:bg-gray-50 transition-colors">
                      <td className="px-4 py-2">
                        <StatusBadge type={entry.type} />
                      </td>
                      <td className="px-4 py-2 text-gray-700">
                        {entry.contact?.name || "—"}
                      </td>
                      <td className="px-4 py-2 text-gray-500 dir-ltr text-left">
                        {entry.contact?.phone || "—"}
                      </td>
                      <td className="px-4 py-2 text-gray-500">
                        {formatDate(entry.contact?.last_activity)}
                      </td>
                      <td className="px-4 py-2 text-gray-400 text-xs">
                        {entry.message || ""}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div ref={logEndRef} />
            </div>
          </div>
        )}

        {/* Info messages (type=info) */}
        {log.filter((e) => e.type === "info").length > 0 && log.filter((e) => e.type !== "info").length === 0 && (
          <div className="text-center text-sm text-gray-400 py-4">סריקה מתבצעת, אנא המתן...</div>
        )}

      </div>
    </div>
  );
}
