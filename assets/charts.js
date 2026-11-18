/* Persian Gulf Daily Summary - charts (spec Section 5).
 * One function per chart: fetch its JSON, compute subtitle values, draw, and fill the "Show data" table.
 * All text goes into the page with textContent, never innerHTML.
 */
(function () {
  'use strict';

  var COLORS = { blue: '#2F6DB5', orange: '#D9822B', green: '#5A9E6F', grid: '#E6E6E6', axis: '#555555', label: '#333333' };
  var FONT = 'Calibri, Carlito, Arial, sans-serif';
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  var DATA_BASE = (document.body && document.body.getAttribute('data-data-base')) || '/data/';
  var nf = new Intl.NumberFormat('en-US');
  var charts = [];

  // ---------- formatting ----------

  function num(n) { return n === null || n === undefined ? 'n/a' : nf.format(n); }
  function parts(iso) { var p = iso.split('-'); return { y: +p[0], m: +p[1], d: +p[2] }; }
  function shortDate(iso) { var p = parts(iso); return MONTHS[p.m - 1] + ' ' + p.d; }
  function longDate(iso) { var p = parts(iso); return MONTHS_LONG[p.m - 1] + ' ' + p.d + ', ' + p.y; }
  function isNarrow() { return window.matchMedia('(max-width: 599px)').matches; }

  // ---------- data helpers ----------

  function load(file) {
    return fetch(DATA_BASE + file, { cache: 'no-cache' }).then(function (res) {
      if (!res.ok) throw new Error(file + ': HTTP ' + res.status);
      return res.json();
    }).then(function (rows) {
      if (!Array.isArray(rows) || rows.length === 0) throw new Error(file + ': no rows');
      return rows;
    });
  }

  // Rows are append-only; a correction is a later row with the same key. Keep the last one.
  function latestBy(rows, key) {
    var map = new Map();
    rows.forEach(function (r) { map.set(r[key], r); });
    return Array.from(map.values());
  }

  function byDate(rows) {
    return latestBy(rows, 'date').sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; });
  }

  // ---------- DOM helpers ----------

  function el(tag, text, cls) {
    var e = document.createElement(tag);
    if (text !== undefined && text !== null) e.textContent = text;
    if (cls) e.className = cls;
    return e;
  }

  function fillTable(card, columns, rows) {
    var table = el('table');
    var thead = el('thead');
    var hr = el('tr');
    columns.forEach(function (c) {
      var th = el('th', c.label, c.num ? 'num' : '');
      th.scope = 'col';
      hr.appendChild(th);
    });
    thead.appendChild(hr);
    var tbody = el('tbody');
    rows.forEach(function (r) {
      var tr = el('tr');
      columns.forEach(function (c) { tr.appendChild(el('td', c.value(r), c.num ? 'num' : '')); });
      tbody.appendChild(tr);
    });
    table.appendChild(thead);
    table.appendChild(tbody);
    var wrap = card.querySelector('.table-wrap');
    wrap.textContent = '';
    wrap.appendChild(table);
  }

  function setText(card, subtitle, ariaLabel, rows) {
    card.querySelector('.chart-subtitle').textContent = subtitle;
    card.querySelector('.chart-canvas').setAttribute('aria-label', ariaLabel);
    var srcEl = card.querySelector('.chart-sources');
    if (srcEl && rows) {
      var seen = Array.from(new Set(rows.map(function (r) { return r.source; }).filter(Boolean)));
      srcEl.textContent = (seen.length > 1 ? 'Sources: ' : 'Source: ') + seen.join('; ') + '.';
    }
  }

  function fail(card, err) {
    if (window.console) console.error(err);
    var box = card.querySelector('.chart-canvas');
    box.textContent = '';
    box.appendChild(el('p', 'Chart data unavailable', 'chart-error'));
    box.setAttribute('aria-label', 'Chart data unavailable');
    var details = card.querySelector('.chart-data');
    if (details) details.hidden = true;
  }

  // ---------- value labels (small Chart.js plugin) ----------
  // options.plugins.valueLabels.mode: 'all' (every bar), 'last' (final bar of each series),
  // or 'total' (one label at the end of each stacked bar).

  var valueLabels = {
    id: 'valueLabels',
    afterDatasetsDraw: function (chart, _args, opts) {
      if (!opts || !opts.mode) return;
      var ctx = chart.ctx;
      var horizontal = chart.options.indexAxis === 'y';
      var visible = chart.data.datasets.map(function (_d, i) { return i; }).filter(function (i) { return chart.isDatasetVisible(i); });
      if (!visible.length) return;
      var size = isNarrow() ? 10 : 11;
      ctx.save();
      ctx.font = size + 'px ' + FONT;
      ctx.fillStyle = COLORS.label;

      function draw(text, bar, spacing) {
        if (horizontal) {
          ctx.textAlign = 'left';
          ctx.textBaseline = 'middle';
          ctx.fillText(text, bar.x + 5, bar.y);
          return;
        }
        var w = ctx.measureText(text).width;
        if (spacing && w > spacing - 2) {
          // Too narrow for horizontal text (e.g. 20 columns on a phone): write it vertically.
          ctx.save();
          ctx.translate(bar.x, bar.y - 4);
          ctx.rotate(-Math.PI / 2);
          ctx.textAlign = 'left';
          ctx.textBaseline = 'middle';
          ctx.fillText(text, 0, 0);
          ctx.restore();
          return;
        }
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        ctx.fillText(text, bar.x, bar.y - 3);
      }

      if (opts.mode === 'total') {
        var last = visible[visible.length - 1];
        chart.getDatasetMeta(last).data.forEach(function (bar, i) {
          var total = visible.reduce(function (s, d) { return s + (chart.data.datasets[d].data[i] || 0); }, 0);
          draw(num(total), bar);
        });
      } else {
        visible.forEach(function (d) {
          var meta = chart.getDatasetMeta(d);
          var values = chart.data.datasets[d].data;
          var spacing = meta.data.length > 1 ? Math.abs(meta.data[1].x - meta.data[0].x) : 0;
          meta.data.forEach(function (bar, i) {
            if (opts.mode === 'last' && i !== meta.data.length - 1) return;
            if (values[i] === null || values[i] === undefined) return;
            draw(num(values[i]), bar, opts.mode === 'all' ? spacing : 0);
          });
        });
      }
      ctx.restore();
    },
  };

  // ---------- shared Chart.js options ----------

  function baseOptions(extra) {
    var o = {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 300 },
      layout: { padding: { top: 20, right: 8 } },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: 'rgba(34,34,34,0.92)',
          titleFont: { family: FONT, size: 13, weight: 'bold' },
          bodyFont: { family: FONT, size: 13 },
          footerFont: { family: FONT, size: 12, weight: 'normal' },
          padding: 8,
          displayColors: false,
        },
        valueLabels: { mode: 'all' },
      },
      scales: {
        x: { grid: { display: false }, ticks: { color: COLORS.axis, autoSkip: true, maxRotation: 0, autoSkipPadding: 10 } },
        y: { beginAtZero: true, grid: { color: COLORS.grid }, border: { display: false }, ticks: { color: COLORS.axis, callback: function (v) { return num(v); } } },
      },
    };
    return merge(o, extra || {});
  }

  function merge(target, src) {
    Object.keys(src).forEach(function (k) {
      var v = src[k];
      if (v && typeof v === 'object' && !Array.isArray(v) && typeof target[k] === 'object' && target[k] !== null) merge(target[k], v);
      else target[k] = v;
    });
    return target;
  }

  function draw(card, config) {
    var canvas = card.querySelector('canvas');
    config.plugins = [valueLabels];
    var chart = new window.Chart(canvas, config);
    charts.push(chart);
    return chart;
  }

  // ---------- 1. Launches ----------

  function chartLaunches(card) {
    return load('launches.json').then(function (raw) {
      var rows = byDate(raw);
      var latest = rows[rows.length - 1];
      setText(card,
        'Running total, JINSA count (lower bound). Latest: ' + num(latest.launched_since_jul7) + ' as of ' + shortDate(latest.date),
        'Column chart of Iranian missiles and drones launched since July 7. Latest: ' + num(latest.launched_since_jul7) + ' as of ' + longDate(latest.date) + '.',
        rows);
      draw(card, {
        type: 'bar',
        data: {
          labels: rows.map(function (r) { return shortDate(r.date); }),
          datasets: [{ label: 'Launched since July 7', data: rows.map(function (r) { return r.launched_since_jul7; }), backgroundColor: COLORS.blue }],
        },
        options: baseOptions({
          plugins: { tooltip: { callbacks: {
            title: function (items) { return longDate(rows[items[0].dataIndex].date); },
            label: function (item) { return 'Launched since July 7: ' + num(item.raw); },
            afterLabel: function (item) { return 'Source: ' + rows[item.dataIndex].source; },
          } } },
        }),
      });
      fillTable(card, [
        { label: 'Date', value: function (r) { return longDate(r.date); } },
        { label: 'Launched since July 7', num: true, value: function (r) { return num(r.launched_since_jul7); } },
        { label: 'Source', value: function (r) { return r.source; } },
      ], rows);
    });
  }

  // ---------- 2. Ship incidents ----------

  function chartShips(card) {
    return load('ship_incidents.json').then(function (raw) {
      var rows = byDate(raw);
      var latest = rows[rows.length - 1];
      setText(card,
        'IMO running count of confirmed incidents since Feb 28. Latest: ' + num(latest.confirmed_incidents) + ' as of ' + shortDate(latest.date),
        'Column chart of confirmed attacks on ships in the Gulf, Hormuz and Gulf of Oman. Latest: ' + num(latest.confirmed_incidents) + ' as of ' + longDate(latest.date) + '.',
        rows);
      draw(card, {
        type: 'bar',
        data: {
          labels: rows.map(function (r) { return shortDate(r.date); }),
          datasets: [{ label: 'Confirmed incidents', data: rows.map(function (r) { return r.confirmed_incidents; }), backgroundColor: COLORS.blue, maxBarThickness: 120 }],
        },
        options: baseOptions({
          plugins: { tooltip: { callbacks: {
            title: function (items) { return longDate(rows[items[0].dataIndex].date); },
            label: function (item) { return 'Confirmed incidents: ' + num(item.raw); },
            afterLabel: function (item) {
              var r = rows[item.dataIndex];
              var lines = [];
              if (r.seafarer_deaths !== null && r.seafarer_deaths !== undefined) lines.push('Seafarer deaths: ' + num(r.seafarer_deaths));
              lines.push('Source: ' + r.source);
              return lines;
            },
          } } },
        }),
      });
      fillTable(card, [
        { label: 'Date', value: function (r) { return longDate(r.date); } },
        { label: 'Confirmed incidents', num: true, value: function (r) { return num(r.confirmed_incidents); } },
        { label: 'Seafarer deaths', num: true, value: function (r) { return num(r.seafarer_deaths); } },
        { label: 'Source', value: function (r) { return r.source; } },
      ], rows);
    });
  }

  // ---------- 3. Casualties ----------

  var NOT_SHOWN = ['Iran', 'Lebanon'];

  function chartCasualties(card) {
    return load('casualties.json').then(function (raw) {
      var all = latestBy(raw, 'country').sort(function (a, b) { return b.killed - a.killed; });
      var shown = all.filter(function (r) { return NOT_SHOWN.indexOf(r.country) === -1; });
      var hidden = NOT_SHOWN.map(function (c) { return all.find(function (r) { return r.country === c; }); }).filter(Boolean);
      var notShown = hidden.map(function (r) { return r.country + ' ' + num(r.killed); }).join('; ');
      var top = shown[0];
      setText(card,
        'JINSA compiled figures (lower bounds).' + (notShown ? ' Not shown: ' + notShown + ' killed' : ''),
        'Bar chart of deaths outside Iran and Lebanon, highest first. ' + (top ? 'Highest: ' + top.country + ', ' + num(top.killed) + ' killed. ' : '') + (notShown ? 'Not shown: ' + notShown + ' killed.' : ''),
        all);
      draw(card, {
        type: 'bar',
        data: {
          labels: shown.map(function (r) { return r.country; }),
          datasets: [{ label: 'Killed', data: shown.map(function (r) { return r.killed; }), backgroundColor: COLORS.blue }],
        },
        options: baseOptions({
          indexAxis: 'y',
          layout: { padding: { top: 4, right: 36 } },
          plugins: { tooltip: { callbacks: {
            title: function (items) { return shown[items[0].dataIndex].country; },
            label: function (item) { return 'Killed: ' + num(item.raw); },
            afterLabel: function (item) {
              var r = shown[item.dataIndex];
              var lines = ['Injured: ' + num(r.injured), 'As of: ' + longDate(r.as_of)];
              if (r.note) lines.push('Note: ' + r.note);
              lines.push('Source: ' + r.source);
              return lines;
            },
          } } },
          scales: {
            x: { beginAtZero: true, grid: { display: true, color: COLORS.grid }, ticks: { callback: function (v) { return num(v); } } },
            y: { beginAtZero: false, grid: { display: false }, border: { display: true }, ticks: { autoSkip: false, callback: function (_v, i) { return shown[i].country; } } },
          },
        }),
      });
      fillTable(card, [
        { label: 'Country', value: function (r) { return r.country; } },
        { label: 'Killed', num: true, value: function (r) { return num(r.killed); } },
        { label: 'Injured', num: true, value: function (r) { return num(r.injured); } },
        { label: 'As of', value: function (r) { return longDate(r.as_of); } },
        { label: 'Note', value: function (r) { return r.note || ''; } },
        { label: 'Source', value: function (r) { return r.source; } },
      ], all);
    });
  }

  // ---------- 4. UAE air defense ----------

  function chartUae(card) {
    return load('uae.json').then(function (raw) {
      var rows = byDate(raw);
      var first = rows[0];
      var latest = rows[rows.length - 1];
      setText(card,
        'Running totals reported by the UAE Ministry of Defence, ' + shortDate(first.date) + ' to ' + shortDate(latest.date),
        'Clustered column chart of UAE air defense engagements. As of ' + longDate(latest.date) + ': ' + num(latest.drones) + ' drones, ' + num(latest.ballistic) + ' ballistic missiles, ' + num(latest.cruise) + ' cruise missiles.',
        rows);
      draw(card, {
        type: 'bar',
        data: {
          labels: rows.map(function (r) { return shortDate(r.date); }),
          datasets: [
            { label: 'Drones', data: rows.map(function (r) { return r.drones; }), backgroundColor: COLORS.orange },
            { label: 'Ballistic missiles', data: rows.map(function (r) { return r.ballistic; }), backgroundColor: COLORS.blue },
            { label: 'Cruise missiles', data: rows.map(function (r) { return r.cruise; }), backgroundColor: COLORS.green },
          ],
        },
        options: baseOptions({
          interaction: { mode: 'index', intersect: false },
          datasets: { bar: { categoryPercentage: 0.8, barPercentage: 0.9 } },
          layout: { padding: { top: 6, right: 30 } },
          plugins: {
            legend: { display: true, position: 'top', align: 'start', labels: { boxWidth: 12, boxHeight: 10, color: COLORS.axis, font: { family: FONT, size: 13 } } },
            valueLabels: { mode: 'last' },
            tooltip: { displayColors: true, callbacks: {
              title: function (items) { return longDate(rows[items[0].dataIndex].date); },
              label: function (item) { return item.dataset.label + ': ' + num(item.raw); },
              footer: function (items) { return 'Source: ' + rows[items[0].dataIndex].source; },
            } },
          },
        }),
      });
      fillTable(card, [
        { label: 'Date', value: function (r) { return longDate(r.date); } },
        { label: 'Drones', num: true, value: function (r) { return num(r.drones); } },
        { label: 'Ballistic', num: true, value: function (r) { return num(r.ballistic); } },
        { label: 'Cruise', num: true, value: function (r) { return num(r.cruise); } },
        { label: 'Source', value: function (r) { return r.source; } },
      ], rows);
    });
  }

  // ---------- 5. Opening wave ----------

  function chartOpeningWave(card) {
    return load('opening_wave.json').then(function (raw) {
      var rows = latestBy(raw, 'country')
        .map(function (r) { return Object.assign({}, r, { total: (r.missiles || 0) + (r.drones || 0) }); })
        .sort(function (a, b) { return b.total - a.total; });
      var top = rows[0];
      setText(card,
        'Missiles and drones fired at each country, Feb 28 to Mar 18',
        'Stacked bar chart of Iranian missiles and drones fired at Gulf states, Feb 28 to Mar 18. Highest: ' + top.country + ', ' + num(top.total) + ' (' + num(top.missiles) + ' missiles, ' + num(top.drones) + ' drones).',
        rows);
      draw(card, {
        type: 'bar',
        data: {
          labels: rows.map(function (r) { return r.country; }),
          datasets: [
            { label: 'Missiles', data: rows.map(function (r) { return r.missiles; }), backgroundColor: COLORS.blue },
            { label: 'Drones', data: rows.map(function (r) { return r.drones; }), backgroundColor: COLORS.orange },
          ],
        },
        options: baseOptions({
          indexAxis: 'y',
          interaction: { mode: 'index', axis: 'y', intersect: false },
          datasets: { bar: { categoryPercentage: 0.75, barPercentage: 0.9 } },
          layout: { padding: { top: 4, right: 44 } },
          plugins: {
            legend: { display: true, position: 'bottom', align: 'end', labels: { boxWidth: 12, boxHeight: 10, color: COLORS.axis, font: { family: FONT, size: 13 } } },
            valueLabels: { mode: 'total' },
            tooltip: { displayColors: true, callbacks: {
              title: function (items) { return rows[items[0].dataIndex].country; },
              label: function (item) { return item.dataset.label + ': ' + num(item.raw); },
              footer: function (items) {
                var r = rows[items[0].dataIndex];
                return ['Total: ' + num(r.total), 'Source: ' + r.source];
              },
            } },
          },
          scales: {
            x: { stacked: true, beginAtZero: true, grid: { display: true, color: COLORS.grid }, ticks: { callback: function (v) { return num(v); } } },
            y: { stacked: true, beginAtZero: false, grid: { display: false }, border: { display: true }, ticks: { autoSkip: false, callback: function (_v, i) { return rows[i].country; } } },
          },
        }),
      });
      fillTable(card, [
        { label: 'Country', value: function (r) { return r.country; } },
        { label: 'Missiles', num: true, value: function (r) { return num(r.missiles); } },
        { label: 'Drones', num: true, value: function (r) { return num(r.drones); } },
        { label: 'Total', num: true, value: function (r) { return num(r.total); } },
        { label: 'Source', value: function (r) { return r.source; } },
      ], rows);
    });
  }

  // ---------- boot ----------

  var BUILDERS = {
    launches: chartLaunches,
    ships: chartShips,
    casualties: chartCasualties,
    uae: chartUae,
    'opening-wave': chartOpeningWave,
  };

  function init() {
    var cards = document.querySelectorAll('figure.chart[data-chart]');
    if (!cards.length) return;
    if (!window.Chart) {
      cards.forEach(function (card) { fail(card, new Error('Chart.js did not load')); });
      return;
    }
    window.Chart.defaults.font.family = FONT;
    window.Chart.defaults.font.size = 12;
    window.Chart.defaults.color = COLORS.axis;

    cards.forEach(function (card) {
      var build = BUILDERS[card.getAttribute('data-chart')];
      if (!build) return;
      try {
        build(card).catch(function (err) { fail(card, err); });
      } catch (err) {
        fail(card, err);
      }
    });

    // Re-fit charts to the printed page width, then back to the screen.
    window.addEventListener('beforeprint', function () { charts.forEach(function (c) { c.resize(); }); });
    window.addEventListener('afterprint', function () { charts.forEach(function (c) { c.resize(); }); });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
