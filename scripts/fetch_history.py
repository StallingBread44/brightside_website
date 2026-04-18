import yfinance as yf
import firebase_admin
from firebase_admin import credentials
from firebase_admin import firestore
import pandas as pd
import time
import os
import requests

# ---------------------------------------------------------
# CONFIG
# ---------------------------------------------------------
SERVICE_ACCOUNT_PATH = 'serviceAccountKey.json'
BATCH_SIZE = 20  # Slower batches for history to avoid rate limits
MAX_HISTORY_POINTS = 365 * 5  # 5 years of daily points

try:
    if not os.path.exists(SERVICE_ACCOUNT_PATH):
        print(f"ERROR: {SERVICE_ACCOUNT_PATH} not found.")
        exit(1)
    cred = credentials.Certificate(SERVICE_ACCOUNT_PATH)
    firebase_admin.initialize_app(cred)
    db = firestore.client()
except Exception as e:
    print(f"Failed to initialize Firebase: {e}")
    exit(1)


def get_top_tickers():
    url = 'https://en.wikipedia.org/wiki/List_of_S%26P_500_companies'
    headers = {'User-Agent': 'Mozilla/5.0'}
    html = requests.get(url, headers=headers).text
    tables = pd.read_html(html)
    df = tables[0]
    tickers = df['Symbol'].str.replace('.', '-').tolist()
    names = df['Security'].tolist()
    return dict(zip(tickers, names))


def fetch_and_store_history():
    ticker_map = get_top_tickers()
    tickers = list(ticker_map.keys())
    print(f"Fetching 5Y history for {len(tickers)} stocks into 'stocks' collection...")
    print("NOTE: This is a one-time seed. Expect ~15-20 minutes due to rate limiting.")

    success_count = 0
    fail_count = 0

    for i in range(0, len(tickers), BATCH_SIZE):
        batch_tickers = tickers[i:i + BATCH_SIZE]
        batch_num = i // BATCH_SIZE + 1
        total_batches = (len(tickers) + BATCH_SIZE - 1) // BATCH_SIZE
        print(f"\nBatch {batch_num}/{total_batches}: {batch_tickers[0]} ... {batch_tickers[-1]}")

        for ticker in batch_tickers:
            try:
                t = yf.Ticker(ticker)
                hist = t.history(period="5y", interval="1d")

                if hist.empty:
                    print(f"  [SKIP] {ticker}: No data returned.")
                    fail_count += 1
                    continue

                # Build prices array — most recent last, capped at MAX_HISTORY_POINTS
                prices = []
                for date, row in hist.iterrows():
                    prices.append({
                        'date': date.strftime('%Y-%m-%d'),
                        'price': round(float(row['Close']), 2)
                    })

                # Cap to prevent oversized documents
                prices = prices[-MAX_HISTORY_POINTS:]

                # Write history into the dedicated 'stock_history' collection
                doc_ref = db.collection('stock_history').document(ticker)
                doc_ref.set({
                    'symbol': ticker,
                    'prices': prices,
                    'updatedAt': firestore.SERVER_TIMESTAMP
                }, merge=True)

                print(f"  [OK] {ticker}: {len(prices)} data points written.")
                success_count += 1

            except Exception as e:
                print(f"  [ERROR] {ticker}: {e}")
                fail_count += 1

        # Respect yfinance rate limits between batches
        print(f"  Sleeping 3s before next batch...")
        time.sleep(3)

    print(f"\n{'='*50}")
    print(f"Seed complete. Success: {success_count} | Failed/Skipped: {fail_count}")
    print(f"{'='*50}")


if __name__ == "__main__":
    fetch_and_store_history()
