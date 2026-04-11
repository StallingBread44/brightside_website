let currentUser = null;
let db = null;
let fModules = null;

// Game State
let cash = 100000.0;
let holdings = {}; // { AAPL: { shares: 10, avgCost: 150.0 } }
let marketData = {}; // { AAPL: { price: 155.0, change: 5.0, changePercent: 3.2, name: 'Apple Inc.' } }
let selectedTicker = null;

/* -------------------------------------------------------------------------- */
/*                                INITIALIZATION                              */
/* -------------------------------------------------------------------------- */

window.addEventListener('GameAuthReady', async (e) => {
    currentUser = e.detail.user;
    db = window.db;
    fModules = window.firebaseModules;
    
    // Load User State
    await loadGameState();
    
    // Load Market Data
    loadMarketData();
    
    // Setup Listeners
    setupSearch();
    setupTradeControls();
});

async function loadGameState() {
    const { doc, getDoc, setDoc } = fModules;
    const userDocRef = doc(db, 'game_state', currentUser.uid);
    const snap = await getDoc(userDocRef);
    
    if (snap.exists()) {
        const data = snap.data();
        cash = data.cash ?? 100000.0;
        holdings = data.holdings || {};
    } else {
        // Initialize new user
        cash = 100000.0;
        holdings = {};
        await setDoc(userDocRef, { cash, holdings });
    }
    
    // Set a live snapshot listener for cross-tab sync
    const { onSnapshot } = fModules;
    onSnapshot(userDocRef, (docSnap) => {
        if (docSnap.exists()) {
            const data = docSnap.data();
            cash = data.cash ?? 100000.0;
            holdings = data.holdings || {};
            renderDashboard();
        }
    });
}

function loadMarketData() {
    const { collection, getDocs, onSnapshot } = fModules;
    
    // Set up a listener for real-time price updates scraped from Python
    onSnapshot(collection(db, 'stocks'), (snapshot) => {
        snapshot.forEach((doc) => {
            marketData[doc.id] = doc.data();
        });
        
        // Re-render UI with new prices
        renderDashboard();
        if (selectedTicker) renderActiveStock(selectedTicker);
    });
}

async function saveGameState() {
    const { doc, setDoc } = fModules;
    const userDocRef = doc(db, 'game_state', currentUser.uid);
    await setDoc(userDocRef, { cash, holdings }, { merge: true });
}

/* -------------------------------------------------------------------------- */
/*                                 UI RENDERING                               */
/* -------------------------------------------------------------------------- */

function formatMoney(amount) {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount);
}

function renderDashboard() {
    // 1. Calculate Portfolio Value
    let totalValue = cash;
    let costBasis = cash; // purely for tracking total return
    
    const tbody = document.getElementById('holdings-body');
    tbody.innerHTML = '';
    
    const holdingKeys = Object.keys(holdings);
    let totalInvested = 0;
    let currentInvestedValue = 0;

    let hasHoldings = false;
    
    for (const t of holdingKeys) {
        const holding = holdings[t];
        if (holding.shares <= 0) continue;
        
        hasHoldings = true;
        const currentPrice = marketData[t]?.price || holding.avgCost;
        const name = marketData[t]?.name || t;
        
        const invested = holding.shares * holding.avgCost;
        const currentValue = holding.shares * currentPrice;
        
        totalInvested += invested;
        currentInvestedValue += currentValue;
        totalValue += currentValue;
        
        const returnAmt = currentValue - invested;
        const returnPct = (returnAmt / invested) * 100;
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
            <td>${holding.shares}</td>
            <td>${formatMoney(holding.avgCost)}</td>
            <td>${formatMoney(currentPrice)}</td>
            <td class="${retColor}">${retSign}${formatMoney(returnAmt)} (${retSign}${returnPct.toFixed(2)}%)</td>
        `;
        tbody.appendChild(tr);
    }
    
    if (!hasHoldings) {
        tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;color:#9ca3af;padding:2rem 0;">No holdings yet. Search for a stock to buy!</td></tr>`;
    }

    // 2. Update Top Status
    document.getElementById('val-cash').textContent = formatMoney(cash);
    document.getElementById('val-total').textContent = formatMoney(totalValue);
    
    // Initial cost base is 100,000 for total return
    const overallReturnAmt = totalValue - 100000;
    const overallReturnPct = (overallReturnAmt / 100000) * 100;
    const retColor = overallReturnAmt >= 0 ? 'pos-change' : 'neg-change';
    const retSign = overallReturnAmt >= 0 ? '+' : '';
    
    const returnEl = document.getElementById('val-return');
    returnEl.textContent = `${retSign}${formatMoney(overallReturnAmt)} (${retSign}${overallReturnPct.toFixed(2)}%)`;
    returnEl.className = `stat-change ${retColor}`;
}

/* -------------------------------------------------------------------------- */
/*                                  SEARCH                                    */
/* -------------------------------------------------------------------------- */

function setupSearch() {
    const input = document.getElementById('stock-search');
    const resultsContainer = document.getElementById('search-results');
    
    input.addEventListener('input', (e) => {
        const val = e.target.value.toUpperCase().trim();
        resultsContainer.innerHTML = '';
        
        if (val.length < 1) {
            resultsContainer.style.display = 'none';
            return;
        }
        
        // Filter marketData array
        const keys = Object.keys(marketData);
        const matches = keys.filter(k => 
            k.includes(val) || 
            (marketData[k].name && marketData[k].name.toUpperCase().includes(val))
        ).slice(0, 8); // top 8 matches
        
        if (matches.length > 0) {
            matches.forEach(t => {
                const md = marketData[t];
                let ccolor = md.change >= 0 ? '#2e7d32' : '#d32f2f';
                const div = document.createElement('div');
                div.className = 'search-result-item';
                div.innerHTML = `
                    <div><strong>${t}</strong> <span style="font-size:0.8rem;color:#6b7280;margin-left:8px;">${md.name}</span></div>
                    <div style="color:${ccolor}">${formatMoney(md.price)}</div>
                `;
                div.onclick = () => {
                    input.value = '';
                    resultsContainer.style.display = 'none';
                    selectStock(t);
                };
                resultsContainer.appendChild(div);
            });
            resultsContainer.style.display = 'block';
        } else {
            resultsContainer.style.display = 'none';
        }
    });
    
    // Hide results on outside click
    document.addEventListener('click', (e) => {
        if (e.target !== input && !resultsContainer.contains(e.target)) {
            resultsContainer.style.display = 'none';
        }
    });
}

function selectStock(ticker) {
    selectedTicker = ticker;
    document.getElementById('active-stock').style.display = 'block';
    document.getElementById('trade-qty').value = '';
    document.getElementById('trade-error').style.display = 'none';
    renderActiveStock(ticker);
}

function renderActiveStock(ticker) {
    if (!marketData[ticker]) return; // Data not ready
    const data = marketData[ticker];
    
    document.getElementById('selected-ticker').textContent = ticker;
    document.getElementById('selected-name').textContent = data.name;
    document.getElementById('selected-price').textContent = formatMoney(data.price);
    
    const changeEl = document.getElementById('selected-change');
    const sign = data.change >= 0 ? '+' : '';
    changeEl.textContent = `${sign}${formatMoney(data.change)} (${sign}${data.changePercent.toFixed(2)}%)`;
    changeEl.style.color = data.change >= 0 ? '#2e7d32' : '#d32f2f';
}

/* -------------------------------------------------------------------------- */
/*                                 TRADING LOGIC                              */
/* -------------------------------------------------------------------------- */

function setupTradeControls() {
    const btnBuy = document.getElementById('btn-buy');
    const btnSell = document.getElementById('btn-sell');
    
    btnBuy.addEventListener('click', () => processTrade('BUY'));
    btnSell.addEventListener('click', () => processTrade('SELL'));
}

async function processTrade(type) {
    const errorEl = document.getElementById('trade-error');
    errorEl.style.display = 'none';
    
    if (!selectedTicker || !marketData[selectedTicker]) {
        errorEl.textContent = "Select a stock first.";
        errorEl.style.display = 'block';
        return;
    }
    
    const qtyStr = document.getElementById('trade-qty').value;
    const qty = parseInt(qtyStr);
    if (isNaN(qty) || qty <= 0) {
        errorEl.textContent = "Enter a valid quantity.";
        errorEl.style.display = 'block';
        return;
    }
    
    const price = marketData[selectedTicker].price;
    const cost = price * qty;
    
    // Ensure holding exists locally
    if (!holdings[selectedTicker]) {
        holdings[selectedTicker] = { shares: 0, avgCost: 0 };
    }
    
    const holding = holdings[selectedTicker];
    
    if (type === 'BUY') {
        if (cost > cash) {
            errorEl.textContent = "Insufficient buying power.";
            errorEl.style.display = 'block';
            return;
        }
        // Deduct cash
        cash -= cost;
        // Calculate new average cost
        const existingVal = holding.shares * holding.avgCost;
        const newVal = existingVal + cost;
        holding.shares += qty;
        holding.avgCost = newVal / holding.shares;
        
    } else if (type === 'SELL') {
        if (holding.shares < qty) {
            errorEl.textContent = "Insufficient shares to sell.";
            errorEl.style.display = 'block';
            return;
        }
        // Add to cash
        cash += cost;
        holding.shares -= qty;
        
        // If 0 shares, we can delete it
        if (holding.shares === 0) {
            delete holdings[selectedTicker];
        }
    }
    
    // Save state
    await saveGameState();
    
    // Reset qty
    document.getElementById('trade-qty').value = '';
    
    // Display quick success briefly (optional)
    errorEl.textContent = `Successfully ${type === 'BUY'? 'bought' : 'sold'} ${qty} shares!`;
    errorEl.style.color = '#2e7d32';
    errorEl.style.display = 'block';
    setTimeout(() => {
        errorEl.style.display = 'none';
        errorEl.style.color = '#d32f2f'; // reset color for errors
    }, 2500);
}
