let currentUser = null;
let supabase = null;

// Game State
let cash = 100000.0;
let holdings = {};
let marketData = {};
let historyCache = {};  // Ticker → prices array (on-demand from stock_history)
let selectedTicker = null;
let currentRange = '6M';
let stockChart = null;
let mainChart = null;

// Stocks page state
let detailChart = null;
let detailTicker = null;
let detailRange = '1M';
let stocksSortCol = 'mktCap';
let stocksSortDir = -1; // -1 = desc, 1 = asc

// Quick modal state
let qmTicker = null;
let qmType = null; // 'BUY' | 'SELL'

// Initialization
let initialized = false;
function init() {
    if (initialized) return;

    // 1. Try to load from Local Cache (Instant Paint)
    const cachedState = localStorage.getItem('game_state');
    if (cachedState) {
        try {
            const data = JSON.parse(cachedState);
            cash = data.cash ?? 100000.0;
            holdings = data.holdings || {};
            console.log("Loaded account data from local cache.");
            renderDashboard();
        } catch(e) { console.warn("Local state cache corrupt."); }
    }

    const cachedMarket = localStorage.getItem('market_data_lite');
    if (cachedMarket) {
        try {
            marketData = JSON.parse(cachedMarket);
            console.log("Loaded market overview from local cache.");
            renderStocksTable();
        } catch(e) { console.warn("Market cache corrupt."); }
    }

    // 2. Wait for Supabase
    if (!window.supabase) {
        setTimeout(init, 50);
        return;
    }
    
    supabase = window.supabase;
    console.log("Simulator logic initialized. Syncing with Supabase...");
    initialized = true;

    loadMarketData();
    setupRangeToggles();
    initCharts();
    setupStocksPage();
    setupSearch(); 
}

// Start init on load
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}

window.addEventListener('GameAuthReady', async (e) => {
    currentUser = e.detail.user;
    console.log("User authenticated:", currentUser.email);
    await loadGameState();
});

async function loadGameState() {
    const { data, error } = await supabase
        .from('game_state')
        .select('cash, holdings')
        .eq('uid', currentUser.id)
        .single();

    if (data) {
        cash = data.cash ?? 100000.0;
        holdings = data.holdings || {};
    } else {
        // Initial state for new user
        cash = 100000.0;
        holdings = {};
        await supabase.from('game_state').insert([{ uid: currentUser.id, cash, holdings }]);
    }

    renderDashboard();

    // Subscribe to portfolio changes
    supabase
        .channel('game_state_updates')
        .on('postgres_changes', { 
            event: 'UPDATE', 
            schema: 'public', 
            table: 'game_state', 
            filter: `uid=eq.${currentUser.id}` 
        }, payload => {
            if (payload.new) {
                cash = payload.new.cash ?? 100000.0;
                holdings = payload.new.holdings || {};
                localStorage.setItem('game_state', JSON.stringify({ cash, holdings }));
                renderDashboard();
            }
        })
        .subscribe();
}

async function loadMarketData() {
    // Paginated fetch — load 500 rows per page to avoid timeout on 6000+ row table
    const PAGE_SIZE = 500;
    let from = 0;
    let keepGoing = true;

    while (keepGoing) {
        const { data, error } = await supabase
            .from('stocks')
            .select('*')
            .range(from, from + PAGE_SIZE - 1);

        if (error) {
            console.error("Supabase stocks fetch error:", error);
            break;
        }

        if (data && data.length > 0) {
            console.log(`[Initial Sync] Received ${data.length} stocks (offset ${from}).`);
            const liteCache = JSON.parse(localStorage.getItem('market_data_lite') || '{}');
            data.forEach(row => {
                marketData[row.symbol] = row;
                liteCache[row.symbol] = {
                    name: row.name,
                    price: row.price,
                    change: row.change,
                    changePercent: row.changePercent,
                    volume: row.volume,
                    dayHigh: row.dayHigh,
                    dayLow: row.dayLow,
                    high52w: row.high52w,
                    low52w: row.low52w,
                    bid: row.bid,
                    ask: row.ask
                };
            });
            localStorage.setItem('market_data_lite', JSON.stringify(liteCache));

            // Render after each page so UI updates progressively
            renderDashboard();
            renderStocksTable();

            from += PAGE_SIZE;
            keepGoing = data.length === PAGE_SIZE; // stop when last page is smaller
        } else {
            keepGoing = false;
            // Ensure we still render default portfolio values (e.g. $100,000 cash) if market is empty
            if (from === 0) {
                renderDashboard();
                renderStocksTable();
            }
        }
    }

    // Subscribe to all price updates
    supabase
        .channel('public:stocks')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'stocks' }, payload => {
            const updated = payload.new;
            if (updated) {
                marketData[updated.symbol] = updated;

                // Refresh relevant UI
                renderDashboard();
                renderStocksTable();
                if (selectedTicker === updated.symbol) renderActiveStock(updated.symbol);
                if (detailTicker === updated.symbol) renderDetailPanel(updated.symbol);
            }
        })
        .subscribe();
}

async function fetchStockHistory(ticker) {
    if (historyCache[ticker]) return historyCache[ticker];
    try {
        const { data, error } = await supabase
            .from('stock_history')
            .select('prices')
            .eq('symbol', ticker)
            .single();
            
        const prices = data ? (data.prices || []) : [];
        historyCache[ticker] = prices;
        return prices;
    } catch (e) {
        console.error(`[History] Failed to fetch history for ${ticker}:`, e);
        return [];
    }
}

async function saveGameState() {
    const { error } = await supabase
        .from('game_state')
        .upsert({ 
            uid: currentUser.id, 
            cash: cash, 
            holdings: holdings 
        });
    if (error) console.error("Error saving game state:", error);
}

/* -------------------------------------------------------------------------- */
/*                                 HELPERS                                    */
/* -------------------------------------------------------------------------- */

function formatMoney(amount) {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount);
}

function formatVolume(v) {
    if (!v && v !== 0) return '—';
    if (v >= 1e9) return (v / 1e9).toFixed(2) + 'B';
    if (v >= 1e6) return (v / 1e6).toFixed(2) + 'M';
    if (v >= 1e3) return (v / 1e3).toFixed(1) + 'K';
    return v.toString();
}

function formatMktCap(v) {
    if (!v && v !== 0) return '—';
    if (v >= 1e12) return '$' + (v / 1e12).toFixed(2) + 'T';
    if (v >= 1e9)  return '$' + (v / 1e9).toFixed(2) + 'B';
    if (v >= 1e6)  return '$' + (v / 1e6).toFixed(2) + 'M';
    return '$' + v.toLocaleString();
}

/* -------------------------------------------------------------------------- */
/*                                 UI RENDERING                               */
/* -------------------------------------------------------------------------- */

function renderDashboard() {
    let totalValue = cash;

    const tbody = document.getElementById('holdings-body');
    if (!tbody) return;
    tbody.innerHTML = '';

    const holdingKeys = Object.keys(holdings);
    let hasHoldings = false;

    for (const t of holdingKeys) {
        const holding = holdings[t];
        const shares = typeof holding === 'number' ? holding : (holding?.shares || 0);
        const avgCost = typeof holding === 'number' ? 0 : (holding?.avgCost || 0);
        if (shares <= 0) continue;

        hasHoldings = true;
        const currentPrice = marketData[t]?.price || avgCost;
        const name = marketData[t]?.name || t;

        const invested = shares * avgCost;
        const currentValue = shares * currentPrice;
        totalValue += currentValue;

        const returnAmt = invested > 0 ? (currentValue - invested) : 0;
        const returnPct = invested > 0 ? ((returnAmt / invested) * 100) : 0;
        const retColor = returnAmt >= 0 ? 'pos-change' : 'neg-change';
        const retSign = returnAmt >= 0 ? '+' : '';

        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>
                <div class="ticker-cell">
                    <span>${t}</span>
                    <span class="ticker-name">${name}</span>
                </div>
            </td>
            <td>${shares}</td>
            <td>${formatMoney(avgCost)}</td>
            <td>${formatMoney(currentPrice)}</td>
            <td class="${retColor}">${retSign}${formatMoney(returnAmt)}<br><span style="font-size:0.8rem;">(${retSign}${returnPct.toFixed(2)}%)</span></td>
            <td>
                <div class="holding-actions">
                    <button class="btn-hold-buy" onclick="openQuickModal('${t}','BUY')">Buy+</button>
                    <button class="btn-hold-sell" onclick="openQuickModal('${t}','SELL')">Sell</button>
                </div>
            </td>
        `;
        tbody.appendChild(tr);
    }

    if (!hasHoldings) {
        tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;color:#9ca3af;padding:2rem 0;">No holdings yet. Search for a stock to buy!</td></tr>`;
    }

    document.getElementById('val-cash').textContent = formatMoney(cash);
    document.getElementById('val-total').textContent = formatMoney(totalValue);

    const overallReturnAmt = totalValue - 100000;
    const overallReturnPct = (overallReturnAmt / 100000) * 100;
    const retColor = overallReturnAmt >= 0 ? 'pos-change' : 'neg-change';
    const retSign = overallReturnAmt >= 0 ? '+' : '';

    const returnEl = document.getElementById('val-return');
    returnEl.textContent = `${retSign}${formatMoney(overallReturnAmt)} (${retSign}${overallReturnPct.toFixed(2)}%)`;
    returnEl.className = `stat-change ${retColor}`;

    updatePortfolioChart(totalValue);
}

function updatePortfolioChart(currentTotal) {
    if (!mainChart) return;
    mainChart.data.labels = ['Initial', 'Current'];
    mainChart.data.datasets[0].data = [100000, currentTotal];
    const isUp = currentTotal >= 100000;
    mainChart.data.datasets[0].borderColor = isUp ? '#2e7d32' : '#d32f2f';
    mainChart.data.datasets[0].backgroundColor = isUp ? 'rgba(46, 125, 50, 0.1)' : 'rgba(211, 47, 47, 0.1)';
    mainChart.update();
}

/* -------------------------------------------------------------------------- */
/*                              STOCKS PAGE                                   */
/* -------------------------------------------------------------------------- */

function setupStocksPage() {
    // Table header sort
    document.querySelectorAll('.stocks-table th[data-col]').forEach(th => {
        th.addEventListener('click', () => {
            const col = th.dataset.col;
            if (stocksSortCol === col) {
                stocksSortDir *= -1;
            } else {
                stocksSortCol = col;
                stocksSortDir = col === 'ticker' ? 1 : -1;
            }
            // Update sort icon styling
            document.querySelectorAll('.stocks-table th .sort-icon').forEach(el => el.classList.remove('active'));
            th.querySelector('.sort-icon').classList.add('active');
            renderStocksTable();
        });
    });

    // Stocks page search (init state — before a detail card is shown)
    setupStocksSearch('stocks-search-input-init', 'stocks-search-results-init');

    // Detail range toggles
    document.querySelectorAll('#detail-range-row .detail-range-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('#detail-range-row .detail-range-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            detailRange = btn.dataset.range;
            if (detailTicker) updateDetailChart(detailTicker);
        });
    });

    // Detail trade buttons
    document.getElementById('detail-btn-buy')?.addEventListener('click', () => {
        if (!detailTicker) return;
        openQuickModal(detailTicker, 'BUY');
    });
    document.getElementById('detail-btn-sell')?.addEventListener('click', () => {
        if (!detailTicker) return;
        openQuickModal(detailTicker, 'SELL');
    });
}

function renderStocksTable() {
    const tbody = document.getElementById('stocks-tbody');
    if (!tbody) return;

    const tickers = Object.keys(marketData);

    // Count display
    const countEl = document.getElementById('stocks-count');
    if (countEl) countEl.textContent = `${tickers.length} stocks`;

    // Sort
    tickers.sort((a, b) => {
        let va, vb;
        const mdA = marketData[a];
        const mdB = marketData[b];
        switch (stocksSortCol) {
            case 'ticker':    va = a; vb = b; break;
            case 'price':     va = mdA.price || 0; vb = mdB.price || 0; break;
            case 'change':    va = mdA.change || 0; vb = mdB.change || 0; break;
            case 'changePct': va = mdA.changePercent || 0; vb = mdB.changePercent || 0; break;
            case 'volume':    va = mdA.volume || 0; vb = mdB.volume || 0; break;
            case 'mktCap':    va = (mdA.price || 0) * (mdA.volume || 0); vb = (mdB.price || 0) * (mdB.volume || 0); break;
            default:          va = 0; vb = 0;
        }
        if (typeof va === 'string') return stocksSortDir * va.localeCompare(vb);
        return stocksSortDir * (va - vb);
    });

    // Take top 25
    const top50 = tickers.slice(0, 25);

    tbody.innerHTML = '';
    top50.forEach(t => {
        const d = marketData[t];
        const price = d.price || 0;
        const change = d.change || 0;
        const changePct = d.changePercent || 0;
        const vol = d.volume || 0;
        const mktCap = price * vol;

        const cSign = change >= 0 ? '+' : '';
        const cColor = change >= 0 ? '#2e7d32' : '#d32f2f';

        const tr = document.createElement('tr');
        tr.style.cursor = 'pointer';
        tr.innerHTML = `
            <td><span class="sym">${t}</span><span class="co-name">${d.name || ''}</span></td>
            <td>${formatMoney(price)}</td>
            <td style="color:${cColor};font-weight:600;">${cSign}${formatMoney(change)}</td>
            <td style="color:${cColor};font-weight:600;">${cSign}${changePct.toFixed(2)}%</td>
            <td>${formatVolume(vol)}</td>
            <td>${formatMktCap(mktCap)}</td>
        `;
        tr.addEventListener('click', () => selectDetailStock(t));
        tbody.appendChild(tr);
    });
}

function selectDetailStock(ticker) {
    detailTicker = ticker;

    // Show filled state, hide placeholder; keep search bar always visible
    document.getElementById('detail-placeholder-state').style.display = 'none';
    document.getElementById('detail-filled-state').style.display = 'block';

    renderDetailPanel(ticker);
    updateDetailChart(ticker);
}

function renderDetailPanel(ticker) {
    const d = marketData[ticker];
    if (!d) return;

    document.getElementById('detail-ticker').textContent = ticker;
    document.getElementById('detail-name').textContent = d.name || '';
    document.getElementById('detail-price').textContent = formatMoney(d.price || 0);

    const change = d.change || 0;
    const changePct = d.changePercent || 0;
    const sign = change >= 0 ? '+' : '';
    const changeEl = document.getElementById('detail-change');
    changeEl.textContent = `${sign}${formatMoney(change)} (${sign}${changePct.toFixed(2)}%)`;
    changeEl.style.color = change >= 0 ? '#2e7d32' : '#d32f2f';

    // Stats
    const price = d.price || 0;
    document.getElementById('detail-dayhi').textContent  = d.dayHigh  ? formatMoney(d.dayHigh)  : formatMoney(price * 1.01);
    document.getElementById('detail-daylo').textContent  = d.dayLow   ? formatMoney(d.dayLow)   : formatMoney(price * 0.99);
    document.getElementById('detail-52hi').textContent   = d.high52w  ? formatMoney(d.high52w)  : '—';
    document.getElementById('detail-52lo').textContent   = d.low52w   ? formatMoney(d.low52w)   : '—';
    document.getElementById('detail-vol').textContent    = formatVolume(d.volume);
    document.getElementById('detail-mktcap').textContent = formatMktCap((d.price || 0) * (d.volume || 0));
    document.getElementById('detail-bid').textContent    = d.bid  ? formatMoney(d.bid)  : '—';
    document.getElementById('detail-ask').textContent    = d.ask  ? formatMoney(d.ask)  : '—';
}

async function updateDetailChart(ticker) {
    if (!detailChart) initDetailChart();
    
    // Fetch history on-demand from the 'stock_history' collection
    const history = await fetchStockHistory(ticker);
    if (!history || history.length === 0) {
        detailChart.data.labels = [];
        detailChart.data.datasets[0].data = [];
        detailChart.update();
        return;
    }

    const filtered = filterHistory(history, detailRange);

    if (filtered.length === 0) {
        detailChart.data.labels = [];
        detailChart.data.datasets[0].data = [];
        detailChart.update();
        return;
    }

    detailChart.data.labels = filtered.map(d => d.date);
    detailChart.data.datasets[0].data = filtered.map(d => d.price);

    detailChart.data.datasets[0].borderColor = '#2b4224'; // forest green
    detailChart.data.datasets[0].backgroundColor = 'rgba(237, 240, 228, 0.7)'; // cream
    detailChart.update();
}

function setupStocksSearch(inputId, resultsId) {
    const input = document.getElementById(inputId);
    const resultsEl = document.getElementById(resultsId);
    if (!input || !resultsEl) return;

    input.addEventListener('input', (e) => {
        const val = e.target.value.toUpperCase().trim();
        resultsEl.innerHTML = '';
        if (val.length < 1) { resultsEl.style.display = 'none'; return; }

        const keys = Object.keys(marketData);
        if (keys.length === 0) {
            resultsEl.innerHTML = `<div class="search-result-item" style="color:#9ca3af;">Connecting…</div>`;
            resultsEl.style.display = 'block';
            return;
        }

        const matches = keys.filter(k => {
            return k.includes(val) || (marketData[k].name || '').toUpperCase().includes(val);
        }).slice(0, 10);

        if (matches.length > 0) {
            matches.forEach(t => {
                const md = marketData[t];
                const cc = (md.change || 0) >= 0 ? '#2e7d32' : '#d32f2f';
                const div = document.createElement('div');
                div.className = 'search-result-item';
                div.innerHTML = `
                    <div><strong>${t}</strong> <span style="font-size:0.75rem;opacity:0.6;margin-left:8px;">${md.name || ''}</span></div>
                    <div style="color:${cc};font-weight:600;">${formatMoney(md.price)}</div>
                `;
                div.addEventListener('click', () => {
                    input.value = '';
                    resultsEl.style.display = 'none';
                    selectDetailStock(t);
                });
                resultsEl.appendChild(div);
            });
            resultsEl.style.display = 'block';
        } else {
            resultsEl.innerHTML = `<div class="search-result-item" style="color:#9ca3af;">No results</div>`;
            resultsEl.style.display = 'block';
        }
    });

    document.addEventListener('click', (e) => {
        if (!input.contains(e.target) && !resultsEl.contains(e.target)) {
            resultsEl.style.display = 'none';
        }
    });
}

/* -------------------------------------------------------------------------- */
/*                                  CHARTING                                  */
/* -------------------------------------------------------------------------- */

function initCharts() {
    const ctxMain = document.getElementById('mainChart')?.getContext('2d');
    if (!ctxMain) return;

    mainChart = new Chart(ctxMain, {
        type: 'line',
        data: { labels: [], datasets: [{ label: 'Portfolio', data: [], fill: true, borderColor: '#3d6133', backgroundColor: 'rgba(61, 97, 51, 0.1)', borderWidth: 2 }] },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false }, tooltip: { mode: 'index', intersect: false } },
            scales: {
                x: { display: true, grid: { display: false }, ticks: { color: '#9ca3af', font: { size: 10 } } },
                y: { grid: { color: 'rgba(43,66,36,0.05)' }, ticks: { color: '#9ca3af', font: { size: 10 }, callback: v => '$' + v.toLocaleString() } }
            },
            elements: { point: { radius: 0 }, line: { tension: 0.4 } }
        }
    });
}

function initDetailChart() {
    const ctx = document.getElementById('detailChart')?.getContext('2d');
    if (!ctx || detailChart) return;

    detailChart = new Chart(ctx, {
        type: 'line',
        data: { labels: [], datasets: [{ label: 'Price', data: [], fill: true, borderColor: '#2b4224', backgroundColor: 'rgba(237, 240, 228, 0.7)', borderWidth: 2, pointRadius: 0 }] },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false }, tooltip: { mode: 'index', intersect: false } },
            scales: {
                x: { display: true, grid: { display: false }, ticks: { color: '#9ca3af', font: { size: 10 }, maxTicksLimit: 6 } },
                y: { grid: { color: 'rgba(43,66,36,0.05)' }, ticks: { color: '#9ca3af', font: { size: 10 }, callback: v => '$' + v.toLocaleString() } }
            },
            elements: { point: { radius: 0 }, line: { tension: 0.4 } }
        }
    });
}

function setupRangeToggles() {
    document.querySelectorAll('#portfolio-range-toggles .range-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('#portfolio-range-toggles .range-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
        });
    });

    document.querySelectorAll('#stock-range-toggles .range-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('#stock-range-toggles .range-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            currentRange = btn.dataset.range;
            if (selectedTicker) updateStockChart(selectedTicker);
        });
    });
}

async function updateStockChart(ticker) {
    if (!stockChart) return;
    
    // Fetch history on-demand from the 'stock_history' collection
    const history = await fetchStockHistory(ticker);
    if (!history || history.length === 0) {
        stockChart.data.labels = [];
        stockChart.data.datasets[0].data = [];
        stockChart.update();
        return;
    }

    const filtered = filterHistory(history, currentRange);

    stockChart.data.labels = filtered.map(d => d.date);
    stockChart.data.datasets[0].data = filtered.map(d => d.price);

    const firstPrice = filtered[0]?.price;
    const lastPrice  = filtered[filtered.length - 1]?.price;
    const color = (lastPrice >= firstPrice) ? '#2e7d32' : '#d32f2f';
    const bg    = (lastPrice >= firstPrice) ? 'rgba(46,125,50,0.1)' : 'rgba(211,47,47,0.1)';
    stockChart.data.datasets[0].borderColor = color;
    stockChart.data.datasets[0].backgroundColor = bg;
    stockChart.update();
}

function filterHistory(history, range) {
    const now = new Date();
    let days = 365;
    if (range === '1W') days = 7;
    else if (range === '1M') days = 30;
    else if (range === '3M') days = 90;
    else if (range === '6M') days = 180;
    else if (range === '5Y') days = 1825;

    const cutoff = new Date();
    cutoff.setDate(now.getDate() - days);
    return history.filter(h => new Date(h.date) >= cutoff);
}

/* -------------------------------------------------------------------------- */
/*                                  PORTFOLIO SEARCH                          */
/* -------------------------------------------------------------------------- */

function setupSearch() {
    const input = document.getElementById('stock-search');
    const resultsContainer = document.getElementById('search-results');
    if (!input || !resultsContainer) return;

    input.addEventListener('input', (e) => {
        const val = e.target.value.toUpperCase().trim();
        resultsContainer.innerHTML = '';

        if (val.length < 1) { resultsContainer.style.display = 'none'; return; }

        const keys = Object.keys(marketData);
        if (keys.length === 0) {
            resultsContainer.innerHTML = `<div class="search-result-item" style="color:#9ca3af;cursor:default;">Connecting to market...</div>`;
            resultsContainer.style.display = 'block';
            return;
        }

        const matches = keys.filter(k => {
            return k.toUpperCase().includes(val) || (marketData[k].name || '').toUpperCase().includes(val);
        }).slice(0, 10);

        if (matches.length > 0) {
            matches.forEach(t => {
                const md = marketData[t];
                const ccolor = (md.change >= 0) ? '#2e7d32' : '#d32f2f';
                const div = document.createElement('div');
                div.className = 'search-result-item';
                div.innerHTML = `
                    <div><strong>${t}</strong> <span style="font-size:0.75rem;opacity:0.6;margin-left:8px;">${md.name || ''}</span></div>
                    <div style="color:${ccolor};font-weight:600;">${formatMoney(md.price)}</div>
                `;
                div.addEventListener('click', () => {
                    input.value = '';
                    resultsContainer.style.display = 'none';
                    selectStock(t);
                });
                resultsContainer.appendChild(div);
            });
            resultsContainer.style.display = 'block';
        } else {
            resultsContainer.innerHTML = `<div class="search-result-item" style="color:#9ca3af;cursor:default;">No stocks found</div>`;
            resultsContainer.style.display = 'block';
        }
    });

    document.addEventListener('click', (e) => {
        if (e.target !== input && !resultsContainer.contains(e.target)) {
            resultsContainer.style.display = 'none';
        }
    });
}

function selectStock(ticker) {
    selectedTicker = ticker;
    document.getElementById('active-stock').style.display = 'block';
    document.getElementById('trade-placeholder').style.display = 'none';
    document.getElementById('trade-qty').value = '';
    document.getElementById('trade-error').style.display = 'none';
    renderActiveStock(ticker);
}

function renderActiveStock(ticker) {
    if (!marketData[ticker]) return;
    const data = marketData[ticker];

    document.getElementById('selected-ticker').textContent = ticker;
    document.getElementById('selected-name').textContent = data.name || '';
    document.getElementById('selected-price').textContent = formatMoney(data.price || 0);

    const changeEl = document.getElementById('selected-change');
    const change = data.change || 0;
    const changePct = data.changePercent || 0;
    const sign = change >= 0 ? '+' : '';
    changeEl.textContent = `${sign}${formatMoney(change)} (${sign}${changePct.toFixed(2)}%)`;
    changeEl.style.color = change >= 0 ? '#2e7d32' : '#d32f2f';

    updateStockChart(ticker);
}

function setupTradeControls() {
    document.getElementById('btn-buy')?.addEventListener('click', () => processTrade('BUY'));
    document.getElementById('btn-sell')?.addEventListener('click', () => processTrade('SELL'));
}

let tradeInFlight = false;

async function processTrade(type, ticker, qty) {
    if (tradeInFlight) return { error: 'Transaction in progress, please wait...' };
    tradeInFlight = true;

    try {
        const price = marketData[ticker]?.price;
        if (!price) return { error: 'Market data unavailable.' };
        const cost = price * qty;
        
        // Prevent floating point anomalies
        if (cost < 0 || isNaN(cost)) return { error: 'Invalid transaction calculation.' };

        // Ensure holding is an object
        if (!holdings[ticker] || typeof holdings[ticker] !== 'object') {
            holdings[ticker] = { shares: 0, avgCost: 0 };
        }
        const holding = holdings[ticker];

        if (type === 'BUY') {
            if (cost > cash) return { error: 'Insufficient buying power.' };
            cash -= cost;
            const existingVal = (holding.shares || 0) * (holding.avgCost || 0);
            holding.shares = (holding.shares || 0) + qty;
            holding.avgCost = (existingVal + cost) / holding.shares;
        } else {
            if ((holding.shares || 0) < qty) return { error: 'Insufficient shares to sell.' };
            cash += cost;
            holding.shares = (holding.shares || 0) - qty;
            if (holding.shares === 0) delete holdings[ticker];
        }

        await saveGameState();
        
        // Update Local Storage and UI immediately
        localStorage.setItem('game_state', JSON.stringify({ cash, holdings }));
        renderDashboard();
        
        return { success: true };
    } catch (e) {
        console.error("Trade error:", e);
        return { error: 'Failed to process trade. Please check your connection.' };
    } finally {
        tradeInFlight = false;
    }
}

/* -------------------------------------------------------------------------- */
/*                             QUICK MODAL (Holdings)                         */
/* -------------------------------------------------------------------------- */

function openQuickModal(ticker, type) {
    qmTicker = ticker;
    qmType = type;
    const md = marketData[ticker] || {};
    const holding = holdings[ticker];
    const shares = holding?.shares || 0;

    document.getElementById('qm-title').textContent = (type === 'BUY' ? 'Buy More ' : 'Sell ') + ticker;
    document.getElementById('qm-subtitle').textContent = `Price: ${formatMoney(md.price || 0)} · You own ${shares} share${shares !== 1 ? 's' : ''}`;
    document.getElementById('qm-qty').value = '';
    document.getElementById('qm-error').style.display = 'none';
    document.getElementById('qm-success').style.display = 'none';

    const btn = document.getElementById('qm-confirm');
    btn.textContent = type === 'BUY' ? 'Buy Shares' : 'Sell Shares';
    btn.className = 'modal-confirm ' + (type === 'BUY' ? 'buy' : 'sell');

    document.getElementById('quick-modal').classList.add('open');
    document.getElementById('qm-qty').focus();
}

function closeQuickModal() {
    document.getElementById('quick-modal').classList.remove('open');
}

document.getElementById('quick-modal')?.addEventListener('click', (e) => {
    if (e.target === document.getElementById('quick-modal')) closeQuickModal();
});

document.getElementById('qm-confirm')?.addEventListener('click', async () => {
    const qty = parseInt(document.getElementById('qm-qty').value);
    const errEl = document.getElementById('qm-error');
    const sucEl = document.getElementById('qm-success');
    errEl.style.display = 'none';
    sucEl.style.display = 'none';

    if (isNaN(qty) || qty <= 0) {
        errEl.textContent = 'Enter a valid number of shares.';
        errEl.style.display = 'block';
        return;
    }

    const res = await processTrade(qmType, qmTicker, qty);
    if (res?.error) {
        errEl.textContent = res.error;
        errEl.style.display = 'block';
    } else {
        sucEl.textContent = `${qmType === 'BUY' ? 'Bought' : 'Sold'} ${qty} share${qty !== 1 ? 's' : ''} of ${qmTicker}!`;
        sucEl.style.display = 'block';
        document.getElementById('qm-qty').value = '';
        setTimeout(closeQuickModal, 1500);
    }
});
