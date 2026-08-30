/**
 * Private price API for the fence calculator.
 *
 * The Google service-account credentials live only in Cloudflare secrets.
 * This file and the public GitHub repository never contain a key.
 */
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_SHEETS_SCOPE = "https://www.googleapis.com/auth/spreadsheets.readonly";
const DEFAULT_ORIGIN = "https://sega881117-bit.github.io";

let tokenCache;

const PRICE_KEY_MAP = {
  profile_one_1_8: "profile_single_1_8", profile_one_2_0: "profile_single_2_0",
  profile_two_1_8: "profile_double_1_8", profile_two_2_0: "profile_double_2_0",
  picket_single_1_8: "picket_single_1_8", picket_single_2_0: "picket_single_2_0",
  picket_chess_1_8: "picket_chess_1_8", picket_chess_2_0: "picket_chess_2_0",
  mesh3d_1_7: "mesh3d_1_7", mesh3d_2_0: "mesh3d_2_0",
  chainlink_1_8: "chainlink_1_8", chainlink_2_0: "chainlink_2_0",
  swing_4: "swing_3_4", swing_5: "swing_5", sliding_4: "sliding_3_4", sliding_5: "sliding_5",
  wicket_standard: "wicket_adjacent", wicket_separate: "wicket_separate",
  delivery_0_60: "delivery_0_60", delivery_61_120: "delivery_61_120", delivery_121_plus: "delivery_121_plus",
  post_extension_per_m: "post_extension_per_m",
};

function allowedOrigins(env) {
  return (env.ALLOWED_ORIGINS || DEFAULT_ORIGIN).split(",").map((item) => item.trim()).filter(Boolean);
}

function isAllowedOrigin(origin, env) {
  return Boolean(origin && allowedOrigins(env).includes(origin));
}

function headers(origin, env) {
  const allowed = isAllowedOrigin(origin, env) ? origin : DEFAULT_ORIGIN;
  return {
    "access-control-allow-origin": allowed,
    "access-control-allow-methods": "GET, OPTIONS",
    "access-control-allow-headers": "content-type",
    "access-control-max-age": "600",
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "vary": "Origin",
  };
}

function json(body, origin, env, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: headers(origin, env) });
}

function base64Url(value) {
  const bytes = typeof value === "string" ? new TextEncoder().encode(value) : new Uint8Array(value);
  let text = "";
  for (const byte of bytes) text += String.fromCharCode(byte);
  return btoa(text).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function getGoogleAccessToken(env) {
  if (tokenCache && tokenCache.expiresAt > Date.now() + 60_000) return tokenCache.token;
  if (!env.GOOGLE_SERVICE_ACCOUNT_EMAIL || !env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY) {
    throw new Error("google_credentials_missing");
  }
  const now = Math.floor(Date.now() / 1000);
  const header = base64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = base64Url(JSON.stringify({
    iss: env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    scope: GOOGLE_SHEETS_SCOPE,
    aud: GOOGLE_TOKEN_URL,
    iat: now,
    exp: now + 3600,
  }));
  const keyText = env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY
    .replace(/\\n/g, "\n")
    .replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s/g, "");
  const der = Uint8Array.from(atob(keyText), (char) => char.charCodeAt(0));
  const key = await crypto.subtle.importKey(
    "pkcs8", der, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"],
  );
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(`${header}.${claim}`));
  const assertion = `${header}.${claim}.${base64Url(signature)}`;
  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }),
  });
  if (!response.ok) throw new Error("google_token_failed");
  const payload = await response.json();
  if (!payload.access_token) throw new Error("google_token_missing");
  tokenCache = { token: payload.access_token, expiresAt: Date.now() + (payload.expires_in || 3600) * 1000 };
  return tokenCache.token;
}

async function readPrices(env) {
  const token = await getGoogleAccessToken(env);
  const spreadsheetId = env.PRICE_SHEET_ID;
  const range = env.PRICE_SHEET_RANGE;
  if (!spreadsheetId || !range) throw new Error("price_sheet_settings_missing");
  const response = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(range)}`,
    { headers: { authorization: `Bearer ${token}` } },
  );
  if (!response.ok) throw new Error("google_sheet_read_failed");
  const payload = await response.json();
  const prices = {};
  for (const row of payload.values || []) {
    const key = PRICE_KEY_MAP[String(row[0] || "")];
    const amount = Number(String(row[3] ?? "").replace(/\s/g, "").replace(",", "."));
    if (key && Number.isFinite(amount) && amount > 0) prices[key] = amount;
  }
  return { version: new Date().toISOString().slice(0, 10), source: "Цены для Авито", ...prices };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get("origin");
    if (url.pathname !== "/v1/prices") return json({ error: "not_found" }, origin, env, 404);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: headers(origin, env) });
    if (request.method !== "GET" || !isAllowedOrigin(origin, env)) return json({ error: "not_allowed" }, origin, env, 403);
    try {
      return json(await readPrices(env), origin, env);
    } catch (error) {
      // The browser receives only a neutral message; the technical reason is
      // retained in Cloudflare logs for safe diagnostics.
      console.error("fence-prices read failed", error instanceof Error ? error.message : String(error));
      return json({ error: "price_source_unavailable", message: "Прайс временно недоступен. Расчёт не выполнен." }, origin, env, 503);
    }
  },
};
