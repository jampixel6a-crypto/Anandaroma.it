/* Calendario Anandaroma: legge gli eventi dal Google Calendar pubblico e assegna un colore a ogni attività.
   Configurazione: attributi data-* dell'elemento #calendario-attivita.
   Se il caricamento non riesce, mostra il calendario incorporato di Google (template #calendario-fallback). */
(function () {
  'use strict';
  var root = document.getElementById('calendario-attivita');
  if (!root) { return; }
  window.__calendarioAvviato = true;
  var wrap = document.getElementById('google-calendar-wrap');
  var CAL = root.getAttribute('data-calendar-id');
  var KEY = root.getAttribute('data-api-key');
  var TZ = root.getAttribute('data-timezone') || 'Europe/Rome';
  var MESI = ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno', 'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre'];
  var GIORNI = ['lun', 'mar', 'mer', 'gio', 'ven', 'sab', 'dom'];
  var GIORNI_LUNGHI = ['domenica', 'lunedì', 'martedì', 'mercoledì', 'giovedì', 'venerdì', 'sabato'];
  var PALETTE = ['#3376c4', '#b9851e', '#2f9e8f', '#8a5fc7', '#e0719f', '#5b8c3a', '#9c4f96', '#2b3a99', '#d98324', '#3f9bb5', '#7a6c5d', '#6b8e23'];
  var overrides = {};
  try { overrides = JSON.parse(root.getAttribute('data-colori') || '{}'); } catch (e) { overrides = {}; }

  var state = { events: [], byDay: {}, colors: {}, keys: [], filter: null, y: 0, m: 0, minY: 0, minM: 0, maxY: 0, maxM: 0 };

  /* ---------- date (tutto in fuso orario di Roma, con chiavi 'AAAA-MM-GG') ---------- */
  var fmtDay = new Intl.DateTimeFormat('sv-SE', { timeZone: TZ });
  var fmtTime = new Intl.DateTimeFormat('it-IT', { timeZone: TZ, hour: '2-digit', minute: '2-digit' });
  function dayKey(d) { return fmtDay.format(d); }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function parseKey(k) { var p = k.split('-'); return { y: +p[0], m: +p[1], d: +p[2] }; }
  function addDays(k, n) { var p = parseKey(k); var d = new Date(Date.UTC(p.y, p.m - 1, p.d + n)); return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate()); }
  function weekdayMon(k) { var p = parseKey(k); return (new Date(Date.UTC(p.y, p.m - 1, p.d)).getUTCDay() + 6) % 7; }
  function weekdayLong(k) { var p = parseKey(k); return GIORNI_LUNGHI[new Date(Date.UTC(p.y, p.m - 1, p.d)).getUTCDay()]; }
  function daysInMonth(y, m) { return new Date(Date.UTC(y, m, 0)).getUTCDate(); }
  function longDate(k) { var p = parseKey(k); return weekdayLong(k) + ' ' + p.d + ' ' + MESI[p.m - 1] + ' ' + p.y; }
  var todayKey = dayKey(new Date());

  /* ---------- eventi ---------- */
  function normalize(t) { return (t || '').toLowerCase().replace(/\s+/g, ' ').trim(); }
  function prepare(item) {
    var allDay = !!(item.start && item.start.date);
    var sKey, eKey, sDate = null, eDate = null;
    if (allDay) {
      sKey = item.start.date; eKey = addDays(item.end && item.end.date ? item.end.date : item.start.date, -1);
      if (eKey < sKey) { eKey = sKey; }
    } else {
      sDate = new Date(item.start.dateTime); eDate = new Date(item.end && item.end.dateTime ? item.end.dateTime : item.start.dateTime);
      sKey = dayKey(sDate);
      eKey = dayKey(new Date(Math.max(sDate.getTime(), eDate.getTime() - 1)));
    }
    var titolo = (item.summary || '').trim() || '(senza titolo)';
    return { id: item.id, title: titolo, key: normalize(titolo), desc: item.description || '', loc: item.location || '', link: item.htmlLink || '', allDay: allDay, sKey: sKey, eKey: eKey, sDate: sDate, eDate: eDate };
  }
  function index(events) {
    var byDay = {}, keys = {};
    events.forEach(function (ev) {
      keys[ev.key] = ev.title;
      var k = ev.sKey, guard = 0;
      while (k <= ev.eKey && guard++ < 400) { (byDay[k] = byDay[k] || []).push(ev); k = addDays(k, 1); }
    });
    Object.keys(byDay).forEach(function (k) {
      byDay[k].sort(function (a, b) {
        if (a.allDay !== b.allDay) { return a.allDay ? -1 : 1; }
        var ta = a.sDate ? a.sDate.getTime() : 0, tb = b.sDate ? b.sDate.getTime() : 0;
        return ta - tb || a.title.localeCompare(b.title, 'it');
      });
    });
    state.byDay = byDay;
    state.keys = Object.keys(keys).sort(function (a, b) { return a.localeCompare(b, 'it'); });
    state.names = keys;
    state.colors = {};
    state.keys.forEach(function (k, i) { state.colors[k] = overrides[k] || PALETTE[i % PALETTE.length]; });
  }
  function colorOf(ev) { return state.colors[ev.key] || PALETTE[0]; }
  function timeLabel(ev, dayK) {
    if (ev.allDay) { return ''; }
    if (dayK && dayK !== ev.sKey) { return ''; }
    return fmtTime.format(ev.sDate);
  }

  /* ---------- caricamento da Google Calendar ---------- */
  function load() {
    var now = new Date(), t = parseKey(dayKey(now));
    state.y = t.y; state.m = t.m;
    var minD = new Date(Date.UTC(t.y, t.m - 3, 1)), maxD = new Date(Date.UTC(t.y, t.m + 12, 1));
    state.minY = minD.getUTCFullYear(); state.minM = minD.getUTCMonth() + 1;
    state.maxY = maxD.getUTCFullYear(); state.maxM = maxD.getUTCMonth() + 1;
    var base = 'https://www.googleapis.com/calendar/v3/calendars/' + encodeURIComponent(CAL) + '/events?key=' + encodeURIComponent(KEY) +
      '&singleEvents=true&orderBy=startTime&maxResults=2500&timeZone=' + encodeURIComponent(TZ) +
      '&timeMin=' + encodeURIComponent(minD.toISOString()) + '&timeMax=' + encodeURIComponent(maxD.toISOString()) +
      '&fields=' + encodeURIComponent('nextPageToken,items(id,summary,description,location,htmlLink,start,end,status)');
    var all = [];
    function page(token, n) {
      var ctrl = ('AbortController' in window) ? new AbortController() : null;
      var timer = setTimeout(function () { if (ctrl) { ctrl.abort(); } }, 15000);
      return fetch(base + (token ? '&pageToken=' + encodeURIComponent(token) : ''), ctrl ? { signal: ctrl.signal } : {}).then(function (r) {
        clearTimeout(timer);
        if (!r.ok) {
          return r.text().then(function (t) {
            var msg = t; try { var j = JSON.parse(t); msg = (j.error && (j.error.message || '')) + (j.error && j.error.errors && j.error.errors[0] ? ' [' + j.error.errors[0].reason + ']' : ''); } catch (e) {}
            throw new Error('Google ha risposto HTTP ' + r.status + ': ' + String(msg).slice(0, 300));
          });
        }
        return r.json();
      }).then(function (j) {
        (j.items || []).forEach(function (it) { if (it.status !== 'cancelled' && it.start) { all.push(prepare(it)); } });
        if (j.nextPageToken && n < 5) { return page(j.nextPageToken, n + 1); }
      });
    }
    return page('', 0).then(function () { state.events = all; index(all); });
  }

  /* ---------- fallback: calendario incorporato di Google ---------- */
  function fallback(err) {
    if (window.console && console.warn) { console.warn('Calendario: uso il calendario Google incorporato.', err); }
    var tpl = document.getElementById('calendario-fallback');
    var diag = null;
    if (/[?&]cal-debug/.test(window.location.search)) {
      diag = document.createElement('pre');
      diag.style.cssText = 'white-space:pre-wrap;margin:10px 8px 0;padding:10px 12px;background:#fff4f2;border:1px solid #e0a79f;border-radius:8px;color:#7a2a20;font:13px/1.4 monospace;';
      diag.textContent = 'Diagnostica calendario: ' + (err && err.message ? err.message : String(err)) + '\nPagina: ' + window.location.origin + '/';
    }
    if (!tpl) { root.textContent = 'Il calendario non è al momento disponibile.'; return; }
    wrap.classList.remove('cal-attivo');
    root.parentNode.removeChild(root);
    var holder = document.createElement('div'); holder.innerHTML = tpl.innerHTML;
    var f = holder.querySelector('iframe');
    if (f && window.innerWidth < 768) { f.src = f.src.replace('mode=MONTH', 'mode=AGENDA'); }
    while (holder.firstChild) { wrap.appendChild(holder.firstChild); }
    if (diag) { wrap.appendChild(diag); }
  }

  /* ---------- interfaccia ---------- */
  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) { e.className = cls; } if (text != null) { e.textContent = text; } return e; }
  function monthIndex(y, m) { return y * 12 + (m - 1); }
  var ui = {};
  function build() {
    root.textContent = '';
    wrap.classList.add('cal-attivo');
    var head = el('div', 'cal-head');
    ui.prev = el('button', 'cal-nav', '‹'); ui.prev.type = 'button'; ui.prev.setAttribute('aria-label', 'Mese precedente');
    ui.next = el('button', 'cal-nav', '›'); ui.next.type = 'button'; ui.next.setAttribute('aria-label', 'Mese successivo');
    ui.title = el('h3', 'cal-title'); ui.title.setAttribute('aria-live', 'polite');
    head.appendChild(ui.prev); head.appendChild(ui.title); head.appendChild(ui.next);
    ui.legend = el('div', 'cal-legend'); ui.legend.setAttribute('role', 'group'); ui.legend.setAttribute('aria-label', 'Filtra per attività');
    ui.grid = el('div', 'cal-grid'); ui.agenda = el('div', 'cal-agenda');
    root.appendChild(head); root.appendChild(ui.legend); root.appendChild(ui.grid); root.appendChild(ui.agenda);
    ui.prev.addEventListener('click', function () { go(-1); });
    ui.next.addEventListener('click', function () { go(1); });
  }
  function go(n) {
    var i = monthIndex(state.y, state.m) + n;
    if (i < monthIndex(state.minY, state.minM) || i > monthIndex(state.maxY, state.maxM)) { return; }
    state.y = Math.floor(i / 12); state.m = (i % 12) + 1; render();
  }
  function visible(ev) { return !state.filter || ev.key === state.filter; }
  function chip(ev, dayK, compact) {
    var b = el('button', 'cal-ev'); b.type = 'button';
    b.style.setProperty('--c', colorOf(ev));
    var t = timeLabel(ev, dayK);
    if (t) { b.appendChild(el('span', 'cal-ev-t', t)); }
    b.appendChild(el('span', 'cal-ev-n', ev.title));
    b.title = ev.title + (t ? ' – ' + t : '');
    b.addEventListener('click', function (e) { e.stopPropagation(); openDetail(ev); });
    return b;
  }
  function render() {
    var y = state.y, m = state.m;
    ui.title.textContent = MESI[m - 1].charAt(0).toUpperCase() + MESI[m - 1].slice(1) + ' ' + y;
    ui.prev.disabled = monthIndex(y, m) <= monthIndex(state.minY, state.minM);
    ui.next.disabled = monthIndex(y, m) >= monthIndex(state.maxY, state.maxM);
    var first = y + '-' + pad(m) + '-01', last = y + '-' + pad(m) + '-' + pad(daysInMonth(y, m));
    /* filtri: piccoli quadratini colorati, uno per attività del mese, senza testo */
    ui.legend.textContent = '';
    var present = {};
    for (var k = first; k <= last; k = addDays(k, 1)) { (state.byDay[k] || []).forEach(function (ev) { present[ev.key] = true; }); }
    var usedKeys = state.keys.filter(function (kk) { return present[kk]; });
    if (state.filter && !present[state.filter]) { state.filter = null; }
    var tutte = el('button', 'cal-leg cal-leg-all'); tutte.type = 'button';
    tutte.setAttribute('aria-label', 'Mostra tutte le attività'); tutte.title = 'Tutte';
    tutte.setAttribute('aria-pressed', state.filter ? 'false' : 'true');
    tutte.addEventListener('click', function () { state.filter = null; render(); });
    ui.legend.appendChild(tutte);
    usedKeys.forEach(function (kk) {
      var b = el('button', 'cal-leg'); b.type = 'button';
      b.style.background = state.colors[kk];
      b.setAttribute('aria-label', 'Mostra solo ' + state.names[kk]);
      b.setAttribute('aria-pressed', state.filter === kk ? 'true' : 'false');
      b.title = state.names[kk];
      if (state.filter && state.filter !== kk) { b.classList.add('cal-off'); }
      b.addEventListener('click', function () { state.filter = (state.filter === kk) ? null : kk; render(); });
      ui.legend.appendChild(b);
    });
    ui.legend.style.display = usedKeys.length > 1 ? '' : 'none';
    /* griglia mensile */
    ui.grid.textContent = '';
    GIORNI.forEach(function (g) { ui.grid.appendChild(el('div', 'cal-dow', g)); });
    var start = addDays(first, -weekdayMon(first));
    var weeks = Math.ceil((weekdayMon(first) + daysInMonth(y, m)) / 7);
    for (var i = 0; i < weeks * 7; i++) {
      (function (dk) {
        var p = parseKey(dk);
        var list = (state.byDay[dk] || []).filter(visible);
        var cell = el('div', 'cal-cell' + (p.m !== m ? ' cal-out' : '') + (dk === todayKey ? ' cal-today-cell' : ''));
        cell.appendChild(el('div', 'cal-num', String(p.d)));
        list.slice(0, 3).forEach(function (ev) { cell.appendChild(chip(ev, dk)); });
        if (list.length > 3) {
          var more = el('button', 'cal-more', '+' + (list.length - 3) + ' altre'); more.type = 'button';
          more.addEventListener('click', function (e) { e.stopPropagation(); openDay(dk); });
          cell.appendChild(more);
        }
        if (list.length) { cell.classList.add('cal-has'); cell.addEventListener('click', function () { openDay(dk); }); }
        ui.grid.appendChild(cell);
      })(addDays(start, i));
    }
    /* agenda (smartphone) */
    ui.agenda.textContent = '';
    var any = false;
    for (var d = first; d <= last; d = addDays(d, 1)) {
      var evs = (state.byDay[d] || []).filter(visible);
      if (!evs.length && d !== todayKey) { continue; }
      if (evs.length) { any = true; }
      var row = el('div', 'cal-ag-day' + (d === todayKey ? ' cal-today-cell' : ''));
      var p2 = parseKey(d);
      var lab = el('div', 'cal-ag-lab'); lab.appendChild(el('strong', null, String(p2.d))); lab.appendChild(el('span', null, GIORNI[weekdayMon(d)]));
      var col = el('div', 'cal-ag-list');
      evs.forEach(function (ev) { col.appendChild(chip(ev, d)); });
      if (!evs.length) { col.appendChild(el('span', 'cal-ag-oggi', nextEventText())); }
      row.appendChild(lab); row.appendChild(col); ui.agenda.appendChild(row);
    }
    if (!any) { ui.agenda.appendChild(el('p', 'cal-empty', 'Nessuna attività in programma in questo mese.')); }
  }

  function nextEventText() {
    var keys = Object.keys(state.byDay).sort(), nk = null;
    for (var i = 0; i < keys.length; i++) {
      if (keys[i] > todayKey && state.byDay[keys[i]].filter(visible).length) { nk = keys[i]; break; }
    }
    if (!nk) { return 'Nessun evento'; }
    var a = parseKey(todayKey), b = parseKey(nk);
    var diff = Math.round((Date.UTC(b.y, b.m - 1, b.d) - Date.UTC(a.y, a.m - 1, a.d)) / 86400000);
    var when = diff === 1 ? 'domani' : diff === 2 ? 'dopodomani' : weekdayLong(nk) + ' ' + b.d + ' ' + MESI[b.m - 1];
    return 'Prossima attività: ' + when;
  }

  /* ---------- finestre di dettaglio ---------- */
  var dlg = null, lastFocus = null;
  function ensureDialog() {
    if (dlg) { return dlg; }
    dlg = el('div', 'cal-pop'); dlg.setAttribute('role', 'dialog'); dlg.setAttribute('aria-modal', 'true'); dlg.setAttribute('aria-hidden', 'true');
    var box = el('div', 'cal-pop-box');
    var x = el('button', 'cal-pop-x', '×'); x.type = 'button'; x.setAttribute('aria-label', 'Chiudi');
    var body = el('div', 'cal-pop-body');
    box.appendChild(x); box.appendChild(body); dlg.appendChild(box); document.body.appendChild(dlg);
    dlg._body = body; dlg._x = x;
    x.addEventListener('click', closeDlg);
    dlg.addEventListener('click', function (e) { if (e.target === dlg) { closeDlg(); } });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && dlg.classList.contains('open')) { closeDlg(); } });
    return dlg;
  }
  function showDlg(fill) {
    var d = ensureDialog();
    if (!d.classList.contains('open')) { lastFocus = document.activeElement; }
    d._body.textContent = ''; fill(d._body);
    d.classList.add('open'); d.setAttribute('aria-hidden', 'false');
    requestAnimationFrame(function () { requestAnimationFrame(function () { d.classList.add('vis'); }); });
    d._x.focus();
  }
  function closeDlg() {
    dlg.classList.remove('vis'); dlg.setAttribute('aria-hidden', 'true');
    setTimeout(function () { dlg.classList.remove('open'); }, 300);
    if (lastFocus && lastFocus.focus) { try { lastFocus.focus(); } catch (e) {} }
  }
  function linkify(text, parent) {
    var re = /(https?:\/\/[^\s<>"']+)/g, last = 0, m;
    while ((m = re.exec(text))) {
      if (m.index > last) { parent.appendChild(document.createTextNode(text.slice(last, m.index))); }
      var url = m[1].replace(/[.,;:!?)]+$/, '');
      var a = el('a', null, url); a.href = url; a.target = '_blank'; a.rel = 'noopener';
      parent.appendChild(a);
      last = m.index + url.length; re.lastIndex = last;
    }
    if (last < text.length) { parent.appendChild(document.createTextNode(text.slice(last))); }
  }
  function plain(html) {
    var s = String(html).replace(/<\s*br\s*\/?>/gi, '\n').replace(/<\/(p|div|li|h[1-6])>/gi, '\n').replace(/<li[^>]*>/gi, '• ');
    var d = new DOMParser().parseFromString(s, 'text/html');
    return (d.body.textContent || '').replace(/\n{3,}/g, '\n\n').trim();
  }
  function when(ev) {
    if (ev.allDay) {
      return ev.sKey === ev.eKey ? longDate(ev.sKey) + ' · tutto il giorno' : 'Da ' + longDate(ev.sKey) + ' a ' + longDate(ev.eKey);
    }
    var s = fmtTime.format(ev.sDate), e = fmtTime.format(ev.eDate);
    if (ev.sKey === ev.eKey) { return longDate(ev.sKey) + ' · ' + s + (e !== s ? '–' + e : ''); }
    return longDate(ev.sKey) + ' ' + s + ' → ' + longDate(ev.eKey) + ' ' + e;
  }
  function openDetail(ev) {
    showDlg(function (b) {
      b.style.setProperty('--c', colorOf(ev));
      b.appendChild(el('div', 'cal-pop-bar'));
      b.appendChild(el('h4', 'cal-pop-t', ev.title));
      b.appendChild(el('p', 'cal-pop-when', when(ev)));
      if (ev.loc) {
        var p = el('p', 'cal-pop-loc'); p.appendChild(document.createTextNode('📍 '));
        var a = el('a', null, ev.loc); a.href = 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(ev.loc); a.target = '_blank'; a.rel = 'noopener';
        p.appendChild(a); b.appendChild(p);
      }
      var txt = plain(ev.desc);
      if (txt) { var d = el('div', 'cal-pop-desc'); linkify(txt, d); b.appendChild(d); }
    });
  }
  function openDay(dk) {
    var list = (state.byDay[dk] || []).filter(visible);
    showDlg(function (b) {
      b.style.setProperty('--c', '#3376c4');
      b.appendChild(el('div', 'cal-pop-bar'));
      var t = longDate(dk); b.appendChild(el('h4', 'cal-pop-t', t.charAt(0).toUpperCase() + t.slice(1)));
      var ul = el('div', 'cal-pop-list');
      list.forEach(function (ev) {
        var r = el('button', 'cal-pop-row'); r.type = 'button'; r.style.setProperty('--c', colorOf(ev));
        r.appendChild(el('span', 'cal-pop-time', ev.allDay ? 'Tutto il giorno' : (timeLabel(ev, dk) || 'Continua')));
        r.appendChild(el('span', 'cal-pop-name', ev.title));
        r.addEventListener('click', function () { openDetail(ev); });
        ul.appendChild(r);
      });
      b.appendChild(ul);
    });
  }

  /* ---------- avvio ---------- */
  if (!CAL || !KEY) { fallback('configurazione mancante'); return; }
  load().then(function () { build(); render(); }).catch(fallback);
})();
