# NRFI Tracker — Claude Notes

## What This App Does
Tracks "No Run First Inning" (NRFI) betting angles for MLB games. For each day's slate, it fetches the schedule, probable pitchers with ERA/WHIP, weather at game time, and live first-inning results. It grades each game A–D for NRFI confidence.

## Architecture
- **Pure frontend React app** (Create React App) — no backend, no API keys needed
- **Hosted**: S3 bucket `nrfi-tracker-app` + CloudFront distribution `E1JFGP2WTX58XO`
- **Domain**: kuplootus.com (Route 53, ACM cert `459831d5-59fa-42c8-825c-bbe483790579`)
- **GitHub**: https://github.com/bsawin/nrfi-tracker

## Data Sources (all free, no auth)
| Data | API |
|---|---|
| Schedule + probable pitchers | `statsapi.mlb.com/api/v1/schedule?sportId=1&date={date}&hydrate=probablePitcher,team,venue` |
| Pitcher ERA/WHIP | `statsapi.mlb.com/api/v1/people/{id}/stats?stats=season&group=pitching&season={year}` |
| Live first-inning linescore | `statsapi.mlb.com/api/v1/game/{gamePk}/linescore` |
| Weather (temp, wind, rain) | `api.open-meteo.com` — free, no key, supports 16-day forecast |

## NRFI Scoring Logic (`nrfiGrade` in App.js)
Starts at 100, subtracts penalties:
- ERA penalty: `((avgERA - 3.0) * 12)` — higher ERA = lower score
- WHIP penalty: `((avgWHIP - 1.0) * 20)`
- Park factor penalty: `(pf - 1.0) * 60`
- Weather delta added (positive = good for NRFI, negative = bad)

Grades: A ≥ 72, B ≥ 55, C ≥ 40, D < 40

## Weather Scoring (`calcWeatherDelta`)
- Temp < 40°F → +10, < 50°F → +6, < 55°F → +3
- Temp > 90°F → −4, > 82°F → −2
- Wind ≥ 8mph blowing OUT toward CF → negative delta (bad for NRFI)
- Wind ≥ 8mph blowing IN from CF → positive delta (good for NRFI)
- Wind alignment uses cosine of angle between wind direction and CF bearing

## Stadium Data (`STADIUM_DATA` array in App.js)
Each entry: `[nameSubstring, { lat, lon, cfBearing, indoor }]`
- `cfBearing`: compass degrees from home plate to center field (0=N, 90=E)
- `indoor: true` for dome/retractable-closed parks (Globe Life, Chase, Tropicana, Rogers Centre)
- Array is ordered most-specific → least-specific to avoid substring collisions (e.g. "Great American" before "American")
- Matched via `venueName.toLowerCase().includes(key.toLowerCase())`

## Live First Inning Result
- Fetched only for `gameState === "Live"` or `"Final"` games
- `firstInning.nrfi = true` when `awayRuns + homeRuns === 0`
- Card shows prominent green (NRFI ✓) or red (YRFI ✗) banner when result is known

## Outcome Storage (DynamoDB)
Every game load saves predictions + eventual results to DynamoDB for model training.

| Resource | Detail |
|---|---|
| DynamoDB table | `nrfi-outcomes` (us-east-1), PK = `gamePk` (String), on-demand billing |
| Lambda | `nrfi-outcomes` (Node.js 18, SDK v3 bundled) — source in `lambda/index.js` |
| API Gateway | HTTP API `q0jutr0ldh` → `https://q0jutr0ldh.execute-api.us-east-1.amazonaws.com` |
| IAM role | `nrfi-lambda-role` |

**Endpoints:**
- `PUT /outcomes/{gamePk}` — upsert game record (prediction on load, result when 1st inning done)
- `GET /outcomes?season=2026` — returns all records with `actualNRFI` set (for calibration)

**DynamoDB record fields:** `gamePk, season, date, homeTeam, awayTeam, venue, homePitcher, awayPitcher, homeERA, awayERA, homeWHIP, awayWHIP, parkFactor, weatherDelta, predictedScore, predictedGrade, actualNRFI?, totalRuns?, updatedAt`

**To redeploy Lambda:**
```bash
cd lambda && npm install && zip -r ../function.zip index.js node_modules
aws lambda update-function-code --function-name nrfi-outcomes --zip-file fileb://../function.zip --region us-east-1
```

## Deploy Command
```bash
npm run build
aws s3 sync build s3://nrfi-tracker-app --delete
aws cloudfront create-invalidation --distribution-id E1JFGP2WTX58XO --paths "/*"
```

## Key Files
- `src/App.js` — entire app (single file, ~370 lines)
- `package.json` — standard CRA setup, no extra dependencies
