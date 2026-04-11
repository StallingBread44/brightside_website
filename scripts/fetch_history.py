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
BATCH_SIZE = 20 # Slower batches for history to avoid rate limits

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
    return tickers

def fetch_and_store_history():
    tickers = get_top_tickers()
    print(f"Fetching 1Y history for {len(tickers)} stocks...")

    for i in range(0, len(tickers), BATCH_SIZE):
        batch_tickers = tickers[i:i+BATCH_SIZE]
        print(f"Processing history batch {i//BATCH_SIZE + 1}...")
        
        for ticker in batch_tickers:
            try:
                # Fetch 1 year of daily data
                t = yf.Ticker(ticker)
                hist = t.history(period="1y", interval="1d")
                
                if hist.empty:
                    continue
                
                # Format prices array: [{date: 'YYYY-MM-DD', price: 123.45}, ...]
                prices = []
                for date, row in hist.iterrows():
                    prices.append({
                        'date': date.strftime('%Y-%m-%d'),
                        'price': round(float(row['Close']), 2)
                    })
                
                # Store in stock_history collection
                db.collection('stock_history').document(ticker).set({
                    'symbol': ticker,
                    'prices': prices,
                    'updatedAt': firestore.SERVER_TIMESTAMP
                })
                
            except Exception as e:
                print(f"Error fetching history for {ticker}: {e}")
        
        # Avoid rate limiting
        time.sleep(2)

    print("Historical data populate complete.")

if __name__ == "__main__":
    fetch_and_store_history()
