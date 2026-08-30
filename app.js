import { calculate, rub } from "./calculator.js";

const request = document.querySelector("#request");
const calculateButton = document.querySelector("#calculate");
const openPdfButton = document.querySelector("#open-pdf");
const result = document.querySelector("#result");
const source = document.querySelector("#source");
let quote = null;

async function prices() {
  if (window.FENCE_PRICE_API_URL) {
    const response = await fetch(window.FENCE_PRICE_API_URL, { cache: "no-store" });
    if (!response.ok) throw new Error("Прайс временно недоступен. Смета не сформирована.");
    const live = await response.json();
    source.textContent = `Прайс: ${live.source || "Цены для Авито"} · версия ${live.version}`;
    return live;
  }
  const local = await fetch("./prices.json", { cache: "no-store" }).then((response) => response.json());
  source.textContent = `Прайс: ${local.version} · контрольная копия (не для боевой отправки)`;
  return local;
}

function render(current) {
  const rows = current.lines.map((line) => `<tr><td>${line.title}</td><td>${line.unit}</td><td>${line.quantity}</td><td>${rub(line.price)}</td><td>${rub(line.amount)}</td></tr>`).join("");
  result.innerHTML = `<h2>${current.title}</h2><table><thead><tr><th>Работы и материалы</th><th>Ед.</th><th>Кол‑во</th><th>Цена</th><th>Сумма</th></tr></thead><tbody>${rows}</tbody><tfoot><tr><th colspan="4">Итого</th><th>${rub(current.total)}</th></tr></tfoot></table><p class="note">Предварительный расчёт. Точная стоимость подтверждается после замера.</p>`;
  result.hidden = false;
  openPdfButton.disabled = false;
}

calculateButton.addEventListener("click", async () => {
  try {
    calculateButton.disabled = true;
    const priceList = await prices();
    quote = calculate(request.value, priceList);
    render(quote);
  } catch (error) {
    result.hidden = false;
    result.innerHTML = `<p class="error">${error.message}</p>`;
  } finally {
    calculateButton.disabled = false;
  }
});

openPdfButton.addEventListener("click", () => {
  if (!quote) return;
  const printWindow = window.open("", "_blank", "noopener,noreferrer");
  if (!printWindow) return;
  printWindow.document.write(`<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>Смета</title><style>body{font:14px Arial;color:#10325f;padding:28px}h1{color:#0879d8}table{border-collapse:collapse;width:100%;margin-top:22px}th,td{border:1px solid #cce0ef;padding:9px;text-align:left}th{background:#edf8ff}tfoot th{background:#dff2ff;font-size:16px}.note{margin-top:18px}</style></head><body>${result.innerHTML}</body></html>`);
  printWindow.document.close();
  printWindow.focus();
  printWindow.print();
});
