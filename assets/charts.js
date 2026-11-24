/* Persian Gulf Daily Summary - charts (spec Section 5).
 * One function per chart: fetch its JSON, compute subtitle values, draw, and fill the "Show data" table.
 * All text goes into the page with textContent, never innerHTML.
 */
(function () {
  'use strict';

  // Dark theme: series colors brightened from the spec palette so they read on charcoal.
  var COLORS = { blue: '#4C86F5', orange: '#E8913A', green: '#5DB37E', grid: '#333333', axis: '#A0A0A0', label: '#E8E8E8', panel: '#1A1A1A' };
  var FONT = '"Inter Tight", "Helvetica Neue", Arial, sans-serif';
  var MONO = '"JetBrains Mono", ui-monospace, Menlo, Consolas, monospace';
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

  var loaded = {};
  function load(file) {
    if (!loaded[file]) loaded[file] = fetchRows(file);
    return loaded[file];
  }

  function fetchRows(file) {
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

  // ---------- panel background (so the chart prints as a dark panel) ----------

  var panelBackground = {
    id: 'panelBackground',
    beforeDraw: function (chart) {
      var ctx = chart.ctx;
      ctx.save();
      ctx.fillStyle = COLORS.panel;
      ctx.fillRect(0, 0, chart.width, chart.height);
      ctx.restore();
    },
  };

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
      ctx.font = '500 ' + size + 'px ' + MONO;
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
          backgroundColor: '#0F0F0F',
          borderColor: '#4A4A4A',
          borderWidth: 1,
          cornerRadius: 0,
          titleFont: { family: FONT, size: 13, weight: 'bold' },
          bodyFont: { family: FONT, size: 13 },
          footerFont: { family: FONT, size: 12, weight: 'normal' },
          padding: 8,
          displayColors: false,
        },
        valueLabels: { mode: 'all' },
      },
      scales: {
        x: { grid: { display: false }, border: { color: '#4A4A4A' }, ticks: { color: COLORS.axis, font: { family: MONO, size: 11 }, autoSkip: true, maxRotation: 0, autoSkipPadding: 10 } },
        y: { beginAtZero: true, grid: { color: COLORS.grid }, border: { display: false }, ticks: { color: COLORS.axis, font: { family: MONO, size: 11 }, callback: function (v) { return num(v); } } },
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
    config.plugins = [panelBackground, valueLabels];
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
            x: { beginAtZero: true, grid: { display: true, color: COLORS.grid }, border: { display: false }, ticks: { callback: function (v) { return num(v); } } },
            y: { beginAtZero: false, grid: { display: false }, border: { display: true, color: '#4A4A4A' }, ticks: { autoSkip: false, color: COLORS.label, font: { family: FONT, size: 13 }, callback: function (_v, i) { return shown[i].country; } } },
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
            legend: { display: true, position: 'top', align: 'start', labels: { boxWidth: 10, boxHeight: 10, color: COLORS.label, font: { family: MONO, size: 11 } } },
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
            legend: { display: true, position: 'bottom', align: 'end', labels: { boxWidth: 10, boxHeight: 10, color: COLORS.label, font: { family: MONO, size: 11 } } },
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
            x: { stacked: true, beginAtZero: true, grid: { display: true, color: COLORS.grid }, border: { display: false }, ticks: { callback: function (v) { return num(v); } } },
            y: { stacked: true, beginAtZero: false, grid: { display: false }, border: { display: true, color: '#4A4A4A' }, ticks: { autoSkip: false, color: COLORS.label, font: { family: FONT, size: 13 }, callback: function (_v, i) { return rows[i].country; } } },
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

  // ---------- key figures (hero strip on daily pages) ----------

  function setFigure(name, value, asof) {
    var box = document.querySelector('[data-figure="' + name + '"]');
    if (!box) return;
    box.querySelector('.figure-value').textContent = value;
    box.querySelector('.figure-asof').textContent = asof;
  }

  function hideFigure(name) {
    var box = document.querySelector('[data-figure="' + name + '"]');
    if (box) box.hidden = true;
  }

  function fillFigures() {
    if (!document.querySelector('[data-figure]')) return;
    load('launches.json').then(function (raw) {
      var r = byDate(raw).pop();
      setFigure('launches', num(r.launched_since_jul7), 'As of ' + shortDate(r.date));
    }).catch(function () { hideFigure('launches'); });
    load('ship_incidents.json').then(function (raw) {
      var rows = byDate(raw);
      var r = rows[rows.length - 1];
      setFigure('ships', num(r.confirmed_incidents), 'As of ' + shortDate(r.date));
      var deaths = rows.filter(function (x) { return x.seafarer_deaths !== null && x.seafarer_deaths !== undefined; }).pop();
      if (deaths) setFigure('seafarers', num(deaths.seafarer_deaths), 'As of ' + shortDate(deaths.date));
      else hideFigure('seafarers');
    }).catch(function () { hideFigure('ships'); hideFigure('seafarers'); });
  }

  // ---------- 6. Brent crude price (outside data: EIA, fetched by scripts/fetch_external.py) ----------

  var usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 });
  var WAR_START = '2026-02-28';

  function chartBrent(card) {
    return load('brent.json').then(function (raw) {
      var rows = byDate(raw);
      var latest = rows[rows.length - 1];
      var prewar = rows.filter(function (r) { return r.date < WAR_START; }).pop();
      var peak = rows.reduce(function (a, b) { return b.price_usd > a.price_usd ? b : a; });
      var sub = 'Latest: ' + usd.format(latest.price_usd) + ' on ' + shortDate(latest.date) +
        (prewar ? '. Last pre-war close: ' + usd.format(prewar.price_usd) + ' on ' + shortDate(prewar.date) : '') +
        '. High: ' + usd.format(peak.price_usd) + ' on ' + shortDate(peak.date);
      setText(card, sub,
        'Column chart of the daily Brent crude spot price from ' + longDate(rows[0].date) + ' to ' + longDate(latest.date) + '. ' + sub + '.',
        rows);
      draw(card, {
        type: 'bar',
        data: {
          labels: rows.map(function (r) { return shortDate(r.date); }),
          datasets: [{
            label: 'Brent, USD per barrel',
            data: rows.map(function (r) { return r.price_usd; }),
            backgroundColor: rows.map(function (r) { return r.date < WAR_START ? '#5A5A5A' : COLORS.orange; }),
            categoryPercentage: 1, barPercentage: 0.8,
          }],
        },
        options: baseOptions({
          plugins: {
            valueLabels: { mode: false },
            tooltip: { callbacks: {
              title: function (items) { return longDate(rows[items[0].dataIndex].date); },
              label: function (item) { return 'Brent: ' + usd.format(item.raw) + ' per barrel'; },
              afterLabel: function (item) { return rows[item.dataIndex].date < WAR_START ? 'Before the war began (Feb 28)' : ''; },
            } },
          },
          scales: { y: { ticks: { callback: function (v) { return '$' + v; } } } },
        }),
      });
      fillTable(card, [
        { label: 'Date', value: function (r) { return longDate(r.date); } },
        { label: 'USD per barrel', num: true, value: function (r) { return usd.format(r.price_usd); } },
      ], rows.slice().reverse());
    });
  }

  // ---------- 7. Strait of Hormuz news coverage (outside data: GDELT) ----------
  // GDELT's own daily intake swings widely (gaps on its side), so the chart shows the share of
  // monitored articles, not raw counts. Days with a small intake are dimmed: their share is noisy.

  var LOW_INTAKE = 10000;

  function chartHormuzCoverage(card) {
    return load('hormuz_coverage.json').then(function (raw) {
      var rows = byDate(raw).filter(function (r) { return r.all_articles; }).map(function (r) {
        return Object.assign({}, r, { share: Math.round((r.articles / r.all_articles) * 100000) / 10 });
      });
      var solid = rows.filter(function (r) { return r.all_articles >= LOW_INTAKE; });
      var latest = solid[solid.length - 1] || rows[rows.length - 1];
      var peak = solid.reduce(function (a, b) { return b.share > a.share ? b : a; }, solid[0] || rows[0]);
      var share = function (v) { return v.toFixed(1); };
      var sub = 'Articles mentioning the strait per 10,000 articles GDELT monitored. Latest full day: ' + share(latest.share) + ' on ' + shortDate(latest.date) +
        '. Peak: ' + share(peak.share) + ' on ' + shortDate(peak.date) + '. Dimmed days: GDELT took in under ' + num(LOW_INTAKE) + ' articles';
      setText(card, sub,
        'Column chart of the daily share of news coverage mentioning the Strait of Hormuz from ' + longDate(rows[0].date) + ' to ' + longDate(rows[rows.length - 1].date) + '. ' + sub + '.',
        rows);
      draw(card, {
        type: 'bar',
        data: {
          labels: rows.map(function (r) { return shortDate(r.date); }),
          datasets: [{
            label: 'Per 10,000 articles',
            data: rows.map(function (r) { return r.share; }),
            backgroundColor: rows.map(function (r) {
              if (r.all_articles < LOW_INTAKE) return '#3A4A66';
              return r.date < WAR_START ? '#5A5A5A' : COLORS.blue;
            }),
            categoryPercentage: 1, barPercentage: 0.8,
          }],
        },
        options: baseOptions({
          plugins: {
            valueLabels: { mode: false },
            tooltip: { callbacks: {
              title: function (items) { return longDate(rows[items[0].dataIndex].date); },
              label: function (item) { return share(item.raw) + ' per 10,000 articles'; },
              afterLabel: function (item) {
                var r = rows[item.dataIndex];
                var lines = [num(r.articles) + ' of ' + num(r.all_articles) + ' articles GDELT monitored'];
                if (r.all_articles < LOW_INTAKE) lines.push('Low GDELT intake that day: treat as rough');
                return lines;
              },
            } },
          },
        }),
      });
      fillTable(card, [
        { label: 'Date', value: function (r) { return longDate(r.date); } },
        { label: 'Per 10,000', num: true, value: function (r) { return share(r.share); } },
        { label: 'Articles', num: true, value: function (r) { return num(r.articles); } },
        { label: 'All monitored', num: true, value: function (r) { return num(r.all_articles); } },
      ], rows.slice().reverse());
    });
  }

  // ---------- 8. Satellite fire detections (outside data: NASA FIRMS) ----------
  // outside_flares: detections away from cells that burned on at least 10% of pre-war days
  // (oil and gas flares). A detection is a heat source seen from orbit, not a confirmed strike.

  function chartFires(card) {
    return load('fires.json').then(function (raw) {
      var rows = byDate(raw);
      var latest = rows[rows.length - 1];
      var prewar = rows.filter(function (r) { return r.date < WAR_START; });
      var avg = prewar.length ? prewar.reduce(function (s, r) { return s + r.outside_flares; }, 0) / prewar.length : null;
      var peak = rows.reduce(function (a, b) { return b.outside_flares > a.outside_flares ? b : a; });
      var sub = 'Detections per day away from routine gas flare sites, Kuwait to the Gulf of Oman. Latest: ' + num(latest.outside_flares) + ' on ' + shortDate(latest.date) +
        (avg !== null ? '. Pre-war daily average: ' + num(Math.round(avg)) : '') + '. Peak: ' + num(peak.outside_flares) + ' on ' + shortDate(peak.date);
      setText(card, sub,
        'Column chart of daily satellite fire detections around the Persian Gulf from ' + longDate(rows[0].date) + ' to ' + longDate(latest.date) + '. ' + sub + '.',
        rows);
      draw(card, {
        type: 'bar',
        data: {
          labels: rows.map(function (r) { return shortDate(r.date); }),
          datasets: [{
            label: 'Away from flare sites',
            data: rows.map(function (r) { return r.outside_flares; }),
            backgroundColor: rows.map(function (r) { return r.date < WAR_START ? '#5A5A5A' : COLORS.orange; }),
            categoryPercentage: 1, barPercentage: 0.8,
          }],
        },
        options: baseOptions({
          plugins: {
            valueLabels: { mode: false },
            tooltip: { callbacks: {
              title: function (items) { return longDate(rows[items[0].dataIndex].date); },
              label: function (item) { return 'Away from flare sites: ' + num(item.raw); },
              afterLabel: function (item) { return 'All detections, flares included: ' + num(rows[item.dataIndex].detections); },
            } },
          },
        }),
      });
      fillTable(card, [
        { label: 'Date', value: function (r) { return longDate(r.date); } },
        { label: 'Away from flares', num: true, value: function (r) { return num(r.outside_flares); } },
        { label: 'All detections', num: true, value: function (r) { return num(r.detections); } },
      ], rows.slice().reverse());
    });
  }

  // ---------- boot ----------

  var BUILDERS = {
    launches: chartLaunches,
    ships: chartShips,
    casualties: chartCasualties,
    uae: chartUae,
    'opening-wave': chartOpeningWave,
    brent: chartBrent,
    'hormuz-coverage': chartHormuzCoverage,
    fires: chartFires,
  };

  function init() {
    fillFigures();
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

  // Draw once the web fonts are ready, so canvas text uses them (fall back after 1.5 s).
  function start() {
    var fontsReady = document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve();
    var timeout = new Promise(function (resolve) { setTimeout(resolve, 1500); });
    Promise.race([fontsReady, timeout]).then(init, init);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
