const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const { DynamoDBDocumentClient, UpdateCommand } = require("@aws-sdk/lib-dynamodb");
const https = require("https");

const client = DynamoDBDocumentClient.from(new DynamoDBClient({ region: "us-east-1" }));
const TABLE = "nrfi-outcomes";
const MLB_API = "https://statsapi.mlb.com/api/v1";

// ── Helpers ───────────────────────────────────────────────────────────────────
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

// Returns the current hour (0–23) in US Eastern time
const getETHour = () => {
  // 'sv' locale gives "YYYY-MM-DD HH:MM:SS" — reliable in Node/Lambda
  const s = new Date().toLocaleString("sv", { timeZone: "America/New_York" });
  return parseInt(s.slice(11, 13), 10);
};

// Today's date in ET as "YYYY-MM-DD"
const todayET = () =>
  new Date().toLocaleString("sv", { timeZone: "America/New_York" }).slice(0, 10);

// ── Handler ───────────────────────────────────────────────────────────────────
exports.handler = async () => {
  const hour = getETHour();
  const date = todayET();

  // Only run during game hours: 1 PM–midnight ET (hour 13–23) plus midnight–1 AM (0) for late West Coast games
  if (hour > 0 && hour < 13) {
    console.log(`ET hour ${hour} — outside game hours, skipping.`);
    return;
  }

  console.log(`Polling MLB schedule for ${date} (ET hour ${hour})`);

  const schedule = await get(
    `${MLB_API}/schedule?sportId=1&date=${date}&hydrate=team,venue`
  );
  const games = schedule.dates?.[0]?.games ?? [];
  const season = date.slice(0, 4);

  // Only check games that are in progress or finished
  const active = games.filter(
    (g) =>
      g.status?.abstractGameState === "Live" ||
      g.status?.abstractGameState === "Final"
  );

  console.log(`${active.length} live/final games out of ${games.length} total`);
  if (!active.length) return;

  let updated = 0;

  await Promise.all(
    active.map(async (game) => {
      const gamePk = String(game.gamePk);
      try {
        const linescore = await get(`${MLB_API}/game/${gamePk}/linescore`);
        const first = linescore.innings?.find((i) => i.num === 1);
        if (!first) return;

        // homeRuns is only present once the bottom of the 1st is complete
        const homeRuns = first.home?.runs;
        if (homeRuns == null) return;

        const awayRuns = first.away?.runs ?? 0;
        const totalRuns = awayRuns + homeRuns;
        const actualNRFI = totalRuns === 0;

        // UpdateItem: sets result fields; uses if_not_exists to avoid
        // overwriting prediction data saved by the frontend
        await client.send(
          new UpdateCommand({
            TableName: TABLE,
            Key: { gamePk },
            UpdateExpression: `
              SET actualNRFI            = :nrfi,
                  totalRuns             = :runs,
                  awayRuns              = :ar,
                  homeRuns              = :hr,
                  season                = if_not_exists(season, :season),
                  #dt                   = if_not_exists(#dt, :date),
                  resultRecordedAt      = if_not_exists(resultRecordedAt, :now),
                  updatedAt             = :now
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
          })
        );

        updated++;
        console.log(
          `gamePk=${gamePk} → NRFI=${actualNRFI} (${awayRuns}+${homeRuns}=${totalRuns} runs)`
        );
      } catch (err) {
        console.error(`gamePk=${gamePk} error:`, err.message);
      }
    })
  );

  console.log(`Done. Updated ${updated}/${active.length} games.`);
};
