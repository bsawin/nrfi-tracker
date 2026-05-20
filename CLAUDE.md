# NRFI Tracker — Claude Notes

## What This App Does
Tracks "No Run First Inning" (NRFI) betting angles for MLB games. For each day's slate, it fetches the schedule, probable pitchers with ERA/WHIP, team hitting stats (OPS/K%), weather at game time, and live first-inning results. It grades each game A–D for NRFI confidence and lets users make crowd picks (NRFI or YRFI) per game.

## Branding
- App name: **NRFI Pro** (previously "NRFI Benny")
- Primary domain: **app.nrfipro.com**
- Logo: `public/logo.png` (square) + `public/og-image.png` (1200×630 for social sharing)

## Architecture
- **Pure frontend React app** (Create React App) — no backend, no API keys needed
- **Hosted**: S3 bucket `nrfi-tracker-app` + CloudFront distribution `E1JFGP2WTX58XO`
- **Primary domain**: app.nrfipro.com — Route 53 (hosted zone `Z086398736YIIJINO32UT`), ACM cert `5cc9de0f-e4dd-4f91-9e19-935d6cca55d9`
- **Redirects**: nrfipro.com + www.nrfipro.com → app.nrfipro.com via CloudFront distribution `E3YSAOWCV4FHH` + CloudFront Function `nrfipro-redirect-to-app` (must use `cloudfront-js-1.0` runtime)
- **Legacy domain**: kuplootus.com + www.kuplootus.com redirect to app.nrfipro.com via CloudFront distribution `E2IIAUDI39JY88` (uses existing kuplootus ACM cert)
- **GitHub**: https://github.com/bsawin/nrfi-tracker

## Data Sources (all free, no auth)
| Data | API |
|---|---|
| Schedule + probable pitchers | `statsapi.mlb.com/api/v1/schedule?sportId=1&date={date}&hydrate=probablePitcher,team,venue` |
| Pitcher ERA/WHIP | `statsapi.mlb.com/api/v1/people/{id}/stats?stats=season&group=pitching&season={year}` |
| Pitcher recent ERA (last 3 starts) | `statsapi.mlb.com/api/v1/people/{id}/stats?stats=gameLog&group=pitching&season={year}` — last 3 starts ≥1 IP; blended 60/40 with season ERA |
| Team hitting stats (OPS, K%) | `statsapi.mlb.com/api/v1/teams/{teamId}/stats?stats=season&group=hitting&season={year}` — falls back to prior season if current season unavailable |
| Live first-inning linescore | `statsapi.mlb.com/api/v1/game/{gamePk}/linescore` |
| Weather (temp, wind, rain) | `api.open-meteo.com` — free, no key, supports 16-day forecast |

## NRFI Scoring Logic (`nrfiGrade` in App.js)
Rebuilt after signal analysis of 564 settled 2026 games (Pearson r). Only ERA and OPS have measurable correlation to NRFI outcomes; WHIP (r=−0.021) and weather (r=+0.002) are noise and removed.

Starts at 100, subtracts penalties:
- Weak-link ERA: `max(0, (max(homeERA, awayERA) - 4.0) * 20)` — worst starter drives the penalty; threshold 4.0 (stricter than league avg 4.5)
- Avg ERA secondary: `max(0, (avgERA - 4.0) * 8)` — smaller multiplier, adds signal when both starters are mediocre
- Park factor penalty: `(pf - 1.0) * 60`
- Hot lineup: `max(0, (max(homeOPS, awayOPS) - 0.720) * 200)` — worst lineup; OPS above 0.720 penalized
- Avg lineup: `max(0, (avgOPS - 0.670) * 120)` — secondary; penalizes when both lineups are above avg

Grades: A ≥ 80, B ≥ 58, C ≥ 42, D < 42

**Recent ERA blending**: `effectiveERA = 0.2 * seasonERA + 0.8 * recentERA` — `recentERA` computed from last 3 qualifying starts (≥1 IP each) via `stats=gameLog`; requires ≥2 starts of data; falls back to season ERA gracefully. Recent form is weighted 80% because it is ~20× more predictive than season ERA (r=−0.13 vs r=−0.006 for home pitcher). Note: `stats=statSplits&sitCodes=i1` (first-inning splits) was found to return empty data for all tested pitchers and was replaced by this approach.

**Grade A data gate**: A game can only receive Grade A if BOTH pitchers have `recentERA` data available. Without both, the grade is capped at B regardless of score. Analysis of 717 settled games shows Grade A hits NRFI at 61% when both recentERAs are present vs ~51% (near baseline) when they're not. Only ~24% of games have both recentERAs available (requires ≥2 qualifying starts in the current season).

OPS (`homeOPS`, `awayOPS`) and K% are stored in DynamoDB. K% not yet used in scoring.

## Weather Scoring (`calcWeatherDelta`)
- Temp < 40°F → +10, < 50°F → +6, < 55°F → +3
- Temp > 90°F → −4, > 82°F → −2
- Wind ≥ 8mph blowing OUT toward CF → negative delta (bad for NRFI)
- Wind ≥ 8mph blowing IN from CF → positive delta (good for NRFI)
- Wind alignment uses cosine of angle between wind direction and CF bearing
- **Indoor stadiums**: `calcWeatherDelta` returns 0; weather pills hidden; shows "🏟 INDOOR" pill instead

## Stadium Data (`STADIUM_DATA` array in App.js)
Each entry: `[nameSubstring, { lat, lon, cfBearing, indoor }]`
- `cfBearing`: compass degrees from home plate to center field (0=N, 90=E)
- `indoor: true` for dome/retractable-closed parks (Globe Life, Chase, Tropicana, Rogers Centre)
- Array is ordered most-specific → least-specific to avoid substring collisions (e.g. "Great American" before "American")
- Matched via `venueName.toLowerCase().includes(key.toLowerCase())`
- **Houston**: key is `"Daikin Park"` (renamed from Minute Maid Park in 2026)
- Same STADIUM_DATA array is duplicated in `lambda-poller/index.js` — keep in sync

## Live First Inning Result
- Fetched only for `gameState === "Live"` or `"Final"` games
- `firstInning.nrfi = true` when `awayRuns + homeRuns === 0`
- Card shows prominent green (NRFI ✓) or red (YRFI ✗) banner when result is known

## Crowd Picks
Users can pick NRFI or YRFI per game before first pitch. Picks are locked once game goes Live or Final.

- Picks stored in DynamoDB table `nrfi-picks` (PK: `gamePk` String, SK: `userUuid` String)
- Each user identified by UUID stored in `localStorage` (`nrfi-uuid`)
- Nickname stored in `localStorage` (`nrfi-nickname`) — same nickname used for chat
- If no nickname set when picking, shows NicknamePrompt first, then submits pending pick
- Crowd distribution bar shown on each card
- Model Performance panel shows crowd pick % and accuracy per grade

## Outcome Storage (DynamoDB)
Every game load saves predictions + eventual results to DynamoDB for model training.

| Resource | Detail |
|---|---|
| DynamoDB table | `nrfi-outcomes` (us-east-1), PK = `gamePk` (String), on-demand billing |
| DynamoDB table | `nrfi-picks` (us-east-1), PK = `gamePk` (String), SK = `userUuid` (String), TTL = 1 year |
| Lambda | `nrfi-outcomes` (Node.js 18, SDK v3 bundled) — source in `lambda/index.js` |
| API Gateway | HTTP API `q0jutr0ldh` → custom domain `https://api.nrfipro.com` |
| IAM role | `nrfi-lambda-role` |

**CORS:** API Gateway `q0jutr0ldh` CORS is configured to allow `https://app.nrfipro.com`, `https://kuplootus.com`, `https://www.kuplootus.com`, `http://localhost:3000`.

**Endpoints:**
- `PUT /outcomes/{gamePk}` — upsert game record (prediction on load, result when 1st inning done)
- `GET /outcomes?season=2026` — returns all records with `actualNRFI` set (for calibration)
- `PUT /picks/{gamePk}` — upsert a user's pick, returns updated crowd counts
- `GET /picks/{gamePk}?userUuid={uuid}` — get crowd counts + user's pick
- `GET /picks?season=2026` — aggregate pick counts per gamePk for model stats

**DynamoDB `nrfi-outcomes` record fields:**
`gamePk, season, gameType, date, homeTeam, awayTeam, venue, homePitcher, awayPitcher, homeERA, awayERA, homeWHIP, awayWHIP, parkFactor, weatherDelta, predictedScore, predictedGrade, eraPenalty, parkPenalty, homeOPS, awayOPS, homeKPct, awayKPct, homeRecentERA, awayRecentERA, actualNRFI?, totalRuns?, awayRuns?, homeRuns?, updatedAt`

**`gameType` values:** `R`=regular season, `S`=spring training, `E`=exhibition, `F`/`D`/`L`/`W`=postseason. **Important:** The MLB API sometimes mislabels minor league / affiliate games as `R`. Model Performance filters on BOTH `gameType === "R"` AND `date >= {season}-03-25` to guard against this.

**To redeploy Lambda:**
```bash
cd lambda && npm install && zip -r ../function.zip index.js node_modules
aws lambda update-function-code --function-name nrfi-outcomes --zip-file fileb://../function.zip --region us-east-1
```

## Scheduled Poller (nrfi-poller Lambda)
Runs every 20 minutes via EventBridge. For **Preview** games: fetches latest pitcher stats, weather, and team hitting stats and overwrites all prediction fields (ensures last-minute pitcher changes and weather updates are captured). For **Live/Final** games: writes first-inning result fields.

- **Lambda:** `nrfi-poller` (source: `lambda-poller/index.js`, 120s timeout)
- **EventBridge rule:** `nrfi-poll-20min` — `rate(20 minutes)`, always enabled
- **Game hours guard:** Lambda exits immediately if ET hour is between 1 AM and 1 PM
- **Idempotent:** `resultRecordedAt` uses `if_not_exists` so re-runs don't overwrite the first recorded timestamp

**To redeploy poller:**
```bash
cd lambda-poller && npm install && zip -qr function.zip index.js node_modules
aws lambda update-function-code --function-name nrfi-poller --zip-file fileb://function.zip --region us-east-1
```

## API Custom Domain (api.nrfipro.com)
- API Gateway v2 custom domain `api.nrfipro.com` mapped to HTTP API `q0jutr0ldh` on `$default` stage
- ACM cert in us-east-1 (required for API Gateway regional endpoints)
- Route 53 alias record using API Gateway regional hosted zone `Z1UJRXOUMOOFQ8`
- App uses `const OUTCOMES_API = "https://api.nrfipro.com"` (not the raw amazonaws.com URL)

## UI Features
- **Date navigation**: YESTERDAY / TODAY / TOMORROW buttons + date picker; auto-loads on selection; initial `date` state is dynamic (`new Date().toLocaleDateString("en-CA")`)
- **Header buttons**: Only highlight (green) after games are fetched (`fetched && date === X`); not highlighted on first load
- **Home screen**: Shows YESTERDAY/TODAY/TOMORROW quick-load buttons; TODAY highlighted in green as the CTA
- **Sorting**: Always by grade (A → D); sort toggle removed
- **Scroll behavior**: `window.scrollTo({ top: 0, behavior: "instant" })` + offset by measured header height on load
- **Game cards**: Show pitcher ERA/WHIP, park factor, weather pills, lineup quality (OPS/K%), score breakdown panel, crowd pick section, NRFI/YRFI result banner
- **Indoor stadiums**: Show "🏟 INDOOR" pill; hide all weather pills; `isIndoor` derived from venue name as fallback if weather fetch fails
- **Model Performance panel**: Shows per-grade NRFI rate, crowd pick %, and crowd accuracy; positioned above game cards
- **Chat sidebar**: Visible once a date is loaded; uses same nickname as crowd picks

## SEO & Social Sharing
- `public/index.html` has full Open Graph + Twitter Card meta tags
- `og:image` points to `public/og-image.png` (1200×630, logo centered on `#0a1628` navy background)
- Twitter card type: `summary_large_image`
- Canonical URL: `https://app.nrfipro.com/`

## Data Quality Notes
- MLB API `gameType` is not always reliable — affiliate/minor league games can appear as `R`
- Always combine `gameType === "R"` with a date floor when filtering for model data
- To backfill `gameType` on existing records: scan `nrfi-outcomes` for records missing `gameType`, call `statsapi.mlb.com/api/v1/schedule?gamePks={pk}` in batches, update each record (run script from `lambda/` directory so AWS SDK is available)
- **UTC vs ET date bug**: MLB `gameDate` is UTC ISO. Evening ET games (e.g. 9:45pm ET = 1:45am UTC next day) were previously stored under the wrong date. Fixed in poller: `gameETDate(gameIso)` derives ET date using `toLocaleDateString("en-CA", { timeZone: "America/New_York" })`. The `#dt` field in UpdateCommand no longer uses `if_not_exists` so poller auto-corrects stale dates.

## Benny's Bet Report
A styled HTML report correlating sportsbook bets with NRFI outcomes, deployed to `https://app.nrfipro.com/bbr`.

- **Script**: `scripts/bet-report.py` — run from repo root
- **Input**: `~/Downloads/All_Bets_Export.xls` (SpreadsheetML XML exported from sportsbook)
- **Run command**: `python3 scripts/bet-report.py`
- **Output**: Terminal table + deploys HTML to S3 key `bbr` (no extension, `Content-Type: text/html`)
- **Sections**: Grade A bets and Other grade bets, each with subtotal; summary bar shows separate stats for each
- **Date matching**: Exact match first; for SETTLED bets only, check ±1 day (handles UTC offset); OPEN bets never use fuzzy matching (shows "Pending" if no exact match)

## Deploy Command
```bash
npm run build
aws s3 sync build s3://nrfi-tracker-app --delete
aws cloudfront create-invalidation --distribution-id E1JFGP2WTX58XO --paths "/*"
```

## Key Files
- `src/App.js` — entire frontend app (single file, ~1280 lines)
- `lambda/index.js` — outcomes + picks API Lambda
- `lambda-poller/index.js` — scheduled poller Lambda (every 20 min)
- `scripts/bet-report.py` — Benny's Bet Report: correlates sportsbook XLS export with DynamoDB outcomes, deploys to `app.nrfipro.com/bbr`
- `public/logo.png` + `src/logo.png` — app logo (keep in sync, regenerate favicon/logo192/logo512 with Pillow when updated)
- `public/og-image.png` — 1200×630 social sharing image (logo centered on `#0a1628` background, generated with Pillow)
- `mockup-card.html` — standalone card UI mockup
- `mockup-model-performance.html` — model performance panel mockup (mid-season example data)
- `mockup-bet-report.html` — bet report modal mockup (dark theme, matches app design system)
- `package.json` — standard CRA setup, no extra dependencies
