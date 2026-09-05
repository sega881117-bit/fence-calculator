define(['jquery', 'underscore'], function ($, _) {
  'use strict';

  // Единый расчётный API в Cloudflare: не зависит от лимита n8n.
  var DRAFT_WEBHOOK_URL = 'https://fence-prices.sega881117.workers.dev/v1/drafts';
  // Адрес прикрепления PDF подставляется только при создании закрытой рабочей сборки.
  // В исходниках GitHub он намеренно пустой.
  var ADD_PDF_WEBHOOK_URL = '';
  var COMPANY_ADVANTAGES = [
    'Проверяем материал микрометром перед установкой',
    'Работаем по официальному договору',
    'Гарантия на забор - 2 года',
    'Устанавливаем забор от 1 дня',
    'Работаем в выходные'
  ];
  var COMPANY_CONTACTS = {
    phone: '+79952229488',
    name: 'Сергей',
    max: 'https://maxln.ru/zabormoskow',
    whatsapp: 'https://wa.me/79952229488',
    telegram: 'https://t.me/79952229488'
  };
  var PANEL_HTML =
    '<section class="fence-assistant" data-fence-assistant>' +
      '<header class="fence-assistant__header"><h2>Помощник</h2></header>' +
      '<label class="fence-assistant__label" for="fence-assistant-request">Что нужно подготовить?</label>' +
      '<textarea id="fence-assistant-request" class="fence-assistant__input" rows="4" maxlength="1000" placeholder="Например: 100 м, 1,8 м, калитка рядом стоящая, доставка 8 000 ₽. Профнастил — по умолчанию."></textarea>' +
      '<p class="fence-assistant__hint">Примеры: 37 м 1,8 по 2000 · распашные 20к · доставка 6к</p>' +
      '<div class="fence-assistant__actions"><button class="fence-assistant__button" type="button" data-draft>Собрать черновик</button><button class="fence-assistant__text-button" type="button" data-clear>Очистить</button></div>' +
      '<section class="fence-assistant__result" data-result hidden aria-live="polite"></section>' +
    '</section>';

  function esc(value) {
    return String(value || '').replace(/[&<>'"]/g, function (character) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[character];
    });
  }

  function cleanLine(value) {
    return String(value || '').replace(/\s*[.;:]+\s*$/, '');
  }

  function getLeadId() {
    var card = typeof APP !== 'undefined' && APP.data && APP.data.current_card;
    return card && Number.isInteger(Number(card.id)) && Number(card.id) > 0 ? Number(card.id) : null;
  }

  function renderReviewCheck(estimate, quote) {
    var extras = quote.line_items.filter(function (item) { return item.section === 'extra'; });
    var delivery = quote.line_items.find(function (item) { return item.section === 'delivery'; });
    var additions = extras.map(function (item) { return cleanLine(item.title).replace(/^Каркас\s+/i, ''); });
    var primary = [
      formatNumber(estimate.length_m) + ' м',
      formatNumber(estimate.height_m) + ' м',
      estimate.material
    ];
    if (additions.length) primary.push(additions.join(', '));
    if (delivery) primary.push('доставка ' + formatRubles(delivery.amount_rub));
    return '<section class="fence-assistant__review-check"><h4>Проверьте параметры</h4><p>' + esc(primary.join(' · ')) + '</p></section>';
  }

  function renderResult($root, result) {
    var $result = $root.find('[data-result]');
    var messages = result && Array.isArray(result.reply_messages) ? result.reply_messages : [];
    var isDraft = result && result.valid === true && result.action === 'draft_reply' && messages.length;
    var isEscalated = result && result.valid === true && result.action === 'escalate';
    var cloudQuote = result && result.valid === true && result.action === 'cloudflare_quote' && result.quote;
    var estimate = result && result.manual_estimate;
    var isManualEstimate = result && result.valid === true && result.action === 'manual_estimate' && estimate;
    if (cloudQuote) {
      var cloudLines = Array.isArray(cloudQuote.lines) ? cloudQuote.lines : [];
      var detailedCloudQuote = {
        heading: cloudQuote.title,
        line_items: cloudLines.map(function (item) {
          return {
            section: item.type,
            title: item.title,
            description_lines: item.descriptionLines || [],
            unit: item.unit,
            quantity: item.quantity,
            unit_price_rub: item.price,
            amount_rub: item.amount
          };
        }),
        total_rub: cloudQuote.total,
        document: cloudQuote.document || null,
        template_note: '',
        advantages: COMPANY_ADVANTAGES,
        contacts: COMPANY_CONTACTS
      };
      $result.removeClass('fence-assistant__result--error').html(
        '<h3>Черновик подробной сметы</h3><p><small>' + esc(cloudQuote.title) + '</small></p>' +
        '<dl class="fence-assistant__estimate-lines">' +
          detailedCloudQuote.line_items.map(renderQuoteLine).join('') +
          '<div class="fence-assistant__estimate-total"><dt>Итого</dt><dd>' + esc(formatRubles(cloudQuote.total)) + '</dd></div>' +
        '</dl>' +
        '<div class="fence-assistant__print-row"><button class="fence-assistant__secondary-button" type="button" data-open-pdf>Открыть PDF</button><button class="fence-assistant__secondary-button" type="button" data-add-pdf>Добавить PDF</button></div>' +
        '<p><small>«Добавить» прикрепит PDF только к этой сделке. Клиенту ничего не отправляется.</small></p>' +
        '<p><small>Прайс: ' + esc(cloudQuote.priceSource || 'Цены для Авито') + ' · версия ' + esc(cloudQuote.priceVersion || '') + '. Сделка и переписка не изменялись.</small></p>'
      ).prop('hidden', false);
      $result.data('fence-assistant-quote', detailedCloudQuote);
      return;
    }
    if (isManualEstimate) {
      var extras = Array.isArray(estimate.extras) ? estimate.extras : [];
      var quote = buildDetailedQuote(estimate);
      var lines = quote.line_items;
      $result.removeClass('fence-assistant__result--error').html(
        '<h3>Черновик подробной сметы</h3><p><small>' + esc(quote.heading) + '</small></p>' +
        '<dl class="fence-assistant__estimate-lines">' +
          lines.map(renderQuoteLine).join('') +
          '<div class="fence-assistant__estimate-total"><dt>Итого</dt><dd>' + esc(formatRubles(quote.total_rub)) + '</dd></div>' +
        '</dl>' +
        renderReviewCheck(estimate, quote) +
        (quote.template_note ? '<p class="fence-assistant__estimate-note"><small>' + esc(quote.template_note) + '</small></p>' : '') +
        '<div class="fence-assistant__print-row"><button class="fence-assistant__secondary-button" type="button" data-open-pdf>Открыть PDF</button><button class="fence-assistant__secondary-button" type="button" data-add-pdf>Добавить PDF</button></div>' +
        '<p><small>«Добавить» прикрепит PDF только к этой сделке. Клиенту ничего не отправляется.</small></p>'
      ).prop('hidden', false);
      $result.data('fence-assistant-quote', quote);
      return;
    }
    if (isDraft) {
      $result.removeClass('fence-assistant__result--error').html(
        '<h3>Черновик готов</h3><div>' + messages.map(function (message) {
          return '<p>' + esc(message) + '</p>';
        }).join('') + '</div><p><small>Это только черновик: сообщение не отправлено.</small></p>'
      ).prop('hidden', false);
      return;
    }
    if (isEscalated) {
      $result.removeClass('fence-assistant__result--error').html(
        '<h3>Нужна ручная проверка</h3><p>Черновик не создан. Сделка и переписка не изменялись.</p>'
      ).prop('hidden', false);
      return;
    }
    renderError($root, 'Черновик не прошёл проверку безопасности. Ничего не отправлено и не изменено.');
  }

  function renderError($root, detail) {
    $root.find('[data-result]').addClass('fence-assistant__result--error').html('<h3>Ничего не изменено</h3><p>' + esc(detail) + '</p>').prop('hidden', false);
  }

  function localDraftFallback(request) {
    // Цены не дублируем в браузере. Единственный источник — Cloudflare API,
    // который читает Google-таблицу «Цены для Авито».
    return {
      valid: false,
      action: 'core_unavailable',
      detail: 'Единое ядро расчёта временно недоступно. Черновик не создан: цены не рассчитывались локально.'
    };
  }

  function requestDraft(request) {
    var deferred = $.Deferred();
    var payload = JSON.stringify({
      mode: 'draft_only',
      lead_id: getLeadId(),
      request: request
    });

    function attempt(isRetry) {
      $.ajax({
        url: DRAFT_WEBHOOK_URL,
        method: 'POST',
        contentType: 'application/json',
        dataType: 'json',
        timeout: 20000,
        data: payload
      }).done(function (response) {
        deferred.resolve(response);
      }).fail(function (xhr) {
        // Короткие сбои сети или обновление Cloudflare не должны сразу
        // лишать менеджера черновика: повторяем запрос только один раз.
        if (!isRetry && (!xhr || xhr.status === 0 || xhr.status >= 500)) {
          window.setTimeout(function () { attempt(true); }, 800);
          return;
        }
        deferred.reject(xhr);
      });
    }

    attempt(false);
    return deferred.promise();
  }

  function formatRubles(value) {
    return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(Math.round(value)) + ' руб.';
  }

  function formatNumber(value) {
    return String(Number(value)).replace('.', ',');
  }

  function standardPostLength(height) {
    var supported = [1.5, 1.8, 2, 2.2, 2.5, 3];
    return supported.some(function (item) { return Math.abs(height - item) < 0.01; }) ? height + 1 : null;
  }

  function lagCount(height) {
    if (height >= 3) return 4;
    if (height >= 2.5) return 3;
    return 2;
  }

  function profileSheetDetails(materialKey, height) {
    var postLength = standardPostLength(height);
    var isThreeMeterFence = Math.abs(height - 3) < 0.01;
    var isTwoSided = /двустор|double/.test(materialKey);
    var hasPaintedFrame = isTwoSided || /покрас[а-яё]*\s+каркас/.test(materialKey);
    var coating = isTwoSided ? 'двухстороннее' : 'одностороннее';
    var colour = pickColour(materialKey, 'RAL 7024');
    var details = [
      'профнастил С8, 0,4 мм, ' + colour + ', НЛМК;',
      postLength
        ? (isThreeMeterFence
          ? 'столбы L-' + formatNumber(postLength) + ' м, 80×80, толщина стенки 3 мм;'
          : 'столбы L-' + formatNumber(postLength) + ' м, 60×60, толщина стенки 2 мм;')
        : 'длину столбов подбираем по высоте забора в калькуляторе;',
      'лаги 40×20, толщина стенки 1,5 мм;',
      'пластиковые заглушки на столбах;',
      'саморезы в цвет профнастила;',
      isThreeMeterFence ? 'забивание столбов на глубину 1,5 м с шагом 2,5 м;' : 'забивание столбов на глубину 1,2 м с шагом 2,5 м;',
      hasPaintedFrame ? 'покраска каркаса: Эмаль Dali 3в1.' : 'грунтовка ГФ-021 светло-серого цвета.'
    ];
    return {
      title: 'Забор из профнастила, покрытие ' + coating + '; высота Н-' + formatNumber(height) + ' м; ' + lagCount(height) + ' лаги.',
      details: details,
      note: postLength ? '' : 'Для этой высоты перед печатью проверьте длину столбов по калькулятору.'
    };
  }

  function fenceFrameDetails(height) {
    var postLength = standardPostLength(height);
    var isThreeMeterFence = Math.abs(height - 3) < 0.01;
    return {
      title: 'Каркас забора; высота Н-' + formatNumber(height) + ' м; ' + lagCount(height) + ' лаги.',
      details: [
        postLength
          ? (isThreeMeterFence
            ? 'столбы L-' + formatNumber(postLength) + ' м, 80×80, толщина стенки 3 мм;'
            : 'столбы L-' + formatNumber(postLength) + ' м, 60×60, толщина стенки 2 мм;')
          : 'длину столбов подбираем по высоте забора в калькуляторе;',
        'лаги 40×20, толщина стенки 1,5 мм;',
        'пластиковые заглушки на столбах;',
        isThreeMeterFence ? 'забивание столбов на глубину 1,5 м с шагом 2,5 м;' : 'забивание столбов на глубину 1,2 м с шагом 2,5 м;',
        'грунтовка ГФ-021 светло-серого цвета.'
      ],
      note: postLength ? '' : 'Для этой высоты перед печатью проверьте длину столбов по калькулятору.'
    };
  }

  function pickColour(materialKey, fallback) {
    var match = materialKey.match(/ral\s*(\d{4})/i);
    return match ? 'RAL ' + match[1] : fallback;
  }

  function euroPalingDetails(materialKey, height) {
    var postLength = standardPostLength(height);
    var isThreeMeterFence = Math.abs(height - 3) < 0.01;
    var isChess = /шахмат/.test(materialKey);
    var isTwoSided = isChess || /двустор/.test(materialKey);
    var hasPaintedFrame = isTwoSided || /покрас[а-яё]*\s+каркас/.test(materialKey);
    var gap = isChess ? 7 : (/5\s*см|5cm/.test(materialKey) ? 5 : 3);
    var order = isChess ? 'Шахматный' : 'Обычный';
    var colour = pickColour(materialKey, 'RAL 7024');
    return {
      title: 'Забор из евроштакетника, покрытие ' + (isTwoSided ? 'двухстороннее' : 'одностороннее') + '; высота Н-' + formatNumber(height) + ' м; ' + lagCount(height) + ' лаги.',
      details: [
        'евроштакетник М-образный, 0,4 мм, ' + colour + ', зазор ' + gap + ' см, порядок ' + order + ';',
        postLength
          ? (isThreeMeterFence
            ? 'столбы L-' + formatNumber(postLength) + ' м, 80×80, толщина стенки 3 мм;'
            : 'столбы L-' + formatNumber(postLength) + ' м, 60×60, толщина стенки 2 мм;')
          : 'длину столбов подбираем по высоте забора в калькуляторе;',
        'лаги 40×20, толщина стенки 1,5 мм;',
        'пластиковые заглушки на столбах;',
        'саморезы в цвет евроштакетника;',
        isThreeMeterFence ? 'забивание столбов на глубину 1,5 м с шагом 2,5 м;' : 'забивание столбов на глубину 1,2 м с шагом 2,5 м;',
        hasPaintedFrame ? 'покраска каркаса: Эмаль Dali 3в1.' : 'грунтовка ГФ-021 светло-серого цвета.'
      ],
      note: postLength ? '' : 'Для этой высоты перед печатью проверьте длину столбов по калькулятору.'
    };
  }

  function rabitsaDetails(materialKey, height) {
    var postLength = [1.5, 1.8, 2].some(function (item) { return Math.abs(height - item) < 0.01; }) ? height + 1 : null;
    var pulls = /2\s*(?:протяж|тяги)/.test(materialKey) ? '2 протяжки' : (/1\s*(?:протяж|тяги)/.test(materialKey) ? '1 протяжка' : 'в натяжку');
    var details = [
      'оцинкованная сетка-рабица с ячейками 50×50 мм, толщина 1,8 мм;',
      postLength
        ? 'столбы L-' + formatNumber(postLength) + ' м, 60×40, толщина стенки 1,5 мм;'
        : 'длину столбов подбираем по высоте забора в калькуляторе;',
      'грунтовка ГФ-021 светло-серого цвета;',
      'пластиковые заглушки на столбах;',
      'забивание столбов на глубину до 1 м с шагом 2,5 м.'
    ];
    if (pulls !== 'в натяжку') details.splice(1, 0, pulls + ' по линии забора;');
    return {
      title: 'Забор из сетки рабицы ' + pulls + '; высота Н-' + formatNumber(height) + ' м.',
      details: details,
      note: postLength ? '' : 'Для этой высоты перед печатью проверьте длину столбов по калькулятору.'
    };
  }

  function threeDDetails(materialKey, height) {
    var postLength = Number(height) + 1.2;
    var colour = pickColour(materialKey, 'RAL 8017');
    return {
      title: 'Забор 3D, высота ' + formatNumber(height) + ' м.',
      details: [
        'секции 3D ' + colour + ', толщина прутка 4 мм;',
        '3 скобы на 1 секцию;',
        'столбы 60×60, L-' + formatNumber(postLength) + ' м, толщина стенки 2 мм, покраска DALI ' + colour + ';',
        'забивание столбов с шагом 2,5 м и заглублением 1,2 м.'
      ],
      note: ''
    };
  }

  function jalousieDetails(materialKey, height) {
    var colour = pickColour(materialKey, 'RAL 8017');
    var postLength = Number(height) + 1.2;
    return {
      title: 'Забор жалюзи; высота Н-' + formatNumber(height) + ' м.',
      details: [
        'ламели Prestige 60, покрытие двухстороннее, ' + colour + ', толщина 0,45 мм;',
        'столбы 60×60, L-' + formatNumber(postLength) + ' м, толщина стенки 2 мм;',
        'пластиковые заглушки на столбах;',
        'забивание столбов на глубину 1,2 м с шагом 2,5 м;',
        'покраска столбов ' + colour + '.'
      ],
      note: ''
    };
  }

  function readWidthFromLabel(label, fallback) {
    var matched = String(label || '').match(/(\d+(?:[.,]\d+)?)\s*м/);
    return matched ? Number(String(matched[1]).replace(',', '.')) : fallback;
  }

  function buildExtraLine(item, height) {
    var label = String(item.label || 'Дополнительная позиция');
    var itemKey = label.toLowerCase();
    var quantity = Number(item.quantity) || 1;
    var line = {
      section: 'extra',
      title: label,
      description_lines: [],
      unit: /покрас.*каркас|удлинен.*столб/.test(itemKey) ? 'м.п.' : 'шт.',
      quantity: quantity,
      unit_price_rub: Number(item.amount_rub),
      amount_rub: Number(item.amount_rub) * quantity
    };
    if (/калитк/.test(itemKey)) {
      var isSeparateWicket = /отдельн|2\s*столб|двух\s*столб/.test(itemKey);
      line.title = isSeparateWicket
        ? 'Каркас отдельно стоящей калитки 1×' + formatNumber(height) + ' м, на двух столбах, открывается наружу.'
        : 'Каркас рядом стоящей калитки 1×' + formatNumber(height) + ' м, на одном столбе, открывается наружу.';
      line.description_lines = [
        'каркас из профтрубы 40×20, толщина стенки 1,5 мм;',
        isSeparateWicket ? 'два столба 80×80, толщина стенки 3 мм;' : 'один столб 80×80, толщина стенки 3 мм;',
        'заглубление на 1,5 м;',
        'петли 25×120 мм;',
        'врезной замок в подарок 🎁.'
      ];
    } else if (/откат/.test(itemKey)) {
      var slidingWidth = readWidthFromLabel(label, 4);
      var isAutomaticSliding = /автомат|rtech/.test(itemKey);
      var driveModelMatch = itemKey.match(/(?:rtech\s*)?(600|1000)\b/);
      var driveModel = isAutomaticSliding && driveModelMatch ? driveModelMatch[1] : '1000';
      if (isAutomaticSliding) {
        line.title = 'Откатные ворота ' + formatNumber(slidingWidth) + '×' + formatNumber(height) + ' м, с автоматическим приводом RTech ' + driveModel + '.';
        line.description_lines = [
          'автоматический привод RTech ' + driveModel + ': мотор, 2 пульта, сигнальная лампа;',
          'рама из профтрубы 60×40, толщина стенки 1,5 мм;',
          'несущая балка; роликовые каретки;',
          'концевой разгрузочный ролик; нижний улавливатель;',
          'направляющая с роликами; верхний улавливатель; заглушки;',
          'опорный столб; ответный столб;',
          'фундамент для роликовых кареток: сваи 89 мм, 2 м, 2 шт. на тумбу.'
        ];
      } else {
        line.title = 'Откатные ворота ' + formatNumber(slidingWidth) + '×' + formatNumber(height) + ' м, с ручным механизмом.';
        line.description_lines = [
          'рама из профтрубы 60×40, толщина стенки 1,5 мм; несущая балка; роликовые каретки;',
          'концевой разгрузочный ролик; нижний улавливатель;',
          'направляющая с роликами; верхний улавливатель; заглушки;',
          'опорный столб; ответный столб;',
          'фундамент для роликовых кареток: сваи 89, 2 шт. на тумбу.'
        ];
      }
    } else if (/распаш|ворот/.test(itemKey)) {
      var swingWidth = readWidthFromLabel(label, 4);
      line.title = 'Каркас распашных ворот ' + formatNumber(swingWidth) + '×' + formatNumber(height) + ' м, открывается наружу.';
      line.description_lines = [
        'каркас из профтрубы 40×20, толщина стенки 1,5 мм;',
        'столбы 80×80, толщина стенки 3 мм;',
        'заглубление на 1,5 м;',
        'изнутри запирающее устройство «гусь» с проушинами для замка;',
        '2 нижних стопора;',
        'петли 25×120 мм.'
      ];
    }
    return line;
  }

  function renderAdvantages(items) {
    return items.map(function (item) {
      return '<li><span class="fence-assistant__line-marker" aria-hidden="true"></span><span>' + esc(item) + '</span></li>';
    }).join('');
  }

  function renderContactLinks(contacts, targetBlank) {
    var target = targetBlank ? ' target="_blank" rel="noopener"' : '';
    return '<nav class="fence-assistant__contact-links" aria-label="Способы связи">' +
      '<a href="' + esc(contacts.max) + '"' + target + '><strong>MAX</strong><span>' + esc(contacts.max) + '</span></a>' +
      '<a href="' + esc(contacts.whatsapp) + '"' + target + '><strong>WhatsApp</strong><span>' + esc(contacts.whatsapp) + '</span></a>' +
      '<a href="' + esc(contacts.telegram) + '"' + target + '><strong>Telegram</strong><span>' + esc(contacts.telegram) + '</span></a>' +
      '</nav>';
  }

  function renderCompanyFooter() {
    return '<section class="fence-assistant__company-footer">' +
      '<h4>Наши преимущества</h4><ul class="fence-assistant__advantages-list">' + renderAdvantages(COMPANY_ADVANTAGES) + '</ul>' +
      '<h4>Контакты</h4><p class="fence-assistant__contact-phone"><a href="tel:' + esc(COMPANY_CONTACTS.phone) + '">' + esc(COMPANY_CONTACTS.phone) + '</a> - ' + esc(COMPANY_CONTACTS.name) + '</p>' +
      renderContactLinks(COMPANY_CONTACTS, true) +
      '</section>';
  }

  function buildDetailedQuote(estimate) {
    var sections = Array.isArray(estimate.sections) ? estimate.sections.filter(function (section) {
      return section && Number(section.length_m) > 0 && Number(section.height_m) > 0 && Number(section.price_per_m) > 0 && String(section.material || '').trim();
    }) : [];
    if (sections.length > 1) {
      var primaryEstimate = $.extend({}, estimate, sections[0]);
      delete primaryEstimate.sections;
      var primaryQuote = buildDetailedQuote(primaryEstimate);
      var fenceLines = sections.map(function (section) {
        var sectionEstimate = $.extend({ extras: [], delivery_rub: 0 }, section);
        return buildDetailedQuote(sectionEstimate).line_items[0];
      });
      var nonFenceLines = primaryQuote.line_items.slice(1);
      primaryQuote.line_items = fenceLines.concat(nonFenceLines);
      var totalLength = sections.reduce(function (sum, section) { return sum + Number(section.length_m); }, 0);
      var headingSuffix = primaryQuote.heading.replace(/^Строительство забора [^,]+ м под ключ/, '');
      primaryQuote.heading = 'Строительство забора ' + formatNumber(totalLength) + ' м под ключ' + headingSuffix;
      primaryQuote.total_rub = primaryQuote.line_items.reduce(function (sum, item) { return sum + Number(item.amount_rub); }, 0);
      primaryQuote.template_note = sections.map(function (section) {
        return buildDetailedQuote($.extend({ extras: [], delivery_rub: 0 }, section)).template_note;
      }).filter(Boolean).join(' ');
      return primaryQuote;
    }
    var material = String(estimate.material || '').trim();
    var materialKey = (material + (estimate.frame_finish === 'dali_3in1' ? ' покраска каркаса' : '')).toLowerCase();
    var height = Number(estimate.height_m);
    var length = Number(estimate.length_m);
    var price = Number(estimate.price_per_m);
    var fenceLine = {
      section: 'fence',
      title: material + '; высота ' + formatNumber(height) + ' м.',
      description_lines: [],
      unit: 'м.п.',
      quantity: length,
      unit_price_rub: price,
      amount_rub: length * price
    };
    var templateNote = '';

    if (/проф/.test(materialKey)) {
      var profile = profileSheetDetails(materialKey, height);
      fenceLine.title = profile.title;
      fenceLine.description_lines = profile.details;
      templateNote = profile.note;
    } else if (/каркас/.test(materialKey)) {
      var frame = fenceFrameDetails(height);
      fenceLine.title = frame.title;
      fenceLine.description_lines = frame.details;
      templateNote = frame.note;
    } else if (/штакет/.test(materialKey)) {
      var euro = euroPalingDetails(materialKey, height);
      fenceLine.title = euro.title;
      fenceLine.description_lines = euro.details;
      templateNote = euro.note;
    } else if (/рабиц/.test(materialKey)) {
      var rabitsa = rabitsaDetails(materialKey, height);
      fenceLine.title = rabitsa.title;
      fenceLine.description_lines = rabitsa.details;
      templateNote = rabitsa.note;
    } else if (/3d|3д/.test(materialKey)) {
      var threeD = threeDDetails(materialKey, height);
      fenceLine.title = threeD.title;
      fenceLine.description_lines = threeD.details;
      templateNote = threeD.note;
    } else if (/жалюзи/.test(materialKey)) {
      var jalousie = jalousieDetails(materialKey, height);
      fenceLine.title = jalousie.title;
      fenceLine.description_lines = jalousie.details;
      templateNote = jalousie.note;
    } else {
      fenceLine.description_lines = [
        'цена и метраж взяты из вашего запроса;',
        'состав материалов для нестандартной комплектации требует ручной проверки.'
      ];
      templateNote = 'Для этого материала виджет не подставляет непроверенные характеристики из шаблона.';
    }

    var extras = Array.isArray(estimate.extras) ? estimate.extras : [];
    var hasGate = extras.some(function (item) { return /распаш|откат|ворот/.test(String(item.label || '').toLowerCase()); });
    var normalizedExtras = extras.map(function (item) {
      var itemKey = String(item.label || '').toLowerCase();
      if (hasGate || !/калитк/.test(itemKey)) return item;
      var copied = $.extend({}, item);
      if (!/отдельн|2\s*столб|двух\s*столб/.test(itemKey)) copied.label = 'Калитка отдельно стоящая (на 2 столбах)';
      return copied;
    });
    var lines = [fenceLine].concat(normalizedExtras.map(function (item) { return buildExtraLine(item, height); }));
    if (Number(estimate.delivery_rub) > 0) {
      lines.push({
        section: 'delivery',
        title: 'Доставка',
        description_lines: [],
        unit: 'усл.',
        quantity: 1,
        unit_price_rub: Number(estimate.delivery_rub),
        amount_rub: Number(estimate.delivery_rub)
      });
    }
    var hasWicket = normalizedExtras.some(function (item) { return /калитк/.test(String(item.label || '').toLowerCase()); });
    var headingSuffix = hasGate && hasWicket
      ? ', включая каркасы ворот и калитки'
      : hasGate
        ? ', включая каркас ворот'
        : hasWicket
          ? ', включая каркас калитки'
          : '';
    return {
      heading: 'Строительство забора ' + formatNumber(length) + ' м под ключ' + headingSuffix,
      line_items: lines,
      total_rub: lines.reduce(function (sum, item) { return sum + item.amount_rub; }, 0),
      template_note: templateNote,
      advantages: COMPANY_ADVANTAGES,
      contacts: COMPANY_CONTACTS
    };
  }

  function renderQuoteLine(item) {
    var description = item.description_lines && item.description_lines.length
      ? '<ul class="fence-assistant__detail-list">' + item.description_lines.map(function (line) { return '<li>' + esc(cleanLine(line)) + '</li>'; }).join('') + '</ul>'
      : '';
    return '<div><dt><strong>' + esc(item.title) + '</strong>' + description +
      '<small>' + esc(item.unit) + ' · ' + esc(formatNumber(item.quantity)) + ' × ' + esc(formatRubles(item.unit_price_rub)) + '</small></dt>' +
      '<dd>' + esc(formatRubles(item.amount_rub)) + '</dd></div>';
  }

  function quotePrintHtml(quote) {
    if (quote.document && quote.document.layoutVersion === 'fence-estimate-v1' && quote.document.html && quote.document.css) {
      return '<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>Смета на устройство забора</title><style>' + quote.document.css + '</style></head><body>' + quote.document.html + '</body></html>';
    }
    var rows = (quote.line_items || []).map(function (item) {
      var details = item.description_lines && item.description_lines.length
        ? '<ul>' + item.description_lines.map(function (line) { return '<li>' + esc(cleanLine(line)) + '</li>'; }).join('') + '</ul>'
        : '';
      return '<tr><td><strong>' + esc(item.title) + '</strong>' + details + '</td><td>' + esc(item.unit) + '</td><td>' + esc(formatNumber(item.quantity)) + '</td><td>' + esc(formatRubles(item.unit_price_rub)) + '</td><td>' + esc(formatRubles(item.amount_rub)) + '</td></tr>';
    }).join('');
    return '<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>' + esc(quote.heading || 'Смета') + '</title><style>' +
      '@page{size:A4;margin:10mm}body{font:12px Arial,sans-serif;color:#1e3347;margin:0;background:#f3f8fb}.page{max-width:1240px;margin:24px auto;padding:28px 32px 34px;background:#fff;box-shadow:0 2px 18px rgba(23,72,106,.12)}.title{margin:0 0 5px;color:#078bd3;font-size:20px;font-weight:700}.table{width:100%;border-collapse:collapse;margin-top:12px}.table th,.table td{border:1px solid #b8d9ec;padding:7px 8px;vertical-align:top}.table th{background:#ebf7fe;font-size:11px;text-align:center}.table td:nth-child(n+2){text-align:center;white-space:nowrap}.table td:last-child{text-align:right}.table ul{margin:4px 0 0;padding:0;list-style:none;color:#3d5970;line-height:1.3}.table li{margin:1px 0}.table li::before{content:"–";display:inline-block;width:12px;text-align:center;color:#3d5970}.total td{background:#e1f3fd;font-size:15px;font-weight:700;text-align:right!important}.total td:first-child{color:#078bd3}.note{margin-top:12px;color:#536f85;font-size:10px}.footer{margin-top:18px;padding:10px;border:1px solid #b8d9ec;background:#f7fcff}.footer b{color:#078bd3}@media(max-width:700px){.page{margin:0;padding:16px;box-shadow:none}.table{font-size:10px}.table th,.table td{padding:5px 4px}}@media print{body{background:#fff;print-color-adjust:exact;-webkit-print-color-adjust:exact}.page{max-width:none;margin:0;padding:0;box-shadow:none}}' +
      '</style></head><body><main class="page"><h1 class="title">' + esc(quote.heading || 'Смета') + '</h1><table class="table"><thead><tr><th>Работы и материалы</th><th>Ед. изм.</th><th>Кол-во</th><th>Цена, руб.</th><th>Сумма, руб.</th></tr></thead><tbody>' + rows + '<tr class="total"><td colspan="4">Итого:</td><td>' + esc(formatRubles(quote.total_rub)) + '</td></tr></tbody></table><p class="note">Точная стоимость и состав работ подтверждаются после выездного замера.</p><section class="footer"><b>Наши преимущества</b><br>Проверяем материал микрометром перед установкой<br>Работаем по официальному договору<br>Гарантия на забор — 2 года<br>Устанавливаем забор от 1 дня</section></main></body></html>';
  }

  // The estimate opens in a separate tab and does not depend on n8n.
  function openPdfPreview($root) {
    var quote = $root.find('[data-result]').data('fence-assistant-quote');
    if (!quote) {
      renderError($root, 'Не удалось определить смету для просмотра. Ничего не отправлено и не добавлено.');
      return;
    }
    var previewWindow = window.open('', '_blank');
    if (!previewWindow) return;
    previewWindow.document.write(quotePrintHtml(quote));
    previewWindow.document.close();
    previewWindow.focus();
    window.setTimeout(function () { previewWindow.focus(); }, 50);
  }

  function textLines(context, text, maxWidth) {
    var words = String(text || '').split(/\s+/).filter(Boolean);
    var lines = [];
    var current = '';
    words.forEach(function (word) {
      var next = current ? current + ' ' + word : word;
      if (current && context.measureText(next).width > maxWidth) {
        lines.push(current);
        current = word;
      } else current = next;
    });
    if (current) lines.push(current);
    return lines.length ? lines : [''];
  }

  function base64FromBytes(bytes) {
    var result = '';
    var chunk = 0x8000;
    for (var i = 0; i < bytes.length; i += chunk) {
      result += String.fromCharCode.apply(null, bytes.subarray(i, Math.min(i + chunk, bytes.length)));
    }
    return window.btoa(result);
  }

  // Формируем настоящий PDF в браузере: русские буквы сначала рисуются на
  // холсте, затем страницы встраиваются в PDF. Поэтому n8n и внешний сервис
  // конвертации не нужны, а PDF одинаково читается в файлах amoCRM.
  function pdfFromJpegs(pages) {
    var encoder = new TextEncoder();
    var objects = [];
    var pageRefs = pages.map(function (_, index) { return 3 + index * 3; });
    objects[1] = encoder.encode('<< /Type /Catalog /Pages 2 0 R >>');
    objects[2] = encoder.encode('<< /Type /Pages /Kids [' + pageRefs.map(function (id) { return id + ' 0 R'; }).join(' ') + '] /Count ' + pages.length + ' >>');
    pages.forEach(function (page, index) {
      var pageId = 3 + index * 3;
      var contentId = pageId + 1;
      var imageId = pageId + 2;
      var content = encoder.encode('q\n595 0 0 842 0 0 cm\n/Im1 Do\nQ\n');
      objects[pageId] = encoder.encode('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /XObject << /Im1 ' + imageId + ' 0 R >> >> /Contents ' + contentId + ' 0 R >>');
      objects[contentId] = [encoder.encode('<< /Length ' + content.length + ' >>\nstream\n'), content, encoder.encode('endstream')];
      objects[imageId] = [encoder.encode('<< /Type /XObject /Subtype /Image /Width ' + page.width + ' /Height ' + page.height + ' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ' + page.jpeg.length + ' >>\nstream\n'), page.jpeg, encoder.encode('\nendstream')];
    });
    var chunks = [encoder.encode('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n')];
    var offsets = [0];
    var position = chunks[0].length;
    for (var objectId = 1; objectId < objects.length; objectId += 1) {
      offsets[objectId] = position;
      var head = encoder.encode(objectId + ' 0 obj\n');
      chunks.push(head); position += head.length;
      var object = objects[objectId];
      var parts = Array.isArray(object) ? object : [object];
      parts.forEach(function (part) { chunks.push(part); position += part.length; });
      var tail = encoder.encode('\nendobj\n');
      chunks.push(tail); position += tail.length;
    }
    var xrefAt = position;
    var xref = 'xref\n0 ' + objects.length + '\n0000000000 65535 f \n';
    for (var id = 1; id < objects.length; id += 1) xref += String(offsets[id]).padStart(10, '0') + ' 00000 n \n';
    var trailer = encoder.encode(xref + 'trailer\n<< /Size ' + objects.length + ' /Root 1 0 R >>\nstartxref\n' + xrefAt + '\n%%EOF');
    chunks.push(trailer); position += trailer.length;
    var output = new Uint8Array(position);
    var cursor = 0;
    chunks.forEach(function (part) { output.set(part, cursor); cursor += part.length; });
    return output;
  }

  function buildPdfBytes(quote) {
    return new Promise(function (resolve, reject) {
      try {
        var width = 1240, height = 1754, left = 54, right = 54, top = 58, bottom = 54;
        var pages = [];
        var canvas, context, y;
        function freshPage(pageNumber) {
          canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
          context = canvas.getContext('2d');
          context.fillStyle = '#ffffff'; context.fillRect(0, 0, width, height);
          context.fillStyle = '#078bd3'; context.font = '700 28px Arial';
          context.fillText(String(quote.heading || 'Смета'), left, top);
          context.strokeStyle = '#b8d9ec'; context.lineWidth = 1;
          context.fillStyle = '#ebf7fe'; context.fillRect(left, top + 28, width - left - right, 38);
          context.strokeRect(left, top + 28, width - left - right, 38);
          context.fillStyle = '#1e3347'; context.font = '700 14px Arial';
          var heads = ['Работы и материалы', 'Ед. изм.', 'Кол-во', 'Цена, руб.', 'Сумма, руб.'];
          var cols = [left, 786, 878, 966, 1090, width - right];
          heads.forEach(function (head, index) { context.fillText(head, cols[index] + 8, top + 52); });
          y = top + 66;
          return { canvas: canvas, context: context, cols: cols, pageNumber: pageNumber };
        }
        var page = freshPage(1);
        function savePage() {
          context.fillStyle = '#607c92'; context.font = '12px Arial';
          context.fillText('Предварительная смета. Точная стоимость подтверждается после замера.', left, height - 28);
          pages.push({ width: width, height: height, jpeg: Uint8Array.from(atob(canvas.toDataURL('image/jpeg', 0.92).split(',')[1]), function (char) { return char.charCodeAt(0); }) });
        }
        function rowMetrics(item) {
          context.font = '700 16px Arial';
          var title = textLines(context, item.title, 702);
          context.font = '14px Arial';
          var details = [];
          (item.description_lines || []).forEach(function (line) { details = details.concat(textLines(context, '• ' + cleanLine(line), 702)); });
          return { title: title, details: details, height: Math.max(68, 18 + title.length * 21 + details.length * 17 + 14) };
        }
        (quote.line_items || []).forEach(function (item) {
          var metrics = rowMetrics(item);
          if (y + metrics.height > height - 108) { savePage(); page = freshPage(pages.length + 1); }
          var cols = page.cols;
          context.strokeStyle = '#b8d9ec'; context.strokeRect(left, y, width - left - right, metrics.height);
          cols.slice(1, -1).forEach(function (x) { context.beginPath(); context.moveTo(x, y); context.lineTo(x, y + metrics.height); context.stroke(); });
          context.fillStyle = '#1e3347'; context.font = '700 16px Arial';
          metrics.title.forEach(function (line, index) { context.fillText(line, left + 9, y + 21 + index * 21); });
          context.font = '14px Arial'; context.fillStyle = '#3d5970';
          metrics.details.forEach(function (line, index) { context.fillText(line, left + 9, y + 21 + metrics.title.length * 21 + index * 17); });
          context.fillStyle = '#1e3347'; context.font = '15px Arial';
          var values = [item.unit, formatNumber(item.quantity), formatRubles(item.unit_price_rub), formatRubles(item.amount_rub)];
          values.forEach(function (value, index) { context.fillText(value, cols[index + 1] + 9, y + 30); });
          y += metrics.height;
        });
        if (y + 56 > height - 108) { savePage(); page = freshPage(pages.length + 1); }
        context.fillStyle = '#e1f3fd'; context.fillRect(left, y, width - left - right, 52);
        context.strokeStyle = '#b8d9ec'; context.strokeRect(left, y, width - left - right, 52);
        context.fillStyle = '#078bd3'; context.font = '700 20px Arial'; context.fillText('Итого:', 970, y + 33);
        context.fillStyle = '#1e3347'; context.fillText(formatRubles(quote.total_rub), 1092, y + 33);
        savePage();
        resolve(pdfFromJpegs(pages));
      } catch (error) { reject(error); }
    });
  }

  function addPdfToLead($root, $button) {
    var quote = $root.find('[data-result]').data('fence-assistant-quote');
    var leadId = getLeadId();
    if (!quote || !leadId) {
      renderError($root, 'Не удалось определить смету или текущую сделку. Ничего не добавлено.');
      return;
    }
    if (!ADD_PDF_WEBHOOK_URL) {
      renderError($root, 'Добавление PDF настраивается только в закрытой рабочей сборке. Клиенту ничего не отправлено.');
      return;
    }
    $button.prop('disabled', true).text('Добавляем…');
    $.ajax({
      url: ADD_PDF_WEBHOOK_URL,
      method: 'POST',
      contentType: 'application/json',
      // Старый webhook завершается 200 без тела ответа. Не заставляем
      // браузер считать успешный запуск ошибкой из-за пустого JSON.
      dataType: 'text',
      data: JSON.stringify({
        mode: 'attach_pdf_to_lead',
        lead_id: leadId,
        quote: quote
      })
    }).done(function (response) {
      var parsed = response;
      if (typeof response === 'string' && response) {
        try { parsed = JSON.parse(response); } catch (ignore) { parsed = null; }
      }
      if (!response || (parsed && parsed.ok === true && parsed.attached === true)) {
        $root.find('[data-result] [data-pdf-status]').remove();
        $root.find('[data-result]').append('<p class="fence-assistant__pdf-status" data-pdf-status><small>PDF добавлен в файлы этой сделки. Клиенту ничего не отправлялось.</small></p>');
      } else {
        renderError($root, 'PDF не был добавлен. Ничего не отправлено клиенту и не изменено в сделке.');
      }
    }).fail(function (error) {
      var response = error && (error.responseJSON || error);
      var reason = response && response.error;
      var message = 'Не удалось добавить PDF. Клиенту ничего не отправлено.';
      if (reason === 'lead_not_allowed') message = 'PDF можно добавить только в тестовую сделку. Для этой сделки прикрепление заблокировано.';
      else if (error && error.message) message = 'Не удалось сформировать PDF: ' + error.message;
      renderError($root, message);
    }).always(function () {
      $button.prop('disabled', false).text('Добавить PDF');
    });
  }

  return function () {
    var self = this;

    this.callbacks = {
      render: function () {
        self.render_template({
          body: PANEL_HTML,
          caption: { class_name: 'fence-assistant-caption' },
          render: ''
        });

        return true;
      },

      init: function () {
        var settings = self.get_settings ? self.get_settings() : {};
        var assetBase = settings.path || self.params.path || '';
        var cssUrl = assetBase + '/style.css?v=' + (settings.version || self.get_version());
        if (cssUrl && !$('link[data-fence-assistant-style]').length) {
          $('<link>', {
            rel: 'stylesheet',
            href: cssUrl,
            'data-fence-assistant-style': 'true'
          }).appendTo('head');
        }
        return true;
      },

      bind_actions: function () {
        var $widget = $('[data-fence-assistant]');
        if (!$widget.length || $widget.data('fence-assistant-ready')) return true;

        $widget.data('fence-assistant-ready', true);
          $widget.on('click', '[data-clear]', function () {
            $widget.find('#fence-assistant-request').val('').focus();
            $widget.find('[data-result]').prop('hidden', true).empty();
          });


          $widget.on('click', '[data-add-pdf]', function () {
            addPdfToLead($widget, $(this));
          });

          $widget.on('click', '[data-open-pdf]', function () {
            openPdfPreview($widget);
          });

          $widget.on('click', '[data-draft]', function () {
            var $button = $(this);
            var request = String($widget.find('#fence-assistant-request').val() || '').trim();
            if (!request) return renderError($widget, 'Опишите, что нужно рассчитать. Сообщение клиенту отправлено не будет.');
            $button.prop('disabled', true).text('Подготавливаем…');
            requestDraft(request).done(function (response) {
              renderResult($widget, response);
            }).fail(function (xhr) {
              var message = xhr && xhr.responseJSON && xhr.responseJSON.message;
              renderError($widget, message || localDraftFallback(request).detail);
            }).always(function () {
              $button.prop('disabled', false).text('Собрать черновик');
            });
          });

        return true;
      },

      settings: function () { return true; },
      onSave: function () { return true; },
      destroy: function () { return true; }
    };

    return this;
  };
});
