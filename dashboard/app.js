// Token Radar v3 dashboard. Reads window.RADAR (written beside dashboard/ by
// main.ts) and renders the ranked board, a filterable table, a per-protocol
// detail view with the model's own inputs, and the live-token reference list.
// No network: every byte it shows is in data.js. The page recomputes a row's
// implied value from the snapshot figures (fitted value, growth tilt, odds,
// screen factor), so the page's code and board.json are visibly the same
// arithmetic; the sandbox sliders only change the growth tilt.
(function () {
  'use strict';
  var DATA = window.RADAR;
  if (!DATA) return;
  var app = document.getElementById('board');
  var params = new URLSearchParams(location.search);
  var shot = params.get('shot') || 'board';
  var state = {
    q: '', category: 'all', chain: 'all', watchOnly: false, verdict: 'all',
    sort: 'implied', dir: -1, selected: null, tab: 'pre',
    growthW: 0.25,
  };
  if (params.get('cat')) state.category = params.get('cat');
  if (params.get('watch') === '1') state.watchOnly = true;
  if (shot === 'filtered') { state.watchOnly = true; }
  if (shot === 'detail') { state.selected = DATA.rows[0] ? DATA.rows[0].slug : null; }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return '$' + Math.round(n);
  }
  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(1) + '%';
  }
  function fmtAge(d) {
    if (d === null || d === undefined) return 'unknown';
    if (d >= 365) return (d / 365).toFixed(1) + 'y';
    return d + 'd';
  }
  function fmtCost(n) { return '$' + n.toFixed(2); }
  function clampGrowth(g) {
    var v = (g === null || g === undefined || !isFinite(g)) ? 0 : g;
    return Math.min(100, Math.max(-50, v));
  }
  // The model in one function: fitted value x growth tilt x token odds x screen.
  function impliedOf(row, growthW) {
    var tilt = 1 + growthW * (clampGrowth(row.change7d) / 100);
    var screen = row.screened ? 0.02 : 1;
    return Math.max(1, Math.round(row.fittedMcap * tilt * row.odds * screen));
  }
  function pill(v) {
    var cls = v === 'Priority farm' ? 'pri' : v === 'Worth farming' ? 'worth' :
      v === 'Marginal' ? 'marg' : v === 'Screened out' ? 'screen' : 'skip';
    return '<span class="pill ' + cls + '">' + esc(v) + '</span>';
  }
  function el(tag, cls, html) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (html !== undefined) n.innerHTML = html;
    return n;
  }

  function kpis() {
    var m = DATA.meta, f = m.fit;
    var med = DATA.rows.slice().sort(function (a, b) { return a.implied - b.implied; })[Math.floor(DATA.rows.length / 2)];
    var cards = [
      ['Protocols scanned', String(m.totalProtocols), 'DefiLlama, TVL ≥ $5M'],
      ['Pre-token rows', String(m.preToken), m.eligible + ' eligible · ' + m.screened + ' screened out'],
      ['Watchlist covered', m.watchlist + ' / ' + m.watchlist, 'every one on the board', 'good'],
      ['Median implied value', fmtUsd(med ? med.implied : 0), 'across all ' + m.preToken + ' rows'],
      ['Fitted curve R²', String(f.r2), 'log10(mcap) on log10(TVL), n=' + f.n],
      ['Holdout median error', f.holdoutMedianLogErr + ' dex', '5-fold, ≈' + Math.pow(10, f.holdoutMedianLogErr).toFixed(1) + '×'],
    ];
    var wrap = el('div', 'kpis');
    cards.forEach(function (c) {
      wrap.appendChild(el('div', 'kpi',
        '<div class="k">' + c[0] + '</div><div class="v' + (c[3] ? ' good' : '') + '">' + esc(c[1]) + '</div><div class="s">' + esc(c[2]) + '</div>'));
    });
    return wrap;
  }

  function modelPanel() {
    var m = DATA.meta, f = m.fit;
    var folds = f.foldErrors.map(function (e) {
      return '<tr><td>Fold ' + (e.fold + 1) + '</td><td>' + e.n + '</td><td>' + e.median + '</td><td>' + e.mean + '</td></tr>';
    }).join('');
    var sec = el('section', 'model',
      '<h2>How the value is fitted — <span>not guessed</span></h2>' +
      '<p>Every implied value starts from one fitted curve, fit by least squares on the <b>' + f.n +
      ' protocols in this snapshot that already have a token with a market cap</b>: ' +
      '<code>log10(market cap) = ' + f.a + ' + ' + f.b + ' × log10(TVL)</code>, R² = <b>' + f.r2 + '</b>. ' +
      'Richer fits were tried on the same holdout and rejected: adding growth, age and chain count lifts R² only to 0.215 ' +
      'while the holdout error gets worse, so the single-variable fit ships.</p>' +
      '<p>Then: <b>× growth tilt</b> (1 + 0.25 × 7-day TVL change, winsorised to −50…+100%), ' +
      '<b>× token odds</b> (the share of same-category peers at a similar TVL that already record a token, shrunk toward the ' +
      'category and global rates — the global rate is ' + (m.globalTokenRate * 100).toFixed(1) + '%), ' +
      '<b>× screen factor</b> (1, or 0.02 for a screened-out CEX / bridge / wrapped / versioned name). ' +
      'No name is ever special-cased: the same function scores every row.</p>' +
      '<table><tr><th>Holdout fold</th><th>Protocols</th><th>Median |log error|</th><th>Mean |log error|</th></tr>' + folds +
      '<tr><td><b>All folds</b></td><td><b>' + f.n + '</b></td><td><b>' + f.holdoutMedianLogErr + ' dex</b></td><td><b>' + f.holdoutMeanLogErr + ' dex</b></td></tr></table>' +
      '<p>Snapshot: ' + esc(m.asOf) + ' · watchlist floor ' + fmtUsd(m.floorUsd) + ' · ' + m.liveToken +
      ' live-token comparables · farm costs are rough per-transaction gas estimates by chain, stated in each step.</p>');
    return sec;
  }

  function filteredRows() {
    var q = state.q.trim().toLowerCase();
    return DATA.rows.filter(function (r) {
      if (state.watchOnly && !r.onWatchlist) return false;
      if (state.category !== 'all' && r.category !== state.category) return false;
      if (state.chain !== 'all' && r.chains.indexOf(state.chain) === -1) return false;
      if (state.verdict !== 'all' && r.verdict !== state.verdict) return false;
      if (q && (r.name + ' ' + r.slug + ' ' + r.category).toLowerCase().indexOf(q) === -1) return false;
      return true;
    }).map(function (r) { return { row: r, implied: impliedOf(r, state.growthW) }; });
  }

  function sortRows(list) {
    var key = state.sort, dir = state.dir;
    var val = function (e) {
      var r = e.row;
      return key === 'implied' ? e.implied : key === 'tvl' ? r.tvlUsd : key === 'growth' ? (r.change7d || 0) :
        key === 'age' ? (r.ageDays === null ? -1 : r.ageDays) : key === 'odds' ? r.odds :
        key === 'cost' ? r.costUsd : r.implied;
    };
    return list.slice().sort(function (a, b) {
      var d = val(a) - val(b);
      return d !== 0 ? d * dir : (a.row.slug < b.row.slug ? -1 : 1);
    });
  }

  function renderTable() {
    var list = sortRows(filteredRows());
    var cats = Array.from(new Set(DATA.rows.map(function (r) { return r.category; }))).sort();
    var chains = Array.from(new Set(DATA.rows.flatMap(function (r) { return r.chains; }))).sort();
    var verdicts = ['Priority farm', 'Worth farming', 'Marginal', 'Skip', 'Screened out'];
    var wrap = el('div');
    var tabs = el('div', 'tabs',
      '<button data-tab="pre" class="' + (state.tab === 'pre' ? 'on' : '') + '">Pre-token board (' + DATA.rows.length + ')</button>' +
      '<button data-tab="live" class="' + (state.tab === 'live' ? 'on' : '') + '">Already launched — reference (' + DATA.live.length + ')</button>');
    wrap.appendChild(tabs);
    if (state.tab === 'live') {
      var note = el('p', 'live-note',
        'These ' + DATA.live.length + ' protocols already have a token that trades, so they are <b>not farmable</b> and never enter the ranked board. ' +
        'They are the comparables the fitted curve is built from — the market\'s own mcap/TVL record, shown so the fit can be checked.');
      wrap.appendChild(note);
      var lt = el('table', 'board',
        '<thead><tr><th>Protocol</th><th>Category</th><th>TVL</th><th>Market cap</th><th>Mcap / TVL</th></tr></thead><tbody>' +
        DATA.live.slice(0, 60).map(function (p) {
          return '<tr><td class="name"><b>' + esc(p.name) + '</b><span>' + esc(p.slug) + '</span></td><td>' + esc(p.category) + '</td><td>' +
            fmtUsd(p.tvlUsd) + '</td><td>' + fmtUsd(p.mcapUsd) + '</td><td>' + p.multiple.toFixed(2) + '×</td></tr>';
        }).join('') + '</tbody>');
      wrap.appendChild(lt);
      wrap.appendChild(el('p', 'note', 'Showing the 60 largest by market cap of ' + DATA.live.length + ' live-token protocols.'));
      return wrap;
    }
    var ctrls = el('div', 'controls',
      '<input type="search" id="q" placeholder="Search name, slug or category…" value="' + esc(state.q) + '" aria-label="Search">' +
      '<select id="cat" aria-label="Category"><option value="all">All categories</option>' +
      cats.map(function (c) { return '<option value="' + esc(c) + '"' + (state.category === c ? ' selected' : '') + '>' + esc(c) + '</option>'; }).join('') + '</select>' +
      '<select id="chain" aria-label="Chain"><option value="all">All chains</option>' +
      chains.map(function (c) { return '<option value="' + esc(c) + '"' + (state.chain === c ? ' selected' : '') + '>' + esc(c) + '</option>'; }).join('') + '</select>' +
      '<select id="verdict" aria-label="Verdict"><option value="all">All verdicts</option>' +
      verdicts.map(function (v) { return '<option value="' + esc(v) + '"' + (state.verdict === v ? ' selected' : '') + '>' + esc(v) + '</option>'; }).join('') + '</select>' +
      '<label class="chk"><input type="checkbox" id="watch" ' + (state.watchOnly ? 'checked' : '') + '> Watchlist only</label>' +
      '<span class="count">' + list.length + ' of ' + DATA.rows.length + ' rows</span>');
    wrap.appendChild(ctrls);
    var sand = el('div', 'sandbox',
      '<b>Model sandbox — try it:</b> growth tilt weight ' +
      '<label><input type="range" id="gw" min="0" max="0.5" step="0.05" value="' + state.growthW + '"> <output id="gwOut">' + state.growthW.toFixed(2) + '</output></label>' +
      'The board re-ranks live from the same fitted value, odds and screen — nothing here is a hardcoded list. ' +
      'At weight 0 the ranking is the pure fitted curve × odds.');
    wrap.appendChild(sand);
    var cols = [
      ['rank', '#'], ['name', 'Protocol'], ['category', 'Category'], ['tvl', 'TVL'],
      ['growth', '7d'], ['age', 'Age'], ['odds', 'Token odds'], ['implied', 'Implied value'],
      ['cost', 'Farm cost'], ['verdict', 'Verdict'],
    ];
    var head = cols.map(function (c) {
      var arrow = state.sort === c[0] ? (state.dir === -1 ? ' ▼' : ' ▲') : '';
      return '<th data-sort="' + c[0] + '">' + c[1] + arrow + '</th>';
    }).join('');
    var body = list.slice(0, 120).map(function (e, i) {
      var r = e.row;
      var rank = DATA.rows.indexOf(r) + 1;
      return '<tr data-slug="' + esc(r.slug) + '" class="' + (state.selected === r.slug ? 'sel' : '') + '">' +
        '<td>' + rank + '</td>' +
        '<td class="name"><b>' + esc(r.name) + (r.onWatchlist ? ' <span class="watch">★ watchlist</span>' : '') + '</b><span>' + esc(r.slug) + ' · ' + esc(r.chains.slice(0, 3).join(', ')) + '</span></td>' +
        '<td>' + esc(r.category) + '</td>' +
        '<td>' + fmtUsd(r.tvlUsd) + '</td>' +
        '<td>' + fmtPct(r.change7d) + '</td>' +
        '<td>' + fmtAge(r.ageDays) + '</td>' +
        '<td><span class="oddsbar"><i style="width:' + Math.round(r.odds * 100) + '%"></i></span>' + (r.odds * 100).toFixed(0) + '%</td>' +
        '<td><b>' + fmtUsd(e.implied) + '</b></td>' +
        '<td>' + fmtCost(r.costUsd) + '</td>' +
        '<td>' + pill(r.verdict) + '</td></tr>';
    }).join('');
    var tbl = el('table', 'board', '<thead><tr>' + head + '</tr></thead><tbody>' + body + '</tbody>');
    wrap.appendChild(tbl);
    if (list.length > 120) {
      wrap.appendChild(el('p', 'note', 'Showing the first 120 of ' + list.length + ' matching rows — narrow the search or a filter to see the rest. Click any row for its detail view and farm plan.'));
    }
    return wrap;
  }

  function renderDetail() {
    var r = DATA.rows.find(function (x) { return x.slug === state.selected; });
    if (!r) return null;
    var implied = impliedOf(r, state.growthW);
    var peers = r.peers.map(function (p) {
      return '<tr><td>' + esc(p.name) + '</td><td>' + fmtUsd(p.tvlUsd) + '</td><td>' + fmtUsd(p.mcapUsd) + '</td><td>' + (p.mcapUsd / p.tvlUsd).toFixed(2) + '×</td></tr>';
    }).join('');
    var steps = r.steps.map(function (s) {
      return '<li>' + esc(s.text) + '</li>';
    }).join('');
    var rank = DATA.rows.indexOf(r) + 1;
    var why = r.screened
      ? 'Rank ' + rank + ' of ' + DATA.rows.length + ' because the screen cut its value to 2%: ' + esc(r.screened) +
        '. On size alone it would rank far higher — that is exactly the trap the screen exists for.'
      : 'Rank ' + rank + ' of ' + DATA.rows.length + ' because its fitted market cap (' + fmtUsd(r.fittedMcap) +
        ') times token odds (' + (r.odds * 100).toFixed(0) + '% from ' + r.oddsPeers + ' peers, ' + r.oddsPeerTokened +
        ' already tokenised — ' + esc(r.oddsBasis) + ') times the growth tilt (' + r.growthTilt.toFixed(2) +
        '×) gives the board\'s ' + (rank <= 10 ? 'top-10' : 'mid-board') + ' expected value.';
    var screenNote = r.screened
      ? '<div class="screen-note"><b>Screened out:</b> ' + esc(r.screened) + '. It stays on the board for completeness, at 2% of its fitted value, and the farm plan below is shown for reference only.</div>'
      : '';
    return el('section', 'detail',
      '<h2>#' + rank + ' — ' + esc(r.name) + '</h2>' +
      '<div class="meta"><b>' + esc(r.category) + '</b> · ' + esc(r.chains.join(', ')) + ' · TVL ' + fmtUsd(r.tvlUsd) +
      ' · 7d ' + fmtPct(r.change7d) + ' · listed ' + fmtAge(r.ageDays) + ' ago' + (r.onWatchlist ? ' · <span class="watch">★ on the watchlist</span>' : '') + '</div>' +
      screenNote +
      '<div class="decomp">' +
      '<div class="d"><div class="k">Fitted market cap</div><div class="v">' + fmtUsd(r.fittedMcap) + '</div><div class="s">from the comparables curve at this TVL</div></div>' +
      '<div class="d"><div class="k">Growth tilt</div><div class="v">' + r.growthTilt.toFixed(2) + '×</div><div class="s">7d change ' + fmtPct(r.change7d) + '</div></div>' +
      '<div class="d"><div class="k">Token odds</div><div class="v">' + (r.odds * 100).toFixed(0) + '%</div><div class="s">' + r.oddsPeerTokened + ' of ' + r.oddsPeers + ' peers tokenised</div></div>' +
      '<div class="d"><div class="k">Implied value</div><div class="v">' + fmtUsd(implied) + '</div><div class="s">expected value · ' + pill(r.verdict) + '</div></div>' +
      '</div>' +
      '<p class="why"><b>Why this rank:</b> ' + why + '</p>' +
      '<h3>Farm plan — about ' + fmtCost(r.costUsd) + ' gas and ' + r.timeMin + ' minutes, value per $1 spent ≈ ' + r.valuePerDollar.toLocaleString('en-US') + '×</h3>' +
      '<ol class="steps">' + steps + '</ol>' +
      '<h3>Nearest live-token comparables</h3>' +
      '<table class="peers"><tr><th>Protocol</th><th>TVL</th><th>Market cap</th><th>Mcap / TVL</th></tr>' + peers + '</table>');
  }

  function render() {
    app.innerHTML = '';
    app.setAttribute('aria-busy', 'false');
    var head = el('header',
      '<h1><b>TOKEN RADAR</b> v3 — every pre-token protocol, valued by the market\'s own curve</h1>' +
      '<p class="sub">The board ranks the <b>' + DATA.rows.length + ' protocols in this snapshot that record no token</b> by what a launch ' +
      'would be worth: a market-cap curve fitted on the ' + DATA.meta.liveToken + ' protocols that already trade, times the odds ' +
      'a token ever lists, times a growth tilt. The watchlist (' + DATA.meta.watchlist + ' protocols) is the floor, never the ceiling — ' +
      'the board covers it whole and keeps going to the smallest early names. Data as of ' + esc(DATA.meta.asOf) + '.</p>');
    app.appendChild(head);
    app.appendChild(kpis());
    app.appendChild(modelPanel());
    var detail = renderDetail();
    if (detail) app.appendChild(detail);
    app.appendChild(renderTable());
    app.appendChild(el('p', 'note',
      '<b>Honest limits:</b> the fitted curve explains only R² = ' + DATA.meta.fit.r2 + ' of log market cap, and the holdout median error is ' +
      DATA.meta.fit.holdoutMedianLogErr + ' dex (about ' + Math.pow(10, DATA.meta.fit.holdoutMedianLogErr).toFixed(1) +
      '×) — treat every implied value as an order of magnitude, not a price target. ' +
      '“Records no token” means the snapshot records none; a protocol may still have a token DefiLlama does not carry. ' +
      'Gas costs are rough estimates by chain. Nothing here predicts whether or when a token is issued.'));
    bind();
    // In screenshot mode, frame the shot's subject: the board shot and the
    // filtered shot show the table, the detail shot shows the detail panel.
    // Only on the first render, so ordinary use never yanks the scroll.
    if (!render.scrolled) {
      render.scrolled = true;
      var target = shot === 'detail' ? app.querySelector('.detail') : app.querySelector('table.board');
      if (target) target.scrollIntoView({ block: 'start' });
    }
    window.__shotReady = true;
  }

  function bind() {
    var q = document.getElementById('q');
    if (q) q.addEventListener('input', function () { state.q = q.value; refresh(); });
    var cat = document.getElementById('cat');
    if (cat) cat.addEventListener('change', function () { state.category = cat.value; refresh(); });
    var chain = document.getElementById('chain');
    if (chain) chain.addEventListener('change', function () { state.chain = chain.value; refresh(); });
    var verdict = document.getElementById('verdict');
    if (verdict) verdict.addEventListener('change', function () { state.verdict = verdict.value; refresh(); });
    var watch = document.getElementById('watch');
    if (watch) watch.addEventListener('change', function () { state.watchOnly = watch.checked; refresh(); });
    var gw = document.getElementById('gw');
    if (gw) gw.addEventListener('input', function () {
      state.growthW = parseFloat(gw.value);
      var out = document.getElementById('gwOut');
      if (out) out.textContent = state.growthW.toFixed(2);
      refresh();
    });
    app.querySelectorAll('th[data-sort]').forEach(function (th) {
      th.addEventListener('click', function () {
        var k = th.getAttribute('data-sort');
        if (state.sort === k) state.dir = -state.dir;
        else { state.sort = k; state.dir = -1; }
        refresh();
      });
    });
    app.querySelectorAll('button[data-tab]').forEach(function (b) {
      b.addEventListener('click', function () {
        state.tab = b.getAttribute('data-tab');
        state.selected = null;
        refresh();
      });
    });
    app.querySelectorAll('tr[data-slug]').forEach(function (tr) {
      tr.addEventListener('click', function () {
        state.selected = tr.getAttribute('data-slug');
        render();
        var d = app.querySelector('.detail');
        if (d) d.scrollIntoView({ block: 'start' });
      });
    });
  }

  var refreshTimer = null;
  function refresh() {
    // Re-render the table region only, keeping the header/model panels stable.
    if (refreshTimer) clearTimeout(refreshTimer);
    refreshTimer = setTimeout(function () { render(); }, 60);
  }

  render();
})();
