const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const { DynamoDBDocumentClient, UpdateCommand } = require("@aws-sdk/lib-dynamodb");
const https = require("https");

const client = DynamoDBDocumentClient.from(new DynamoDBClient({ region: "us-east-1" }));
const TABLE = "nrfi-outcomes";
const MLB_API = "https://statsapi.mlb.com/api/v1";

// ── HTTP helper ───────────────────────────────────────────────────────────────
const get = (url) =>
  new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(e); }
      });
      res.on("error", reject);
    }).on("error", reject);
  });

const getETHour = () => {
  const s = new Date().toLocaleString("sv", { timeZone: "America/New_York" });
  return parseInt(s.slice(11, 13), 10);
};

const todayET = () =>
  new Date().toLocaleString("sv", { timeZone: "America/New_York" }).slice(0, 10);

// ── Park Factors ──────────────────────────────────────────────────────────────
const PARK_FACTORS = {
  "Coors": 1.25, "American Ball Park": 1.15, "Globe Life": 1.12,
  "Truist": 1.08, "Fenway": 1.07, "Yankee": 1.06, "Wrigley": 1.05,
  "Guaranteed Rate": 1.04, "Nationals": 1.02, "American Family": 1.01,
  "Chase": 0.99, "T-Mobile": 0.97, "Dodger": 0.96, "PNC": 0.95,
  "Oracle": 0.94, "Petco": 0.93, "loanDepot": 0.92,
};

const getPF = (venue = "") => {
  const lower = venue.toLowerCase();
  for (const [k, f] of Object.entries(PARK_FACTORS))
    if (lower.includes(k.toLowerCase())) return f;
  return 1.0;
};

// ── Stadium Data ──────────────────────────────────────────────────────────────
const STADIUM_DATA = [
  ["Great American",    { lat: 39.0979, lon: -84.5082,  cfBearing: 18,  indoor: false }],
  ["American Family",   { lat: 43.0280, lon: -87.9712,  cfBearing: 25,  indoor: false }],
  ["Globe Life",        { lat: 32.7473, lon: -97.0836,  cfBearing: 35,  indoor: true  }],
  ["loanDepot",         { lat: 25.7781, lon: -80.2197,  cfBearing: 355, indoor: false }],
  ["Citizens Bank",     { lat: 39.9061, lon: -75.1665,  cfBearing: 350, indoor: false }],
  ["Minute Maid",       { lat: 29.7573, lon: -95.3555,  cfBearing: 18,  indoor: false }],
  ["Guaranteed Rate",   { lat: 41.8300, lon: -87.6339,  cfBearing: 355, indoor: false }],
  ["Tropicana",         { lat: 27.7682, lon: -82.6534,  cfBearing: 0,   indoor: true  }],
  ["Rogers Centre",     { lat: 43.6414, lon: -79.3894,  cfBearing: 20,  indoor: true  }],
  ["Target Field",      { lat: 44.9817, lon: -93.2781,  cfBearing: 355, indoor: false }],
  ["Angel Stadium",     { lat: 33.8003, lon: -117.8827, cfBearing: 335, indoor: false }],
  ["Sutter Health",     { lat: 38.5805, lon: -121.5001, cfBearing: 15,  indoor: false }],
  ["T-Mobile Park",     { lat: 47.5914, lon: -122.3325, cfBearing: 335, indoor: false }],
  ["Yankee Stadium",    { lat: 40.8296, lon: -73.9262,  cfBearing: 33,  indoor: false }],
  ["Fenway Park",       { lat: 42.3467, lon: -71.0972,  cfBearing: 5,   indoor: false }],
  ["Oriole Park",       { lat: 39.2838, lon: -76.6218,  cfBearing: 50,  indoor: false }],
  ["Progressive Field", { lat: 41.4962, lon: -81.6852,  cfBearing: 22,  indoor: false }],
  ["Comerica Park",     { lat: 42.3390, lon: -83.0485,  cfBearing: 330, indoor: false }],
  ["Kauffman Stadium",  { lat: 39.0517, lon: -94.4803,  cfBearing: 5,   indoor: false }],
  ["Truist Park",       { lat: 33.8908, lon: -84.4678,  cfBearing: 12,  indoor: false }],
  ["Citi Field",        { lat: 40.7571, lon: -73.8458,  cfBearing: 350, indoor: false }],
  ["Nationals Park",    { lat: 38.8730, lon: -77.0074,  cfBearing: 30,  indoor: false }],
  ["Wrigley Field",     { lat: 41.9484, lon: -87.6553,  cfBearing: 68,  indoor: false }],
  ["PNC Park",          { lat: 40.4469, lon: -80.0057,  cfBearing: 14,  indoor: false }],
  ["Busch Stadium",     { lat: 38.6226, lon: -90.1928,  cfBearing: 5,   indoor: false }],
  ["Chase Field",       { lat: 33.4455, lon: -112.0667, cfBearing: 350, indoor: true  }],
  ["Coors Field",       { lat: 39.7559, lon: -104.9942, cfBearing: 17,  indoor: false }],
  ["Dodger Stadium",    { lat: 34.0739, lon: -118.2400, cfBearing: 335, indoor: false }],
  ["Petco Park",        { lat: 32.7073, lon: -117.1573, cfBearing: 35,  indoor: false }],
  ["Oracle Park",       { lat: 37.7786, lon: -122.3893, cfBearing: 100, indoor: false }],
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
    const url =
      `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
      `&hourly=temperature_2m,wind_speed_10m,wind_direction_10m,precipitation_probability` +
      `&temperature_unit=fahrenheit&wind_speed_unit=mph&timezone=UTC` +
      `&start_date=${dateStr}&end_date=${nextStr}`;
    const d = await get(url);
    if (!d.hourly?.time?.length) return null;
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
  } catch { return null; }
};

const windAlignment = (windDir, cfBearing) => {
  const outSource = (cfBearing + 180) % 360;
  const diff = ((windDir - outSource + 540) % 360) - 180;
  return Math.cos(diff * Math.PI / 180);
};

const calcWeatherDelta = (wx) => {
  if (!wx) return 0;
  const { tempF, windSpeed, windDir, cfBearing, isIndoor } = wx;
  if (isIndoor) return 0;
  let delta = 0;
  if (tempF != null) {
    if      (tempF < 40) delta += 10;
    else if (tempF < 50) delta += 6;
    else if (tempF < 55) delta += 3;
    else if (tempF > 90) delta -= 4;
    else if (tempF > 82) delta -= 2;
  }
  if (windSpeed != null && windDir != null && cfBearing != null && windSpeed >= 8) {
    const align = windAlignment(windDir, cfBearing);
    delta += Math.round(-align * (windSpeed - 7) * 0.5);
  }
  return Math.round(delta);
};

// ── Team Hitting Stats ────────────────────────────────────────────────────────
const fetchTeamStats = async (teamId, season) => {
  try {
    const d = await get(`${MLB_API}/teams/${teamId}/stats?stats=season&group=hitting&season=${season}`);
    const stat = d.stats?.[0]?.splits?.[0]?.stat;
    if (!stat) return null;
    const ops  = stat.ops != null ? parseFloat(stat.ops) : null;
    const so   = stat.strikeOuts       ?? 0;
    const pa   = stat.plateAppearances ?? 0;
    const kPct = pa > 0 ? Math.round((so / pa) * 1000) / 10 : null;
    return { ops, kPct };
  } catch { return null; }
};

// ── Pitcher Stats ─────────────────────────────────────────────────────────────
const fetchPitcherStats = async (personId, season) => {
  const tryFetch = async (s) => {
    try {
      const d = await get(`${MLB_API}/people/${personId}/stats?stats=season&group=pitching&season=${s}`);
      const splits = d.stats?.[0]?.splits;
      if (!splits?.length) return null;
      const stat = splits[splits.length - 1].stat;
      const era  = stat.era  != null ? parseFloat(stat.era)  : null;
      const whip = stat.whip != null ? parseFloat(stat.whip) : null;
      if (era == null && whip == null) return null;
      return { era, whip };
    } catch { return null; }
  };
  return (await tryFetch(season)) ?? (await tryFetch(String(parseInt(season) - 1)));
};

// ── NRFI Grade ────────────────────────────────────────────────────────────────
const nrfiGrade = ({ homeERA, awayERA, homeWHIP, awayWHIP, pf, weatherDelta = 0 }) => {
  let s = 100;
  s -= Math.max(0, (((homeERA ?? 4.5) + (awayERA ?? 4.5)) / 2 - 3.0) * 25);
  s -= Math.max(0, (((homeWHIP ?? 1.3) + (awayWHIP ?? 1.3)) / 2 - 1.0) * 40);
  s -= (pf - 1.0) * 60;
  s += weatherDelta;
  s = Math.round(Math.max(0, Math.min(100, s)));
  return { score: s, grade: s >= 75 ? "A" : s >= 58 ? "B" : s >= 42 ? "C" : "D" };
};

// ── Handler ───────────────────────────────────────────────────────────────────
exports.handler = async () => {
  const hour = getETHour();
  const date = todayET();

  if (hour > 0 && hour < 13) {
    console.log(`ET hour ${hour} — outside game hours, skipping.`);
    return;
  }

  console.log(`Polling MLB schedule for ${date} (ET hour ${hour})`);

  const schedule = await get(
    `${MLB_API}/schedule?sportId=1&date=${date}&hydrate=probablePitcher,team,venue`
  );
  const games = schedule.dates?.[0]?.games ?? [];
  const season = date.slice(0, 4);

  console.log(`${games.length} total games`);
  if (!games.length) return;

  let updatedPredictions = 0, updatedResults = 0;

  await Promise.all(
    games.map(async (game) => {
      const gamePk     = String(game.gamePk);
      const state      = game.status?.abstractGameState;
      const venueName  = game.venue?.name ?? "";
      const gameIso    = game.gameDate;
      const homeTeam   = game.teams?.home?.team?.teamName ?? game.teams?.home?.team?.name ?? "";
      const awayTeam   = game.teams?.away?.team?.teamName ?? game.teams?.away?.team?.name ?? "";
      const homePitcherId   = game.teams?.home?.probablePitcher?.id ?? null;
      const awayPitcherId   = game.teams?.away?.probablePitcher?.id ?? null;
      const homePitcherName = game.teams?.home?.probablePitcher?.fullName ?? null;
      const awayPitcherName = game.teams?.away?.probablePitcher?.fullName ?? null;
      const homeTeamId      = game.teams?.home?.team?.id ?? null;
      const awayTeamId      = game.teams?.away?.team?.id ?? null;

      try {
        if (state === "Preview") {
          // ── Refresh prediction with latest pitcher + weather + lineup ──────
          const stadium = getStadium(venueName);
          const pf = getPF(venueName);

          const [homeStats, awayStats, rawWeather, homeTeamStats, awayTeamStats] = await Promise.all([
            homePitcherId ? fetchPitcherStats(homePitcherId, season) : Promise.resolve(null),
            awayPitcherId ? fetchPitcherStats(awayPitcherId, season) : Promise.resolve(null),
            stadium       ? fetchWeather(stadium.lat, stadium.lon, date, gameIso) : Promise.resolve(null),
            homeTeamId    ? fetchTeamStats(homeTeamId, season) : Promise.resolve(null),
            awayTeamId    ? fetchTeamStats(awayTeamId, season) : Promise.resolve(null),
          ]);

          const wx = rawWeather && stadium
            ? { ...rawWeather, cfBearing: stadium.cfBearing, isIndoor: stadium.indoor }
            : (stadium ? { isIndoor: stadium.indoor } : null);

          const weatherDelta = calcWeatherDelta(wx);
          const { score, grade } = nrfiGrade({
            homeERA: homeStats?.era ?? null, awayERA: awayStats?.era ?? null,
            homeWHIP: homeStats?.whip ?? null, awayWHIP: awayStats?.whip ?? null,
            pf, weatherDelta,
          });

          const homeERA  = homeStats?.era  ?? null;
          const awayERA  = awayStats?.era  ?? null;
          const homeWHIP = homeStats?.whip ?? null;
          const awayWHIP = awayStats?.whip ?? null;
          const avgERA   = ((homeERA  ?? 4.5) + (awayERA  ?? 4.5)) / 2;
          const avgWHIP  = ((homeWHIP ?? 1.3)  + (awayWHIP ?? 1.3))  / 2;

          await client.send(new UpdateCommand({
            TableName: TABLE,
            Key: { gamePk },
            UpdateExpression: `SET
              season               = if_not_exists(season, :season),
              #dt                  = if_not_exists(#dt, :date),
              gameTime             = :gameTime,
              homeTeam             = :homeTeam,
              awayTeam             = :awayTeam,
              venue                = :venue,
              homePitcher          = :homePitcher,
              awayPitcher          = :awayPitcher,
              homeERA              = :homeERA,
              awayERA              = :awayERA,
              homeWHIP             = :homeWHIP,
              awayWHIP             = :awayWHIP,
              parkFactor           = :pf,
              homeOPS              = :homeOPS,
              awayOPS              = :awayOPS,
              homeKPct             = :homeKPct,
              awayKPct             = :awayKPct,
              eraPenalty           = :eraPenalty,
              whipPenalty          = :whipPenalty,
              parkPenalty          = :parkPenalty,
              tempF                = :tempF,
              windSpeed            = :windSpeed,
              windDir              = :windDir,
              precipPct            = :precipPct,
              isIndoor             = :isIndoor,
              weatherDelta         = :weatherDelta,
              predictedScore       = :score,
              predictedGrade       = :grade,
              predictionUpdatedAt  = :now,
              updatedAt            = :now
            `,
            ExpressionAttributeNames: { "#dt": "date" },
            ExpressionAttributeValues: {
              ":season":       season,
              ":date":         date,
              ":gameTime":     gameIso,
              ":homeTeam":     homeTeam,
              ":awayTeam":     awayTeam,
              ":venue":        venueName,
              ":homePitcher":  homePitcherName,
              ":awayPitcher":  awayPitcherName,
              ":homeERA":      homeERA,
              ":awayERA":      awayERA,
              ":homeWHIP":     homeWHIP,
              ":awayWHIP":     awayWHIP,
              ":pf":           pf,
              ":homeOPS":      homeTeamStats?.ops  ?? null,
              ":awayOPS":      awayTeamStats?.ops  ?? null,
              ":homeKPct":     homeTeamStats?.kPct ?? null,
              ":awayKPct":     awayTeamStats?.kPct ?? null,
              ":eraPenalty":   Math.round(Math.max(0, (avgERA  - 3.0) * 25) * 100) / 100,
              ":whipPenalty":  Math.round(Math.max(0, (avgWHIP - 1.0) * 40) * 100) / 100,
              ":parkPenalty":  Math.round((pf - 1.0) * 60 * 100) / 100,
              ":tempF":        wx?.tempF     ?? null,
              ":windSpeed":    wx?.windSpeed ?? null,
              ":windDir":      wx?.windDir   ?? null,
              ":precipPct":    wx?.precipPct ?? null,
              ":isIndoor":     wx?.isIndoor  ?? false,
              ":weatherDelta": weatherDelta,
              ":score":        score,
              ":grade":        grade,
              ":now":          new Date().toISOString(),
            },
          }));

          updatedPredictions++;
          console.log(`gamePk=${gamePk} (Preview) grade=${grade} score=${score} pitchers=${awayPitcherName}/${homePitcherName}`);

        } else if (state === "Live" || state === "Final") {
          // ── Write first-inning result ──────────────────────────────────────
          const linescore = await get(`${MLB_API}/game/${gamePk}/linescore`);
          const first = linescore.innings?.find((i) => i.num === 1);
          if (!first) return;

          const homeRuns = first.home?.runs;
          if (homeRuns == null) return;

          const awayRuns   = first.away?.runs ?? 0;
          const totalRuns  = awayRuns + homeRuns;
          const actualNRFI = totalRuns === 0;

          await client.send(new UpdateCommand({
            TableName: TABLE,
            Key: { gamePk },
            UpdateExpression: `SET
              actualNRFI       = :nrfi,
              totalRuns        = :runs,
              awayRuns         = :ar,
              homeRuns         = :hr,
              season           = if_not_exists(season, :season),
              #dt              = if_not_exists(#dt, :date),
              resultRecordedAt = if_not_exists(resultRecordedAt, :now),
              updatedAt        = :now
            `,
            ExpressionAttributeNames: { "#dt": "date" },
            ExpressionAttributeValues: {
              ":nrfi":   actualNRFI,
              ":runs":   totalRuns,
              ":ar":     awayRuns,
              ":hr":     homeRuns,
              ":season": season,
              ":date":   date,
              ":now":    new Date().toISOString(),
            },
          }));

          updatedResults++;
          console.log(`gamePk=${gamePk} (${state}) NRFI=${actualNRFI} (${awayRuns}+${homeRuns}=${totalRuns})`);
        }
      } catch (err) {
        console.error(`gamePk=${gamePk} error:`, err.message);
      }
    })
  );

  console.log(`Done. Predictions refreshed: ${updatedPredictions}, Results recorded: ${updatedResults}`);
};
