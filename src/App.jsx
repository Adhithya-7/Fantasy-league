import { useState, useEffect, useMemo, useCallback } from "react";
import { createClient } from "@supabase/supabase-js";

// ─── Supabase Setup ───────────────────────────────────────────────────────────
// Replace these with your actual values from Supabase
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
    id: "f1l", name: "F1 Legacy", sub: "10 · 7 · 6 · 5 · 4 · 3 · 2 · Last=0",
    note: "Higher total score = better rank", color: "#f97316", lowerBetter: false,
    dist: n => [10, 7, 6, 5, 4, 3, 2, 1, 0].slice(0, n),
    pts: (rank) => [10,7,6,5,4,3,2,1,0][Math.min(rank-1, 8)],
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

function computeSysTable(players, games, sys) {
  const acc = Object.fromEntries(players.map(p => [p, { pts: 0, wins: 0, pods: 0 }]));
  games.forEach(g => {
    const playing = players.map(p => ({ p, s: g.scores[p] })).filter(e => e.s != null).sort((a, b) => b.s - a.s);
    playing.forEach(({ p, s }, i) => {
      const higher = playing.filter(e => e.s > s).length;
      acc[p].pts += sys.pts(i + 1, players.length, s);
      if (higher === 0) acc[p].wins++;
      if (higher < 3) acc[p].pods++;
    });
  });
  const rows = players.map(p => ({ player: p, ...acc[p], avg: acc[p].pts / games.length }));
  const sortedRows = [...rows].sort((a, b) => sys.lowerBetter ? a.pts - b.pts : b.pts - a.pts);
  sortedRows.forEach((r, i, arr) => { r.rank = i === 0 ? 1 : r.pts === arr[i - 1].pts ? arr[i - 1].rank : i + 1; });
  return sortedRows;
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

  useEffect(() => {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = "https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@400;600;700;800;900&family=IBM+Plex+Mono:wght@400;500;600&display=swap";
    document.head.appendChild(link);
  }, []);

  // Load data from Supabase
  useEffect(() => {
    loadData();
    // Real-time subscription
    const channel = supabase
      .channel("games-changes")
      .on("postgres_changes", { event: "*", schema: "public", table: "games" }, () => {
        loadData();
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      const { data: playersData } = await supabase
        .from("players")
        .select("name")
        .order("name", { ascending: true });

      const { data: gamesData } = await supabase
        .from("games")
        .select("*")
        .order("game_number", { ascending: true });

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
    if (!adminPassword) {
      alert("Enter admin password");
      return;
    }
    // Simple password check (use real auth in production)
    const correctPassword = "league2024"; // Change this to something only you know!
    if (adminPassword !== correctPassword) {
      alert("Wrong password");
      setAdminPassword("");
      return;
    }

    try {
      const scores = {};
      data.players.forEach(p => {
        const val = gameForm[p];
        scores[p] = val ? parseFloat(val) : null;
      });

      const gameNum = (data.games.length || 0) + 1;
      await supabase.from("games").insert([{ game_number: gameNum, scores }]);
      
      setGameForm({});
      setAdminPassword("");
      setAdminMode(false);
      await loadData();
    } catch (err) {
      console.error("Error adding game:", err);
      alert("Failed to add game");
    }
  };

  const basicStats = useMemo(() => data ? computeBasicStats(data.players, data.games) : [], [data]);
  const sysTables = useMemo(() =>
    data ? Object.fromEntries(SYSTEMS.map(sys => [sys.id, computeSysTable(data.players, data.games, sys)])) : {},
    [data]);

  const getSorted = (rows, key) => {
    const s = sorts[key];
    if (!s) return rows;
    return [...rows].sort((a, b) => {
      const cmp = typeof a[s.col] === "number" ? a[s.col] - b[s.col] : String(a[s.col]).localeCompare(String(b[s.col]));
      return s.asc ? cmp : -cmp;
    });
  };
  const onSort = (key, col) => setSorts(p => ({ ...p, [key]: p[key]?.col === col ? { col, asc: !p[key].asc } : { col, asc: false } }));

  // ─── Styles ──────────────────────────────────────────────────────────────────
  const C = { bg: "#0d1117", surf: "#161b22", surf2: "#21262d", border: "#30363d", text: "#e6edf3", muted: "#8b949e", fnt: "'Barlow Condensed',sans-serif", mono: "'IBM Plex Mono',monospace" };

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

  const n1 = v => v?.toLocaleString(undefined, { maximumFractionDigits: 1 }) ?? "—";
  const n2 = v => v?.toFixed(2) ?? "—";

  // ─── Loading ──────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div style={{ minHeight: "100vh", background: C.bg, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: C.fnt }}>
        <div style={{ fontSize: 32, color: "#58a6ff" }}>⏳ Loading...</div>
      </div>
    );
  }

  if (!data) {
    return (
      <div style={{ minHeight: "100vh", background: C.bg, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 24, fontFamily: C.fnt }}>
        <div style={{ fontSize: 56, color: "#ff6b6b" }}>⚠️</div>
        <div style={{ fontSize: 20, color: C.text, textAlign: "center" }}>
          No data found. Check Supabase connection.<br />
          <span style={{ fontSize: 12, color: C.muted, marginTop: 8 }}>Verify SUPABASE_URL and SUPABASE_KEY</span>
        </div>
      </div>
    );
  }

  // ─── Dashboard ────────────────────────────────────────────────────────────────
  const allTabs = [{ id: "stats", label: "📊 Overview", color: "#58a6ff" }, ...SYSTEMS.map(s => ({ id: s.id, label: s.name, color: s.color }))];
  const topW = [...basicStats].sort((a, b) => b.wins - a.wins)[0];
  const topS = [...basicStats].sort((a, b) => b.total - a.total)[0];

  return (
    <div style={{ minHeight: "100vh", background: C.bg, color: C.text, fontFamily: C.fnt }}>

      {/* Header */}
        <div style={{ background: "linear-gradient(135deg,#161b22,#1b2337)", borderBottom: `1px solid ${C.border}`, padding: "18px 28px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <div style={{ fontSize: 30, fontWeight: 900, letterSpacing: 4, color: "#58a6ff", textTransform: "uppercase" }}>⚡ Fantasy League</div>
            <div style={{ color: C.muted, fontSize: 13, marginTop: 3 }}>📁 {data.name} &nbsp;·&nbsp; {data.players.length} players &nbsp;·&nbsp; {data.games.length} games played</div>
          </div>
        </div>


      {/* Tab Bar */}
      <div style={{ display: "flex", gap: 2, padding: "0 20px", background: C.surf, borderBottom: `1px solid ${C.border}`, overflowX: "auto" }}>
        {allTabs.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} style={{ padding: "14px 20px", border: "none", borderBottom: `3px solid ${tab === t.id ? t.color : "transparent"}`, cursor: "pointer", fontFamily: C.fnt, fontSize: 14, fontWeight: 700, letterSpacing: 1, textTransform: "uppercase", whiteSpace: "nowrap", background: "transparent", color: tab === t.id ? t.color : C.muted, transition: "all 0.15s" }}>
            {t.label}
          </button>
        ))}
      </div>

      <div style={{ padding: "24px", maxWidth: 1200, margin: "0 auto" }}>

        {/* STATS OVERVIEW TAB */}
        {tab === "stats" && (
          <>
            <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginBottom: 24 }}>
              {[
                { label: "Total Games", val: data.games.length, color: "#58a6ff" },
                { label: "Players", val: data.players.length, color: "#c084fc" },
                { label: "Most Wins", val: `${topW?.player}`, sub: `${topW?.wins} wins`, color: "#f97316" },
                { label: "Top Scorer", val: `${topS?.player}`, sub: n1(topS?.total) + " pts", color: "#22d3a0" },
                { label: "Highest Match", val: n1(Math.max(...basicStats.map(s => s.high))), color: "#fbbf24" },
              ].map(({ label, val, sub, color }) => (
                <div key={label} style={{ background: C.surf, border: `1px solid ${C.border}`, borderTop: `3px solid ${color}`, borderRadius: 10, padding: "14px 20px", flex: 1, minWidth: 130 }}>
                  <div style={{ color: C.muted, fontSize: 11, fontWeight: 700, letterSpacing: 2, textTransform: "uppercase", marginBottom: 6 }}>{label}</div>
                  <div style={{ fontSize: sub ? 22 : 28, fontWeight: 800, color, fontFamily: C.mono }}>{val}</div>
                  {sub && <div style={{ color: C.muted, fontSize: 12, marginTop: 2 }}>{sub}</div>}
                </div>
              ))}
            </div>

            <div style={{ background: C.surf, border: `1px solid ${C.border}`, borderRadius: 12, overflow: "hidden" }}>
              <div style={{ padding: "14px 20px", borderBottom: `1px solid ${C.border}`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontSize: 17, fontWeight: 800, letterSpacing: 2, textTransform: "uppercase", color: "#58a6ff" }}>Player Statistics</span>
                <span style={{ color: C.muted, fontSize: 12 }}>Click any column header to sort</span>
              </div>
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead>
                    <tr>
                      <TH id="stats" col="rank" lbl="Rank" align="center" />
                      <TH id="stats" col="player" lbl="Player" align="left" />
                      <TH id="stats" col="total" lbl="Total Score" />
                      <TH id="stats" col="avg" lbl="Avg Score" />
                      <TH id="stats" col="std" lbl="Std Dev" />
                      <TH id="stats" col="high" lbl="Highest" />
                      <TH id="stats" col="low" lbl="Lowest" />
                      <TH id="stats" col="wins" lbl="Wins" />
                      <TH id="stats" col="pods" lbl="Podiums" />
                    </tr>
                  </thead>
                  <tbody>
                    {getSorted(basicStats, "stats").map((r, i) => (
                      <tr key={r.player} style={{ background: i % 2 === 0 ? "transparent" : C.bg, transition: "background 0.1s" }}>
                        <td style={{ padding: "12px 14px", textAlign: "center", borderBottom: `1px solid ${C.surf2}` }}><Rank r={r.rank} /></td>
                        <TD v={r.player} align="left" weight={700} size={16} color={C.text} mono={false} />
                        <TD v={n1(r.total)} weight={700} color="#58a6ff" size={15} />
                        <TD v={n1(r.avg)} />
                        <TD v={n1(r.std)} color={C.muted} />
                        <TD v={n1(r.high)} color="#22d3a0" weight={600} />
                        <TD v={n1(r.low)} color="#f85149" />
                        <TD v={r.wins} color="#f97316" weight={700} />
                        <TD v={r.pods} color="#c084fc" />
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}

        {/* SCORING SYSTEM TABS */}
        {SYSTEMS.map(sys => tab === sys.id && (
          <div key={sys.id}>
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

            <div style={{ background: C.surf, border: `1px solid ${C.border}`, borderRadius: 12, overflow: "hidden" }}>
              <div style={{ padding: "14px 20px", borderBottom: `1px solid ${C.border}`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontSize: 17, fontWeight: 800, letterSpacing: 2, textTransform: "uppercase", color: sys.color }}>League Standings</span>
                <span style={{ color: C.muted, fontSize: 12 }}>Click any column header to sort</span>
              </div>
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead>
                    <tr>
                      <TH id={sys.id} col="rank" lbl="Rank" align="center" />
                      <TH id={sys.id} col="player" lbl="Player" align="left" />
                      <TH id={sys.id} col="pts" lbl={sys.id === "raw" ? "Total Score" : "Total Points"} />
                      <TH id={sys.id} col="avg" lbl={sys.id === "raw" ? "Avg / Game" : "Pts / Game"} />
                      <TH id={sys.id} col="wins" lbl="Wins 🏆" />
                      <TH id={sys.id} col="pods" lbl="Podiums" />
                    </tr>
                  </thead>
                  <tbody>
                    {getSorted(sysTables[sys.id] || [], sys.id).map((r, i) => (
                      <tr key={r.player} style={{ background: i % 2 === 0 ? "transparent" : C.bg }}>
                        <td style={{ padding: "12px 14px", textAlign: "center", borderBottom: `1px solid ${C.surf2}` }}><Rank r={r.rank} /></td>
                        <TD v={r.player} align="left" weight={700} size={16} color={C.text} mono={false} />
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

            <div style={{ marginTop: 20, background: C.surf, border: `1px solid ${C.border}`, borderRadius: 12, overflow: "hidden" }}>
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
                      playing.forEach(({ p, s }, i) => { ptMap[p] = sys.pts(i + 1, data.players.length, s); });
                      data.players.filter(p => g.scores[p] == null).forEach(p => { ptMap[p] = "—"; });
                      const maxPts = Math.max(...Object.values(ptMap).filter(v => v !== "—"));
                      return (
                        <tr key={gi} style={{ background: gi % 2 === 0 ? "transparent" : C.bg }}>
                          <td style={{ padding: "10px 14px", borderBottom: `1px solid ${C.surf2}`, color: C.muted, fontFamily: C.mono, fontSize: 13 }}>#{gi + 1}</td>
                          {data.players.map(p => {
                            const pv = ptMap[p];
                            const isNS = g.scores[p] == null;
                            const isBest = !isNS && (sys.lowerBetter ? pv === Math.min(...Object.values(ptMap).filter(v => v !== "—")) : pv === maxPts);
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