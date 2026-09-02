import { rub } from "./calculator.js";

const request = document.querySelector("#request");
const calculateButton = document.querySelector("#calculate");
const openPdfButton = document.querySelector("#open-pdf");
const result = document.querySelector("#result");
const source = document.querySelector("#source");
let quote = null;

const escapeHtml = (value) => String(value ?? "").replace(/[&<>'"]/g, (character) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;",
}[character]));

const quoteDate = () => new Intl.DateTimeFormat("ru-RU", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
}).format(new Date());

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

function quoteDocument(current) {
  if (current.document && current.document.layoutVersion === "fence-estimate-v1" && current.document.html) {
    return current.document.html;
  }
  const rows = current.lines.map((line) => {
    const details = Array.isArray(line.descriptionLines) && line.descriptionLines.length
      ? `<ul class="quote-document__details">${line.descriptionLines.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`
      : "";
    return `<tr><td><strong>${escapeHtml(line.title)}</strong>${details}</td><td>${escapeHtml(line.unit)}</td><td>${escapeHtml(line.quantity)}</td><td>${rub(line.price)}</td><td>${rub(line.amount)}</td></tr>`;
  }).join("");
  return `<article class="quote-document" data-layout-version="fence-estimate-v1">
    <header class="quote-document__header">
      <p class="quote-document__eyebrow">ПРЕДВАРИТЕЛЬНЫЙ РАСЧЁТ</p>
      <h2>Смета на устройство забора</h2>
      <p class="quote-document__date">от ${quoteDate()}</p>
    </header>
    <table><thead><tr><th>Работы и материалы</th><th>Ед. изм.</th><th>Кол‑во</th><th>Цена, руб.</th><th>Сумма, руб.</th></tr></thead><tbody>${rows}</tbody><tfoot><tr><th colspan="3">Итого</th><td colspan="2"><span>Включая материалы и работы</span><strong>${rub(current.total)}</strong></td></tr></tfoot></table>
    <footer class="quote-document__notice"><strong>Предварительная смета</strong><p>Действует 7 календарных дней. Окончательная стоимость уточняется после выезда на объект.</p></footer>
  </article>`;
}

const printStyles = `
  *{box-sizing:border-box} body{margin:0;background:#f4f8fc;color:#112d63;font-family:Arial,sans-serif}
  .quote-document{width:100%;max-width:1240px;margin:36px auto;border:1px solid #d5e7f9;background:#fff}
  .quote-document__header{padding:42px 46px 29px;background:#f8fbff;border-bottom:1px solid #d5e7f9}
  .quote-document__eyebrow{margin:0 0 13px;font-size:19px;font-weight:700;color:#345785}.quote-document h2{margin:0;color:#0c2862;font-size:39px;line-height:1.08}.quote-document__date{margin:16px 0 0;color:#42658f;font-size:20px}
  table{width:100%;border-collapse:collapse;table-layout:fixed}th,td{border:1px solid #d5e7f9;padding:13px 16px;vertical-align:middle}thead th{background:#d7e9fb;color:#0d2a60;text-align:center;font-size:18px;font-weight:700}th:first-child,td:first-child{width:50.2%;text-align:left}th:nth-child(2),td:nth-child(2){width:9.8%}th:nth-child(3),td:nth-child(3){width:9.1%}th:nth-child(4),td:nth-child(4){width:14.3%}th:nth-child(5),td:nth-child(5){width:16.6%}td:first-child{font-size:20px;line-height:1.27}td:first-child strong{font-size:22px;color:#102d64}td:not(:first-child){color:#0f2c63;text-align:center;font-size:19px;white-space:nowrap}td:last-child{font-weight:700}.quote-document__details{margin:13px 0 3px;padding:0;list-style:none;color:#43658c;font-size:18px;line-height:1.3}.quote-document__details li{margin:3px 0}.quote-document__details li::before{content:'— ';font-weight:700}tfoot th,tfoot td{border-color:#d5e7f9;background:#d7e9fb;color:#102d64;padding:27px 18px}tfoot th{text-align:right;font-size:28px}tfoot td{display:table-cell;text-align:left;font-size:20px}tfoot td span{margin-right:24px;font-weight:400}tfoot td strong{font-size:30px;white-space:nowrap}.quote-document__notice{padding:28px 40px 25px;background:#f8fbff;color:#345785}.quote-document__notice strong{display:block;color:#112d63;font-size:22px}.quote-document__notice p{margin:13px 0 0;font-size:18px;line-height:1.35}
  @media print{body{background:#fff;-webkit-print-color-adjust:exact;print-color-adjust:exact}.quote-document{max-width:none;margin:0;border:1px solid #d5e7f9}.quote-document__header{padding:22mm 18mm 12mm}.quote-document__eyebrow{font-size:14pt}.quote-document h2{font-size:29pt}.quote-document__date{font-size:14pt}thead th{font-size:12pt}th,td{padding:7pt 8pt}td:first-child{font-size:12pt}td:first-child strong{font-size:13pt}.quote-document__details{font-size:10.5pt;margin-top:7pt}td:not(:first-child){font-size:11.5pt}tfoot th{font-size:18pt}tfoot td{font-size:12pt}tfoot td strong{font-size:20pt}.quote-document__notice{padding:12mm 16mm}.quote-document__notice strong{font-size:15pt}.quote-document__notice p{font-size:12pt}}
`;

function render(current) {
  result.innerHTML = quoteDocument(current);
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
  const css = quote.document && quote.document.layoutVersion === "fence-estimate-v1" && quote.document.css
    ? quote.document.css
    : printStyles;
  printWindow.document.write(`<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>Смета</title><style>${css}</style></head><body class="quote-print">${quoteDocument(quote)}</body></html>`);
  printWindow.document.close();
  printWindow.focus();
  printWindow.print();
});
