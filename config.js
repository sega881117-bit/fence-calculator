// Цены выдаёт Cloudflare Worker из закрытой таблицы «Цены для Авито».
// В браузер попадает только результат чтения, без ключа сервисного аккаунта.
window.FENCE_PRICE_API_URL = "https://fence-prices.sega881117.workers.dev/v1/prices";
window.FENCE_DRAFT_API_URL = "https://fence-prices.sega881117.workers.dev/v1/drafts";
