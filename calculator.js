const MATERIALS = [
  { key: "profile_double", label: "Профлист двухсторонний", test: /двухстор|двустор/i, heights: [1.8, 2] },
  { key: "picket_chess", label: "Евроштакетник шахматка", test: /шахмат/i, heights: [1.8, 2] },
  { key: "mesh3d", label: "3D-сетка", test: /(?:3\s*[dд]|гиттер)/i, heights: [1.7, 2] },
  { key: "chainlink", label: "Сетка-рабица", test: /рабиц/i, heights: [1.8, 2] },
  { key: "picket_single", label: "Евроштакетник один ряд", test: /(?:штакет|евроштак)/i, heights: [1.8, 2] },
  { key: "profile_single", label: "Профлист односторонний", test: /(?:проф(?:лист|настил)?|профилист|сплошн)/i, heights: [1.8, 2] }
];

const number = (value) => Number(String(value).replace(",", "."));
const rub = (value) => new Intl.NumberFormat("ru-RU").format(Math.round(value)) + " ₽";

function heightIn(text, fallback = 2) {
  const matches = [...String(text).matchAll(/(?:h\s*=\s*|высот[аы]?\s*)?(\d{1,4}(?:[,.]\d+)?)\s*(?:мм|м\.?|метр)/gi)];
  for (const match of matches) {
    const n = number(match[1]);
    if (n >= 1.6 && n <= 2.1) return n;
    if (n >= 1600 && n <= 2100) return n / 1000;
  }
  return fallback;
}

function materialIn(text) {
  return MATERIALS.find((material) => material.test.test(text)) ?? MATERIALS.at(-1);
}

function explicitRate(text) {
  const match = text.match(/по\s*(\d{3,5})(?:\s*(?:₽|руб\.?|р\.?))?/i);
  return match ? number(match[1]) : null;
}

function fenceLine(line, prices) {
  if (/(?:ворот|калит|достав|удлин|откатн|распаш|в\s*сторону)/i.test(line)) return null;
  const lengthMatch = line.match(/(?:^|\s)(\d+(?:[.,]\d+)?)\s*(?:м\.?|м\.п\.?|метр(?:а|ов)?|х|x|×)?/i);
  if (!lengthMatch) return null;
  const length = number(lengthMatch[1]);
  if (!(length > 0)) return null;
  const material = materialIn(line);
  const height = heightIn(line);
  const heightKey = Math.abs(height - 1.8) < 0.01 ? "1_8" : Math.abs(height - 1.7) < 0.01 ? "1_7" : Math.abs(height - 2) < 0.01 ? "2_0" : null;
  const price = explicitRate(line) ?? prices[`${material.key}_${heightKey}`];
  if (!Number.isFinite(price)) throw new Error(`Нет утверждённой цены: ${material.label}, высота ${height} м.`);
  return { type: "fence", title: `${material.label}, высота ${String(height).replace(".", ",")} м`, quantity: length, unit: "м.п.", price, amount: length * price };
}

function gateLine(text, prices) {
  const sliding = /(?:откатн|в\s*сторону)/i.test(text);
  const gateMentioned = /(?:ворот|откатн|распаш|в\s*сторону)/i.test(text);
  const match = text.match(/(?:ворот\w*|откатн\w*|распаш\w*)[^\n]{0,28}?(3(?:[.,]5)?|4|5)\s*(?:м\.?|метр)/i);
  const width = match ? number(match[1]) : 4;
  if (width > 5 || width < 3) throw new Error("Ворота шире 5 м или уже 3 м требуют ручной проверки.");
  const kind = sliding ? "Откатные" : "Распашные";
  const price = sliding ? (width > 4 ? prices.sliding_5 : prices.sliding_3_4) : (width > 4 ? prices.swing_5 : prices.swing_3_4);
  return { type: "extra", title: `${kind} ворота ${String(width).replace(".", ",")} м`, quantity: 1, unit: "шт.", price, amount: price, inferred: !gateMentioned };
}

function wicketLine(text, prices) {
  const separate = /(?:калит[^\n]{0,36}(?:отдельн|двух\s*столб|2\s*столб)|(?:отдельн|двух\s*столб|2\s*столб)[^\n]{0,36}калит)/i.test(text);
  const explicit = text.match(/калит[^\n]{0,24}?\s(?:по|за)\s*(\d+(?:[.,]\d+)?)\s*(к|к\.|тыс|₽|руб\.?|р\.)?/i);
  const raw = explicit ? number(explicit[1]) : null;
  const price = raw ? (raw < 100 ? raw * 1000 : raw) : (separate ? prices.wicket_separate : prices.wicket_adjacent);
  return { type: "extra", title: separate ? "Калитка отдельно стоящая (на 2 столбах)" : "Калитка рядом стоящая (на 1 столбе)", quantity: 1, unit: "шт.", price, amount: price, inferred: !/калит/i.test(text) };
}

function deliveryLine(text, length, prices) {
  const match = text.match(/достав[^\n\d]{0,20}(\d+(?:[.,]\d+)?)\s*(к|тыс|₽|руб\.?|р\.)?/i);
  const raw = match ? number(match[1]) : null;
  const price = raw ? (raw < 100 ? raw * 1000 : raw) : (length <= 60 ? prices.delivery_0_60 : length <= 120 ? prices.delivery_61_120 : prices.delivery_121_plus);
  return { type: "delivery", title: "Доставка", quantity: 1, unit: "рейс", price, amount: price };
}

export function calculate(request, prices) {
  const text = String(request ?? "").trim();
  if (!text) throw new Error("Введите параметры забора.");
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const fences = lines.map((line) => fenceLine(line, prices)).filter(Boolean);
  if (!fences.length) {
    const match = text.match(/(?:^|\s)(\d+(?:[.,]\d+)?)\s*(?:м\.?|метр(?:а|ов)?)/i);
    if (!match) throw new Error("Не удалось определить длину забора.");
    fences.push(fenceLine(`${match[1]} м профлист`, prices));
  }
  const length = fences.reduce((sum, line) => sum + line.quantity, 0);
  const extras = [gateLine(text, prices), wicketLine(text, prices)];
  const extension = /удлин[а-яё]*\s+столб/i.test(text) && /1[,.]5/.test(text);
  if (extension) extras.push({ type: "extra", title: "Удлинение столбов до 1,5 м", quantity: length, unit: "м.п.", price: prices.post_extension_per_m, amount: length * prices.post_extension_per_m });
  const delivery = deliveryLine(text, length, prices);
  const linesOut = [...fences, ...extras, delivery];
  const total = linesOut.reduce((sum, line) => sum + line.amount, 0);
  return { title: `Строительство забора ${length} м под ключ`, length, lines: linesOut, total, priceVersion: prices.version };
}

export { rub };
