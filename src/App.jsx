import { useState, useEffect, useMemo } from "react";
import { createClient } from "@supabase/supabase-js";

// ─── Supabase Setup ───────────────────────────────────────────────────────────
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || "https://your-project.supabase.co";
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_KEY || "your-anon-key";
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// ─── Scoring Systems ───────────────────────────────────────────────────────────
const SYSTEMS = [
  {
    id: "inv", name: "Inverse Rank", sub: "Winner = 1pt · Last = N pts",
    note: "Lower total score = better rank", color: "#22d3a0", lowerBetter: true,
    dist: n => Array.from({ length: n }, (_, i) => i + 1),
    pts: (rank) => rank,
  },
  {
    id: "f1l", name: "F1 Legacy", sub: "10 · 7 · 6 · 5 · 4 · 3 · 2 · 0",
    note: "Higher total score = better rank", color: "#f97316", lowerBetter: false,
    dist: n => [10, 7, 6, 5, 4, 3, 2, 0].slice(0, n),
    pts: (rank) => [10,7,6,5,4,3,2,0][Math.min(rank-1, 7)],
  },
  {
    id: "raw", name: "Raw Score", sub: "Direct sum of all match scores",
    note: "Direct sum of all match scores", color: "#60a5fa", lowerBetter: false,
    pts: (rank, n, score) => score,
  },
  {
    id: "f1m", name: "F1 Modern", sub: "25 · 18 · 15 · 12 · 10 · 8 · 6 · 4",
    note: "Higher total score = better rank", color: "#c084fc", lowerBetter: false,
    dist: n => [25, 18, 15, 12, 10, 8, 6, 4, 2, 1].slice(0, n),
    pts: (rank) => [25,18,15,12,10,8,6,4,2,1,0][Math.min(rank-1, 10)],
  },
];

const MEDALS = ["🥇", "🥈", "🥉"];
const ORD = ["1st","2nd","3rd","4th","5th","6th","7th","8th","9th","10th"];

// ─── Stats Computation ────────────────────────────────────────────────────────
function computeBasicStats(players, games) {
  const rows = players.map(p => {
    const all = games.map(g => g.scores[p]);
    const played = all.filter(s => s != null);
    const total = played.reduce((a, b) => a + b, 0);
    const avg = played.length ? total / played.length : 0;
    const std = Math.sqrt(played.length ? played.reduce((a, b) => a + (b - avg) ** 2, 0) / played.length : 0);
    const wins = games.filter(g => {
      if (g.scores[p] == null) return false;
      return !players.some(q => g.scores[q] != null && g.scores[q] > g.scores[p]);
    }).length;
    const pods = games.filter(g => {
      if (g.scores[p] == null) return false;
      return players.filter(q => g.scores[q] != null && g.scores[q] > g.scores[p]).length < 3;
    }).length;
    return { player: p, total, avg, std, high: played.length ? Math.max(...played) : 0, low: played.length ? Math.min(...played) : 0, wins, pods };
  });
  const sorted = [...rows].sort((a, b) => b.total - a.total);
  rows.forEach(r => { r.rank = sorted.findIndex(s => s.player === r.player) + 1; });
  return rows;
}

function getSysPointsForRange(sys, startRank, endRank, score) {
  if (sys.id === "raw") return score;
  return sys.pts(startRank, undefined, score);
}

function computeSysTable(players, games, sys) {
  const acc = Object.fromEntries(players.map(p => [p, { pts: 0, wins: 0, pods: 0, played: 0 }]));
  games.forEach(g => {
    const playing = players.map(p => ({ p, s: g.scores[p] })).filter(e => e.s != null).sort((a, b) => b.s - a.s);
    for (let i = 0; i < playing.length;) {
      const score = playing[i].s;
      let j = i + 1;
      while (j < playing.length && playing[j].s === score) j += 1;
      const startRank = i + 1;
      const pts = getSysPointsForRange(sys, startRank, j, score);
      for (let k = i; k < j; k++) {
        const p = playing[k].p;
        acc[p].pts += pts;
        acc[p].played++;
        if (startRank === 1) acc[p].wins++;
        if (startRank <= 3) acc[p].pods++;
      }
      i = j;
    }
  });
  const rows = players.map(p => ({ player: p, ...acc[p], avg: games.length ? acc[p].pts / games.length : 0 }));
  const sortedRows = [...rows].sort((a, b) => sys.lowerBetter ? a.pts - b.pts : b.pts - a.pts);
  sortedRows.forEach((r, i, arr) => { r.rank = i === 0 ? 1 : r.pts === arr[i-1].pts ? arr[i-1].rank : i + 1; });
  return sortedRows;
}

// ─── NEW: Form Guide (last N games per player) ────────────────────────────────
function computeFormGuide(players, games, n = 5) {
  const lastN = games.slice(-n);
  const guide = {};
  players.forEach(p => {
    guide[p] = lastN.map(g => {
      if (g.scores[p] == null) return "ns";
      const sorted = players.filter(q => g.scores[q] != null).sort((a, b) => g.scores[b] - g.scores[a]);
      const rank = sorted.indexOf(p) + 1;
      if (rank === 1) return "win";
      if (rank <= 3) return "pod";
      return "loss";
    });
  });
  return guide;
}

// ─── NEW: Auto-generated Data Insights ────────────────────────────────────────
function computeInsights(players, games, basicStats) {
  if (!games.length || !basicStats.length) return [];
  const insights = [];

  // 1. Overall leader
  const leader = [...basicStats].sort((a, b) => a.rank - b.rank)[0];
  if (leader) insights.push({ icon: "👑", label: "Overall Leader", text: leader.player, sub: `${leader.wins} wins · ${leader.total.toFixed(1)} pts total`, color: "#fbbf24" });

  // 2. Hot streak (wins in last 3 games)
  if (games.length >= 2) {
    const last3 = games.slice(-Math.min(3, games.length));
    const streaks = players.map(p => ({
      p,
      wins: last3.filter(g => {
        if (g.scores[p] == null) return false;
        return !players.some(q => q !== p && g.scores[q] != null && g.scores[q] > g.scores[p]);
      }).length
    })).sort((a, b) => b.wins - a.wins);
    if (streaks[0]?.wins >= 2) {
      insights.push({ icon: "🔥", label: "Hot Streak", text: streaks[0].p, sub: `${streaks[0].wins}/${last3.length} recent wins`, color: "#f97316" });
    }
  }

  // 3. Most consistent (lowest std dev)
  const withGames = basicStats.filter(r => r.avg > 0);
  if (withGames.length) {
    const consistent = [...withGames].sort((a, b) => a.std - b.std)[0];
    insights.push({ icon: "🎯", label: "Most Consistent", text: consistent.player, sub: `±${consistent.std.toFixed(1)} std dev`, color: "#22d3a0" });
  }

  // 4. Highest single-game score
  let bigGame = { player: null, score: -Infinity, gameNum: 0 };
  games.forEach((g, gi) => {
    players.forEach(p => {
      if (g.scores[p] != null && g.scores[p] > bigGame.score) {
        bigGame = { player: p, score: g.scores[p], gameNum: gi + 1 };
      }
    });
  });
  if (bigGame.player) {
    insights.push({ icon: "⚡", label: "Record Score", text: bigGame.player, sub: `${bigGame.score.toFixed(1)} pts in Game #${bigGame.gameNum}`, color: "#c084fc" });
  }

  // 5. Most improved (last 3 avg vs overall avg)
  if (games.length >= 4) {
    const last3 = games.slice(-3);
    const improved = players.map(p => {
      const scores = last3.map(g => g.scores[p]).filter(s => s != null);
      if (!scores.length) return null;
      const last3avg = scores.reduce((a, b) => a + b, 0) / scores.length;
      const overall = basicStats.find(r => r.player === p)?.avg || 0;
      return { p, delta: last3avg - overall };
    }).filter(Boolean).sort((a, b) => b.delta - a.delta);
    if (improved[0]?.delta > 0) {
      insights.push({ icon: "📈", label: "Most Improved", text: improved[0].p, sub: `+${improved[0].delta.toFixed(1)} above season avg`, color: "#60a5fa" });
    }
  }

  return insights;
}

// ─── Main App ─────────────────────────────────────────────────────────────────
export default function App() {
  const [data, setData] = useState(null);
  const [tab, setTab] = useState("stats");
  const [sorts, setSorts] = useState({});
  const [loading, setLoading] = useState(true);
  const [adminMode, setAdminMode] = useState(false);
  const [adminPassword, setAdminPassword] = useState("");
  const [gameForm, setGameForm] = useState({});
  const [loadDots, setLoadDots] = useState(0);

  useEffect(() => {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = "https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@400;600;700;800;900&family=IBM+Plex+Mono:wght@400;500;600&display=swap";
    document.head.appendChild(link);

    // Inject global CSS for animations & hover effects
    const style = document.createElement("style");
    style.textContent = `
      * { box-sizing: border-box; }
      tr.data-row { transition: background 0.12s ease; }
      tr.data-row:hover { background: rgba(88, 166, 255, 0.06) !important; }
      .insight-card { transition: transform 0.15s ease, box-shadow 0.15s ease; cursor: default; }
      .insight-card:hover { transform: translateY(-3px); box-shadow: 0 10px 30px rgba(0,0,0,0.5); }
      .tab-btn { transition: color 0.15s ease; }
      .tab-btn:hover { color: #e6edf3 !important; }
      @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.3; } }
      @keyframes spin { to { transform: rotate(360deg); } }
      @keyframes fadeSlideIn { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
      .live-dot { animation: pulse 2s ease-in-out infinite; }
      .loading-ring { animation: spin 1s linear infinite; transform-origin: center; }
      .fade-in { animation: fadeSlideIn 0.35s ease forwards; }
      input:focus { border-color: #58a6ff !important; outline: none; }
      ::-webkit-scrollbar { height: 4px; width: 4px; }
      ::-webkit-scrollbar-track { background: transparent; }
      ::-webkit-scrollbar-thumb { background: #30363d; border-radius: 2px; }
    `;
    document.head.appendChild(style);
  }, []);

  // Animate loading dots
  useEffect(() => {
    if (!loading) return;
    const t = setInterval(() => setLoadDots(d => (d + 1) % 4), 380);
    return () => clearInterval(t);
  }, [loading]);

  // Load data from Supabase + real-time subscription
  useEffect(() => {
    loadData();
    const channel = supabase
      .channel("games-changes")
      .on("postgres_changes", { event: "*", schema: "public", table: "games" }, () => { loadData(); })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      const { data: playersData } = await supabase.from("players").select("name").order("name", { ascending: true });
      const { data: gamesData } = await supabase.from("games").select("*").order("game_number", { ascending: true });
      if (playersData?.length && gamesData?.length) {
        setData({
          players: playersData.map(p => p.name),
          games: gamesData.map(g => ({ id: g.id, scores: g.scores })),
          name: "Live Fantasy League",
        });
      }
    } catch (err) {
      console.error("Error loading data:", err);
    }
    setLoading(false);
  };

  const handleAddGame = async () => {
    if (!adminPassword) { alert("Enter admin password"); return; }
    if (adminPassword !== "league2024") { alert("Wrong password"); setAdminPassword(""); return; }
    try {
      const scores = {};
      data.players.forEach(p => { const val = gameForm[p]; scores[p] = val ? parseFloat(val) : null; });
      await supabase.from("games").insert([{ game_number: (data.games.length || 0) + 1, scores }]);
      setGameForm({}); setAdminPassword(""); setAdminMode(false);
      await loadData();
    } catch (err) { console.error("Error adding game:", err); alert("Failed to add game"); }
  };

  const basicStats = useMemo(() => data ? computeBasicStats(data.players, data.games) : [], [data]);
  const sysTables  = useMemo(() => data ? Object.fromEntries(SYSTEMS.map(sys => [sys.id, computeSysTable(data.players, data.games, sys)])) : {}, [data]);
  const formGuide  = useMemo(() => data ? computeFormGuide(data.players, data.games) : {}, [data]);
  const insights   = useMemo(() => data ? computeInsights(data.players, data.games, basicStats) : [], [data, basicStats]);

  const getSorted = (rows, key) => {
    const s = sorts[key];
    if (!s) return rows;
    return [...rows].sort((a, b) => {
      const cmp = typeof a[s.col] === "number" ? a[s.col] - b[s.col] : String(a[s.col]).localeCompare(String(b[s.col]));
      return s.asc ? cmp : -cmp;
    });
  };
  const onSort = (key, col) => setSorts(p => ({ ...p, [key]: p[key]?.col === col ? { col, asc: !p[key].asc } : { col, asc: false } }));

  // ─── Style tokens ──────────────────────────────────────────────────────────
  const C = {
    bg: "#0d1117", surf: "#161b22", surf2: "#21262d",
    border: "#30363d", text: "#e6edf3", muted: "#8b949e",
    fnt: "'Barlow Condensed',sans-serif", mono: "'IBM Plex Mono',monospace",
  };

  // ─── Reusable sub-components ───────────────────────────────────────────────
  const Rank = ({ r }) => r <= 3
    ? <span style={{ fontSize: 20 }}>{MEDALS[r - 1]}</span>
    : <span style={{ color: C.muted, fontFamily: C.mono, fontSize: 13 }}>#{r}</span>;

  const TH = ({ id, col, lbl, align = "right" }) => {
    const active = sorts[id]?.col === col;
    return (
      <th onClick={() => onSort(id, col)} style={{ padding: "11px 14px", textAlign: align, background: C.surf2, color: active ? "#58a6ff" : C.muted, fontSize: 11, fontWeight: 700, letterSpacing: 2, textTransform: "uppercase", borderBottom: `2px solid ${C.border}`, cursor: "pointer", whiteSpace: "nowrap", userSelect: "none", fontFamily: C.fnt }}>
        {lbl}{active ? (sorts[id].asc ? " ▲" : " ▼") : ""}
      </th>
    );
  };

  const TD = ({ v, align = "right", color, weight, size = 14, mono = true }) => (
    <td style={{ padding: "11px 14px", textAlign: align, borderBottom: `1px solid ${C.surf2}`, color: color || C.text, fontWeight: weight || 400, fontSize: size, fontFamily: mono ? C.mono : C.fnt }}>
      {v}
    </td>
  );

  // NEW: Form guide dot (W / P / L / –)
  const FormDot = ({ result }) => {
    const map = { win: ["#22d3a0", "W"], pod: ["#fbbf24", "P"], loss: ["#f85149", "L"], ns: ["#2d333b", "–"] };
    const [bg, lbl] = map[result] || map.ns;
    return (
      <span title={result === "win" ? "Win" : result === "pod" ? "Podium" : result === "loss" ? "Loss" : "Not played"}
        style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 22, height: 22, borderRadius: 5, background: bg, fontSize: 10, fontWeight: 800, color: result === "ns" ? C.muted : "#0d1117", fontFamily: C.mono, margin: "0 1px", border: `1px solid ${bg === "#2d333b" ? C.border : "transparent"}` }}>
        {lbl}
      </span>
    );
  };

  const n1 = v => v?.toLocaleString(undefined, { maximumFractionDigits: 1 }) ?? "—";
  const n2 = v => v?.toFixed(2) ?? "—";

  // ─── Loading screen ────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div style={{ minHeight: "100vh", background: C.bg, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 24, fontFamily: C.fnt }}>
        <div style={{ position: "relative", width: 72, height: 72 }}>
          <svg viewBox="0 0 72 72" className="loading-ring" style={{ width: 72, height: 72, display: "block" }}>
            <circle cx="36" cy="36" r="30" fill="none" stroke={C.surf2} strokeWidth="5" />
            <circle cx="36" cy="36" r="30" fill="none" stroke="#58a6ff" strokeWidth="5" strokeDasharray="68 120" strokeLinecap="round" />
          </svg>
          <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 26 }}>⚡</div>
        </div>
        <div>
          <div style={{ color: "#58a6ff", fontSize: 24, fontWeight: 800, letterSpacing: 3, textTransform: "uppercase", textAlign: "center" }}>
            Loading{".".repeat(loadDots)}
          </div>
          <div style={{ color: C.muted, fontSize: 13, textAlign: "center", marginTop: 6 }}>Fetching league data from Supabase</div>
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div style={{ minHeight: "100vh", background: C.bg, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 24, fontFamily: C.fnt }}>
        <div style={{ fontSize: 56 }}>⚠️</div>
        <div style={{ fontSize: 20, color: C.text, textAlign: "center" }}>
          No data found. Check Supabase connection.<br />
          <span style={{ fontSize: 12, color: C.muted, marginTop: 8, display: "block" }}>Verify SUPABASE_URL and SUPABASE_KEY</span>
        </div>
      </div>
    );
  }

  // ─── Dashboard ─────────────────────────────────────────────────────────────
  const allTabs = [{ id: "stats", label: "📊 Overview", color: "#58a6ff" }, ...SYSTEMS.map(s => ({ id: s.id, label: s.name, color: s.color }))];
  const topW = [...basicStats].sort((a, b) => b.wins - a.wins)[0];
  const topS = [...basicStats].sort((a, b) => b.total - a.total)[0];

  return (
    <div style={{ minHeight: "100vh", background: C.bg, color: C.text, fontFamily: C.fnt }}>

      {/* ── Header ── */}
      <div style={{ background: "linear-gradient(135deg,#0d1117 0%,#161b22 60%,#1a2040 100%)", borderBottom: `1px solid ${C.border}`, padding: "18px 28px" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <div style={{ fontSize: 30, fontWeight: 900, letterSpacing: 4, color: "#58a6ff", textTransform: "uppercase" }}>⚡ Fantasy League</div>
              <div style={{ display: "flex", alignItems: "center", gap: 5, background: "rgba(34, 197, 94, 0.1)", border: "1px solid rgba(34, 197, 94, 0.3)", borderRadius: 20, padding: "3px 10px" }}>
                <span className="live-dot" style={{ width: 7, height: 7, borderRadius: "50%", background: "#22c55e", display: "inline-block" }} />
                <span style={{ fontSize: 11, fontWeight: 700, color: "#22c55e", letterSpacing: 1.5 }}>LIVE</span>
              </div>
            </div>
            <div style={{ color: C.muted, fontSize: 13, marginTop: 5, display: "flex", gap: 18, flexWrap: "wrap", alignItems: "center" }}>
              <span>📁 {data.name}</span>
              <span>👥 {data.players.length} players</span>
              <span>🎮 {data.games.length} games played</span>
              {topS && <span>🏆 Leader: <strong style={{ color: "#fbbf24" }}>{topS.player}</strong></span>}
            </div>
          </div>
          <button
            onClick={() => setAdminMode(m => !m)}
            style={{ background: adminMode ? "rgba(248,81,73,0.1)" : C.surf2, border: `1px solid ${adminMode ? "#f85149" : C.border}`, borderRadius: 8, padding: "8px 18px", cursor: "pointer", color: adminMode ? "#f85149" : C.muted, fontSize: 13, fontWeight: 700, fontFamily: C.fnt, letterSpacing: 1, textTransform: "uppercase", transition: "all 0.15s" }}
          >
            {adminMode ? "✕ Close" : "⚙ Admin"}
          </button>
        </div>
      </div>

      {/* ── Admin Panel ── */}
      {adminMode && (
        <div className="fade-in" style={{ background: "rgba(248,81,73,0.04)", borderBottom: `1px solid rgba(248,81,73,0.2)`, padding: "20px 28px" }}>
          <div style={{ maxWidth: 1200, margin: "0 auto" }}>
            <div style={{ fontSize: 14, fontWeight: 800, letterSpacing: 2, color: "#f85149", textTransform: "uppercase", marginBottom: 14 }}>
              ➕ Add Game #{data.games.length + 1}
            </div>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
              {data.players.map(p => (
                <div key={p} style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                  <label style={{ color: C.muted, fontSize: 10, fontWeight: 700, letterSpacing: 1.5, textTransform: "uppercase" }}>{p}</label>
                  <input
                    type="number" placeholder="Score"
                    value={gameForm[p] || ""}
                    onChange={e => setGameForm(f => ({ ...f, [p]: e.target.value }))}
                    style={{ background: C.surf2, border: `1px solid ${C.border}`, borderRadius: 6, padding: "8px 12px", color: C.text, fontFamily: C.mono, fontSize: 14, width: 90, transition: "border-color 0.15s" }}
                  />
                </div>
              ))}
              <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                <label style={{ color: C.muted, fontSize: 10, fontWeight: 700, letterSpacing: 1.5, textTransform: "uppercase" }}>Password</label>
                <input
                  type="password" placeholder="Admin pass"
                  value={adminPassword}
                  onChange={e => setAdminPassword(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && handleAddGame()}
                  style={{ background: C.surf2, border: `1px solid ${C.border}`, borderRadius: 6, padding: "8px 12px", color: C.text, fontFamily: C.mono, fontSize: 14, width: 130, transition: "border-color 0.15s" }}
                />
              </div>
              <button
                onClick={handleAddGame}
                style={{ background: "#f85149", border: "none", borderRadius: 6, padding: "9px 22px", cursor: "pointer", color: "#fff", fontFamily: C.fnt, fontSize: 14, fontWeight: 800, letterSpacing: 1, textTransform: "uppercase" }}
              >
                Submit
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Tab Bar ── */}
      <div style={{ display: "flex", gap: 2, padding: "0 20px", background: C.surf, borderBottom: `1px solid ${C.border}`, overflowX: "auto" }}>
        {allTabs.map(t => (
          <button key={t.id} className="tab-btn" onClick={() => setTab(t.id)}
            style={{ padding: "14px 20px", border: "none", borderBottom: `3px solid ${tab === t.id ? t.color : "transparent"}`, cursor: "pointer", fontFamily: C.fnt, fontSize: 14, fontWeight: 700, letterSpacing: 1, textTransform: "uppercase", whiteSpace: "nowrap", background: "transparent", color: tab === t.id ? t.color : C.muted }}>
            {t.label}
          </button>
        ))}
      </div>

      <div style={{ padding: "24px", maxWidth: 1200, margin: "0 auto" }}>

        {/* ══ STATS OVERVIEW TAB ══ */}
        {tab === "stats" && (
          <div className="fade-in">

            {/* Stat Cards */}
            <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginBottom: 20 }}>
              {[
                { label: "Total Games", val: data.games.length, color: "#58a6ff", icon: "🎮", sub: null },
                { label: "Players",     val: data.players.length, color: "#c084fc", icon: "👥", sub: null },
                { label: "Most Wins",   val: topW?.player, sub: `${topW?.wins} wins`, color: "#f97316", icon: "🏆" },
                { label: "Top Scorer",  val: topS?.player, sub: `${n1(topS?.total)} total pts`, color: "#22d3a0", icon: "🥇" },
                { label: "Record Score",val: n1(Math.max(...basicStats.map(s => s.high))), sub: "single game high", color: "#fbbf24", icon: "⚡" },
              ].map(({ label, val, sub, color, icon }) => (
                <div key={label} style={{ background: C.surf, border: `1px solid ${C.border}`, borderTop: `3px solid ${color}`, borderRadius: 12, padding: "16px 20px", flex: 1, minWidth: 130 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
                    <span style={{ fontSize: 14 }}>{icon}</span>
                    <span style={{ color: C.muted, fontSize: 10, fontWeight: 700, letterSpacing: 2, textTransform: "uppercase" }}>{label}</span>
                  </div>
                  <div style={{ fontSize: sub ? 21 : 28, fontWeight: 800, color, fontFamily: C.mono, lineHeight: 1.1 }}>{val}</div>
                  {sub && <div style={{ color: C.muted, fontSize: 11, marginTop: 4 }}>{sub}</div>}
                </div>
              ))}
            </div>

            {/* ── Quick Insights ── */}
            {insights.length > 0 && (
              <div style={{ marginBottom: 22 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
                  <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: 2, textTransform: "uppercase", color: C.muted, whiteSpace: "nowrap" }}>⚡ Quick Insights</span>
                  <div style={{ flex: 1, height: 1, background: C.border }} />
                </div>
                <div style={{ display: "flex", gap: 12, overflowX: "auto", paddingBottom: 4 }}>
                  {insights.map((ins, i) => (
                    <div key={i} className="insight-card" style={{ background: C.surf, border: `1px solid ${C.border}`, borderLeft: `4px solid ${ins.color}`, borderRadius: 10, padding: "14px 18px", minWidth: 175, flexShrink: 0 }}>
                      <div style={{ fontSize: 22, marginBottom: 6, lineHeight: 1 }}>{ins.icon}</div>
                      <div style={{ fontSize: 10, color: C.muted, fontWeight: 700, letterSpacing: 1.5, textTransform: "uppercase", marginBottom: 3 }}>{ins.label}</div>
                      <div style={{ fontSize: 17, fontWeight: 800, color: ins.color, fontFamily: C.mono, lineHeight: 1.2 }}>{ins.text}</div>
                      <div style={{ fontSize: 11, color: C.muted, marginTop: 4 }}>{ins.sub}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* ── Player Statistics Table ── */}
            <div style={{ background: C.surf, border: `1px solid ${C.border}`, borderRadius: 12, overflow: "hidden" }}>
              <div style={{ padding: "14px 20px", borderBottom: `1px solid ${C.border}`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontSize: 17, fontWeight: 800, letterSpacing: 2, textTransform: "uppercase", color: "#58a6ff" }}>Player Statistics</span>
                <span style={{ color: C.muted, fontSize: 12 }}>Click any column header to sort</span>
              </div>
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead>
                    <tr>
                      <TH id="stats" col="rank"   lbl="Rank" align="center" />
                      <TH id="stats" col="player" lbl="Player" align="left" />
                      <TH id="stats" col="total"  lbl="Total Score" />
                      <TH id="stats" col="avg"    lbl="Avg Score" />
                      <TH id="stats" col="std"    lbl="Std Dev" />
                      <TH id="stats" col="high"   lbl="Highest" />
                      <TH id="stats" col="low"    lbl="Lowest" />
                      <TH id="stats" col="wins"   lbl="Wins" />
                      <TH id="stats" col="pods"   lbl="Podiums" />
                      <th style={{ padding: "11px 14px", textAlign: "center", background: C.surf2, color: C.muted, fontSize: 11, fontWeight: 700, letterSpacing: 2, textTransform: "uppercase", borderBottom: `2px solid ${C.border}`, whiteSpace: "nowrap", fontFamily: C.fnt }}>
                        Form (last 5)
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {getSorted(basicStats, "stats").map((r, i) => (
                      <tr key={r.player} className="data-row"
                        style={{ background: r.rank === 1 ? "rgba(251,191,36,0.04)" : i % 2 === 0 ? "transparent" : C.bg }}>
                        <td style={{ padding: "12px 14px", textAlign: "center", borderBottom: `1px solid ${C.surf2}` }}>
                          <Rank r={r.rank} />
                        </td>
                        <td style={{ padding: "11px 14px", textAlign: "left", borderBottom: `1px solid ${C.surf2}`, fontWeight: 700, fontSize: 16, color: r.rank === 1 ? "#fbbf24" : C.text, fontFamily: C.fnt }}>
                          {r.player}
                          {r.rank === 1 && <span style={{ marginLeft: 6, fontSize: 13 }}>👑</span>}
                        </td>
                        <TD v={n1(r.total)} weight={700} color="#58a6ff" size={15} />
                        <TD v={n1(r.avg)} />
                        <TD v={n1(r.std)} color={C.muted} />
                        <TD v={n1(r.high)} color="#22d3a0" weight={600} />
                        <TD v={n1(r.low)} color="#f85149" />
                        <TD v={r.wins} color="#f97316" weight={700} />
                        <TD v={r.pods} color="#c084fc" />
                        <td style={{ padding: "11px 14px", textAlign: "center", borderBottom: `1px solid ${C.surf2}` }}>
                          <div style={{ display: "flex", justifyContent: "center" }}>
                            {(formGuide[r.player] || []).map((result, fi) => (
                              <FormDot key={fi} result={result} />
                            ))}
                            {!(formGuide[r.player]?.length) && <span style={{ color: C.muted, fontSize: 12 }}>—</span>}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {/* Form legend */}
              <div style={{ padding: "10px 20px", borderTop: `1px solid ${C.border}`, display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap" }}>
                <span style={{ color: C.muted, fontSize: 10, fontWeight: 700, letterSpacing: 1.5, textTransform: "uppercase" }}>Legend:</span>
                {[["win","#22d3a0","W","Win"], ["pod","#fbbf24","P","Top 3"], ["loss","#f85149","L","Loss"], ["ns","#2d333b","–","N/A"]].map(([r, c, l, label]) => (
                  <div key={r} style={{ display: "flex", alignItems: "center", gap: 5 }}>
                    <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 20, height: 20, borderRadius: 4, background: c, fontSize: 10, fontWeight: 800, color: r === "ns" ? C.muted : "#0d1117", border: `1px solid ${r === "ns" ? C.border : "transparent"}` }}>{l}</span>
                    <span style={{ color: C.muted, fontSize: 11 }}>{label}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ══ SCORING SYSTEM TABS ══ */}
        {SYSTEMS.map(sys => tab === sys.id && (
          <div key={sys.id} className="fade-in">

            {/* System info header */}
            <div style={{ background: C.surf, border: `1px solid ${sys.color}44`, borderLeft: `5px solid ${sys.color}`, borderRadius: 12, padding: "18px 24px", marginBottom: 20 }}>
              <div style={{ display: "flex", gap: 32, alignItems: "flex-start", flexWrap: "wrap" }}>
                <div style={{ minWidth: 200 }}>
                  <div style={{ fontSize: 24, fontWeight: 900, letterSpacing: 3, color: sys.color, textTransform: "uppercase" }}>{sys.name}</div>
                  <div style={{ color: C.muted, fontSize: 13, marginTop: 4, fontFamily: C.mono }}>{sys.sub}</div>
                  <div style={{ color: sys.color, fontSize: 12, fontWeight: 700, marginTop: 8, letterSpacing: 1, textTransform: "uppercase" }}>
                    {sys.lowerBetter ? "★ Lower total = better rank" : "★ Higher total = better rank"}
                  </div>
                </div>
                {sys.dist && (
                  <div>
                    <div style={{ color: C.muted, fontSize: 11, fontWeight: 700, letterSpacing: 2, textTransform: "uppercase", marginBottom: 8 }}>Points Per Position</div>
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                      {sys.dist(data.players.length).map((p, i) => (
                        <div key={i} style={{ background: C.surf2, borderRadius: 8, padding: "6px 12px", textAlign: "center", minWidth: 48, border: i === 0 ? `1px solid ${sys.color}88` : `1px solid ${C.border}` }}>
                          <div style={{ fontSize: 10, color: C.muted, letterSpacing: 1, textTransform: "uppercase" }}>{ORD[i] || `${i+1}th`}</div>
                          <div style={{ fontSize: 18, fontWeight: 800, color: i === 0 ? sys.color : C.text, fontFamily: C.mono }}>{p}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {!sys.dist && (
                  <div style={{ display: "flex", alignItems: "center", gap: 12, color: C.muted, fontSize: 14 }}>
                    <span style={{ fontSize: 32 }}>🎯</span>
                    <span>Actual game scores summed directly.<br />Everyone plays every game — no adjustments.</span>
                  </div>
                )}
              </div>
            </div>

            {/* Standings table */}
            <div style={{ background: C.surf, border: `1px solid ${C.border}`, borderRadius: 12, overflow: "hidden", marginBottom: 20 }}>
              <div style={{ padding: "14px 20px", borderBottom: `1px solid ${C.border}`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontSize: 17, fontWeight: 800, letterSpacing: 2, textTransform: "uppercase", color: sys.color }}>League Standings</span>
                <span style={{ color: C.muted, fontSize: 12 }}>Click any column header to sort</span>
              </div>
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead>
                    <tr>
                      <TH id={sys.id} col="rank"   lbl="Rank" align="center" />
                      <TH id={sys.id} col="player" lbl="Player" align="left" />
                      <TH id={sys.id} col="pts"    lbl={sys.id === "raw" ? "Total Score" : "Total Points"} />
                      <TH id={sys.id} col="avg"    lbl={sys.id === "raw" ? "Avg / Game" : "Pts / Game"} />
                      <TH id={sys.id} col="wins"   lbl="Wins 🏆" />
                      <TH id={sys.id} col="pods"   lbl="Podiums" />
                    </tr>
                  </thead>
                  <tbody>
                    {getSorted(sysTables[sys.id] || [], sys.id).map((r, i) => (
                      <tr key={r.player} className="data-row"
                        style={{ background: r.rank === 1 ? `${sys.color}08` : i % 2 === 0 ? "transparent" : C.bg }}>
                        <td style={{ padding: "12px 14px", textAlign: "center", borderBottom: `1px solid ${C.surf2}` }}><Rank r={r.rank} /></td>
                        <td style={{ padding: "11px 14px", textAlign: "left", borderBottom: `1px solid ${C.surf2}`, fontWeight: 700, fontSize: 16, color: r.rank === 1 ? sys.color : C.text, fontFamily: C.fnt }}>
                          {r.player}
                          {r.rank === 1 && <span style={{ marginLeft: 6 }}>👑</span>}
                        </td>
                        <TD v={n1(r.pts)} weight={800} color={sys.color} size={18} />
                        <TD v={sys.id === "raw" ? n1(r.avg) : n2(r.avg)} color={C.muted} />
                        <TD v={r.wins > 0 ? `${r.wins} 🏅` : r.wins} color="#f97316" weight={700} />
                        <TD v={r.pods} color="#c084fc" />
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Game-by-game breakdown */}
            <div style={{ background: C.surf, border: `1px solid ${C.border}`, borderRadius: 12, overflow: "hidden" }}>
              <div style={{ padding: "14px 20px", borderBottom: `1px solid ${C.border}` }}>
                <span style={{ fontSize: 17, fontWeight: 800, letterSpacing: 2, textTransform: "uppercase", color: sys.color }}>Game-by-Game Breakdown</span>
              </div>
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead>
                    <tr>
                      <th style={{ padding: "10px 14px", textAlign: "left", background: C.surf2, color: C.muted, fontSize: 11, fontWeight: 700, letterSpacing: 2, textTransform: "uppercase", borderBottom: `2px solid ${C.border}`, fontFamily: C.fnt, whiteSpace: "nowrap" }}>Game</th>
                      {data.players.map(p => (
                        <th key={p} style={{ padding: "10px 14px", textAlign: "right", background: C.surf2, color: C.muted, fontSize: 11, fontWeight: 700, letterSpacing: 2, textTransform: "uppercase", borderBottom: `2px solid ${C.border}`, fontFamily: C.fnt, whiteSpace: "nowrap" }}>{p}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {data.games.map((g, gi) => {
                      const playing = data.players.map(p => ({ p, s: g.scores[p] })).filter(e => e.s != null).sort((a, b) => b.s - a.s);
                      const ptMap = {};
                      for (let i = 0; i < playing.length;) {
                        const score = playing[i].s;
                        let j = i + 1;
                        while (j < playing.length && playing[j].s === score) j += 1;
                        const pts = getSysPointsForRange(sys, i + 1, j, score);
                        for (let k = i; k < j; k++) ptMap[playing[k].p] = pts;
                        i = j;
                      }
                      data.players.filter(p => g.scores[p] == null).forEach(p => { ptMap[p] = "—"; });
                      const numVals = Object.values(ptMap).filter(v => v !== "—");
                      const maxPts = numVals.length ? Math.max(...numVals) : 0;
                      const minPts = numVals.length ? Math.min(...numVals) : 0;
                      return (
                        <tr key={gi} className="data-row" style={{ background: gi % 2 === 0 ? "transparent" : C.bg }}>
                          <td style={{ padding: "10px 14px", borderBottom: `1px solid ${C.surf2}`, color: C.muted, fontFamily: C.mono, fontSize: 13 }}>#{gi + 1}</td>
                          {data.players.map(p => {
                            const pv = ptMap[p];
                            const isNS = g.scores[p] == null;
                            const isBest = !isNS && (sys.lowerBetter ? pv === minPts : pv === maxPts);
                            return (
                              <td key={p} style={{ padding: "10px 14px", textAlign: "right", borderBottom: `1px solid ${C.surf2}`, fontFamily: C.mono, fontSize: 13, fontWeight: isBest ? 700 : 400, color: isNS ? "#f85149" : isBest ? sys.color : C.text, background: isBest ? `${sys.color}11` : "transparent" }}>
                                {isNS ? "—" : sys.id === "raw" ? n1(pv) : pv}
                              </td>
                            );
                          })}
                        </tr>
                      );
                    })}
                    <tr style={{ background: C.surf2 }}>
                      <td style={{ padding: "12px 14px", borderTop: `2px solid ${C.border}`, fontWeight: 800, fontSize: 13, letterSpacing: 2, textTransform: "uppercase", fontFamily: C.fnt, color: sys.color }}>TOTAL</td>
                      {data.players.map(p => {
                        const row = (sysTables[sys.id] || []).find(r => r.player === p);
                        return (
                          <td key={p} style={{ padding: "12px 14px", textAlign: "right", borderTop: `2px solid ${C.border}`, fontFamily: C.mono, fontSize: 15, fontWeight: 800, color: sys.color }}>
                            {n1(row?.pts ?? 0)}
                          </td>
                        );
                      })}
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}