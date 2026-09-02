// ARCHIVE ONLY (2026-08-17): legacy local calculator.
// It is intentionally no longer imported by the server. Runtime quotes must go
// through the n8n core → Google Sheet «Цены для Авито».
const MATERIALS = {
  profile_single: { label: 'Профлист односторонний', rates: { '1.8': 1900, '2': 2100 } },
  profile_double: { label: 'Профлист двухсторонний', rates: { '1.8': 2200, '2': 2400 } },
  euro_single: { label: 'Евроштакетник в один ряд', rates: { '1.8': 2150, '2': 2300 } },
  euro_chess: { label: 'Евроштакетник шахматка', rates: { '1.8': 3650, '2': 3900 } },
  mesh3d: { label: '3D-сетка', rates: { '1.7': 1900, '2': 2000 } },
  chainlink: { label: 'Сетка-рабица', rates: { '1.8': 900, '2': 1000 } },
  frame: { label: 'Каркас забора без заполнения', rates: { '1.8': 1250, '2': 1400 } }
};

function normalize(input) {
  return String(input || '').toLowerCase().replace(/ё/g, 'е').replace(/,/g, '.').replace(/\s+/g, ' ').trim();
}

function pickMaterial(text) {
  if (/(3d|3д|3-д)/.test(text)) return 'mesh3d';
  if (/рабиц/.test(text)) return 'chainlink';
  if (/каркас/.test(text)) return 'frame';
  if (/(евро)?шт[а-я]*ет/.test(text) && /(шахмат|в два ряда|двухряд)/.test(text)) return 'euro_chess';
  if (/(евро)?шт[а-я]*ет/.test(text)) return 'euro_single';
  if (/(профлист|профнастил)/.test(text) && /(двухстор|две сторон)/.test(text)) return 'profile_double';
  if (/(профлист|профнастил)/.test(text)) return 'profile_single';
  return null;
}

function pickLength(text) {
  const match = text.match(/(?:^|\s)(\d{2,3}(?:\.\d+)?)\s*(?:м\.?\s*(?:п\.?|пог\.?|кв\.?)?|метр(?:ов|а)?|квадрат|(?=вк(?:$|\s|[,.])))/);
  return match ? Number(match[1]) : null;
}

function pickHeight(text) {
  const explicit = text.match(/(?:^|[^0-9])(?:h\s*=\s*|высот[аы]?\s*)?(1[.,]?[78]|2(?:[.,]?0)?|1700|1800|2000)\s*(?:мм|м\.?|метр)/);
  const contextual = text.match(/(?:профлист|профнастил|шт[а-я]*ет|3d|3д|рабиц|каркас)[^0-9]{0,18}(1[.,]?[78]|2(?:[.,]?0)?)/);
  const raw = explicit?.[1] ?? contextual?.[1];
  if (!raw) return null;
  const value = Number(String(raw).replace(',', '.'));
  return value >= 100 ? value / 1000 : value;
}

function hasGateIntent(text) {
  return /(?:ворот|откатн|распаш)|(?:^|\s)вк(?:$|\s|[,.])/.test(text);
}

function pickGate(text) {
  if (!hasGateIntent(text)) return null;
  return /откатн/.test(text) ? 'sliding' : 'swing';
}

function pickGateWidth(text) {
  const match = text.match(/(?:ворот\w*|откатн\w*|распаш\w*)[^\d]{0,12}(3(?:\.5)?|4|5)\s*(?:м\.?|метр)?/);
  return match ? Number(match[1]) : 4;
}

function hasWicket(text) {
  return /калитк|(?:^|\s)вк(?:$|\s|[,.])/.test(text);
}

function wicketPrice(text) {
  return /калитк[^.\n]{0,24}(?:отдельн|двух столб)/.test(text) ? 15000 : 13000;
}

function delivery(length) {
  if (length <= 60) return 6000;
  if (length <= 120) return 8000;
  return 12000;
}

function money(value) {
  return new Intl.NumberFormat('ru-RU').format(value) + ' ₽';
}

export function buildDraft(request) {
  const text = normalize(request);
  const length = pickLength(text);
  const gate = pickGate(text);
  const wicket = hasWicket(text);
  const missing = [];
  if (!length) missing.push('общую длину');
  if (!gate) missing.push('ворота');
  if (!wicket) missing.push('калитку');

  if (missing.length) return { title: 'Нужны уточнения', detail: 'Для стандартной сметы не хватает: ' + missing.join(', ') + '. Ничего не отправлено и не изменено.', action: 'needs_clarification', safe: true };
  if (length < 30) return { title: 'Оставить для ручного расчёта', detail: 'Автосмета доступна от 30 м. Ничего не отправлено и не изменено.', action: 'manual_review', safe: true };

  const materialKey = pickMaterial(text) || 'profile_single';
  const height = pickHeight(text) ?? 2;
  const material = MATERIALS[materialKey];
  const rate = material.rates[String(height)];
  if (!rate) return { title: 'Оставить для ручного расчёта', detail: 'Для этой высоты нет утверждённой автоматической цены. Ничего не отправлено и не изменено.', action: 'manual_review', safe: true };

  const width = pickGateWidth(text);
  const gatePrice = gate === 'sliding' ? (width === 5 ? 75000 : 69000) : (width === 5 ? 23000 : 17000);
  const gateLabel = (gate === 'sliding' ? 'Откатные' : 'Распашные') + ' ворота ' + width + ' м';
  const wicketCost = wicketPrice(text);
  const deliveryPrice = delivery(length);
  const total = length * rate + gatePrice + wicketCost + deliveryPrice;
  return {
    title: 'Черновик сметы готов к проверке',
    detail: material.label + ', ' + length + ' м, высота ' + String(height).replace('.', ',') + ' м; ' + gateLabel + '; калитка. Предварительный итог: ' + money(total) + '. Ничего не отправлено и не изменено.',
    action: 'draft_estimate', safe: true,
    summary: { fence: money(length * rate), gates: money(gatePrice), wicket: money(wicketCost), delivery: money(deliveryPrice), total: money(total) }
  };
}
