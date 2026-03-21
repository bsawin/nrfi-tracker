const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, UpdateCommand, ScanCommand, PutCommand, GetCommand, QueryCommand } = require('@aws-sdk/lib-dynamodb');

const client = DynamoDBDocumentClient.from(new DynamoDBClient({ region: 'us-east-1' }));
const TABLE = 'nrfi-outcomes';
const TABLE_PICKS = 'nrfi-picks';

const cors = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,PUT,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const res = (status, body) => ({ statusCode: status, headers: cors, body: JSON.stringify(body) });

const getGamePickCounts = async (gamePk) => {
  const result = await client.send(new QueryCommand({
    TableName: TABLE_PICKS,
    KeyConditionExpression: '#g = :g',
    ExpressionAttributeNames: { '#g': 'gamePk' },
    ExpressionAttributeValues: { ':g': String(gamePk) },
  }));
  const items = result.Items ?? [];
  const nrfiCount = items.filter(i => i.pick === 'NRFI').length;
  const yrfiCount = items.filter(i => i.pick === 'YRFI').length;
  return { nrfiCount, yrfiCount, total: items.length };
};

exports.handler = async (event) => {
  const method = event.requestContext?.http?.method ?? '';
  const path   = event.requestContext?.http?.path   ?? '';

  if (method === 'OPTIONS') return { statusCode: 200, headers: cors, body: '' };

  try {
    // PUT /outcomes/{gamePk}  — merge prediction/result fields into existing record
    if (method === 'PUT' && path.startsWith('/outcomes/')) {
      const gamePk = decodeURIComponent(path.split('/')[2]);
      const body   = JSON.parse(event.body || '{}');

      const RESULT_FIELDS = new Set(['actualNRFI', 'totalRuns', 'awayRuns', 'homeRuns']);
      const ALWAYS_SET    = new Set(['updatedAt']);

      const setParts = ['#updatedAt = :updatedAt'];
      const names  = { '#updatedAt': 'updatedAt' };
      const values = { ':updatedAt': new Date().toISOString() };

      Object.entries(body).forEach(([k, v]) => {
        const safe = k.replace(/[^a-zA-Z0-9_]/g, '_');
        const nameKey  = `#f_${safe}`;
        const valueKey = `:v_${safe}`;
        names[nameKey]  = k;
        values[valueKey] = v;
        if (RESULT_FIELDS.has(k) || ALWAYS_SET.has(k)) {
          setParts.push(`${nameKey} = ${valueKey}`);
        } else {
          setParts.push(`${nameKey} = if_not_exists(${nameKey}, ${valueKey})`);
        }
      });

      await client.send(new UpdateCommand({
        TableName: TABLE,
        Key: { gamePk },
        UpdateExpression: `SET ${setParts.join(', ')}`,
        ExpressionAttributeNames:  names,
        ExpressionAttributeValues: values,
      }));
      return res(200, { ok: true });
    }

    // GET /outcomes?season=2026  — fetch completed outcomes for calibration
    if (method === 'GET' && path === '/outcomes') {
      const season = event.queryStringParameters?.season ?? String(new Date().getFullYear());
      const result = await client.send(new ScanCommand({
        TableName: TABLE,
        FilterExpression: '#s = :s AND attribute_exists(actualNRFI)',
        ExpressionAttributeNames: { '#s': 'season' },
        ExpressionAttributeValues: { ':s': season },
      }));
      return res(200, result.Items ?? []);
    }

    // PUT /picks/{gamePk}  — upsert a user's pick, return updated counts
    if (method === 'PUT' && path.startsWith('/picks/')) {
      const gamePk = decodeURIComponent(path.split('/')[2]);
      const body = JSON.parse(event.body || '{}');
      const { userUuid, nickname, pick, date, season } = body;

      if (!pick || !['NRFI', 'YRFI'].includes(pick)) return res(400, { error: 'Invalid pick' });
      if (!userUuid) return res(400, { error: 'userUuid required' });

      await client.send(new PutCommand({
        TableName: TABLE_PICKS,
        Item: {
          gamePk:    String(gamePk),
          userUuid,
          pick,
          nickname:  (nickname || 'Anonymous').slice(0, 30),
          date:      date || '',
          season:    season || '',
          pickedAt:  new Date().toISOString(),
          ttl:       Math.floor(Date.now() / 1000) + 365 * 86400,
        },
      }));

      const counts = await getGamePickCounts(gamePk);
      return res(200, { ...counts, userPick: pick });
    }

    // GET /picks/{gamePk}  — get crowd pick counts (+ user's pick if userUuid param)
    if (method === 'GET' && path.startsWith('/picks/')) {
      const gamePk = decodeURIComponent(path.split('/')[2]);
      const userUuid = event.queryStringParameters?.userUuid;
      const counts = await getGamePickCounts(gamePk);
      if (userUuid) {
        const r = await client.send(new GetCommand({
          TableName: TABLE_PICKS,
          Key: { gamePk: String(gamePk), userUuid },
        }));
        counts.userPick = r.Item?.pick ?? null;
      }
      return res(200, counts);
    }

    // GET /picks?season=2026  — aggregate pick counts per gamePk for model stats
    if (method === 'GET' && path === '/picks') {
      const season = event.queryStringParameters?.season ?? String(new Date().getFullYear());
      const result = await client.send(new ScanCommand({
        TableName: TABLE_PICKS,
        FilterExpression: '#s = :s',
        ExpressionAttributeNames: { '#s': 'season' },
        ExpressionAttributeValues: { ':s': season },
      }));
      const byGame = {};
      (result.Items ?? []).forEach(item => {
        const pk = String(item.gamePk);
        if (!byGame[pk]) byGame[pk] = { gamePk: pk, nrfiCount: 0, yrfiCount: 0 };
        if (item.pick === 'NRFI') byGame[pk].nrfiCount++;
        else if (item.pick === 'YRFI') byGame[pk].yrfiCount++;
      });
      return res(200, Object.values(byGame));
    }

    return res(404, { error: 'Not found' });
  } catch (err) {
    console.error(err);
    return res(500, { error: err.message });
  }
};
