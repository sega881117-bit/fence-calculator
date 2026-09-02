import http from 'node:http';

const port = Number(process.env.PORT || 8787);
const host = process.env.HOST || '127.0.0.1';
const allowedOrigin = process.env.ALLOWED_ORIGIN || '';
const enabled = process.env.WIDGET_SERVER_ENABLED === 'true';
const coreDraftUrl = process.env.CORE_DRAFT_WEBHOOK_URL || '';

function send(response, status, body, origin) {
  const headers = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' };
  if (origin && origin === allowedOrigin) headers['access-control-allow-origin'] = origin;
  response.writeHead(status, headers);
  response.end(JSON.stringify(body));
}

function readJson(request) {
  return new Promise((resolve, reject) => {
    let raw = '';
    request.on('data', chunk => {
      raw += chunk;
      if (raw.length > 4096) request.destroy();
    });
    request.on('end', () => {
      try { resolve(JSON.parse(raw || '{}')); } catch { reject(new Error('invalid_json')); }
    });
    request.on('error', reject);
  });
}

http.createServer(async (request, response) => {
  const origin = request.headers.origin || '';
  if (request.method === 'OPTIONS') {
    if (!allowedOrigin || origin !== allowedOrigin) return send(response, 403, { error: 'origin_not_allowed' }, origin);
    response.writeHead(204, {
      'access-control-allow-origin': origin,
      'access-control-allow-methods': 'POST, OPTIONS',
      'access-control-allow-headers': 'content-type',
      'access-control-max-age': '600'
    });
    return response.end();
  }
  if (request.method === 'GET' && request.url === '/health') return send(response, 200, { ok: true, mode: enabled && coreDraftUrl ? 'core_proxy' : 'disabled' }, origin);
  if (request.method !== 'POST' || request.url !== '/v1/drafts') return send(response, 404, { error: 'not_found' }, origin);
  if (!enabled) return send(response, 503, { error: 'server_disabled', message: 'Черновики пока не подключены.' }, origin);
  if (!coreDraftUrl) return send(response, 503, { error: 'core_not_configured', message: 'Не задан адрес единого ядра расчёта.' }, origin);
  if (!allowedOrigin || origin !== allowedOrigin) return send(response, 403, { error: 'origin_not_allowed' }, origin);

  try {
    const body = await readJson(request);
    if (body.mode !== 'draft_only' || typeof body.request !== 'string' || body.request.length > 1000) {
      return send(response, 400, { error: 'invalid_request' }, origin);
    }
    const coreResponse = await fetch(coreDraftUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...body, source: 'amo_widget' })
    });
    const result = await coreResponse.json().catch(() => null);
    if (!coreResponse.ok || !result) return send(response, 502, { error: 'core_unavailable', message: 'Единое ядро не вернуло расчёт.' }, origin);
    return send(response, 200, result, origin);
  } catch {
    return send(response, 400, { error: 'invalid_json' }, origin);
  }
}).listen(port, host, () => {
  console.log('Fence assistant draft server listens on http://' + host + ':' + port);
});
