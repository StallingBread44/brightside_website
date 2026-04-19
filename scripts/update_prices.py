import yfinance as yf
import firebase_admin
from firebase_admin import credentials
from firebase_admin import firestore
import pandas as pd
import time
import os
import requests
from datetime import datetime, timezone
import schedule
from dotenv import load_dotenv

# Load environment variables from .env file (if present)
load_dotenv()

# ---------------------------------------------------------
# CONSTANTS & CONFIG
# ---------------------------------------------------------
SERVICE_ACCOUNT_PATH = os.getenv('FIREBASE_CREDENTIALS_PATH', 'serviceAccountKey.json')
BATCH_SIZE = 50
MAX_HISTORY_POINTS = 365 * 5  # Cap: 5 years of daily points

try:
    if not os.path.exists(SERVICE_ACCOUNT_PATH):
        print(f"ERROR: {SERVICE_ACCOUNT_PATH} not found.")
        print("Please configure the FIREBASE_CREDENTIALS_PATH in your .env file")
        print("to point to a secure location outside your Git repository.")
        exit(1)

    cred = credentials.Certificate(SERVICE_ACCOUNT_PATH)
    firebase_admin.initialize_app(cred)
    db = firestore.client()
    print("Successfully connected to Firebase Firestore.")
except Exception as e:
    print(f"Failed to initialize Firebase: {e}")
    exit(1)


def get_top_tickers():
    """
    Fetches the S&P 500 list from Wikipedia.
    Returns a dict of { ticker: company_name }.
    """
    print("Fetching top 500 tickers from Wikipedia (S&P 500)...")
    try:
        url = 'https://en.wikipedia.org/wiki/List_of_S%26P_500_companies'
        headers = {'User-Agent': 'Mozilla/5.0'}
        
        response = requests.get(url, headers=headers)
        response.raise_for_status()
        
        # Try pandas first with explicit parser
        try:
            tables = pd.read_html(response.text, flavor='lxml')
            df = tables[0]
        except:
            # Fallback to html5lib if lxml fails
            try:
                tables = pd.read_html(response.text, flavor='html5lib')
                df = tables[0]
            except:
                # Manual parsing with BeautifulSoup as last resort
                from bs4 import BeautifulSoup
                soup = BeautifulSoup(response.text, 'html.parser')
                table = soup.find('table', {'id': 'constituents'})
                
                tickers = []
                names = []
                
                for row in table.find_all('tr')[1:]:  # Skip header
                    cols = row.find_all('td')
                    if len(cols) >= 2:
                        ticker = cols[0].text.strip().replace('.', '-')
                        name = cols[1].text.strip()
                        tickers.append(ticker)
                        names.append(name)
                
                ticker_map = dict(zip(tickers, names))
                print(f"Found {len(ticker_map)} tickers (via BeautifulSoup).")
                return ticker_map
        
        tickers = df['Symbol'].str.replace('.', '-').tolist()
        names = df['Security'].tolist()
        ticker_map = dict(zip(tickers, names))
        print(f"Found {len(ticker_map)} tickers.")
        return ticker_map
        
    except Exception as e:
        print(f"Error fetching tickers: {e}")
        print("Using fallback ticker list...")
        return {
            "AAPL": "Apple Inc.", "MSFT": "Microsoft", "JNJ": "Johnson & Johnson",
            "V": "Visa", "PG": "Procter & Gamble", "JPM": "JPMorgan Chase",
            "UNH": "UnitedHealth", "HD": "Home Depot", "DIS": "Walt Disney",
            "BAC": "Bank of America"
        }


def safe_float(value, fallback=0.0):
    """Safely cast a value to float, returning fallback on failure."""
    try:
        return round(float(value), 2)
    except (TypeError, ValueError):
        return fallback


def build_updated_prices(existing_prices: list, today_str: str, current_price: float) -> list:
    """
    Hybrid history logic:
      - If the last entry is today → update its price in-place (intraday refresh).
      - If the last entry is a prior day → append a new point (daily rollup).
    Always caps the array at MAX_HISTORY_POINTS.
    """
    prices = list(existing_prices)  # avoid mutating the original

    if prices and prices[-1].get('date') == today_str:
        # Intraday update: replace today's price with the latest value
        prices[-1]['price'] = current_price
    else:
        # New trading day: append a fresh point
        prices.append({'date': today_str, 'price': current_price})

    # Trim oldest entries if we've exceeded the cap
    return prices[-MAX_HISTORY_POINTS:]


def update_stock_prices():
    ticker_map = get_top_tickers()
    tickers = list(ticker_map.keys())
    today_str = datetime.now(timezone.utc).strftime('%Y-%m-%d')

    print(f"Starting price update for {len(tickers)} stocks (date: {today_str})...")

    for i in range(0, len(tickers), BATCH_SIZE):
        batch_tickers = tickers[i:i + BATCH_SIZE]
        tickers_str = " ".join(batch_tickers)
        batch_num = i // BATCH_SIZE + 1
        total_batches = (len(tickers) + BATCH_SIZE - 1) // BATCH_SIZE

        print(f"\nBatch {batch_num}/{total_batches} ({len(batch_tickers)} stocks)...")

        try:
            data = yf.Tickers(tickers_str)
            valid_updates = 0

            for ticker in batch_tickers:
                try:
                    t = data.tickers[ticker]
                    hist = t.history(period="1d")

                    if hist.empty:
                        continue

                    current_price = safe_float(hist['Close'].iloc[-1])
                    info = t.info  # single call; cache implicitly by yfinance

                    prev_close = safe_float(info.get('previousClose'), current_price)
                    change = round(current_price - prev_close, 2)
                    change_pct = round((change / prev_close) * 100, 4) if prev_close else 0.0

                    # --- Fetch extended stats for the right panel ---
                    day_high   = safe_float(info.get('dayHigh'))
                    day_low    = safe_float(info.get('dayLow'))
                    high_52w   = safe_float(info.get('fiftyTwoWeekHigh'))
                    low_52w    = safe_float(info.get('fiftyTwoWeekLow'))
                    bid        = safe_float(info.get('bid'))
                    ask        = safe_float(info.get('ask'))
                    volume     = int(info.get('volume') or 0)

                    # --- 1. Live data → 'stocks' collection (lightweight) ---
                    db.collection('stocks').document(ticker).set({
                        'symbol':        ticker,
                        'name':          ticker_map.get(ticker, ticker),
                        'price':         current_price,
                        'change':        change,
                        'changePercent': change_pct,
                        'volume':        volume,
                        'dayHigh':       day_high,
                        'dayLow':        day_low,
                        'high52w':       high_52w,
                        'low52w':        low_52w,
                        'bid':           bid,
                        'ask':           ask,
                        'updatedAt':     firestore.SERVER_TIMESTAMP
                    }, merge=True)

                    # --- 2. History → 'stock_history' collection ---
                    history_ref = db.collection('stock_history').document(ticker)
                    existing_doc = history_ref.get()
                    existing_prices = []
                    if existing_doc.exists:
                        existing_prices = existing_doc.to_dict().get('prices', [])

                    updated_prices = build_updated_prices(existing_prices, today_str, current_price)

                    history_ref.set({
                        'symbol':  ticker,
                        'prices':  updated_prices,
                        'updatedAt': firestore.SERVER_TIMESTAMP
                    }, merge=True)

                    valid_updates += 1

                except Exception as e:
                    # Individual ticker errors (delisted, bad data) should not abort the batch
                    print(f"  [ERROR] {ticker}: {e}")

            print(f"  {valid_updates}/{len(batch_tickers)} stocks updated.")

        except Exception as e:
            print(f"  [BATCH ERROR] {e}")

        time.sleep(1)

    print("\nStock update complete.")


def schedule_updates():
    """Run an immediate update, then schedule subsequent runs every 10 minutes."""
    print("Running initial price update...")
    update_stock_prices()  # Run immediately on startup

    schedule.every(10).minutes.do(update_stock_prices)
    print(f"\nScheduler initialized. Next update in 10 minutes.")

    while True:
        schedule.run_pending()
        time.sleep(30)  # Check if a job is pending every 30 seconds


if __name__ == "__main__":
    schedule_updates()
