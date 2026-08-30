/**
 * Private price API for the fence calculator.
 *
 * The Google service-account credentials live only in Cloudflare secrets.
 * This file and the public GitHub repository never contain a key.
 */
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_SHEETS_SCOPE = "https://www.googleapis.com/auth/spreadsheets.readonly";
const DEFAULT_ORIGIN = "https://sega881117-bit.github.io";
const DEFAULT_ALLOWED_ORIGINS = ["https://sega881117-bit.github.io", "https://sega171188.amocrm.ru"];

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
  const configured = String(env.ALLOWED_ORIGINS || "").split(",").map((item) => item.trim()).filter(Boolean);
  return [...new Set([...DEFAULT_ALLOWED_ORIGINS, ...configured])];
}

function isAllowedOrigin(origin, env) {
  return Boolean(origin && allowedOrigins(env).includes(origin));
}

function headers(origin, env) {
  const allowed = isAllowedOrigin(origin, env) ? origin : DEFAULT_ORIGIN;
  return {
    "access-control-allow-origin": allowed,
    "access-control-allow-methods": "GET, POST, OPTIONS",
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
  // These identifiers are not credentials. Keeping safe fallbacks prevents a
  // Git deployment from losing a non-secret dashboard variable.
  const spreadsheetId = env.PRICE_SHEET_ID || "1ru38oT771nNZr4AgbqxxJiYrwtXk7pKbX3izBcyF05Y";
  const range = env.PRICE_SHEET_RANGE || "Цены!A5:F40";
  const response = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(range)}`,
    { headers: { authorization: `Bearer ${token}` } },
  );
  if (!response.ok) throw new Error(`google_sheet_read_failed_${response.status}`);
  const payload = await response.json();
  const prices = {};
  for (const row of payload.values || []) {
    const key = PRICE_KEY_MAP[String(row[0] || "")];
    const amount = Number(String(row[3] ?? "").replace(/\s/g, "").replace(",", "."));
    if (key && Number.isFinite(amount) && amount > 0) prices[key] = amount;
  }
  return { version: new Date().toISOString().slice(0, 10), source: "Цены для Авито", ...prices };
}

const MATERIALS = [
  { key: "profile_double", label: "Профлист двухсторонний", test: /двухстор|двустор|двойн|2\s*сторон|обе\s*сторон/i },
  { key: "picket_chess", label: "Евроштакетник шахматка", test: /шахмат|в\s*два\s*ряд|вразбеж/i },
  { key: "mesh3d", label: "3D-сетка", test: /(?:3\s*[dд]|гиттер)/i },
  { key: "chainlink", label: "Сетка-рабица", test: /рабиц/i },
  { key: "picket_single", label: "Евроштакетник один ряд", test: /(?:штакет|штает|евроштак)/i },
  { key: "profile_single", label: "Профлист односторонний", test: /(?:проф(?:лист|настил)?|профилист|проф\.|профиль|лист|сплошн|глух)/i },
];
const num = (value) => Number(String(value).replace(",", "."));
const formatHeight = (value) => String(value).replace(".", ",");

function heightIn(text, fallback = 2) {
  const matches = [...String(text).matchAll(/(?:h\s*=\s*|высот[аы]?\s*)?(\d{1,4}(?:[,.]\d+)?)\s*(?:мм|м\.?|метр)/gi)];
  for (const match of matches) {
    const value = num(match[1]);
    if (value >= 1.6 && value <= 2.1) return value;
    if (value >= 1600 && value <= 2100) return value / 1000;
  }
  return fallback;
}

function explicitAmount(value, suffix) {
  const amount = num(String(value).replace(/[ \u00a0]/g, ""));
  return /^(?:к|к\.|тыс)/i.test(String(suffix || "")) ? amount * 1000 : amount;
}

function explicitRate(text) {
  const match = String(text).match(/по\s*(\d+(?:[ \u00a0]\d{3})*(?:[.,]\d+)?)\s*(к\.?|тыс(?:\.?|яч)?|₽|руб\.?|р\.?)?/i);
  return match ? explicitAmount(match[1], match[2]) : null;
}

function explicitExtraPrice(text, pattern) {
  const match = String(text).match(pattern);
  return match ? explicitAmount(match[1], match[2]) : null;
}

function materialIn(text) {
  const value = String(text || "");
  // Сначала учитываем явно названный материал, затем его покрытие.
  // Поэтому «штакетник в два ряда» остаётся шахматкой, а не профлистом.
  if (MATERIALS[1].test.test(value)) return MATERIALS[1];
  if (MATERIALS[2].test.test(value)) return MATERIALS[2];
  if (MATERIALS[3].test.test(value)) return MATERIALS[3];
  if (MATERIALS[4].test.test(value)) return MATERIALS[4];
  if (MATERIALS[0].test.test(value)) return MATERIALS[0];
  return MATERIALS[5];
}

function explicitPositionPrice(text, label) {
  const suffix = "(к\\.?|тыс(?:\\.?|яч)?|₽|руб\\.?|р\\.?)";
  const amount = "(\\d+(?:[ \\u00a0]\\d{3})*(?:[.,]\\d+)?)";
  const rawAfterPreposition = new RegExp(`${label}[^\\n]{0,36}?(?:по|за)\\s*${amount}\\s*${suffix}?`, "i");
  const shorthandAfterLabel = new RegExp(`${label}[^\\n]{0,36}?\\s${amount}\\s*${suffix}`, "i");
  const match = String(text).match(rawAfterPreposition) || String(text).match(shorthandAfterLabel);
  return match ? explicitAmount(match[1], match[2]) : null;
}

function fenceLine(line, prices) {
  // «Итого 300», «всего 250 000» — это комментарий к цене, а не новый участок.
  if (/^\s*(?:итого|всего|общ(?:ая|ий)\s+сумм)/i.test(line)) return null;
  if (/(?:ворот|калит|достав|удлин|откатн|сдвижн|распаш|створк|в\s*сторону)/i.test(line)) return null;
  const match = String(line).match(/(?:^|\s)(\d+(?:[.,]\d+)?)\s*(?:м\.?|м\.п\.?|метр(?:а|ов)?|х|x|×)?/i);
  if (!match || !(num(match[1]) > 0)) return null;
  const material = materialIn(line);
  const height = heightIn(line);
  const heightKey = Math.abs(height - 1.8) < 0.01 ? "1_8" : Math.abs(height - 1.7) < 0.01 ? "1_7" : Math.abs(height - 2) < 0.01 ? "2_0" : null;
  const price = explicitRate(line) || prices[`${material.key}_${heightKey}`];
  if (!Number.isFinite(price)) throw new Error(`Нет утверждённой цены: ${material.label}, высота ${height} м.`);
  return {
    type: "fence",
    material: material.key,
    height,
    title: fenceTitle(material.key, height),
    descriptionLines: fenceDescription(material.key, height),
    quantity: num(match[1]), unit: "м.п.", price, amount: num(match[1]) * price,
  };
}

function postLength(height, material) {
  if (material === "mesh3d") return height + 1.2;
  return height + 1;
}

function fenceTitle(material, height) {
  const h = formatHeight(height);
  if (material === "profile_double") return `Забор из профнастила, покрытие двухстороннее; высота Н-${h} м; 2 лаги.`;
  if (material === "profile_single") return `Забор из профнастила, покрытие одностороннее; высота Н-${h} м; 2 лаги.`;
  if (material === "picket_chess") return `Забор из евроштакетника, шахматка; высота Н-${h} м; 2 лаги.`;
  if (material === "picket_single") return `Забор из евроштакетника, один ряд; высота Н-${h} м; 2 лаги.`;
  if (material === "mesh3d") return `Забор 3D, высота ${h} м.`;
  return `Забор из сетки-рабицы, высота Н-${h} м.`;
}

function fenceDescription(material, height) {
  const length = formatHeight(postLength(height, material));
  if (material === "mesh3d") return [
    "секции 3D RAL 8017, толщина прутка 4 мм;",
    "3 скобы на 1 секцию;",
    `столбы 60×60, L-${length} м, толщина стенки 2 мм, покраска DALI RAL 8017;`,
    "забивание столбов с шагом 2,5 м и заглублением 1,2 м.",
  ];
  if (material === "chainlink") return [
    "оцинкованная сетка-рабица с ячейками 50×50 мм, толщина 1,8 мм;",
    `столбы L-${length} м, 60×40, толщина стенки 1,5 мм;`,
    "грунтовка ГФ-021 светло-серого цвета;",
    "пластиковые заглушки на столбах;",
    "забивание столбов на глубину до 1 м с шагом 2,5 м.",
  ];
  const isPicket = material === "picket_single" || material === "picket_chess";
  const isDouble = material === "profile_double" || material === "picket_chess";
  const first = isPicket
    ? `евроштакетник М-образный, 0,4 мм, RAL 7024, зазор ${material === "picket_chess" ? 7 : 3} см, порядок ${material === "picket_chess" ? "Шахматный" : "Обычный"};`
    : "профнастил С8, 0,4 мм, RAL 7024, НЛМК;";
  return [
    first,
    `столбы L-${length} м, 60×60, толщина стенки 2 мм;`,
    "лаги 40×20, толщина стенки 1,5 мм;",
    "пластиковые заглушки на столбах;",
    isPicket ? "саморезы в цвет евроштакетника;" : "саморезы в цвет профнастила;",
    "забивание столбов на глубину 1,2 м с шагом 2,5 м;",
    isDouble ? "покраска каркаса: Эмаль Dali 3в1." : "грунтовка ГФ-021 светло-серого цвета.",
  ];
}

function gateLine(text, prices) {
  const gateMentioned = /(?:ворот|откатн|сдвижн|распаш|створк|в\s*сторону)/i.test(text);
  const sliding = /(?:откатн|сдвижн|в\s*сторону)/i.test(text);
  const match = String(text).match(/(?:ворот\w*|откатн\w*|распаш\w*)[^\n]{0,28}?(3(?:[.,]5)?|4|5)\s*(?:м\.?|метр)/i);
  const width = match ? num(match[1]) : 4;
  if (width > 5 || width < 3) throw new Error("Ворота шире 5 м или уже 3 м требуют ручной проверки.");
  const statedPrice = explicitPositionPrice(text, "(?:ворот\\w*|откатн\\w*|сдвижн\\w*|распаш\\w*|створк\\w*)");
  const price = statedPrice || (sliding ? (width > 4 ? prices.sliding_5 : prices.sliding_3_4) : (width > 4 ? prices.swing_5 : prices.swing_3_4));
  const height = heightIn(text);
  return {
    type: "extra", title: sliding ? `Откатные ворота ${formatHeight(width)}×${formatHeight(height)} м, с ручным механизмом.` : `Каркас распашных ворот ${formatHeight(width)}×${formatHeight(height)} м, открывается наружу.`,
    descriptionLines: sliding ? [
      "рама из профтрубы 60×40, толщина стенки 1,5 мм; несущая балка; роликовые каретки;",
      "концевой разгрузочный ролик; нижний улавливатель;",
      "направляющая с роликами; верхний улавливатель; заглушки;",
      "опорный столб; ответный столб;",
      "фундамент для роликовых кареток: сваи 89, 2 шт. на тумбу.",
    ] : [
      "каркас из профтрубы 40×20, толщина стенки 1,5 мм;",
      "столбы 80×80, толщина стенки 3 мм;",
      "заглубление на 1,5 м;",
      "изнутри запирающее устройство «гусь» с проушинами для замка;",
      "2 нижних стопора;",
      "петли 25×120 мм.",
    ],
    quantity: 1, unit: "шт.", price, amount: price, inferred: !gateMentioned,
  };
}

function wicketLine(text, prices) {
  const separate = /(?:калит[^\n]{0,36}(?:отдельн|двух\s*столб|2\s*столб)|(?:отдельн|двух\s*столб|2\s*столб)[^\n]{0,36}калит)/i.test(text);
  const statedPrice = explicitPositionPrice(text, "калит");
  const price = statedPrice || (separate ? prices.wicket_separate : prices.wicket_adjacent);
  const height = heightIn(text);
  return {
    type: "extra",
    title: separate ? `Каркас отдельно стоящей калитки 1×${formatHeight(height)} м, на двух столбах, открывается наружу.` : `Каркас рядом стоящей калитки 1×${formatHeight(height)} м, на одном столбе, открывается наружу.`,
    descriptionLines: [
      "каркас из профтрубы 40×20, толщина стенки 1,5 мм;",
      separate ? "два столба 80×80, толщина стенки 3 мм;" : "один столб 80×80, толщина стенки 3 мм;",
      "заглубление на 1,5 м;",
      "петли 25×120 мм;",
      "врезной замок в подарок 🎁.",
    ],
    quantity: 1, unit: "шт.", price, amount: price,
  };
}

function deliveryLine(text, length, prices) {
  const match = String(text).match(/достав[^\n\d]{0,20}(\d+(?:[.,]\d+)?)\s*(к|тыс|₽|руб\.?|р\.)?/i);
  const raw = match ? num(match[1]) : null;
  const price = raw ? (raw < 100 ? raw * 1000 : raw) : (length <= 60 ? prices.delivery_0_60 : length <= 120 ? prices.delivery_61_120 : prices.delivery_121_plus);
  return { type: "delivery", title: "Доставка", descriptionLines: ["доставка материалов и бригады."], quantity: 1, unit: "рейс", price, amount: price };
}

function targetTotalIn(text) {
  const match = String(text).match(/(?:^|\n)\s*(?:итого|всего|общ(?:ая|ий)\s+сумм)[^\d]{0,16}(\d+(?:[ \u00a0]\d{3})*(?:[.,]\d+)?)\s*(к\.?|тыс(?:\.?|яч)?|₽|руб\.?|р\.)?/im);
  if (!match) return null;
  const raw = num(String(match[1]).replace(/[ \u00a0]/g, ""));
  if (!Number.isFinite(raw) || raw <= 0) return null;
  return match[2] || raw >= 1000 ? raw : raw * 1000;
}

function applyTargetTotal(fences, fixedLines, targetTotal, length) {
  if (!targetTotal) return;
  const fixedAmount = fixedLines.reduce((sum, item) => sum + item.amount, 0);
  const fenceAmount = targetTotal - fixedAmount;
  if (fenceAmount <= 0) throw new Error("Итоговая сумма должна быть больше стоимости ворот, калитки и доставки.");
  const price = fenceAmount / length;
  for (const fence of fences) {
    fence.price = price;
    fence.amount = fence.quantity * price;
  }
}

function buildQuote(request, prices) {
  const text = String(request || "").trim();
  if (!text) throw new Error("Введите параметры забора.");
  const fences = text.split(/\r?\n/).map((line) => fenceLine(line.trim(), prices)).filter(Boolean);
  if (!fences.length) {
    const match = text.match(/(?:^|\s)(\d+(?:[.,]\d+)?)\s*(?:м\.?|метр(?:а|ов)?)/i);
    if (!match) throw new Error("Не удалось определить длину забора.");
    fences.push(fenceLine(`${match[1]} м профлист`, prices));
  }
  const length = fences.reduce((sum, item) => sum + item.quantity, 0);
  const fixedLines = [gateLine(text, prices), wicketLine(text, prices)];
  if (/удлин[а-яё]*\s+столб/i.test(text) && /1[,.]5/.test(text)) fixedLines.push({ type: "extra", title: "Удлинение столбов до 1,5 м", quantity: length, unit: "м.п.", price: prices.post_extension_per_m, amount: length * prices.post_extension_per_m });
  fixedLines.push(deliveryLine(text, length, prices));
  applyTargetTotal(fences, fixedLines, targetTotalIn(text), length);
  const lines = [...fences, ...fixedLines];
  return { title: `Строительство забора ${length} м под ключ`, length, lines, total: lines.reduce((sum, item) => sum + item.amount, 0), priceVersion: prices.version, priceSource: prices.source };
}

function allowedAmoLeadIds(env) {
  // Пока идёт приёмка, нельзя прикрепить файл к боевой сделке даже при
  // случайном нажатии кнопки в виджете. Для запуска понадобится явно
  // заменить эту переменную в Cloudflare и отдельно подтвердить включение.
  const configured = String(env.AMOCRM_ALLOWED_LEAD_IDS || "36413089")
    .split(",")
    .map((value) => Number(value.trim()))
    .filter((value) => Number.isInteger(value) && value > 0);
  return new Set(configured);
}

function pdfBytesFromBase64(value) {
  if (typeof value !== "string" || value.length < 16 || value.length > 11_000_000) {
    throw new Error("invalid_pdf_payload");
  }
  const base64 = value.replace(/^data:application\/pdf;base64,/i, "");
  const binary = atob(base64);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  if (bytes.length < 64 || bytes.length > 8_000_000 || new TextDecoder().decode(bytes.slice(0, 5)) !== "%PDF-") {
    throw new Error("invalid_pdf_file");
  }
  return bytes;
}

async function attachPdfToAmo({ leadId, pdfBytes, fileName }, env) {
  if (!env.AMOCRM_ACCESS_TOKEN) throw new Error("amocrm_token_missing");
  const amoBase = String(env.AMOCRM_BASE_URL || "https://sega171188.amocrm.ru").replace(/\/$/, "");
  const auth = { authorization: `Bearer ${env.AMOCRM_ACCESS_TOKEN}` };
  const account = await fetch(`${amoBase}/api/v4/account?with=drive_url`, { headers: auth });
  if (!account.ok) throw new Error(`amocrm_account_${account.status}`);
  const driveUrl = (await account.json()).drive_url;
  if (!driveUrl) throw new Error("amocrm_drive_url_missing");
  const session = await fetch(`${driveUrl}/v1.0/sessions`, {
    method: "POST",
    headers: { ...auth, "content-type": "application/json" },
    body: JSON.stringify({ file_name: fileName, file_size: pdfBytes.length, content_type: "application/pdf" }),
  });
  if (!session.ok) throw new Error(`amocrm_upload_session_${session.status}`);
  const sessionData = await session.json();
  if (!sessionData.upload_url) throw new Error("amocrm_upload_url_missing");
  const upload = await fetch(sessionData.upload_url, {
    method: "POST",
    headers: { "content-type": "application/pdf" },
    body: pdfBytes,
  });
  if (!upload.ok) throw new Error(`amocrm_upload_${upload.status}`);
  const uploaded = await upload.json();
  const uuid = uploaded.uuid || uploaded.file_uuid;
  if (!uuid) throw new Error("amocrm_file_uuid_missing");
  const attach = await fetch(`${amoBase}/api/v4/leads/${leadId}/files`, {
    method: "PUT",
    headers: { ...auth, "content-type": "application/json" },
    body: JSON.stringify([{ file_uuid: uuid }]),
  });
  if (!attach.ok) throw new Error(`amocrm_attach_${attach.status}`);
  return { uuid };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get("origin");
    if (url.pathname === "/v1/amo/attach-pdf") {
      if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: headers(origin, env) });
      if (request.method !== "POST" || !isAllowedOrigin(origin, env)) return json({ error: "not_allowed" }, origin, env, 403);
      try {
        const body = await request.json();
        const leadId = Number(body?.lead_id);
        if (!Number.isInteger(leadId) || !allowedAmoLeadIds(env).has(leadId)) {
          return json({ ok: false, error: "lead_not_allowed" }, origin, env, 403);
        }
        const pdfBytes = pdfBytesFromBase64(body?.pdf_base64);
        const fileName = `Смета_${leadId}_${new Date().toISOString().slice(0, 10)}.pdf`;
        const uploaded = await attachPdfToAmo({ leadId, pdfBytes, fileName }, env);
        return json({ ok: true, attached: true, file_uuid: uploaded.uuid }, origin, env);
      } catch (error) {
        console.error("amo pdf attach failed", error instanceof Error ? error.message : String(error));
        return json({ ok: false, error: "attach_failed" }, origin, env, 502);
      }
    }
    if (url.pathname === "/v1/drafts") {
      if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: headers(origin, env) });
      if (request.method !== "POST" || !isAllowedOrigin(origin, env)) return json({ error: "not_allowed" }, origin, env, 403);
      try {
        const body = await request.json();
        if (body?.mode !== "draft_only" || typeof body.request !== "string" || body.request.length > 1000) return json({ error: "invalid_request" }, origin, env, 400);
        const quote = buildQuote(body.request, await readPrices(env));
        return json({ valid: true, action: "cloudflare_quote", quote }, origin, env);
      } catch (error) {
        return json({ valid: false, error: "calculation_failed", message: error instanceof Error ? error.message : "Расчёт не выполнен." }, origin, env, 422);
      }
    }
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
