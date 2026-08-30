import { rub } from "./calculator.js";

const request = document.querySelector("#request");
const calculateButton = document.querySelector("#calculate");
const openPdfButton = document.querySelector("#open-pdf");
const result = document.querySelector("#result");
const source = document.querySelector("#source");
let quote = null;

async function draft(request) {
  const response = await fetch(window.FENCE_DRAFT_API_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ mode: "draft_only", request })
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || !result.valid || !result.quote) throw new Error(result.message || "Прайс временно недоступен. Смета не сформирована.");
  source.textContent = `Прайс: ${result.quote.priceSource || "Цены для Авито"} · версия ${result.quote.priceVersion}`;
  return result.quote;
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
    quote = await draft(request.value);
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
