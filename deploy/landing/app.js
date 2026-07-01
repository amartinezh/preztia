/* Landing de Preztia — lógica de cliente sin dependencias.
 * Resuelve la URL del API a partir del host actual (api.<dominio>), trae el "pulso del sector"
 * y pinta titulares + changelog. Degrada con elegancia si el API no responde. */

(function () {
  'use strict';

  var host = location.hostname.replace(/^www\./, '');
  // En https usa el subdominio api.<dominio>; en local (file://) queda vacío y se muestra el fallback.
  var API_BASE = location.protocol === 'https:' ? 'https://api.' + host : '';
  var APP_URL = location.protocol === 'https:' ? 'https://app.' + host : '#';

  // Enlaces "Ingresar" apuntan al dashboard (app.<dominio>).
  ['nav-login', 'hero-login', 'band-login'].forEach(function (id) {
    var el = document.getElementById(id);
    if (el) el.setAttribute('href', APP_URL);
  });

  document.getElementById('year').textContent = String(new Date().getFullYear());

  // Reloj "vivo": señal honesta de que el sitio está activo (no inventa métricas de negocio).
  var clock = document.getElementById('live-clock');
  function tick() {
    clock.textContent = new Date().toLocaleTimeString('es-CO', { hour12: false });
  }
  tick();
  setInterval(tick, 1000);

  loadNews();

  function loadNews() {
    if (!API_BASE) {
      renderEmpty('El pulso del sector aparecerá aquí en producción.');
      return;
    }
    fetch(API_BASE + '/public/news', { headers: { accept: 'application/json' } })
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then(render)
      .catch(function () {
        renderEmpty('No pudimos cargar los titulares ahora. Vuelve a intentarlo en un momento.');
      });
  }

  function render(data) {
    renderSector(data && data.sector ? data.sector : []);
    renderChangelog(data && data.platform ? data.platform : []);
    var when = data && data.updatedAt ? new Date(data.updatedAt) : null;
    var label = when ? 'Actualizado ' + relativeTime(when) : 'Actualizado hoy';
    setText('news-updated', label);
    setText('live-updated', 'Pulso del sector: ' + label.toLowerCase());
  }

  function renderSector(items) {
    var list = document.getElementById('news-list');
    if (!items.length) {
      renderEmpty('Sin titulares por ahora.');
      return;
    }
    list.innerHTML = '';
    items.forEach(function (it) {
      var a = document.createElement('a');
      a.className = 'news-item';
      a.href = it.link;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';

      var title = document.createElement('div');
      title.className = 'n-title';
      title.textContent = it.title;

      var meta = document.createElement('div');
      meta.className = 'n-meta';
      var src = document.createElement('span');
      src.className = 'n-source';
      src.textContent = it.source || 'Fuente';
      meta.appendChild(src);
      if (it.publishedAt) {
        var t = document.createElement('span');
        t.textContent = '· ' + relativeTime(new Date(it.publishedAt));
        meta.appendChild(t);
      }

      a.appendChild(title);
      a.appendChild(meta);
      list.appendChild(a);
    });
  }

  function renderChangelog(entries) {
    var ol = document.getElementById('changelog-list');
    ol.innerHTML = '';
    entries.forEach(function (e) {
      var li = document.createElement('li');
      var tag = document.createElement('div');
      tag.className = 't-tag';
      tag.textContent = e.tag || '';
      var title = document.createElement('div');
      title.className = 't-title';
      title.textContent = e.title;
      var desc = document.createElement('div');
      desc.className = 't-desc';
      desc.textContent = e.description || '';
      var date = document.createElement('div');
      date.className = 't-date';
      date.textContent = e.date || '';
      li.appendChild(tag);
      li.appendChild(title);
      li.appendChild(desc);
      li.appendChild(date);
      ol.appendChild(li);
    });
  }

  function renderEmpty(msg) {
    var list = document.getElementById('news-list');
    list.innerHTML = '';
    var p = document.createElement('div');
    p.className = 'news-empty';
    p.textContent = msg;
    list.appendChild(p);
    setText('news-updated', '—');
    setText('live-updated', 'Pulso del sector: en espera');
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

  function setText(id, text) {
    var el = document.getElementById(id);
    if (el) el.textContent = text;
  }
})();
