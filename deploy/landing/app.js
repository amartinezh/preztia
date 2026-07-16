/* Landing de Preztia — portal "pulso financiero" sin dependencias.
 * Resuelve la URL del API a partir del host (api.<dominio>), trae titulares (/public/news) e
 * indicadores (/public/market) y pinta una portada editorial viva: cinta de mercado en
 * movimiento, nota principal, secciones por tema, sparkline, datos curiosos rotativos y
 * refresco automático. Degrada con elegancia si el API no responde. */

(function () {
  'use strict';

  var host = location.hostname.replace(/^www\./, '');
  var isLocal = host === 'localhost' || host === '127.0.0.1';
  // En https usa api.<dominio>; en desarrollo local pega directo al API; en file:// modo demo.
  var API_BASE =
    location.protocol === 'https:' ? 'https://api.' + host
    : isLocal ? 'http://localhost:3010'
    : '';
  var APP_URL = location.protocol === 'https:' ? 'https://app.' + host : '#';

  var REFRESH_MS = 5 * 60 * 1000; // re-consulta del API
  var RELTIME_MS = 60 * 1000; //     "hace X min" al día
  var FACT_MS = 10 * 1000; //        rotación de curiosidades
  var FRONT_LIST_COUNT = 5; //       titulares junto a la nota principal
  var SECTION_ITEMS = 6; //          titulares por sección temática

  // Colores editoriales por sección (estilo kicker de diario, con contraste sobre fondo blanco);
  // paleta de reserva para temas nuevos.
  var TOPIC_COLORS = {
    'Economía': '#0e9f6e',
    'Finanzas y crédito': '#2563eb',
    'Mercados': '#7c3aed',
    'Criptomonedas': '#d97706',
    'Fintech': '#0891b2',
    'PIX y pagos': '#db2777',
  };
  var FALLBACK_COLORS = ['#0e9f6e', '#2563eb', '#7c3aed', '#d97706', '#0891b2', '#db2777'];

  // Datos curiosos del mundo del dinero: contenido propio, atemporal y verificable.
  var FACTS = [
    'La palabra «salario» viene del latín salarium: parte del pago de los soldados romanos se entregaba en sal, un bien escaso y valioso.',
    'El primer papel moneda del mundo se emitió en China hace más de mil años; Europa tardó siglos en adoptarlo: Suecia lo introdujo en 1661.',
    'La primera bolsa de valores moderna nació en Ámsterdam en 1602, para negociar acciones de la Compañía Neerlandesa de las Indias Orientales.',
    'El símbolo $ es anterior al dólar estadounidense: proviene del peso hispanoamericano, el «real de a ocho» que circuló por medio mundo.',
    'La TRM (tasa representativa del mercado) se calcula y certifica cada día hábil en Colombia con las operaciones reales de compra y venta de dólares.',
    'En Colombia la tasa de usura se certifica cada mes: prestar por encima de ese tope es delito. Por eso el crédito formal publica siempre su tasa.',
    'PIX, el sistema de pagos instantáneos de Brasil, funciona 24/7 desde 2020 y liquida una transferencia en segundos, incluso festivos.',
    'El real brasileño nació en 1994 con el Plano Real, para frenar una inflación que llegó a superar el 2.000 % anual.',
    'Bitcoin tiene una oferta máxima de 21 millones de monedas; se estima que la última fracción se minará alrededor del año 2140.',
    'Al interés compuesto se le llama a veces «la octava maravilla del mundo», una frase que se atribuye —sin evidencia— a Albert Einstein.',
    'Cuenta la historia que la primera tarjeta de crédito moderna (Diners Club, 1950) nació después de que su creador olvidara la billetera al pagar una cena.',
    'Un «unicornio» es una empresa emergente valorada en más de US$1.000 millones antes de salir a bolsa. El término se acuñó en 2013.',
    'La UVR ajusta a diario el valor de los créditos de vivienda en Colombia según la inflación certificada del mes anterior.',
    'El «gota a gota» debe su nombre a la forma de pago: abonos pequeños y frecuentes, muchas veces diarios, como gotas que llenan un balde.',
    '«Fintech» combina finance y technology. América Latina es una de las regiones donde este sector crece más rápido en el mundo.',
    'El billete de mayor denominación jamás impreso fue el de 100 trillones de pengő en Hungría (1946), en la peor hiperinflación registrada.',
  ];

  var newsSnapshot = null;
  var marketSnapshot = null;
  var lastTapeJson = '';

  // Se crea ANTES del arranque: observeReveals() lo usa de inmediato (con `var` más abajo
  // estaría aún undefined y el TypeError abortaría todo el script).
  var revealObserver = new IntersectionObserver(
    function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add('in');
          revealObserver.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.08 }
  );

  /* ===== Arranque ===== */

  ['nav-login', 'band-login', 'subscriber-link'].forEach(function (id) {
    var el = document.getElementById(id);
    if (el) el.setAttribute('href', APP_URL);
  });

  document.getElementById('year').textContent = String(new Date().getFullYear());
  document.getElementById('today').textContent = new Date().toLocaleDateString('es-CO', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });

  var clock = document.getElementById('live-clock');
  function tick() {
    clock.textContent = new Date().toLocaleTimeString('es-CO', { hour12: false });
  }
  tick();
  setInterval(tick, 1000);

  startFacts();
  observeReveals();
  loadAll();
  setInterval(loadAll, REFRESH_MS);
  setInterval(refreshRelativeTimes, RELTIME_MS);

  /* ===== Carga de datos ===== */

  function loadAll() {
    if (!API_BASE) {
      renderNewsEmpty('El pulso del sector aparecerá aquí en producción.');
      renderTapeEmpty('Indicadores de mercado disponibles en producción.');
      setText('live-updated', 'Pulso del sector: en espera');
      return;
    }
    fetchJson('/public/news').then(
      function (data) {
        newsSnapshot = data;
        renderNews(data);
      },
      function () {
        if (!newsSnapshot) renderNewsEmpty('No pudimos cargar los titulares ahora. Vuelve a intentarlo en un momento.');
      }
    );
    fetchJson('/public/market').then(
      function (data) {
        marketSnapshot = data;
        renderMarket(data);
      },
      function () {
        if (!marketSnapshot) renderTapeEmpty('Indicadores no disponibles por ahora.');
      }
    );
  }

  function fetchJson(path) {
    return fetch(API_BASE + path, { headers: { accept: 'application/json' } }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    });
  }

  /* ===== Titulares: portada + secciones ===== */

  function renderNews(data) {
    var items = (data && data.sector) || [];
    if (!items.length) {
      renderNewsEmpty('Sin titulares por ahora.');
      return;
    }

    var lead = items[0];
    var frontItems = items.slice(1, 1 + FRONT_LIST_COUNT);
    var usedLinks = {};
    usedLinks[lead.link] = true;
    frontItems.forEach(function (it) {
      usedLinks[it.link] = true;
    });

    renderLead(lead);
    renderFrontList(frontItems);
    renderSections(items, usedLinks);
    renderTopics(items);
    renderChangelog((data && data.platform) || []);

    var live = document.getElementById('live-updated');
    if (data && data.updatedAt && live) {
      live.dataset.time = data.updatedAt;
      live.dataset.prefix = 'Pulso del sector: actualizado ';
    } else {
      setText('live-updated', 'Pulso del sector: actualizado hoy');
    }
    refreshRelativeTimes();
  }

  function renderLead(item) {
    var lead = document.getElementById('lead-story');
    lead.innerHTML = '';
    lead.removeAttribute('aria-busy');
    lead.style.setProperty('--kick', topicColor(item.topic));

    var kicker = el('span', 'kicker', item.topic || 'Portada');

    var a = document.createElement('a');
    a.href = item.link;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.appendChild(el('span', 'lead-title', item.title));

    var meta = buildMeta(item);
    var cta = el('span', 'lead-cta', 'Leer en la fuente →');
    a.appendChild(cta);

    lead.appendChild(kicker);
    lead.appendChild(a);
    lead.appendChild(meta);
  }

  function renderFrontList(items) {
    var list = document.getElementById('front-list');
    list.innerHTML = '';
    list.removeAttribute('aria-busy');
    items.forEach(function (item) {
      var a = document.createElement('a');
      a.className = 'front-item';
      a.href = item.link;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      a.style.setProperty('--kick', topicColor(item.topic));
      a.appendChild(el('span', 'kicker', item.topic || ''));
      a.appendChild(el('div', 'n-title', item.title));
      a.appendChild(buildMeta(item));
      list.appendChild(a);
    });
  }

  function renderSections(items, usedLinks) {
    var byTopic = {};
    var order = [];
    items.forEach(function (item) {
      if (usedLinks[item.link]) return;
      var topic = item.topic || 'Sector';
      if (!byTopic[topic]) {
        byTopic[topic] = [];
        order.push(topic);
      }
      if (byTopic[topic].length < SECTION_ITEMS) byTopic[topic].push(item);
    });

    var root = document.getElementById('secciones');
    root.innerHTML = '';
    order.forEach(function (topic) {
      var section = document.createElement('section');
      section.className = 'news-section reveal';
      section.id = 'sec-' + slug(topic);
      section.style.setProperty('--kick', topicColor(topic));

      var head = el('div', 'section-head', null);
      head.appendChild(el('span', 'kicker', topic));
      head.appendChild(el('span', 'rule', null));
      section.appendChild(head);

      var grid = el('div', 'section-grid', null);
      byTopic[topic].forEach(function (item) {
        var a = document.createElement('a');
        a.className = 'sec-item';
        a.href = item.link;
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        a.appendChild(el('div', 'n-title', item.title));
        a.appendChild(buildMeta(item));
        grid.appendChild(a);
      });
      section.appendChild(grid);
      root.appendChild(section);
      revealObserver.observe(section);
    });
  }

  function renderTopics(items) {
    var counts = {};
    var order = [];
    items.forEach(function (item) {
      var topic = item.topic || 'Sector';
      if (!counts[topic]) order.push(topic);
      counts[topic] = (counts[topic] || 0) + 1;
    });
    var chips = document.getElementById('topics-chips');
    chips.innerHTML = '';
    order.forEach(function (topic) {
      var a = document.createElement('a');
      a.className = 'chip';
      a.href = '#sec-' + slug(topic);
      a.style.setProperty('--kick', topicColor(topic));
      a.textContent = topic + ' · ' + counts[topic];
      chips.appendChild(a);
    });
  }

  function renderChangelog(entries) {
    var ol = document.getElementById('changelog-list');
    ol.innerHTML = '';
    entries.forEach(function (e) {
      var li = document.createElement('li');
      li.appendChild(el('div', 't-tag', e.tag || ''));
      li.appendChild(el('div', 't-title', e.title));
      li.appendChild(el('div', 't-desc', e.description || ''));
      li.appendChild(el('div', 't-date', e.date || ''));
      ol.appendChild(li);
    });
  }

  function renderNewsEmpty(msg) {
    var lead = document.getElementById('lead-story');
    lead.innerHTML = '';
    lead.removeAttribute('aria-busy');
    lead.appendChild(el('div', 'news-empty', msg));
    var list = document.getElementById('front-list');
    list.innerHTML = '';
    list.removeAttribute('aria-busy');
    document.getElementById('topics-chips').innerHTML = '';
  }

  function buildMeta(item) {
    var meta = el('div', 'n-meta', null);
    meta.appendChild(el('span', 'n-source', item.source || 'Fuente'));
    if (item.publishedAt) {
      var t = el('span', null, '');
      t.dataset.time = item.publishedAt;
      t.dataset.prefix = '· ';
      meta.appendChild(t);
    }
    return meta;
  }

  /* ===== Indicadores: cinta + panel con sparkline ===== */

  function renderMarket(data) {
    var indicators = (data && data.indicators) || [];
    if (!indicators.length) {
      renderTapeEmpty('Indicadores no disponibles por ahora.');
      return;
    }
    renderTape(indicators);
    renderIndicatorPanel(indicators);

    var pill = document.getElementById('market-updated');
    if (data.updatedAt && pill) {
      pill.dataset.time = data.updatedAt;
      pill.dataset.prefix = 'actualizado ';
    }
    refreshRelativeTimes();
  }

  function renderTape(indicators) {
    // Evita reiniciar la animación del marquee si los valores no cambiaron.
    var json = JSON.stringify(indicators.map(function (i) { return [i.id, i.value, i.changePct]; }));
    if (json === lastTapeJson) return;
    lastTapeJson = json;

    var track = document.getElementById('tape-track');
    track.innerHTML = '';
    // El contenido se duplica para que el desplazamiento a -50% enlace sin salto.
    [0, 1].forEach(function (copy) {
      indicators.forEach(function (ind) {
        var item = el('span', 'tape-item', null);
        if (copy === 1) item.setAttribute('aria-hidden', 'true');
        item.appendChild(el('span', 't-label', ind.label));
        item.appendChild(el('span', 't-value', formatValue(ind.value, ind.unit)));
        item.appendChild(el('span', 't-chg ' + trendClass(ind.changePct), formatChange(ind.changePct)));
        track.appendChild(item);
      });
    });
    track.style.setProperty('--tape-secs', Math.max(30, indicators.length * 6) + 's');
  }

  function renderTapeEmpty(msg) {
    var track = document.getElementById('tape-track');
    track.innerHTML = '';
    track.appendChild(el('span', 'tape-loading', msg));
  }

  function renderIndicatorPanel(indicators) {
    // El protagonista del panel es el primer indicador con serie histórica (la TRM);
    // si ninguno trae serie, el primero de la lista.
    var hero = null;
    for (var i = 0; i < indicators.length; i++) {
      if (indicators[i].series && indicators[i].series.length >= 2) {
        hero = indicators[i];
        break;
      }
    }
    if (!hero) hero = indicators[0];

    renderIndicatorHero(hero);

    var list = document.getElementById('ind-list');
    list.innerHTML = '';
    indicators.forEach(function (ind) {
      if (ind.id === hero.id) return;
      var li = document.createElement('li');
      li.appendChild(el('span', 'il-label', ind.label));
      li.appendChild(el('span', 'il-value', formatValue(ind.value, ind.unit)));
      li.appendChild(el('span', 'il-chg ' + trendClass(ind.changePct), formatChange(ind.changePct)));
      list.appendChild(li);
    });
  }

  function renderIndicatorHero(ind) {
    var box = document.getElementById('ind-hero');
    box.innerHTML = '';
    box.appendChild(el('div', 'ih-label', ind.label));

    var value = el('div', 'ih-value', formatValue(ind.value, ind.unit));
    box.appendChild(value);
    animateValue(value, ind.value, ind.unit);

    box.appendChild(el('div', 'ih-chg ' + trendClass(ind.changePct), formatChange(ind.changePct)));

    if (ind.series && ind.series.length >= 2) {
      box.appendChild(buildSparkline(ind.series, trendClass(ind.changePct) === 'down'));
    }
    if (ind.asOf) {
      var asof = el('div', 'ih-asof', '');
      asof.dataset.time = ind.asOf;
      asof.dataset.prefix = 'Dato ';
      box.appendChild(asof);
    }
  }

  /** Sparkline SVG (línea + área) con animación de trazo vía pathLength normalizado. */
  function buildSparkline(series, isDown) {
    var W = 300;
    var H = 56;
    var PAD = 3;
    var min = Math.min.apply(null, series);
    var max = Math.max.apply(null, series);
    var span = max - min || 1;
    var points = series.map(function (v, i) {
      var x = PAD + (i * (W - 2 * PAD)) / (series.length - 1);
      var y = H - PAD - ((v - min) / span) * (H - 2 * PAD);
      return [Math.round(x * 10) / 10, Math.round(y * 10) / 10];
    });

    var NS = 'http://www.w3.org/2000/svg';
    var svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
    svg.setAttribute('preserveAspectRatio', 'none');
    svg.setAttribute('aria-hidden', 'true');

    var color = isDown ? '#d92d3f' : '#0e9f6e';
    var gradId = 'sparkfill-' + Math.random().toString(36).slice(2, 8);
    var defs = document.createElementNS(NS, 'defs');
    var grad = document.createElementNS(NS, 'linearGradient');
    grad.setAttribute('id', gradId);
    grad.setAttribute('x1', '0');
    grad.setAttribute('y1', '0');
    grad.setAttribute('x2', '0');
    grad.setAttribute('y2', '1');
    [['0%', '.30'], ['100%', '0']].forEach(function (stop) {
      var s = document.createElementNS(NS, 'stop');
      s.setAttribute('offset', stop[0]);
      s.setAttribute('stop-color', color);
      s.setAttribute('stop-opacity', stop[1]);
      grad.appendChild(s);
    });
    defs.appendChild(grad);
    svg.appendChild(defs);

    var lineStr = points.map(function (p) { return p[0] + ',' + p[1]; }).join(' ');
    var area = document.createElementNS(NS, 'path');
    area.setAttribute(
      'd',
      'M' + points[0][0] + ',' + (H - PAD) + ' L' + lineStr.replace(/ /g, ' L') + ' L' + points[points.length - 1][0] + ',' + (H - PAD) + ' Z'
    );
    area.setAttribute('fill', 'url(#' + gradId + ')');
    area.setAttribute('class', 'spark-area');
    svg.appendChild(area);

    var line = document.createElementNS(NS, 'polyline');
    line.setAttribute('points', lineStr);
    line.setAttribute('pathLength', '100');
    line.setAttribute('class', 'spark-line' + (isDown ? ' down-line' : ''));
    svg.appendChild(line);

    return svg;
  }

  /** Cuenta regresiva suave del valor grande: da sensación de dato "aterrizando" en vivo. */
  function animateValue(node, target, unit) {
    var start = target * 0.985;
    var t0 = null;
    var DURATION = 900;
    function step(ts) {
      if (t0 === null) t0 = ts;
      var p = Math.min(1, (ts - t0) / DURATION);
      var eased = 1 - Math.pow(1 - p, 3);
      node.textContent = formatValue(start + (target - start) * eased, unit);
      if (p < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }

  /* ===== ¿Sabías que…? ===== */

  function startFacts() {
    var text = document.getElementById('fact-text');
    var count = document.getElementById('fact-count');
    var bar = document.getElementById('fact-progress');
    var index = Math.floor(Math.random() * FACTS.length);

    function show() {
      text.textContent = FACTS[index];
      count.textContent = index + 1 + '/' + FACTS.length;
      bar.classList.remove('running');
      void bar.offsetWidth; // reinicia la animación de la barra de progreso
      bar.style.setProperty('--fact-secs', FACT_MS / 1000 + 's');
      bar.classList.add('running');
    }

    function next() {
      index = (index + 1) % FACTS.length;
      text.classList.add('fading');
      setTimeout(function () {
        show();
        text.classList.remove('fading');
      }, 450);
    }

    show();
    setInterval(next, FACT_MS);
  }

  /* ===== Utilidades ===== */

  function observeReveals() {
    document.querySelectorAll('.reveal').forEach(function (node) {
      revealObserver.observe(node);
    });
  }

  function topicColor(topic) {
    if (topic && TOPIC_COLORS[topic]) return TOPIC_COLORS[topic];
    var hash = 0;
    var name = topic || '';
    for (var i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
    return FALLBACK_COLORS[hash % FALLBACK_COLORS.length];
  }

  function slug(text) {
    return String(text)
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
  }

  function formatValue(value, unit) {
    if (unit === '%') return formatNumber(value, 2) + ' %';
    if (unit === 'COP') return '$ ' + formatNumber(value, 2);
    if (unit === 'BRL') return 'R$ ' + formatNumber(value, value < 100 ? 3 : 2);
    if (unit === 'USD') return 'US$ ' + formatNumber(value, value >= 1000 ? 0 : 2);
    return formatNumber(value, 2);
  }

  function formatNumber(value, decimals) {
    return value.toLocaleString('es-CO', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
  }

  function trendClass(changePct) {
    if (changePct === null || changePct === undefined || changePct === 0) return 'flat';
    return changePct > 0 ? 'up' : 'down';
  }

  function formatChange(changePct) {
    if (changePct === null || changePct === undefined) return '—';
    var arrow = changePct > 0 ? '▲' : changePct < 0 ? '▼' : '·';
    var sign = changePct > 0 ? '+' : '';
    return arrow + ' ' + sign + formatNumber(changePct, 2) + ' %';
  }

  function refreshRelativeTimes() {
    document.querySelectorAll('[data-time]').forEach(function (node) {
      var date = new Date(node.dataset.time);
      if (isNaN(date.getTime())) return;
      node.textContent = (node.dataset.prefix || '') + relativeTime(date);
    });
  }

  function relativeTime(date) {
    var diffMs = Date.now() - date.getTime();
    var mins = Math.round(diffMs / 60000);
    if (mins < 1) return 'ahora';
    if (mins < 60) return 'hace ' + mins + ' min';
    var hours = Math.round(mins / 60);
    if (hours < 24) return 'hace ' + hours + ' h';
    var days = Math.round(hours / 24);
    return 'hace ' + days + ' d';
  }

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== null && text !== undefined) node.textContent = text;
    return node;
  }

  function setText(id, text) {
    var node = document.getElementById(id);
    if (node) node.textContent = text;
  }
})();
