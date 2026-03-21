import { useState, useCallback, useEffect, useRef } from "react";
import bennyLogo from "./logo.png";

// ── Scoring ───────────────────────────────────────────────────────────────────
const PARK_FACTORS = {
  "Coors": 1.25, "American Ball Park": 1.15, "Globe Life": 1.12,
  "Truist": 1.08, "Fenway": 1.07, "Yankee": 1.06, "Wrigley": 1.05,
  "Guaranteed Rate": 1.04, "Nationals": 1.02, "American Family": 1.01,
  "Chase": 0.99, "T-Mobile": 0.97, "Dodger": 0.96, "PNC": 0.95,
  "Oracle": 0.94, "Petco": 0.93, "loanDepot": 0.92,
};
const getPF = (venue = "") => {
  for (const [k, f] of Object.entries(PARK_FACTORS))
    if (venue.toLowerCase().includes(k.toLowerCase())) return f;
  return 1.0;
};
// Scoring recalibrated against MLB historical NRFI rate (~26-30%).
// Old multipliers (ERA×12, WHIP×20) gave A grades to every average matchup.
// New multipliers (ERA×25, WHIP×40) anchor average pitching (~4.2 ERA / 1.28 WHIP)
// to the C/B boundary, reserving A for genuinely elite matchups.
const nrfiGrade = ({ homeERA, awayERA, homeWHIP, awayWHIP, pf, weatherDelta = 0 }) => {
  let s = 100;
  s -= Math.max(0, (((homeERA ?? 4.5) + (awayERA ?? 4.5)) / 2 - 3.0) * 25);
  s -= Math.max(0, (((homeWHIP ?? 1.3) + (awayWHIP ?? 1.3)) / 2 - 1.0) * 40);
  s -= (pf - 1.0) * 60;
  s += weatherDelta;
  s = Math.round(Math.max(0, Math.min(100, s)));
  return s >= 75 ? { g:"A", c:"#00e5a0", l:"Strong NRFI", s } :
         s >= 58 ? { g:"B", c:"#f5c842", l:"Lean NRFI",   s } :
         s >= 42 ? { g:"C", c:"#ff9f43", l:"Toss-Up",     s } :
                   { g:"D", c:"#ff4d6d", l:"Risky NRFI",  s };
};

// ── Stadium Data ──────────────────────────────────────────────────────────────
// cfBearing: compass degrees from home plate to CF (0=N, 90=E, 180=S, 270=W)
// indoor: true = dome/retractable usually closed → wind not a factor
const STADIUM_DATA = [
  // Most-specific patterns first to avoid substring collisions
  ["Great American",   { lat: 39.0979, lon: -84.5082,  cfBearing: 18,  indoor: false }], // Cincinnati
  ["American Family",  { lat: 43.0280, lon: -87.9712,  cfBearing: 25,  indoor: false }], // Milwaukee (retractable, usually open)
  ["Globe Life",       { lat: 32.7473, lon: -97.0836,  cfBearing: 35,  indoor: true  }], // Arlington (retractable, usually closed)
  ["loanDepot",        { lat: 25.7781, lon: -80.2197,  cfBearing: 355, indoor: false }], // Miami (retractable)
  ["Citizens Bank",    { lat: 39.9061, lon: -75.1665,  cfBearing: 350, indoor: false }], // Philadelphia
  ["Minute Maid",      { lat: 29.7573, lon: -95.3555,  cfBearing: 18,  indoor: false }], // Houston (retractable)
  ["Guaranteed Rate",  { lat: 41.8300, lon: -87.6339,  cfBearing: 355, indoor: false }], // Chicago (Sox)
  ["Tropicana",        { lat: 27.7682, lon: -82.6534,  cfBearing: 0,   indoor: true  }], // Tampa (dome)
  ["Rogers Centre",    { lat: 43.6414, lon: -79.3894,  cfBearing: 20,  indoor: true  }], // Toronto (dome)
  ["Target Field",     { lat: 44.9817, lon: -93.2781,  cfBearing: 355, indoor: false }], // Minneapolis
  ["Angel Stadium",    { lat: 33.8003, lon: -117.8827, cfBearing: 335, indoor: false }], // Anaheim
  ["Sutter Health",    { lat: 38.5805, lon: -121.5001, cfBearing: 15,  indoor: false }], // Sacramento (A's)
  ["T-Mobile Park",    { lat: 47.5914, lon: -122.3325, cfBearing: 335, indoor: false }], // Seattle (retractable, usually open)
  ["Yankee Stadium",   { lat: 40.8296, lon: -73.9262,  cfBearing: 33,  indoor: false }], // New York (AL)
  ["Fenway Park",      { lat: 42.3467, lon: -71.0972,  cfBearing: 5,   indoor: false }], // Boston
  ["Oriole Park",      { lat: 39.2838, lon: -76.6218,  cfBearing: 50,  indoor: false }], // Baltimore
  ["Progressive Field",{ lat: 41.4962, lon: -81.6852,  cfBearing: 22,  indoor: false }], // Cleveland
  ["Comerica Park",    { lat: 42.3390, lon: -83.0485,  cfBearing: 330, indoor: false }], // Detroit
  ["Kauffman Stadium", { lat: 39.0517, lon: -94.4803,  cfBearing: 5,   indoor: false }], // Kansas City
  ["Truist Park",      { lat: 33.8908, lon: -84.4678,  cfBearing: 12,  indoor: false }], // Atlanta
  ["Citi Field",       { lat: 40.7571, lon: -73.8458,  cfBearing: 350, indoor: false }], // New York (NL)
  ["Nationals Park",   { lat: 38.8730, lon: -77.0074,  cfBearing: 30,  indoor: false }], // Washington
  ["Wrigley Field",    { lat: 41.9484, lon: -87.6553,  cfBearing: 68,  indoor: false }], // Chicago (NL) — ENE, famous wind
  ["PNC Park",         { lat: 40.4469, lon: -80.0057,  cfBearing: 14,  indoor: false }], // Pittsburgh
  ["Busch Stadium",    { lat: 38.6226, lon: -90.1928,  cfBearing: 5,   indoor: false }], // St. Louis
  ["Chase Field",      { lat: 33.4455, lon: -112.0667, cfBearing: 350, indoor: true  }], // Phoenix (retractable, usually closed)
  ["Coors Field",      { lat: 39.7559, lon: -104.9942, cfBearing: 17,  indoor: false }], // Denver
  ["Dodger Stadium",   { lat: 34.0739, lon: -118.2400, cfBearing: 335, indoor: false }], // Los Angeles
  ["Petco Park",       { lat: 32.7073, lon: -117.1573, cfBearing: 35,  indoor: false }], // San Diego
  ["Oracle Park",      { lat: 37.7786, lon: -122.3893, cfBearing: 100, indoor: false }], // San Francisco (CF toward the Bay)
];

const getStadium = (venueName = "") => {
  const lower = venueName.toLowerCase();
  const found = STADIUM_DATA.find(([k]) => lower.includes(k.toLowerCase()));
  return found ? found[1] : null;
};

// ── Weather ───────────────────────────────────────────────────────────────────
const fetchWeather = async (lat, lon, dateStr, gameIso) => {
  try {
    const next = new Date(dateStr + "T00:00:00Z");
    next.setDate(next.getDate() + 1);
    const nextStr = next.toISOString().slice(0, 10);
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
      `&hourly=temperature_2m,wind_speed_10m,wind_direction_10m,precipitation_probability` +
      `&temperature_unit=fahrenheit&wind_speed_unit=mph&timezone=UTC` +
      `&start_date=${dateStr}&end_date=${nextStr}`;
    const r = await fetch(url);
    if (!r.ok) return null;
    const d = await r.json();
    if (!d.hourly?.time?.length) return null;
    // Find hour index closest to game time
    const gameMs = new Date(gameIso).getTime();
    let idx = 0, minDiff = Infinity;
    d.hourly.time.forEach((t, i) => {
      const diff = Math.abs(new Date(t + ":00Z").getTime() - gameMs);
      if (diff < minDiff) { minDiff = diff; idx = i; }
    });
    return {
      tempF:     d.hourly.temperature_2m[idx],
      windSpeed: d.hourly.wind_speed_10m[idx],
      windDir:   d.hourly.wind_direction_10m[idx],
      precipPct: d.hourly.precipitation_probability[idx],
    };
  } catch {
    return null;
  }
};

// Returns -1 (blowing in) to +1 (blowing out)
const windAlignment = (windDir, cfBearing) => {
  const outSource = (cfBearing + 180) % 360;
  const diff = ((windDir - outSource + 540) % 360) - 180;
  return Math.cos(diff * Math.PI / 180);
};

const calcWeatherDelta = (weather) => {
  if (!weather) return 0;
  const { tempF, windSpeed, windDir, cfBearing, isIndoor } = weather;
  if (isIndoor) return 0;
  let delta = 0;
  // Cold = denser air = less carry = good for NRFI; heat = slight disadvantage
  if (tempF != null) {
    if      (tempF < 40) delta += 10;
    else if (tempF < 50) delta += 6;
    else if (tempF < 55) delta += 3;
    else if (tempF > 90) delta -= 4;
    else if (tempF > 82) delta -= 2;
  }
  // Wind: blowing out hurts NRFI, blowing in helps
  if (windSpeed != null && windDir != null && cfBearing != null && windSpeed >= 8) {
    const align = windAlignment(windDir, cfBearing);
    delta += Math.round(-align * (windSpeed - 7) * 0.5);
  }
  return Math.round(delta);
};

const getWindInfo = (weather) => {
  if (!weather || weather.isIndoor) return null;
  const { windSpeed, windDir, cfBearing } = weather;
  if (!windSpeed || windSpeed < 8 || windDir == null || cfBearing == null) return null;
  const align = windAlignment(windDir, cfBearing);
  if (align >  0.4) return { label: `${Math.round(windSpeed)}mph OUT`,   color: "#ff4d6d" };
  if (align < -0.4) return { label: `${Math.round(windSpeed)}mph IN`,    color: "#00e5a0" };
  return               { label: `${Math.round(windSpeed)}mph CROSS`, color: "#4a6080" };
};

// ── Outcomes API (DynamoDB via Lambda) ───────────────────────────────────────
const OUTCOMES_API = "https://q0jutr0ldh.execute-api.us-east-1.amazonaws.com";

const buildOutcomePayload = (game, predictedScore, predictedGrade, season, firstInning = null) => {
  const wx  = game.weather;
  const pf  = getPF(game.venue);
  const avgERA  = ((game.homeERA  ?? 4.5) + (game.awayERA  ?? 4.5)) / 2;
  const avgWHIP = ((game.homeWHIP ?? 1.3)  + (game.awayWHIP ?? 1.3))  / 2;
  const payload = {
    season,
    date:           game.gameIso?.slice(0, 10),
    gameTime:       game.gameIso,
    homeTeam:       game.homeTeam,
    awayTeam:       game.awayTeam,
    venue:          game.venue,
    homePitcher:    game.homePitcher,
    awayPitcher:    game.awayPitcher,
    homeERA:        game.homeERA,
    awayERA:        game.awayERA,
    homeWHIP:       game.homeWHIP,
    awayWHIP:       game.awayWHIP,
    parkFactor:     pf,
    // Team hitting stats — for model refinement
    homeOPS:        game.homeOPS  ?? null,
    awayOPS:        game.awayOPS  ?? null,
    homeKPct:       game.homeKPct ?? null,
    awayKPct:       game.awayKPct ?? null,
    // Individual score components — lets us reweight formula against actuals later
    eraPenalty:     Math.round(Math.max(0, (avgERA  - 3.0) * 25) * 100) / 100,
    whipPenalty:    Math.round(Math.max(0, (avgWHIP - 1.0) * 40) * 100) / 100,
    parkPenalty:    Math.round((pf - 1.0) * 60 * 100) / 100,
    // Individual weather components preserved for model training
    tempF:          wx?.tempF        ?? null,
    windSpeed:      wx?.windSpeed    ?? null,
    windDir:        wx?.windDir      ?? null,
    precipPct:      wx?.precipPct    ?? null,
    isIndoor:       wx?.isIndoor     ?? false,
    weatherDelta:   calcWeatherDelta(wx),
    predictedScore,
    predictedGrade,
  };
  if (firstInning) {
    payload.actualNRFI  = firstInning.nrfi;
    payload.totalRuns   = firstInning.totalRuns;
    payload.awayRuns    = firstInning.awayRuns;
    payload.homeRuns    = firstInning.homeRuns;
  }
  return payload;
};

const submitPick = async (gamePk, pick, userUuid, nickname, date) => {
  const r = await fetch(`${OUTCOMES_API}/picks/${gamePk}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userUuid, nickname, pick, date, season: date.slice(0, 4) }),
  });
  return r.json();
};

const fetchGamePicks = async (gamePk, userUuid) => {
  try {
    const r = await fetch(`${OUTCOMES_API}/picks/${gamePk}?userUuid=${userUuid}`);
    return r.json();
  } catch {
    return { nrfiCount: 0, yrfiCount: 0, userPick: null };
  }
};

const saveOutcome = async (game, predictedScore, predictedGrade, season) => {
  try {
    await fetch(`${OUTCOMES_API}/outcomes/${game.gamePk}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(buildOutcomePayload(game, predictedScore, predictedGrade, season)),
    });
  } catch { /* non-critical, never block the UI */ }
};

const recordResult = async (gamePk, firstInning, predictedScore, predictedGrade, season, gameData) => {
  if (!firstInning || gamePk == null) return;
  try {
    await fetch(`${OUTCOMES_API}/outcomes/${gamePk}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(buildOutcomePayload(gameData, predictedScore, predictedGrade, season, firstInning)),
    });
  } catch { /* non-critical */ }
};

// ── Chat ──────────────────────────────────────────────────────────────────────
const CHAT_WS = "wss://q56kgtnct0.execute-api.us-east-1.amazonaws.com/production";

const getUserUuid = () => {
  let id = localStorage.getItem("nrfi-uuid");
  if (!id) { id = crypto.randomUUID(); localStorage.setItem("nrfi-uuid", id); }
  return id;
};

const fmtTime = (iso) => {
  try {
    return new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true });
  } catch { return ""; }
};

const NicknamePrompt = ({ onSave }) => {
  const [val, setVal] = useState("");
  return (
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,.75)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:100}}>
      <div style={{background:"#0d1f30",border:"1px solid #1a2e42",borderRadius:14,padding:"32px 28px",width:320,textAlign:"center"}}>
        <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:24,letterSpacing:3,color:"#e0eaf4",marginBottom:6}}>CHOOSE A NICKNAME</div>
        <div style={{fontFamily:"'Space Mono',monospace",fontSize:10,color:"#4a6080",letterSpacing:1,marginBottom:20}}>SHOWN IN THE CHAT · MAX 20 CHARS</div>
        <input
          autoFocus maxLength={20} value={val} onChange={e => setVal(e.target.value)}
          onKeyDown={e => e.key === "Enter" && val.trim() && onSave(val.trim())}
          placeholder="e.g. NRFIKing99"
          style={{width:"100%",background:"#060f18",border:"1px solid #1a2e42",borderRadius:8,padding:"10px 14px",color:"#c8d8e8",fontFamily:"'Space Mono',monospace",fontSize:12,outline:"none",boxSizing:"border-box",marginBottom:14}}
        />
        <button
          onClick={() => val.trim() && onSave(val.trim())}
          style={{width:"100%",padding:"10px",background:"linear-gradient(135deg,#00e5a0,#00bfff)",border:"none",borderRadius:8,color:"#060f18",fontFamily:"'Space Mono',monospace",fontSize:12,fontWeight:700,letterSpacing:1,cursor:"pointer"}}
        >LET'S GO</button>
      </div>
    </div>
  );
};

const ChatPanel = ({ date, nickname, onChangeNickname }) => {
  const [messages, setMessages]   = useState([]);
  const [input,    setInput]      = useState("");
  const [status,   setStatus]     = useState("connecting"); // connecting | open | closed
  const wsRef      = useRef(null);
  const bottomRef  = useRef(null);
  const uuid       = getUserUuid();

  useEffect(() => {
    if (!date) return;
    setMessages([]);
    setStatus("connecting");

    const ws = new WebSocket(`${CHAT_WS}?date=${date}`);
    wsRef.current = ws;

    ws.onopen    = () => {
      setStatus("open");
      ws.send(JSON.stringify({ action: "getHistory", date }));
    };
    ws.onclose   = () => setStatus("closed");
    ws.onerror   = () => setStatus("closed");
    ws.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        if (data.type === "history")  setMessages(data.messages ?? []);
        if (data.type === "message")  setMessages(prev => [...prev, data]);
      } catch {}
    };

    return () => ws.close();
  }, [date]);

  // Scroll to bottom whenever messages change
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const send = () => {
    if (!input.trim() || wsRef.current?.readyState !== WebSocket.OPEN) return;
    wsRef.current.send(JSON.stringify({
      action: "sendMessage", date, message: input.trim(), nickname, userUuid: uuid,
    }));
    setInput("");
  };

  const statusColor = status === "open" ? "#00e5a0" : status === "connecting" ? "#f5c842" : "#ff4d6d";
  const statusLabel = status === "open" ? "LIVE" : status === "connecting" ? "CONNECTING..." : "DISCONNECTED";

  return (
    <div style={{display:"flex",flexDirection:"column",height:"100%",background:"linear-gradient(145deg,#0d1f30,#0a1520)",border:"1px solid #1a2e42",borderRadius:12,overflow:"hidden"}}>

      {/* Header */}
      <div style={{padding:"12px 16px",borderBottom:"1px solid #0e1822",display:"flex",alignItems:"center",justifyContent:"space-between",flexShrink:0}}>
        <div>
          <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:16,letterSpacing:2,color:"#e0eaf4"}}>GAME DAY CHAT</div>
          <div style={{fontFamily:"'Space Mono',monospace",fontSize:8,color:"#4a6080",letterSpacing:1,marginTop:1}}>{date}</div>
        </div>
        <div style={{display:"flex",alignItems:"center",gap:8}}>
          <div style={{width:6,height:6,borderRadius:"50%",background:statusColor,boxShadow:`0 0 6px ${statusColor}`}}/>
          <span style={{fontFamily:"'Space Mono',monospace",fontSize:8,color:statusColor,letterSpacing:1}}>{statusLabel}</span>
        </div>
      </div>

      {/* Messages */}
      <div style={{flex:1,overflowY:"auto",padding:"12px 14px",display:"flex",flexDirection:"column",gap:10}}>
        {messages.length === 0 && status === "open" && (
          <div style={{textAlign:"center",padding:"30px 0",fontFamily:"'Space Mono',monospace",fontSize:10,color:"#2a4060",letterSpacing:1}}>
            NO MESSAGES YET.<br/>BE THE FIRST TO CHAT!
          </div>
        )}
        {messages.map((m) => {
          const isMe = m.userUuid === uuid;
          return (
            <div key={m.messageId} style={{display:"flex",flexDirection:"column",alignItems:isMe?"flex-end":"flex-start"}}>
              <div style={{display:"flex",alignItems:"baseline",gap:6,marginBottom:3,flexDirection:isMe?"row-reverse":"row"}}>
                <span style={{fontFamily:"'Space Mono',monospace",fontSize:9,fontWeight:700,color:isMe?"#00bfff":"#00e5a0",letterSpacing:.5}}>
                  {isMe ? "YOU" : m.nickname}
                </span>
                <span style={{fontFamily:"'Space Mono',monospace",fontSize:8,color:"#2a4060"}}>{fmtTime(m.sentAt)}</span>
              </div>
              <div style={{maxWidth:"85%",padding:"7px 10px",borderRadius:isMe?"10px 2px 10px 10px":"2px 10px 10px 10px",background:isMe?"#003d5c":"#0e1f30",border:`1px solid ${isMe?"#00bfff20":"#1a2e42"}`,fontFamily:"'DM Sans',sans-serif",fontSize:12,color:"#c8d8e8",lineHeight:1.45,wordBreak:"break-word"}}>
                {m.message}
              </div>
            </div>
          );
        })}
        <div ref={bottomRef}/>
      </div>

      {/* Nickname bar */}
      <div style={{padding:"6px 14px",borderTop:"1px solid #0e1822",display:"flex",alignItems:"center",justifyContent:"space-between",flexShrink:0}}>
        <span style={{fontFamily:"'Space Mono',monospace",fontSize:9,color:"#4a6080"}}>
          CHATTING AS <span style={{color:"#00e5a0"}}>{nickname}</span>
        </span>
        <button onClick={onChangeNickname} style={{background:"none",border:"none",color:"#4a6080",fontFamily:"'Space Mono',monospace",fontSize:9,cursor:"pointer",letterSpacing:.5,textDecoration:"underline"}}>
          CHANGE
        </button>
      </div>

      {/* Input */}
      <div style={{padding:"10px 12px",borderTop:"1px solid #0e1822",display:"flex",gap:8,flexShrink:0}}>
        <input
          value={input} onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === "Enter" && send()}
          maxLength={500}
          placeholder={status === "open" ? "Type a message..." : "Connecting..."}
          disabled={status !== "open"}
          style={{flex:1,background:"#060f18",border:"1px solid #1a2e42",borderRadius:8,padding:"8px 12px",color:"#c8d8e8",fontFamily:"'DM Sans',sans-serif",fontSize:12,outline:"none",opacity:status==="open"?1:.5}}
        />
        <button
          onClick={send} disabled={status !== "open" || !input.trim()}
          style={{padding:"8px 14px",background:status==="open"&&input.trim()?"linear-gradient(135deg,#00e5a0,#00bfff)":"#0d1f30",border:"none",borderRadius:8,color:status==="open"&&input.trim()?"#060f18":"#2a4060",fontFamily:"'Space Mono',monospace",fontSize:10,fontWeight:700,cursor:status==="open"&&input.trim()?"pointer":"not-allowed",transition:"all .2s",letterSpacing:1}}
        >SEND</button>
      </div>
    </div>
  );
};

// ── MLB Stats API ─────────────────────────────────────────────────────────────
const MLB_API = "https://statsapi.mlb.com/api/v1";

const fetchSchedule = async (date) => {
  const r = await fetch(
    `${MLB_API}/schedule?sportId=1&date=${date}&hydrate=probablePitcher,team,venue`
  );
  if (!r.ok) throw new Error(`MLB schedule API error ${r.status}`);
  return r.json();
};

const fetchFirstInningResult = async (gamePk) => {
  try {
    const r = await fetch(`${MLB_API}/game/${gamePk}/linescore`);
    if (!r.ok) return null;
    const d = await r.json();
    const first = d.innings?.find(i => i.num === 1);
    if (!first) return null;
    // homeRuns is only set once the bottom of the 1st is complete
    const homeRuns = first.home?.runs;
    if (homeRuns == null) return null;
    const awayRuns = first.away?.runs ?? 0;
    const totalRuns = awayRuns + homeRuns;
    return { nrfi: totalRuns === 0, totalRuns, awayRuns, homeRuns };
  } catch {
    return null;
  }
};

const fetchTeamStats = async (teamId, season) => {
  try {
    const r = await fetch(
      `${MLB_API}/teams/${teamId}/stats?stats=season&group=hitting&season=${season}`
    );
    if (!r.ok) return null;
    const d = await r.json();
    const stat = d.stats?.[0]?.splits?.[0]?.stat;
    if (!stat) return null;
    const ops  = stat.ops  != null ? parseFloat(stat.ops)  : null;
    const so   = stat.strikeOuts       ?? 0;
    const pa   = stat.plateAppearances ?? 0;
    const kPct = pa > 0 ? Math.round((so / pa) * 1000) / 10 : null;
    return { ops, kPct };
  } catch { return null; }
};

const fetchPitcherStats = async (personId, season) => {
  const tryFetch = async (s) => {
    try {
      const r = await fetch(
        `${MLB_API}/people/${personId}/stats?stats=season&group=pitching&season=${s}`
      );
      if (!r.ok) return null;
      const d = await r.json();
      const splits = d.stats?.[0]?.splits;
      if (!splits?.length) return null;
      const stat = splits[splits.length - 1].stat;
      const era  = stat.era  != null ? parseFloat(stat.era)  : null;
      const whip = stat.whip != null ? parseFloat(stat.whip) : null;
      if (era == null && whip == null) return null;
      return { era, whip, statSeason: s };
    } catch { return null; }
  };
  // Try current season first; fall back to prior season (covers Opening Day)
  return (await tryFetch(season)) ?? (await tryFetch(String(parseInt(season) - 1)));
};

const formatGameTime = (isoString) => {
  try {
    return new Date(isoString).toLocaleTimeString("en-US", {
      hour: "numeric", minute: "2-digit", timeZone: "America/New_York", timeZoneName: "short",
    });
  } catch { return "TBD"; }
};

// ── Components ────────────────────────────────────────────────────────────────
const Spinner = ({ msg }) => (
  <div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:16,padding:80}}>
    <div style={{width:40,height:40,border:"3px solid #1e2a3a",borderTop:"3px solid #00e5a0",borderRadius:"50%",animation:"spin .8s linear infinite"}}/>
    <span style={{fontFamily:"'Space Mono',monospace",fontSize:11,color:"#4a6080",letterSpacing:2}}>{msg}</span>
  </div>
);

const PRow = ({ side, name, era, whip, team, priorSeason }) => {
  const dot = side === "AWAY" ? "#4a9eff" : "#00e5a0";
  const ec = era == null ? "#4a6080" : era <= 3.5 ? "#00e5a0" : era >= 5 ? "#ff4d6d" : "#f5c842";
  const wc = whip == null ? "#4a6080" : whip <= 1.1 ? "#00e5a0" : whip >= 1.5 ? "#ff4d6d" : "#f5c842";
  return (
    <div style={{display:"flex",alignItems:"center",gap:10,padding:"8px 0",borderBottom:"1px solid #0e1822"}}>
      <div style={{width:6,height:6,borderRadius:"50%",background:dot,flexShrink:0}}/>
      <div style={{flex:1}}>
        <div style={{fontFamily:"'Space Mono',monospace",fontSize:9,color:"#4a6080",letterSpacing:1,display:"flex",alignItems:"center",gap:6}}>
          {side} · {team}
          {priorSeason && <span style={{background:"#f5c84220",color:"#f5c842",border:"1px solid #f5c84240",borderRadius:4,padding:"0 4px",fontSize:7,letterSpacing:1}}>{priorSeason} STATS</span>}
        </div>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginTop:3}}>
          <span style={{fontFamily:"'DM Sans',sans-serif",fontSize:13,color:"#c8d8e8",fontWeight:600}}>{name || "TBD"}</span>
          <div style={{display:"flex",gap:12}}>
            <span style={{fontFamily:"'Space Mono',monospace",fontSize:11,color:"#8899aa"}}>ERA <span style={{color:ec}}>{era != null ? era.toFixed(2) : "—"}</span></span>
            <span style={{fontFamily:"'Space Mono',monospace",fontSize:11,color:"#8899aa"}}>WHIP <span style={{color:wc}}>{whip != null ? whip.toFixed(2) : "—"}</span></span>
          </div>
        </div>
      </div>
    </div>
  );
};

const Chip = ({ label, color }) => (
  <div style={{fontFamily:"'Space Mono',monospace",fontSize:10,letterSpacing:1,padding:"3px 10px",borderRadius:20,background:`${color}15`,color,border:`1px solid ${color}35`}}>
    {label}
  </div>
);

const FirstInningBanner = ({ result }) => {
  if (!result) return null;
  const { nrfi, totalRuns, awayRuns, homeRuns } = result;
  const bg   = nrfi ? "linear-gradient(135deg,#003d2a,#004d34)" : "linear-gradient(135deg,#3d0010,#4d0015)";
  const border = nrfi ? "#00e5a040" : "#ff4d6d40";
  const accent = nrfi ? "#00e5a0" : "#ff4d6d";
  const label  = nrfi ? "NRFI" : "YRFI";
  const icon   = nrfi ? "✓" : "✗";
  const sub    = nrfi
    ? "NO RUNS IN THE FIRST INNING"
    : `${totalRuns} RUN${totalRuns !== 1 ? "S" : ""} SCORED · AWAY ${awayRuns} · HOME ${homeRuns}`;

  return (
    <div style={{margin:"-20px -22px 16px",padding:"14px 22px",background:bg,borderBottom:`1px solid ${border}`,display:"flex",alignItems:"center",gap:14}}>
      <div style={{width:48,height:48,borderRadius:"50%",background:`${accent}20`,border:`2px solid ${accent}`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:26,color:accent,fontWeight:700,flexShrink:0,lineHeight:1}}>
        {icon}
      </div>
      <div>
        <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:28,letterSpacing:3,color:accent,lineHeight:1}}>{label}</div>
        <div style={{fontFamily:"'Space Mono',monospace",fontSize:9,color:`${accent}99`,letterSpacing:1,marginTop:3}}>{sub}</div>
      </div>
      <div style={{marginLeft:"auto",fontFamily:"'Bebas Neue',sans-serif",fontSize:52,color:`${accent}15`,lineHeight:1,userSelect:"none"}}>{label}</div>
    </div>
  );
};

const CrowdPickSection = ({ gamePk, gameState, crowdPick, onPick }) => {
  const canPick = gameState !== 'Live' && gameState !== 'Final';
  const { nrfiCount = 0, yrfiCount = 0, userPick = null } = crowdPick ?? {};
  const total = nrfiCount + yrfiCount;
  const nrfiPct = total > 0 ? Math.round(nrfiCount / total * 100) : 50;
  const yrfiPct = 100 - nrfiPct;

  return (
    <div style={{marginTop:14,borderTop:"1px solid #0e1822",paddingTop:12}}>
      <div style={{fontFamily:"'Space Mono',monospace",fontSize:8,color:"#4a6080",letterSpacing:1,marginBottom:8}}>
        CROWD PICK{total > 0 ? ` · ${total} VOTE${total !== 1 ? 'S' : ''}` : ' · BE THE FIRST'}
      </div>

      {/* Pick buttons */}
      <div style={{display:"flex",gap:8,marginBottom:total > 0 ? 10 : 0}}>
        {['NRFI','YRFI'].map(pick => {
          const isSelected = userPick === pick;
          const color = pick === 'NRFI' ? '#00e5a0' : '#ff4d6d';
          return (
            <button
              key={pick}
              onClick={() => canPick && onPick(gamePk, pick)}
              disabled={!canPick}
              style={{flex:1,padding:"7px 0",background:isSelected?`${color}20`:"#0a1520",border:`1px solid ${isSelected?color:canPick?"#1a2e42":"#0e1822"}`,borderRadius:7,color:isSelected?color:canPick?"#8899aa":"#2a4060",fontFamily:"'Space Mono',monospace",fontSize:11,fontWeight:700,letterSpacing:2,cursor:canPick?"pointer":"not-allowed",transition:"all .15s"}}
            >
              {pick}{isSelected ? ' ✓' : ''}
            </button>
          );
        })}
      </div>

      {/* Crowd bar */}
      {total > 0 && (
        <div>
          <div style={{display:"flex",height:5,borderRadius:3,overflow:"hidden",marginBottom:5}}>
            <div style={{width:`${nrfiPct}%`,background:"#00e5a0",transition:"width .3s"}}/>
            <div style={{width:`${yrfiPct}%`,background:"#ff4d6d",transition:"width .3s"}}/>
          </div>
          <div style={{display:"flex",justifyContent:"space-between"}}>
            <span style={{fontFamily:"'Space Mono',monospace",fontSize:9,color:"#00e5a0"}}>{nrfiPct}% NRFI</span>
            <span style={{fontFamily:"'Space Mono',monospace",fontSize:9,color:"#ff4d6d"}}>{yrfiPct}% YRFI</span>
          </div>
        </div>
      )}

      {!canPick && (
        <div style={{fontFamily:"'Space Mono',monospace",fontSize:8,color:"#2a4060",letterSpacing:1,textAlign:"center",marginTop:6}}>
          PICKS LOCKED · GAME IN PROGRESS
        </div>
      )}
    </div>
  );
};

const Card = ({ game, idx, crowdPick, onPick }) => {
  const pf = getPF(game.venue);
  const weatherDelta = calcWeatherDelta(game.weather);
  const nr = nrfiGrade({ homeERA:game.homeERA, awayERA:game.awayERA, homeWHIP:game.homeWHIP, awayWHIP:game.awayWHIP, pf, weatherDelta });
  const avgERA = game.homeERA != null && game.awayERA != null ? ((game.homeERA + game.awayERA) / 2).toFixed(2) : null;
  const pfPct = ((pf - 1) * 100).toFixed(0);
  const pfc = pf > 1.05 ? "#ff4d6d" : pf < 0.97 ? "#00e5a0" : "#4a6080";

  const wx = game.weather;
  const windInfo = getWindInfo(wx);
  const tempColor = wx && !wx.isIndoor && wx.tempF != null
    ? (wx.tempF < 50 ? "#4a9eff" : wx.tempF > 85 ? "#ff9f43" : "#4a6080")
    : "#4a6080";

  const result = game.firstInning ?? null;
  const cardBorder = result
    ? (result.nrfi ? "#00e5a0" : "#ff4d6d")
    : nr.c;

  return (
    <div
      style={{background:"linear-gradient(145deg,#0d1f30,#0a1520)",border:`1px solid ${result ? (result.nrfi ? "#00e5a030" : "#ff4d6d30") : "#1a2e42"}`,borderTop:`3px solid ${cardBorder}`,borderRadius:12,padding:"20px 22px",position:"relative",overflow:"hidden",animation:`fadeUp .4s ease ${idx * .06}s both`,transition:"transform .2s,box-shadow .2s"}}
      onMouseEnter={e=>{e.currentTarget.style.transform="translateY(-3px)";e.currentTarget.style.boxShadow="0 12px 40px rgba(0,0,0,.5)";}}
      onMouseLeave={e=>{e.currentTarget.style.transform="translateY(0)";e.currentTarget.style.boxShadow="none";}}
    >
      <div style={{position:"absolute",top:-30,right:-30,width:120,height:120,borderRadius:"50%",background:`${nr.c}08`,pointerEvents:"none"}}/>
      <FirstInningBanner result={result}/>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:14,gap:12}}>
        <div style={{flex:1,minWidth:0}}>
          <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:20,letterSpacing:2,color:"#e0eaf4",lineHeight:1.15}}>
            {game.awayTeam} <span style={{color:"#2a4a6a"}}>@</span> {game.homeTeam}
          </div>
          <div style={{fontFamily:"'Space Mono',monospace",fontSize:9,color:"#4a6080",marginTop:4,letterSpacing:1}}>{game.venue || "—"} · {game.gameTime || "TBD"}</div>
        </div>
        <div style={{display:"flex",flexDirection:"column",alignItems:"center",background:`${nr.c}15`,border:`1px solid ${nr.c}40`,borderRadius:10,padding:"8px 14px",minWidth:68,flexShrink:0}}>
          <span style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:36,color:nr.c,lineHeight:1}}>{nr.g}</span>
          <span style={{fontFamily:"'Space Mono',monospace",fontSize:8,color:nr.c,letterSpacing:1,textAlign:"center",marginTop:2}}>{nr.l}</span>
          <div style={{marginTop:5,width:"100%",height:3,borderRadius:2,background:"#0a1520",overflow:"hidden"}}>
            <div style={{width:`${nr.s}%`,height:"100%",background:nr.c,borderRadius:2}}/>
          </div>
          <span style={{fontFamily:"'Space Mono',monospace",fontSize:8,color:"#4a6080",marginTop:2}}>{nr.s}/100</span>
        </div>
      </div>

      <div style={{marginBottom:0}}>
        <PRow side="AWAY" name={game.awayPitcher} era={game.awayERA} whip={game.awayWHIP} team={game.awayTeam} priorSeason={game.awayStatSeason !== String(game.gameIso?.slice(0,4)) ? game.awayStatSeason : null}/>
        <PRow side="HOME" name={game.homePitcher} era={game.homeERA} whip={game.homeWHIP} team={game.homeTeam} priorSeason={game.homeStatSeason !== String(game.gameIso?.slice(0,4)) ? game.homeStatSeason : null}/>
      </div>

      {/* Lineup quality */}
      {(game.awayOPS != null || game.homeOPS != null) && (() => {
        const opsColor  = (ops)  => ops  >= 0.78 ? "#ff4d6d" : ops  <= 0.70 ? "#00e5a0" : "#f5c842";
        const kPctColor = (kpct) => kpct >= 24   ? "#00e5a0" : kpct <= 18   ? "#ff4d6d" : "#f5c842";
        return (
          <div style={{display:"flex",gap:0,padding:"8px 0",borderBottom:"1px solid #0e1822",borderTop:"1px solid #0e1822",marginTop:2}}>
            {[["AWAY", game.awayOPS, game.awayKPct], ["HOME", game.homeOPS, game.homeKPct]].map(([side, ops, kpct], i) => (
              <div key={side} style={{flex:1,paddingLeft: i === 0 ? 16 : 12, borderLeft: i === 1 ? "1px solid #0e1822" : "none"}}>
                <div style={{fontFamily:"'Space Mono',monospace",fontSize:7,color:"#4a6080",letterSpacing:1,marginBottom:4}}>{side} LINEUP</div>
                <div style={{display:"flex",gap:10}}>
                  {ops  != null && <span style={{fontFamily:"'Space Mono',monospace",fontSize:10,color:"#8899aa"}}>OPS <span style={{color:opsColor(ops)}}>{ops.toFixed(3)}</span></span>}
                  {kpct != null && <span style={{fontFamily:"'Space Mono',monospace",fontSize:10,color:"#8899aa"}}>K% <span style={{color:kPctColor(kpct)}}>{kpct.toFixed(1)}%</span></span>}
                </div>
              </div>
            ))}
          </div>
        );
      })()}

      {/* Score breakdown */}
      {(() => {
        const avgERA2  = ((game.homeERA  ?? 4.5) + (game.awayERA  ?? 4.5)) / 2;
        const avgWHIP2 = ((game.homeWHIP ?? 1.3)  + (game.awayWHIP ?? 1.3))  / 2;
        const eraP  = Math.max(0, (avgERA2  - 3.0) * 25);
        const whipP = Math.max(0, (avgWHIP2 - 1.0) * 40);
        const parkP = (pf - 1.0) * 60;
        const wxD   = weatherDelta;
        const rows = [
          { label: "ERA penalty",  val: -eraP,  color: "#ff4d6d" },
          { label: "WHIP penalty", val: -whipP, color: "#ff4d6d" },
          { label: "Park penalty", val: -parkP, color: parkP > 0 ? "#ff9f43" : parkP < 0 ? "#00e5a0" : "#4a6080" },
          { label: "Weather",      val:  wxD,   color: wxD >= 0 ? "#00e5a0" : "#ff4d6d" },
        ];
        const maxAbs = Math.max(...rows.map(r => Math.abs(r.val)), 1);
        return (
          <div style={{margin:"10px 0",padding:"10px 12px",background:"#060f18",border:"1px solid #0e1822",borderRadius:8}}>
            <div style={{fontFamily:"'Space Mono',monospace",fontSize:7,color:"#4a6080",letterSpacing:1,marginBottom:8}}>SCORE BREAKDOWN · STARTS AT 100</div>
            {rows.map(({ label, val, color }) => (
              <div key={label} style={{display:"flex",alignItems:"center",gap:8,marginBottom:5}}>
                <div style={{fontFamily:"'Space Mono',monospace",fontSize:8,color:"#4a6080",width:82,flexShrink:0}}>{label}</div>
                <div style={{flex:1,height:5,background:"#1a2e42",borderRadius:3,overflow:"hidden"}}>
                  <div style={{width:`${Math.abs(val) / maxAbs * 100}%`,height:"100%",background:color,borderRadius:3}}/>
                </div>
                <div style={{fontFamily:"'Space Mono',monospace",fontSize:8,color,width:34,textAlign:"right",flexShrink:0}}>
                  {val >= 0 ? "+" : "−"}{Math.abs(val).toFixed(1)}
                </div>
              </div>
            ))}
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"baseline",marginTop:8,paddingTop:6,borderTop:"1px solid #0e1822"}}>
              <span style={{fontFamily:"'Space Mono',monospace",fontSize:8,color:"#4a6080",letterSpacing:1}}>FINAL SCORE</span>
              <div style={{display:"flex",alignItems:"baseline",gap:8}}>
                <span style={{fontFamily:"'Space Mono',monospace",fontSize:8,color:"#2a4060"}}>
                  100 − {eraP.toFixed(1)} − {whipP.toFixed(1)} {parkP >= 0 ? "−" : "+"} {Math.abs(parkP).toFixed(1)} {wxD >= 0 ? "+" : "−"} {Math.abs(wxD).toFixed(1)} =
                </span>
                <span style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:22,color:nr.c,lineHeight:1}}>{nr.s}</span>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Chips row */}
      <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
        <Chip label={`PARK ${pf > 1 ? "+" : ""}${pfPct}%`} color={pfc}/>
        {avgERA && <Chip label={`AVG ERA ${avgERA}`} color="#4a6080"/>}
        {wx?.isIndoor && <Chip label="DOME" color="#4a6080"/>}
        {wx && !wx.isIndoor && wx.tempF != null &&
          <Chip label={`${Math.round(wx.tempF)}°F`} color={tempColor}/>}
        {windInfo && <Chip label={windInfo.label} color={windInfo.color}/>}
        {wx && !wx.isIndoor && wx.precipPct != null && wx.precipPct >= 40 &&
          <Chip label={`${wx.precipPct}% RAIN`} color="#f5c842"/>}
      </div>

      <CrowdPickSection
        gamePk={game.gamePk}
        gameState={game.gameState}
        crowdPick={crowdPick}
        onPick={onPick}
      />
    </div>
  );
};

// ── Model Stats Panel ─────────────────────────────────────────────────────────
const GRADE_META = {
  A: { c: "#00e5a0", l: "Strong NRFI", range: "score ≥ 75" },
  B: { c: "#f5c842", l: "Lean NRFI",   range: "score 58–74" },
  C: { c: "#ff9f43", l: "Toss-Up",     range: "score 42–57" },
  D: { c: "#ff4d6d", l: "Risky NRFI",  range: "score < 42"  },
};

const ModelStatsPanel = ({ season }) => {
  const [records,      setRecords]      = useState(null);
  const [picksSummary, setPicksSummary] = useState(null);
  const [loading,      setLoading]      = useState(true);

  useEffect(() => {
    Promise.all([
      fetch(`${OUTCOMES_API}/outcomes?season=${season}`).then(r => r.json()),
      fetch(`${OUTCOMES_API}/picks?season=${season}`).then(r => r.json()).catch(() => []),
    ]).then(([items, picks]) => {
      setRecords(items);
      setPicksSummary(picks);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [season]);

  if (loading) return (
    <div style={{padding:"14px 32px",background:"#0a1520",borderBottom:"1px solid #0e1f30",textAlign:"center"}}>
      <span style={{fontFamily:"'Space Mono',monospace",fontSize:10,color:"#4a6080",letterSpacing:2}}>LOADING MODEL DATA...</span>
    </div>
  );

  // Only count regular season games (Opening Day is typically late March)
  const regularSeason = (records ?? []).filter(r => r.date >= `${season}-03-25`);

  const stats = { A:{nrfi:0,total:0}, B:{nrfi:0,total:0}, C:{nrfi:0,total:0}, D:{nrfi:0,total:0} };
  let totalNRFI = 0;
  regularSeason.forEach(r => {
    const g = r.predictedGrade;
    if (stats[g]) { stats[g].total++; if (r.actualNRFI) { stats[g].nrfi++; totalNRFI++; } }
  });
  const totalGames = regularSeason.length;
  const baseline   = totalGames ? totalNRFI / totalGames : 0;

  // Crowd pick accuracy per grade — join picks summary with outcomes
  const crowd = { A:{nrfi:0,yrfi:0,correct:0,withResult:0}, B:{nrfi:0,yrfi:0,correct:0,withResult:0}, C:{nrfi:0,yrfi:0,correct:0,withResult:0}, D:{nrfi:0,yrfi:0,correct:0,withResult:0} };
  if (picksSummary?.length && records?.length) {
    const outcomeMap = Object.fromEntries(regularSeason.map(r => [String(r.gamePk), r]));
    picksSummary.forEach(p => {
      const outcome = outcomeMap[String(p.gamePk)];
      if (!outcome?.predictedGrade) return;
      const g = outcome.predictedGrade;
      if (!crowd[g]) return;
      crowd[g].nrfi += p.nrfiCount;
      crowd[g].yrfi += p.yrfiCount;
      if (outcome.actualNRFI != null) {
        const picks = p.nrfiCount + p.yrfiCount;
        crowd[g].withResult += picks;
        crowd[g].correct += outcome.actualNRFI ? p.nrfiCount : p.yrfiCount;
      }
    });
  }

  return (
    <div style={{background:"#0a1520",borderBottom:"1px solid #0e1f30",padding:"18px 32px"}}>
      <div style={{maxWidth:1100,margin:"0 auto"}}>

        {/* Header row */}
        <div style={{display:"flex",alignItems:"baseline",gap:16,marginBottom:14,flexWrap:"wrap"}}>
          <span style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:16,letterSpacing:3,color:"#e0eaf4"}}>MODEL PERFORMANCE</span>
          {totalGames > 0 && <>
            <span style={{fontFamily:"'Space Mono',monospace",fontSize:9,color:"#4a6080",letterSpacing:1}}>{totalGames} GRADED GAMES</span>
            <span style={{fontFamily:"'Space Mono',monospace",fontSize:9,color:"#4a6080",letterSpacing:1}}>BASELINE NRFI {Math.round(baseline*100)}%</span>
            <span style={{fontFamily:"'Space Mono',monospace",fontSize:9,color:"#2a4060",letterSpacing:1,marginLeft:"auto"}}>↑ ABOVE BASELINE · ~ NEAR · ↓ BELOW</span>
          </>}
        </div>

        {totalGames === 0 ? (
          <div style={{textAlign:"center",padding:"20px 0",fontFamily:"'Space Mono',monospace",fontSize:10,color:"#2a4060",letterSpacing:1}}>
            NO COMPLETED GAMES YET — DATA BUILDS UP DURING THE SEASON
          </div>
        ) : (
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(220px,1fr))",gap:10}}>
            {["A","B","C","D"].map(g => {
              const { c, l, range } = GRADE_META[g];
              const { nrfi, total } = stats[g];
              const rate = total ? nrfi / total : null;
              const diff = rate != null ? rate - baseline : null;
              const trend      = diff == null ? null  : diff >  0.05 ? "↑" : diff < -0.05 ? "↓" : "~";
              const trendColor = diff == null ? "#4a6080" : diff > 0.05 ? "#00e5a0" : diff < -0.05 ? "#ff4d6d" : "#f5c842";

              const { nrfi: cNrfi, yrfi: cYrfi, correct: cCorrect, withResult: cWithResult } = crowd[g];
              const cTotal = cNrfi + cYrfi;
              const cNrfiPct = cTotal > 0 ? Math.round(cNrfi / cTotal * 100) : null;
              const cAccuracy = cWithResult > 0 ? Math.round(cCorrect / cWithResult * 100) : null;

              return (
                <div key={g} style={{background:"#060f18",border:`1px solid ${c}20`,borderTop:`2px solid ${c}`,borderRadius:8,padding:"12px 14px"}}>
                  {/* Grade label row */}
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:10}}>
                    <div style={{display:"flex",alignItems:"center",gap:8}}>
                      <span style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:28,color:c,lineHeight:1}}>{g}</span>
                      <div>
                        <div style={{fontFamily:"'Space Mono',monospace",fontSize:8,color:c,letterSpacing:1}}>{l}</div>
                        <div style={{fontFamily:"'Space Mono',monospace",fontSize:7,color:"#2a4060",letterSpacing:1,marginTop:1}}>{range}</div>
                      </div>
                    </div>
                    {trend && <span style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:24,color:trendColor,lineHeight:1}}>{trend}</span>}
                  </div>

                  {/* Model NRFI rate bar */}
                  <div style={{height:4,background:"#1a2e42",borderRadius:2,marginBottom:10,overflow:"hidden"}}>
                    <div style={{width:`${rate != null ? Math.round(rate*100) : 0}%`,height:"100%",background:c,borderRadius:2}}/>
                  </div>

                  {/* Big number + sample size */}
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"baseline",marginBottom:10}}>
                    <span style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:32,color:"#e0eaf4",lineHeight:1}}>
                      {rate != null ? `${Math.round(rate*100)}%` : "—"}
                    </span>
                    <div style={{textAlign:"right"}}>
                      <div style={{fontFamily:"'Space Mono',monospace",fontSize:9,color:"#4a6080"}}>{nrfi}/{total} NRFI</div>
                      {total > 0 && total < 10 &&
                        <div style={{fontFamily:"'Space Mono',monospace",fontSize:7,color:"#2a4060",letterSpacing:1,marginTop:2}}>LOW SAMPLE</div>}
                    </div>
                  </div>

                  {/* Crowd picks section */}
                  {cTotal > 0 && (
                    <div style={{borderTop:"1px solid #0e1822",paddingTop:8}}>
                      <div style={{fontFamily:"'Space Mono',monospace",fontSize:7,color:"#4a6080",letterSpacing:1,marginBottom:6}}>CROWD PICKS · {cTotal} VOTE{cTotal !== 1 ? 'S' : ''}</div>
                      <div style={{display:"flex",height:4,borderRadius:2,overflow:"hidden",marginBottom:5}}>
                        <div style={{width:`${cNrfiPct}%`,background:"#00e5a0",transition:"width .3s"}}/>
                        <div style={{width:`${100 - cNrfiPct}%`,background:"#ff4d6d",transition:"width .3s"}}/>
                      </div>
                      <div style={{display:"flex",justifyContent:"space-between",alignItems:"baseline"}}>
                        <span style={{fontFamily:"'Space Mono',monospace",fontSize:8,color:"#00e5a0"}}>{cNrfiPct}% NRFI</span>
                        {cAccuracy != null && (
                          <span style={{fontFamily:"'Space Mono',monospace",fontSize:8,color:cAccuracy >= 55 ? "#00e5a0" : cAccuracy >= 45 ? "#f5c842" : "#ff4d6d"}}>
                            {cAccuracy}% CORRECT
                          </span>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

// ── App ───────────────────────────────────────────────────────────────────────
export default function App() {
  const [games,    setGames]    = useState([]);
  const [loading,  setLoading]  = useState(false);
  const [status,   setStatus]   = useState("");
  const [error,    setError]    = useState(null);
  const [date,     setDate]     = useState("2026-03-26");
  const [sortBy,   setSortBy]   = useState("grade");
  const [fetched,  setFetched]  = useState(false);

  // ── Chat + picks state ─────────────────────────────────────────────────────
  const [nickname,        setNickname]        = useState(() => localStorage.getItem("nrfi-nickname") || "");
  const [showNickPrompt,  setShowNickPrompt]  = useState(false);
  const [crowdPicks,      setCrowdPicks]      = useState({});
  const [pendingPick,     setPendingPick]     = useState(null); // { gamePk, pick } while waiting for nickname

  const load = useCallback(async (d) => {
    setLoading(true); setError(null); setGames([]); setFetched(false);
    const season = d.slice(0, 4);

    try {
      // ── Step 1: Fetch schedule ────────────────────────────────────────────
      setStatus("FETCHING SCHEDULE...");
      const schedData = await fetchSchedule(d);
      const rawGames = schedData.dates?.[0]?.games ?? [];

      if (!rawGames.length) {
        setGames([]); setFetched(true); setLoading(false); setStatus(""); return;
      }

      const gameList = rawGames.map((g, i) => ({
        id: g.gamePk ?? i,
        gamePk: g.gamePk,
        gameState: g.status?.abstractGameState ?? "Preview", // "Preview" | "Live" | "Final"
        gameIso: g.gameDate,
        gameTime: formatGameTime(g.gameDate),
        venue: g.venue?.name ?? "",
        awayTeam: g.teams?.away?.team?.teamName ?? g.teams?.away?.team?.name ?? "Away",
        homeTeam: g.teams?.home?.team?.teamName ?? g.teams?.home?.team?.name ?? "Home",
        awayPitcher: g.teams?.away?.probablePitcher?.fullName ?? null,
        awayPitcherId: g.teams?.away?.probablePitcher?.id ?? null,
        homePitcher: g.teams?.home?.probablePitcher?.fullName ?? null,
        homePitcherId: g.teams?.home?.probablePitcher?.id ?? null,
        homeTeamId: g.teams?.home?.team?.id ?? null,
        awayTeamId: g.teams?.away?.team?.id ?? null,
      }));

      // ── Step 2: Fetch pitcher stats + weather + team hitting in parallel ──
      setStatus("FETCHING STATS & WEATHER...");
      const pitcherIds = [...new Set(
        gameList.flatMap(g => [g.awayPitcherId, g.homePitcherId]).filter(Boolean)
      )];
      const teamIds = [...new Set(
        gameList.flatMap(g => [g.homeTeamId, g.awayTeamId]).filter(Boolean)
      )];

      const [statsEntries, weatherResults, firstInningResults, teamStatsEntries] = await Promise.all([
        Promise.all(pitcherIds.map(async (id) => [id, await fetchPitcherStats(id, season)])),
        Promise.all(gameList.map(async (g) => {
          const stadium = getStadium(g.venue);
          if (!stadium) return null;
          const wx = await fetchWeather(stadium.lat, stadium.lon, d, g.gameIso);
          return wx ? { ...wx, cfBearing: stadium.cfBearing, isIndoor: stadium.indoor } : null;
        })),
        Promise.all(gameList.map(async (g) => {
          if (g.gameState === "Preview" || !g.gamePk) return null;
          return fetchFirstInningResult(g.gamePk);
        })),
        Promise.all(teamIds.map(async (id) => [id, await fetchTeamStats(id, season)])),
      ]);

      const statsMap     = Object.fromEntries(statsEntries);
      const teamStatsMap = Object.fromEntries(teamStatsEntries);

      // ── Step 3: Merge ─────────────────────────────────────────────────────
      const enriched = gameList.map((g, i) => ({
        ...g,
        awayERA:        statsMap[g.awayPitcherId]?.era        ?? null,
        awayWHIP:       statsMap[g.awayPitcherId]?.whip       ?? null,
        homeERA:        statsMap[g.homePitcherId]?.era        ?? null,
        homeWHIP:       statsMap[g.homePitcherId]?.whip       ?? null,
        awayStatSeason: statsMap[g.awayPitcherId]?.statSeason ?? null,
        homeStatSeason: statsMap[g.homePitcherId]?.statSeason ?? null,
        homeOPS:        teamStatsMap[g.homeTeamId]?.ops       ?? null,
        awayOPS:        teamStatsMap[g.awayTeamId]?.ops       ?? null,
        homeKPct:       teamStatsMap[g.homeTeamId]?.kPct      ?? null,
        awayKPct:       teamStatsMap[g.awayTeamId]?.kPct      ?? null,
        weather:        weatherResults[i],
        firstInning:    firstInningResults[i],
      }));

      setGames(enriched);
      setFetched(true);

      // ── Step 4: Persist to DynamoDB + fetch crowd picks (fire-and-forget) ───
      const uuid = getUserUuid();
      const picksResults = await Promise.allSettled(
        enriched.map(g => fetchGamePicks(g.gamePk, uuid))
      );
      const picksMap = {};
      enriched.forEach((g, i) => {
        const r = picksResults[i];
        picksMap[String(g.gamePk)] = r.status === 'fulfilled' ? r.value : { nrfiCount: 0, yrfiCount: 0, userPick: null };
      });
      setCrowdPicks(picksMap);

      enriched.forEach((g) => {
        const pf = getPF(g.venue);
        const wd = calcWeatherDelta(g.weather);
        const { g: grade, s: score } = nrfiGrade({
          homeERA: g.homeERA, awayERA: g.awayERA,
          homeWHIP: g.homeWHIP, awayWHIP: g.awayWHIP,
          pf, weatherDelta: wd,
        });
        if (g.firstInning) {
          recordResult(g.gamePk, g.firstInning, score, grade, season, g);
        } else {
          saveOutcome(g, score, grade, season);
        }
      });
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false); setStatus("");
    }
  }, []);

  const handlePick = useCallback(async (gamePk, pick) => {
    const uuid = getUserUuid();
    const nick = nickname || localStorage.getItem("nrfi-nickname") || "";
    if (!nick) {
      setPendingPick({ gamePk, pick });
      setShowNickPrompt(true);
      return;
    }
    try {
      const data = await submitPick(gamePk, pick, uuid, nick, date);
      setCrowdPicks(prev => ({ ...prev, [String(gamePk)]: data }));
    } catch { /* non-critical */ }
  }, [nickname, date]);

  const gradeOf = (g) => {
    const pf = getPF(g.venue);
    const weatherDelta = calcWeatherDelta(g.weather);
    return nrfiGrade({ homeERA:g.homeERA, awayERA:g.awayERA, homeWHIP:g.homeWHIP, awayWHIP:g.awayWHIP, pf, weatherDelta });
  };

  const sorted = [...games].sort((a, b) =>
    sortBy === "grade" ? gradeOf(b).s - gradeOf(a).s : 0
  );
  const counts = games.reduce((acc, g) => {
    const { g: gr } = gradeOf(g);
    acc[gr] = (acc[gr] || 0) + 1; return acc;
  }, {});

  return (
    <div style={{minHeight:"100vh",background:"#060f18",fontFamily:"'DM Sans',sans-serif",paddingBottom:60}}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Space+Mono:wght@400;700&family=DM+Sans:wght@400;500;600;700&display=swap');
        @keyframes spin{to{transform:rotate(360deg);}}
        @keyframes fadeUp{from{opacity:0;transform:translateY(18px);}to{opacity:1;transform:translateY(0);}}
        *{box-sizing:border-box;margin:0;padding:0;}
        ::-webkit-scrollbar{width:4px;}::-webkit-scrollbar-track{background:#060f18;}::-webkit-scrollbar-thumb{background:#1a2e42;border-radius:2px;}
        input[type=date]::-webkit-calendar-picker-indicator{filter:invert(.4);cursor:pointer;}
        .body-layout{display:flex;flex-direction:row;gap:20px;align-items:flex-start;max-width:1400px;margin:32px auto 0;padding:0 24px;}
        .chat-sidebar{width:320px;flex-shrink:0;position:sticky;top:90px;height:calc(100vh - 110px);}
        @media(max-width:768px){
          .body-layout{flex-direction:column;}
          .chat-sidebar{width:100%;position:static;height:420px;}
        }
      `}</style>

      {/* Header */}
      <div style={{background:"linear-gradient(180deg,#0a1c2e,#060f18)",borderBottom:"1px solid #0e1f30",padding:"28px 32px 20px",position:"sticky",top:0,zIndex:10}}>
        <div style={{maxWidth:1100,margin:"0 auto"}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",flexWrap:"wrap",gap:16}}>
            <div style={{display:"flex",alignItems:"center",gap:12}}>
              <img src={bennyLogo} alt="NRFI Benny" style={{width:52,height:52,borderRadius:10,objectFit:"cover"}}/>
              <div>
                <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:28,letterSpacing:4,color:"#e0eaf4"}}>NRFI BENNY</div>
                <div style={{fontFamily:"'Space Mono',monospace",fontSize:10,color:"#4a6080",letterSpacing:2}}>NO RUN FIRST INNING · MLB ANALYSIS</div>
              </div>
            </div>
            <div style={{display:"flex",gap:10,alignItems:"center",flexWrap:"wrap"}}>
              <div style={{display:"flex",alignItems:"center",gap:8,background:"#0d1f30",border:"1px solid #1a2e42",borderRadius:8,padding:"6px 12px"}}>
                <span style={{fontFamily:"'Space Mono',monospace",fontSize:10,color:"#4a6080",letterSpacing:1}}>DATE</span>
                <input type="date" value={date} onChange={e => setDate(e.target.value)}
                  style={{background:"transparent",border:"none",outline:"none",color:"#c8d8e8",fontFamily:"'Space Mono',monospace",fontSize:11,cursor:"pointer"}}/>
              </div>
              <div style={{display:"flex",background:"#0d1f30",border:"1px solid #1a2e42",borderRadius:8,overflow:"hidden"}}>
                {["grade","time"].map(s => (
                  <button key={s} onClick={() => setSortBy(s)} style={{padding:"6px 14px",background:sortBy===s?"#00e5a020":"transparent",border:"none",color:sortBy===s?"#00e5a0":"#4a6080",fontFamily:"'Space Mono',monospace",fontSize:10,letterSpacing:1,cursor:"pointer",textTransform:"uppercase",transition:"all .2s"}}>
                    {s === "grade" ? "BY GRADE" : "BY TIME"}
                  </button>
                ))}
              </div>
              <button onClick={() => load(date)} disabled={loading} style={{padding:"7px 20px",background:loading?"#0d1f30":"linear-gradient(135deg,#00e5a0,#00bfff)",border:"none",borderRadius:8,color:loading?"#4a6080":"#060f18",fontFamily:"'Space Mono',monospace",fontSize:11,fontWeight:700,letterSpacing:1,cursor:loading?"not-allowed":"pointer",transition:"all .2s"}}>
                {loading ? "LOADING..." : "LOAD GAMES"}
              </button>
            </div>
          </div>
          {fetched && games.length > 0 && (
            <div style={{display:"flex",gap:20,marginTop:14,flexWrap:"wrap",alignItems:"center"}}>
              {[["A","#00e5a0","Strong"],["B","#f5c842","Lean"],["C","#ff9f43","Toss-Up"],["D","#ff4d6d","Risky"]].map(([g,c,l]) => (
                <div key={g} style={{display:"flex",alignItems:"center",gap:6}}>
                  <span style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:18,color:c}}>{g}</span>
                  <span style={{fontFamily:"'Space Mono',monospace",fontSize:10,color:"#4a6080"}}>{l}</span>
                  <span style={{fontFamily:"'Space Mono',monospace",fontSize:10,background:`${c}20`,color:c,padding:"1px 7px",borderRadius:10}}>{counts[g]||0}</span>
                </div>
              ))}
              <span style={{fontFamily:"'Space Mono',monospace",fontSize:10,color:"#2a4a6a",marginLeft:"auto"}}>{games.length} GAMES</span>
            </div>
          )}
        </div>
      </div>

      {/* Model stats panel */}
      <ModelStatsPanel season={date.slice(0, 4)}/>

      {/* Nickname prompt — shown on first chat or when changing name */}
      {showNickPrompt && (
        <NicknamePrompt onSave={(n) => {
          localStorage.setItem("nrfi-nickname", n);
          setNickname(n);
          setShowNickPrompt(false);
          if (pendingPick) {
            const { gamePk, pick } = pendingPick;
            setPendingPick(null);
            submitPick(gamePk, pick, getUserUuid(), n, date)
              .then(data => setCrowdPicks(prev => ({ ...prev, [String(gamePk)]: data })))
              .catch(() => {});
          }
        }}/>
      )}

      {/* Body */}
      <div className="body-layout">
        {/* Main content column */}
        <div style={{flex:1,minWidth:0}}>
        {!loading && !fetched && !error && (
          <div style={{textAlign:"center",padding:"80px 20px"}}>
            <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:52,color:"#0d1f30",letterSpacing:6,lineHeight:1}}>NRFI</div>
            <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:22,color:"#1a3050",letterSpacing:4,marginBottom:8}}>TRACKER</div>
            <div style={{fontFamily:"'Space Mono',monospace",fontSize:11,color:"#2a4060",marginBottom:32,letterSpacing:1}}>SELECT A DATE · LOAD GAMES · BET SMARTER</div>
            <div style={{display:"flex",gap:12,justifyContent:"center",flexWrap:"wrap"}}>
              <button onClick={() => { setDate("2026-03-25"); setTimeout(() => load("2026-03-25"), 50); }} style={{padding:"10px 24px",background:"#0d1f30",border:"1px solid #1a2e42",borderRadius:10,color:"#c8d8e8",fontFamily:"'Space Mono',monospace",fontSize:11,fontWeight:700,letterSpacing:1,cursor:"pointer"}}>
                MAR 25 (OPENING NIGHT)
              </button>
              <button onClick={() => { setDate("2026-03-26"); setTimeout(() => load("2026-03-26"), 50); }} style={{padding:"10px 24px",background:"linear-gradient(135deg,#00e5a0,#00bfff)",border:"none",borderRadius:10,color:"#060f18",fontFamily:"'Space Mono',monospace",fontSize:12,fontWeight:700,letterSpacing:1,cursor:"pointer"}}>
                MAR 26 (OPENING DAY — 11 GAMES)
              </button>
              <button onClick={() => { setDate("2026-03-27"); setTimeout(() => load("2026-03-27"), 50); }} style={{padding:"10px 24px",background:"#0d1f30",border:"1px solid #1a2e42",borderRadius:10,color:"#c8d8e8",fontFamily:"'Space Mono',monospace",fontSize:11,fontWeight:700,letterSpacing:1,cursor:"pointer"}}>
                MAR 27
              </button>
            </div>
          </div>
        )}
        {loading && <Spinner msg={status || "LOADING..."}/>}
        {error && (
          <div style={{background:"#1a0d10",border:"1px solid #ff4d6d40",borderRadius:12,padding:28,textAlign:"center"}}>
            <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:22,color:"#ff4d6d",letterSpacing:2,marginBottom:8}}>ERROR</div>
            <div style={{fontFamily:"'Space Mono',monospace",fontSize:11,color:"#4a6080",maxWidth:480,margin:"0 auto 16px"}}>{error}</div>
            <button onClick={() => load(date)} style={{padding:"8px 24px",background:"#ff4d6d20",border:"1px solid #ff4d6d40",color:"#ff4d6d",borderRadius:8,cursor:"pointer",fontFamily:"'Space Mono',monospace",fontSize:11,letterSpacing:1}}>RETRY</button>
          </div>
        )}
        {fetched && !loading && games.length === 0 && (
          <div style={{textAlign:"center",padding:60}}>
            <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:28,color:"#1a2e42",letterSpacing:4}}>NO GAMES FOUND</div>
            <div style={{fontFamily:"'Space Mono',monospace",fontSize:11,color:"#2a4060",marginTop:8,marginBottom:24}}>No games found for this date. Try March 25, 26, or 27.</div>
            <div style={{display:"flex",gap:10,justifyContent:"center"}}>
              {["2026-03-25","2026-03-26","2026-03-27"].map(d => (
                <button key={d} onClick={() => { setDate(d); setTimeout(() => load(d), 50); }} style={{padding:"8px 18px",background:"#0d1f30",border:"1px solid #1a2e42",borderRadius:8,color:"#c8d8e8",fontFamily:"'Space Mono',monospace",fontSize:10,cursor:"pointer",letterSpacing:1}}>
                  {d.slice(5)}
                </button>
              ))}
            </div>
          </div>
        )}
        {!loading && sorted.length > 0 && (
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(320px,1fr))",gap:20}}>
            {sorted.map((g, i) => <Card key={g.id || i} game={g} idx={i} crowdPick={crowdPicks[String(g.gamePk)]} onPick={handlePick}/>)}
          </div>
        )}
        </div>{/* end main content column */}

        {/* Chat sidebar — visible once a date is selected */}
        {(fetched || loading) && (
          <div className="chat-sidebar">
            <ChatPanel
              date={date}
              nickname={nickname || "Anonymous"}
              onChangeNickname={() => setShowNickPrompt(true)}
            />
            {!nickname && !showNickPrompt && (
              <button
                onClick={() => setShowNickPrompt(true)}
                style={{marginTop:10,width:"100%",padding:"9px",background:"#0d1f30",border:"1px dashed #1a2e42",borderRadius:8,color:"#4a6080",fontFamily:"'Space Mono',monospace",fontSize:10,cursor:"pointer",letterSpacing:1}}
              >SET YOUR NICKNAME</button>
            )}
          </div>
        )}
      </div>

      <div style={{textAlign:"center",marginTop:48,fontFamily:"'Space Mono',monospace",fontSize:10,color:"#1a2e42",letterSpacing:2}}>
        DATA VIA MLB STATS API + OPEN-METEO · FOR ENTERTAINMENT PURPOSES ONLY
      </div>
    </div>
  );
}
