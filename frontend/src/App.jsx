import { useState, useRef, useEffect } from "react";

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
  const [clientId, setClientId] = useState(() => localStorage.getItem("sp_client_id") || "");
  const [clientSecret, setClientSecret] = useState(() => localStorage.getItem("sp_client_secret") || "");
  const [bots, setBots] = useState([]);
  const [selectedBot, setSelectedBot] = useState("");
  const [days, setDays] = useState(30);
  const [customDate, setCustomDate] = useState("");
  const [dateMode, setDateMode] = useState("days"); // "days" | "custom"
  const [loading, setLoading] = useState(false);
  const [botsLoading, setBotsLoading] = useState(false);
  const [log, setLog] = useState([]);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [deleteSelectedLoading, setDeleteSelectedLoading] = useState(false);
  const [summary, setSummary] = useState(null);
  const [error, setError] = useState("");
  const [debugResult, setDebugResult] = useState(null);
  const [debugLoading, setDebugLoading] = useState(false);
  const logEndRef = useRef(null);

  useEffect(() => {
    if (clientId) localStorage.setItem("sp_client_id", clientId);
    else localStorage.removeItem("sp_client_id");
  }, [clientId]);

  useEffect(() => {
    if (clientSecret) localStorage.setItem("sp_client_secret", clientSecret);
    else localStorage.removeItem("sp_client_secret");
  }, [clientSecret]);

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

  async function runDiagnose() {
    setDebugResult(null);
    setError("");
    if (!clientId || !clientSecret) {
      setError("יש להזין Client ID ו-Client Secret");
      return;
    }
    setDebugLoading(true);
    try {
      const res = await fetch(`${API}/api/debug`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId, clientSecret, botId: selectedBot || undefined }),
      });
      const data = await res.json();
      setDebugResult(data);
    } catch (e) {
      setError(`שגיאת אבחון: ${e.message}`);
    } finally {
      setDebugLoading(false);
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

  async function deleteSelected() {
    if (selectedIds.size === 0) return;
    if (!window.confirm(`האם למחוק ${selectedIds.size} אנשי קשר נבחרים?`)) return;

    setDeleteSelectedLoading(true);
    setError("");

    const contacts = log
      .filter(entry => entry.contact?.id && selectedIds.has(entry.contact.id))
      .map(entry => entry.contact);

    if (contacts.length === 0) {
      setError("לא נמצאו אנשי קשר למחיקה");
      setDeleteSelectedLoading(false);
      return;
    }

    try {
      const res = await fetch(`${API}/api/delete-selected`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId, clientSecret, contacts }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        throw new Error(err.error || `HTTP ${res.status}`);
      }

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
            const ev = JSON.parse(line);
            if (ev.type === "done") {
              setSummary({ ...ev, mode: "live" });
              setSelectedIds(new Set());
            } else if (ev.type === "fatal") {
              setError(`שגיאה: ${ev.message}`);
            } else {
              setLog(prev => prev.map(entry =>
                entry.contact?.id === ev.contact?.id
                  ? { ...entry, type: ev.type, message: ev.message }
                  : entry
              ));
            }
          } catch {}
        }
      }
    } catch (e) {
      setError(`שגיאת חיבור: ${e.message}`);
    } finally {
      setDeleteSelectedLoading(false);
    }
  }

  async function runCleanup(mode) {
    setError("");
    setSummary(null);
    setLog([]);
    setSelectedIds(new Set());
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
            } else if (event.type === "fatal") {
              setError(`שגיאה מה-API: ${event.message}`);
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
          <div className="flex items-center justify-between border-b pb-2">
            <h2 className="font-semibold text-gray-700 text-lg">אישורי API</h2>
            {(clientId || clientSecret) && (
              <button
                onClick={() => { setClientId(""); setClientSecret(""); }}
                className="text-xs text-gray-400 hover:text-red-500 transition-colors"
              >
                נקה שמור
              </button>
            )}
          </div>
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
            <button
              onClick={runDiagnose}
              disabled={debugLoading}
              className="bg-gray-200 hover:bg-gray-300 disabled:bg-gray-100 text-gray-700 rounded-lg px-5 py-2 text-sm font-medium transition-colors"
            >
              {debugLoading ? "בודק..." : "אבחון API"}
            </button>
          </div>
        </div>

        {/* Debug result */}
        {debugResult && (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4">
            <h2 className="font-semibold text-gray-700 mb-3 text-sm">תוצאות אבחון</h2>
            <div className="space-y-2">
              {Object.entries(debugResult).map(([ep, result]) => (
                <div key={ep} className="text-xs font-mono">
                  <span className={`inline-block w-12 text-center rounded px-1 mr-2 ${result.status === 200 ? "bg-green-100 text-green-700" : "bg-red-100 text-red-600"}`}>
                    {result.status || "err"}
                  </span>
                  <span className="text-gray-600">{ep}</span>
                  {result.status === 200 && (
                    <span className="ml-2 text-gray-400">
                      — {Array.isArray(result.data?.data) ? `${result.data.data.length} רשומות` : JSON.stringify(result.data).slice(0, 80)}
                    </span>
                  )}
                </div>
              ))}
            </div>
            <details className="mt-3">
              <summary className="text-xs text-gray-400 cursor-pointer">JSON מלא</summary>
              <pre className="text-xs mt-1 overflow-auto max-h-48 bg-gray-50 p-2 rounded">{JSON.stringify(debugResult, null, 2)}</pre>
            </details>
          </div>
        )}

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
              ? `הסתיים. נמחקו ${summary.totalDeleted} מתוך ${summary.totalFound} אנשי קשר לא פעילים (נסרקו ${summary.totalScanned ?? "?"} סה״כ).`
              : `סריקה הסתיימה. נמצאו ${summary.totalFound} אנשי קשר לא פעילים (נסרקו ${summary.totalScanned ?? "?"} סה״כ).`}
          </div>
        )}

        {/* Log table */}
        {log.length > 0 && (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between flex-wrap gap-2">
              <div className="flex items-center gap-3">
                <h2 className="font-semibold text-gray-700">לוג פעולות</h2>
                <span className="text-xs text-gray-400">{log.length} רשומות</span>
              </div>
              <div className="flex items-center gap-3">
                {log.some(e => e.type === "found") && (
                  <label className="flex items-center gap-1.5 text-xs text-gray-500 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={selectedIds.size === log.filter(e => e.type === "found").length}
                      onChange={(e) => {
                        if (e.target.checked) {
                          setSelectedIds(new Set(log.filter(e => e.type === "found").map(e => e.contact?.id).filter(Boolean)));
                        } else {
                          setSelectedIds(new Set());
                        }
                      }}
                      className="accent-blue-600"
                    />
                    בחר הכל
                  </label>
                )}
                {selectedIds.size > 0 && (
                  <button
                    type="button"
                    onClick={deleteSelected}
                    disabled={deleteSelectedLoading}
                    className="bg-red-600 hover:bg-red-700 disabled:bg-red-300 text-white rounded-lg px-4 py-1.5 text-xs font-medium transition-colors"
                  >
                    {deleteSelectedLoading ? "מוחק..." : `מחק נבחרים (${selectedIds.size})`}
                  </button>
                )}
              </div>
            </div>
            <div className="overflow-auto max-h-96">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-gray-500 text-xs">
                  <tr>
                    <th className="px-4 py-2"></th>
                    <th className="text-right px-4 py-2 font-medium">סטטוס</th>
                    <th className="text-right px-4 py-2 font-medium">שם</th>
                    <th className="text-right px-4 py-2 font-medium">טלפון</th>
                    <th className="text-right px-4 py-2 font-medium">פעילות אחרונה</th>
                    <th className="text-right px-4 py-2 font-medium">הודעה</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {log.map((entry, i) => (
                    <tr key={i} className={`hover:bg-gray-50 transition-colors ${selectedIds.has(entry.contact?.id) ? "bg-blue-50" : ""}`}>
                      <td className="px-4 py-2">
                        {entry.type === "found" && entry.contact?.id && (
                          <input
                            type="checkbox"
                            checked={selectedIds.has(entry.contact.id)}
                            onChange={() => {
                              setSelectedIds(prev => {
                                const next = new Set(prev);
                                next.has(entry.contact.id) ? next.delete(entry.contact.id) : next.add(entry.contact.id);
                                return next;
                              });
                            }}
                            className="accent-blue-600"
                          />
                        )}
                      </td>
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
                        {typeof entry.message === "object" ? JSON.stringify(entry.message) : (entry.message || "")}
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
