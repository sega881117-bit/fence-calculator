const MATERIALS = [
  { key: "profile_double", label: "Профлист двухсторонний", test: /двухстор|двустор|двойн|2\s*сторон|обе\s*сторон/i, heights: [1.8, 2] },
  { key: "picket_chess", label: "Евроштакетник шахматка", test: /шахмат|в\s*два\s*ряд|вразбеж/i, heights: [1.8, 2] },
  { key: "mesh3d", label: "3D-сетка", test: /(?:3\s*[dд]|гиттер)/i, heights: [1.7, 2] },
  { key: "chainlink", label: "Сетка-рабица", test: /рабиц/i, heights: [1.8, 2] },
  { key: "picket_single", label: "Евроштакетник один ряд", test: /(?:штакет|штает|евроштак)/i, heights: [1.8, 2] },
  { key: "profile_single", label: "Профлист односторонний", test: /(?:проф(?:лист|настил)?|профилист|проф\.|профиль|лист|сплошн|глух)/i, heights: [1.8, 2] }
];

const number = (value) => Number(String(value).replace(",", "."));
const rub = (value) => new Intl.NumberFormat("ru-RU").format(Math.round(value)) + " ₽";

function heightIn(text, fallback = 2) {
  const source = String(text);
  // Короткая запись «131х1.8 штакетник» — второй размер может быть без «м».
  const dimension = source.match(/\d{1,4}(?:[,.]\d+)?\s*[xх×]\s*(1[,.][78]|2(?:[,.]0)?)/i);
  if (dimension) return number(dimension[1]);
  const matches = [...source.matchAll(/(?:h\s*=\s*|высот[аы]?\s*)?(\d{1,4}(?:[,.]\d+)?)\s*(?:мм|м\.?|метр)/gi)];
  for (const match of matches) {
    const n = number(match[1]);
    if (n >= 1.6 && n <= 2.1) return n;
    if (n >= 1600 && n <= 2100) return n / 1000;
  }
  return fallback;
}

function materialIn(text) {
  const value = String(text || "");
  if (MATERIALS[1].test.test(value)) return MATERIALS[1];
  if (MATERIALS[2].test.test(value)) return MATERIALS[2];
  if (MATERIALS[3].test.test(value)) return MATERIALS[3];
  if (MATERIALS[4].test.test(value)) return MATERIALS[4];
  if (MATERIALS[0].test.test(value)) return MATERIALS[0];
  return MATERIALS[5];
}

function explicitAmount(value, suffix) {
  const amount = number(String(value).replace(/[ \u00a0]/g, ""));
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

function explicitPositionPrice(text, label) {
  const suffix = "(к\\.?|тыс(?:\\.?|яч)?|₽|руб\\.?|р\\.?)";
  const amount = "(\\d+(?:[ \\u00a0]\\d{3})*(?:[.,]\\d+)?)";
  const rawAfterPreposition = new RegExp(`${label}[^\\n]{0,36}?(?:по|за)\\s*${amount}\\s*${suffix}?`, "i");
  const shorthandAfterLabel = new RegExp(`${label}[^\\n]{0,36}?\\s${amount}\\s*${suffix}`, "i");
  const match = String(text).match(rawAfterPreposition) || String(text).match(shorthandAfterLabel);
  return match ? explicitAmount(match[1], match[2]) : null;
}

function hasGateMention(text) {
  return /(?:ворот|откатн|сдвижн|распаш|створк|в\s*сторону|(?:^|\s)в\s*(?:\+\s*)?к(?=\s|$))/im.test(String(text));
}

function hasWicketMention(text) {
  return /(?:калит|(?:^|\s)в\s*(?:\+\s*)?к(?=\s|$))/im.test(String(text));
}

function fenceLine(line, prices) {
  // «Итого 300», «всего 250 000» — это комментарий к цене, а не новый участок.
  if (/^\s*(?:итого|всего|общ(?:ая|ий)\s+сумм)/i.test(line)) return null;
  if (/(?:ворот|калит|достав|удлин|откатн|сдвижн|распаш|створк|в\s*сторону)/i.test(line)) return null;
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
  const sliding = /(?:откатн|сдвижн|в\s*сторону)/i.test(text);
  const gateMentioned = hasGateMention(text);
  // В ручной смете ворота появляются только когда они названы явно.
  if (!gateMentioned) return null;
  const match = text.match(/(?:ворот\w*|откатн\w*|распаш\w*)[^\n]{0,28}?(3(?:[.,]5)?|4|5)\s*(?:м\.?|метр)/i);
  const width = match ? number(match[1]) : 4;
  if (width > 5 || width < 3) throw new Error("Ворота шире 5 м или уже 3 м требуют ручной проверки.");
  const kind = sliding ? "Откатные" : "Распашные";
  const statedPrice = explicitPositionPrice(text, "(?:ворот\\w*|откатн\\w*|сдвижн\\w*|распаш\\w*|створк\\w*)");
  const price = statedPrice || (sliding ? (width > 4 ? prices.sliding_5 : prices.sliding_3_4) : (width > 4 ? prices.swing_5 : prices.swing_3_4));
  return { type: "extra", title: `${kind} ворота ${String(width).replace(".", ",")} м`, quantity: 1, unit: "шт.", price, amount: price, inferred: !gateMentioned };
}

function wicketLine(text, prices) {
  const gateMentioned = hasGateMention(text);
  const wicketMentioned = hasWicketMention(text);
  // В ручной смете калитка появляется только когда она названа явно.
  if (!wicketMentioned) return null;
  const separate = !gateMentioned || /(?:калит[^\n]{0,36}(?:отдельн|двух\s*столб|2\s*столб)|(?:отдельн|двух\s*столб|2\s*столб)[^\n]{0,36}калит)/i.test(text);
  const explicit = text.match(/калит[^\n]{0,24}?\s(?:по|за)\s*(\d+(?:[.,]\d+)?)\s*(к|к\.|тыс|₽|руб\.?|р\.)?/i);
  const raw = explicit ? number(explicit[1]) : null;
  const statedPrice = explicitPositionPrice(text, "калит");
  const price = statedPrice || (raw ? (raw < 100 ? raw * 1000 : raw) : (separate ? prices.wicket_separate : prices.wicket_adjacent));
  return { type: "extra", title: separate ? "Калитка отдельно стоящая (на 2 столбах)" : "Калитка рядом стоящая (на 1 столбе)", quantity: 1, unit: "шт.", price, amount: price, inferred: !/калит/i.test(text) };
}

function deliveryLine(text, length, prices) {
  const match = text.match(/достав[^\n\d]{0,20}(\d+(?:[.,]\d+)?)\s*(к|тыс|₽|руб\.?|р\.)?/i);
  const raw = match ? number(match[1]) : null;
  const price = raw ? (raw < 100 ? raw * 1000 : raw) : (length <= 60 ? prices.delivery_0_60 : length <= 120 ? prices.delivery_61_120 : prices.delivery_121_plus);
  return { type: "delivery", title: "Доставка", quantity: 1, unit: "рейс", price, amount: price };
}

function targetTotalIn(text) {
  const match = String(text).match(/(?:^|\n)\s*(?:итого|всего|общ(?:ая|ий)\s+сумм)[^\d]{0,16}(\d+(?:[ \u00a0]\d{3})*(?:[.,]\d+)?)\s*(к\.?|тыс(?:\.?|яч)?|₽|руб\.?|р\.)?/im);
  if (!match) return null;
  const raw = number(String(match[1]).replace(/[ \u00a0]/g, ""));
  if (!Number.isFinite(raw) || raw <= 0) return null;
  return match[2] ? explicitAmount(match[1], match[2]) : raw >= 1000 ? raw : raw * 1000;
}

function applyTargetTotal(fences, fixedLines, targetTotal, length) {
  if (!targetTotal) return;
  const fixedAmount = fixedLines.reduce((sum, line) => sum + line.amount, 0);
  const fenceAmount = targetTotal - fixedAmount;
  if (fenceAmount <= 0) throw new Error("Итоговая сумма должна быть больше стоимости ворот, калитки и доставки.");
  const price = fenceAmount / length;
  for (const fence of fences) {
    fence.price = price;
    fence.amount = fence.quantity * price;
  }
}

function quoteTitle(length, fixedLines) {
  const hasGate = fixedLines.some((line) => line.type === "extra" && /(?:ворот|откатн)/i.test(line.title));
  const hasWicket = fixedLines.some((line) => /калит/i.test(line.title));
  const suffix = hasGate && hasWicket
    ? ", включая каркасы ворот и калитки"
    : hasGate ? ", включая каркасы ворот"
      : hasWicket ? ", включая каркасы калитки" : "";
  return `Строительство забора ${length} м под ключ${suffix}`;
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
  const extras = [gateLine(text, prices), wicketLine(text, prices)].filter(Boolean);
  const extension = /удлин[а-яё]*\s+столб/i.test(text) && /1[,.]5/.test(text);
  // Цена хранится в «Цены для Авито». Резервное значение — согласованные
  // 300 ₽/м.п.; оно не даёт сформировать нулевую смету, если строка допработы
  // временно отсутствует в выгрузке прайса.
  const extensionRate = Number(prices.post_extension_per_m) || 300;
  if (extension) extras.push({ type: "extra", title: "Удлинение столбов до 1,5 м", quantity: length, unit: "м.п.", price: extensionRate, amount: length * extensionRate });
  const delivery = deliveryLine(text, length, prices);
  const fixedLines = [...extras, delivery];
  applyTargetTotal(fences, fixedLines, targetTotalIn(text), length);
  const linesOut = [...fences, ...fixedLines];
  const total = linesOut.reduce((sum, line) => sum + line.amount, 0);
  return { title: quoteTitle(length, fixedLines), length, lines: linesOut, total, priceVersion: prices.version };
}

export { rub };
