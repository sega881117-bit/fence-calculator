import assert from "node:assert/strict";
import { calculate } from "./calculator.js";

const prices = {
  profile_single_1_8: 1900, profile_single_2_0: 2100,
  profile_double_1_8: 2150, profile_double_2_0: 2400,
  picket_single_1_8: 2150, picket_single_2_0: 2300,
  picket_chess_1_8: 3600, picket_chess_2_0: 3900,
  mesh3d_1_7: 2000, mesh3d_2_0: 2100,
  chainlink_1_8: 1000, chainlink_2_0: 1100,
  swing_3_4: 17000, swing_5: 23000,
  sliding_3_4: 69000, sliding_5: 75000,
  wicket_adjacent: 13000, wicket_separate: 15000,
  delivery_0_60: 6000, delivery_61_120: 8000, delivery_121_plus: 12000,
  post_extension_per_m: 300,
  version: "test",
};

const quote = (lines) => calculate(lines.join("\n"), prices);
const titles = (result) => result.lines.map((line) => line.title);
const line = (result, pattern) => result.lines.find((item) => pattern.test(item.title));

// Ручной виджет: конструкции появляются только при явном указании.
{
  const result = quote(["30м по 2700", "Доставка 7к"]);
  assert.equal(result.total, 88000);
  assert.equal(result.lines.length, 2);
  assert.equal(line(result, /Профлист|Забор/).price, 2700);
  assert.equal(line(result, /Доставка/).price, 7000);
  assert.doesNotMatch(result.title, /ворот|калит/i);
}

{
  const result = quote(["31 штакетник", "откатные"]);
  assert.equal(result.lines.length, 3);
  assert.ok(line(result, /Откатные ворота/));
  assert.equal(line(result, /калит/i), undefined);
  assert.match(result.title, /каркасы ворот$/);
}

{
  const result = quote(["31 штакетник", "калитка"]);
  assert.equal(result.lines.length, 3);
  assert.equal(line(result, /ворот/i), undefined);
  assert.equal(line(result, /Калитка отдельно стоящая|отдельно стоящей калитки/).price, 15000);
  assert.match(result.title, /каркасы калитки$/);
}

// «вк» и «в+к» — обе конструкции; тип ворот по умолчанию распашной 4 м.
for (const shorthand of ["вк", "в+к"]) {
  const result = quote(["20 " + shorthand, "Итого 93к"]);
  assert.equal(result.total, 93000);
  assert.equal(line(result, /Распашные ворота/).amount, 17000);
  assert.equal(line(result, /Калитка рядом стоящая|рядом стоящей калитки/).amount, 13000);
  assert.equal(line(result, /Профлист|Забор/).price, 2850);
  assert.match(result.title, /каркасы ворот и калитки$/);
}

// Явные цены относятся только к названной позиции, «к» — тысячи.
{
  const result = quote(["100 двойной", "распашные по 20к", "калитка 15к"]);
  assert.equal(line(result, /Профлист двухсторонний|двухстороннее/).price, 2400);
  assert.equal(line(result, /Распашные ворота/).price, 20000);
  assert.equal(line(result, /калит/i).price, 15000);
  assert.equal(result.total, 283000);
}

// «Итого» задаёт целевую сумму, из которой сначала вычитаются допы.
{
  const result = quote(["100 вк", "Итого 300"]);
  assert.equal(result.total, 300000);
  assert.equal(line(result, /Профлист|Забор/).price, 2620);
}

{
  const result = quote(["80 профлист", "откатные", "калитка", "Итого 300 000"]);
  assert.equal(result.total, 300000);
  assert.equal(line(result, /Профлист|Забор/).price, 2625);
}

// Синонимы материалов и конструкций.
{
  const result = quote(["100 проф лист двухстор", "сдвижные 4м по 75 тыс", "калитка за 15 000"]);
  assert.equal(result.lines.filter((item) => item.type === "fence").length, 1);
  assert.equal(line(result, /Профлист двухсторонний|двухстороннее/).price, 2400);
  assert.equal(line(result, /Откатные ворота/).price, 75000);
  assert.equal(line(result, /калит/i).price, 15000);
}

{
  const result = quote(["20х1.8 шахматка", "80х1.8 профлист", "откатные", "калитка"]);
  assert.equal(result.lines.filter((item) => item.type === "fence").length, 2);
  assert.equal(line(result, /шахматка/).quantity, 20);
  assert.equal(line(result, /Профлист односторонний|одностороннее/).quantity, 80);
}

// Страховка на случай, если строка «удлинение» ещё не попала в API-выгрузку
// Google-таблицы: согласованная цена — 300 ₽/м.п., а не нулевой итог.
{
  const pricesWithoutExtension = { ...prices, post_extension_per_m: undefined };
  const result = calculate("80 м профлист\nоткатные\nкалитка\nудлинение столбов 1,5 м", pricesWithoutExtension);
  assert.equal(line(result, /Удлинение/).price, 300);
  assert.equal(line(result, /Удлинение/).amount, 24000);
  assert.equal(result.total, 282000);
}

console.log("calculator tests: ok");
