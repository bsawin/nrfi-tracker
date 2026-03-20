import { useState, useCallback, useEffect, useRef } from "react";

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
const nrfiGrade = ({ homeERA, awayERA, homeWHIP, awayWHIP, pf, weatherDelta = 0 }) => {
  let s = 100;
  s -= Math.max(0, (((homeERA ?? 4) + (awayERA ?? 4)) / 2 - 3.0) * 12);
  s -= Math.max(0, (((homeWHIP ?? 1.3) + (awayWHIP ?? 1.3)) / 2 - 1.0) * 20);
  s -= (pf - 1.0) * 60;
  s += weatherDelta;
  s = Math.round(Math.max(0, Math.min(100, s)));
  return s >= 72 ? { g:"A", c:"#00e5a0", l:"Strong NRFI", s } :
         s >= 55 ? { g:"B", c:"#f5c842", l:"Lean NRFI",   s } :
         s >= 40 ? { g:"C", c:"#ff9f43", l:"Toss-Up",     s } :
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

const saveOutcome = async (game, predictedScore, predictedGrade, season) => {
  try {
    await fetch(`${OUTCOMES_API}/outcomes/${game.gamePk}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        season,
        date: game.gameIso?.slice(0, 10),
        homeTeam: game.homeTeam,
        awayTeam: game.awayTeam,
        venue: game.venue,
        homePitcher: game.homePitcher,
        awayPitcher: game.awayPitcher,
        homeERA: game.homeERA,
        awayERA: game.awayERA,
        homeWHIP: game.homeWHIP,
        awayWHIP: game.awayWHIP,
        parkFactor: getPF(game.venue),
        weatherDelta: calcWeatherDelta(game.weather),
        predictedScore,
        predictedGrade,
      }),
    });
  } catch { /* non-critical, never block the UI */ }
};

const recordResult = async (gamePk, firstInning, predictedScore, predictedGrade, season, gameData) => {
  if (!firstInning || gamePk == null) return;
  try {
    await fetch(`${OUTCOMES_API}/outcomes/${gamePk}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        season,
        date: gameData.gameIso?.slice(0, 10),
        homeTeam: gameData.homeTeam,
        awayTeam: gameData.awayTeam,
        venue: gameData.venue,
        homePitcher: gameData.homePitcher,
        awayPitcher: gameData.awayPitcher,
        homeERA: gameData.homeERA,
        awayERA: gameData.awayERA,
        homeWHIP: gameData.homeWHIP,
        awayWHIP: gameData.awayWHIP,
        parkFactor: getPF(gameData.venue),
        weatherDelta: calcWeatherDelta(gameData.weather),
        predictedScore,
        predictedGrade,
        actualNRFI: firstInning.nrfi,
        totalRuns: firstInning.totalRuns,
      }),
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

    ws.onopen    = () => setStatus("open");
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

const fetchPitcherStats = async (personId, season) => {
  try {
    const r = await fetch(
      `${MLB_API}/people/${personId}/stats?stats=season&group=pitching&season=${season}`
    );
    if (!r.ok) return null;
    const d = await r.json();
    const splits = d.stats?.[0]?.splits;
    if (!splits?.length) return null;
    const stat = splits[splits.length - 1].stat;
    return {
      era:  stat.era  != null ? parseFloat(stat.era)  : null,
      whip: stat.whip != null ? parseFloat(stat.whip) : null,
    };
  } catch {
    return null;
  }
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

const PRow = ({ side, name, era, whip, team }) => {
  const dot = side === "AWAY" ? "#4a9eff" : "#00e5a0";
  const ec = era == null ? "#4a6080" : era <= 3.5 ? "#00e5a0" : era >= 5 ? "#ff4d6d" : "#f5c842";
  const wc = whip == null ? "#4a6080" : whip <= 1.1 ? "#00e5a0" : whip >= 1.5 ? "#ff4d6d" : "#f5c842";
  return (
    <div style={{display:"flex",alignItems:"center",gap:10,padding:"8px 0",borderBottom:"1px solid #0e1822"}}>
      <div style={{width:6,height:6,borderRadius:"50%",background:dot,flexShrink:0}}/>
      <div style={{flex:1}}>
        <div style={{fontFamily:"'Space Mono',monospace",fontSize:9,color:"#4a6080",letterSpacing:1}}>{side} · {team}</div>
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

const Card = ({ game, idx }) => {
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

      <div style={{marginBottom:14}}>
        <PRow side="AWAY" name={game.awayPitcher} era={game.awayERA} whip={game.awayWHIP} team={game.awayTeam}/>
        <PRow side="HOME" name={game.homePitcher} era={game.homeERA} whip={game.homeWHIP} team={game.homeTeam}/>
      </div>

      {/* Chips row */}
      <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
        <Chip label={`PARK ${pf > 1 ? "+" : ""}${pfPct}%`} color={pfc}/>
        {avgERA && <Chip label={`AVG ERA ${avgERA}`} color="#4a6080"/>}

        {/* Weather chips */}
        {wx?.isIndoor && <Chip label="DOME" color="#4a6080"/>}
        {wx && !wx.isIndoor && wx.tempF != null &&
          <Chip label={`${Math.round(wx.tempF)}°F`} color={tempColor}/>}
        {windInfo && <Chip label={windInfo.label} color={windInfo.color}/>}
        {wx && !wx.isIndoor && wx.precipPct != null && wx.precipPct >= 40 &&
          <Chip label={`${wx.precipPct}% RAIN`} color="#f5c842"/>}
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

  // ── Chat state ─────────────────────────────────────────────────────────────
  const [nickname,        setNickname]        = useState(() => localStorage.getItem("nrfi-nickname") || "");
  const [showNickPrompt,  setShowNickPrompt]  = useState(false);

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
      }));

      // ── Step 2: Fetch pitcher stats + weather in parallel ─────────────────
      setStatus("FETCHING STATS & WEATHER...");
      const pitcherIds = [...new Set(
        gameList.flatMap(g => [g.awayPitcherId, g.homePitcherId]).filter(Boolean)
      )];

      const [statsEntries, weatherResults, firstInningResults] = await Promise.all([
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
      ]);

      const statsMap = Object.fromEntries(statsEntries);

      // ── Step 3: Merge ─────────────────────────────────────────────────────
      const enriched = gameList.map((g, i) => ({
        ...g,
        awayERA:      statsMap[g.awayPitcherId]?.era  ?? null,
        awayWHIP:     statsMap[g.awayPitcherId]?.whip ?? null,
        homeERA:      statsMap[g.homePitcherId]?.era  ?? null,
        homeWHIP:     statsMap[g.homePitcherId]?.whip ?? null,
        weather:      weatherResults[i],
        firstInning:  firstInningResults[i],
      }));

      setGames(enriched);
      setFetched(true);

      // ── Step 4: Persist to DynamoDB (fire-and-forget) ─────────────────────
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
      `}</style>

      {/* Header */}
      <div style={{background:"linear-gradient(180deg,#0a1c2e,#060f18)",borderBottom:"1px solid #0e1f30",padding:"28px 32px 20px",position:"sticky",top:0,zIndex:10}}>
        <div style={{maxWidth:1100,margin:"0 auto"}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",flexWrap:"wrap",gap:16}}>
            <div style={{display:"flex",alignItems:"center",gap:12}}>
              <div style={{width:36,height:36,borderRadius:10,background:"linear-gradient(135deg,#00e5a0,#00bfff)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:18,fontWeight:700,color:"#060f18"}}>N</div>
              <div>
                <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:28,letterSpacing:4,color:"#e0eaf4"}}>NRFI TRACKER</div>
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

      {/* Nickname prompt — shown on first chat or when changing name */}
      {showNickPrompt && (
        <NicknamePrompt onSave={(n) => {
          localStorage.setItem("nrfi-nickname", n);
          setNickname(n);
          setShowNickPrompt(false);
        }}/>
      )}

      {/* Body */}
      <div style={{maxWidth:1400,margin:"32px auto 0",padding:"0 24px",display:"flex",gap:20,alignItems:"flex-start"}}>
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
            {sorted.map((g, i) => <Card key={g.id || i} game={g} idx={i}/>)}
          </div>
        )}
        </div>{/* end main content column */}

        {/* Chat sidebar — visible once a date is selected */}
        {(fetched || loading) && (
          <div style={{width:320,flexShrink:0,position:"sticky",top:90,height:"calc(100vh - 110px)"}}>
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
