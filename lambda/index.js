const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, PutCommand, ScanCommand } = require('@aws-sdk/lib-dynamodb');

const client = DynamoDBDocumentClient.from(new DynamoDBClient({ region: 'us-east-1' }));
const TABLE = 'nrfi-outcomes';

const cors = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,PUT,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const res = (status, body) => ({ statusCode: status, headers: cors, body: JSON.stringify(body) });

exports.handler = async (event) => {
  const method = event.requestContext?.http?.method ?? '';
  const path   = event.requestContext?.http?.path   ?? '';

  if (method === 'OPTIONS') return { statusCode: 200, headers: cors, body: '' };

  try {
    // PUT /outcomes/{gamePk}  — upsert a game record
    if (method === 'PUT' && path.startsWith('/outcomes/')) {
      const gamePk = decodeURIComponent(path.split('/')[2]);
      const body   = JSON.parse(event.body || '{}');
      await client.send(new PutCommand({
        TableName: TABLE,
        Item: { gamePk, ...body, updatedAt: new Date().toISOString() },
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

    return res(404, { error: 'Not found' });
  } catch (err) {
    console.error(err);
    return res(500, { error: err.message });
  }
};
