const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const {
  DynamoDBDocumentClient, PutCommand, DeleteCommand, QueryCommand,
} = require("@aws-sdk/lib-dynamodb");
const {
  ApiGatewayManagementApiClient, PostToConnectionCommand,
} = require("@aws-sdk/client-apigatewaymanagementapi");

const dynamo = DynamoDBDocumentClient.from(new DynamoDBClient({ region: "us-east-1" }));
const CHAT_TABLE  = "nrfi-chat";
const CONN_TABLE  = "nrfi-connections";
const MSG_LIMIT   = 75;
const MSG_MAX_LEN = 500;
const MSG_TTL_DAYS = 90;

// ── Helpers ───────────────────────────────────────────────────────────────────
const nowIso = () => new Date().toISOString();
const ttlSec = (days) => Math.floor(Date.now() / 1000) + days * 86400;

const makeApigw = (domainName, stage) =>
  new ApiGatewayManagementApiClient({
    endpoint: `https://${domainName}/${stage}`,
  });

// Send JSON to a single connection; delete stale connections (HTTP 410)
const post = async (apigw, connectionId, payload) => {
  try {
    await apigw.send(
      new PostToConnectionCommand({
        ConnectionId: connectionId,
        Data: JSON.stringify(payload),
      })
    );
  } catch (err) {
    if (err.$metadata?.httpStatusCode === 410) {
      await dynamo.send(
        new DeleteCommand({ TableName: CONN_TABLE, Key: { connectionId } })
      );
    }
  }
};

// Broadcast to all connections currently watching a given date
const broadcast = async (apigw, date, payload) => {
  const result = await dynamo.send(
    new QueryCommand({
      TableName: CONN_TABLE,
      IndexName: "date-index",
      KeyConditionExpression: "#d = :d",
      ExpressionAttributeNames: { "#d": "date" },
      ExpressionAttributeValues: { ":d": date },
    })
  );
  await Promise.all(
    (result.Items ?? []).map((c) => post(apigw, c.connectionId, payload))
  );
};

// ── Handler ───────────────────────────────────────────────────────────────────
exports.handler = async (event) => {
  const { connectionId, routeKey, domainName, stage } = event.requestContext;
  const apigw = makeApigw(domainName, stage);

  // ── $connect ──────────────────────────────────────────────────────────────
  if (routeKey === "$connect") {
    const date = event.queryStringParameters?.date ??
      new Date().toISOString().slice(0, 10);

    // Save connection
    await dynamo.send(
      new PutCommand({
        TableName: CONN_TABLE,
        Item: {
          connectionId,
          date,
          connectedAt: nowIso(),
          ttl: ttlSec(1), // connections auto-expire after 24 h
        },
      })
    );

    // Send chat history for this date (last MSG_LIMIT messages, oldest first)
    const history = await dynamo.send(
      new QueryCommand({
        TableName: CHAT_TABLE,
        KeyConditionExpression: "#d = :d",
        ExpressionAttributeNames: { "#d": "date" },
        ExpressionAttributeValues: { ":d": date },
        ScanIndexForward: false, // newest first so Limit grabs most recent
        Limit: MSG_LIMIT,
      })
    );

    await post(apigw, connectionId, {
      type: "history",
      messages: (history.Items ?? []).reverse(), // back to chronological order
    });

    return { statusCode: 200 };
  }

  // ── $disconnect ───────────────────────────────────────────────────────────
  if (routeKey === "$disconnect") {
    await dynamo.send(
      new DeleteCommand({ TableName: CONN_TABLE, Key: { connectionId } })
    );
    return { statusCode: 200 };
  }

  // ── sendMessage ───────────────────────────────────────────────────────────
  let body;
  try { body = JSON.parse(event.body ?? "{}"); }
  catch { return { statusCode: 400 }; }

  const { date, message, nickname, userUuid } = body;
  if (!date || !message?.trim()) return { statusCode: 400 };

  const msgId   = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const sentAt  = nowIso();
  const sortKey = `${sentAt}#${msgId}`;

  const item = {
    date,
    sortKey,
    messageId: msgId,
    userUuid:  userUuid  || "anon",
    nickname:  (nickname || "Anonymous").slice(0, 30),
    message:   message.trim().slice(0, MSG_MAX_LEN),
    sentAt,
    ttl: ttlSec(MSG_TTL_DAYS),
  };

  await dynamo.send(new PutCommand({ TableName: CHAT_TABLE, Item: item }));
  await broadcast(apigw, date, { type: "message", ...item });

  return { statusCode: 200 };
};
