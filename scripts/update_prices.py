import yfinance as yf
import firebase_admin
from firebase_admin import credentials
from firebase_admin import firestore
import pandas as pd
import time
import os

# ---------------------------------------------------------
# CONSTANTS & CONFIG
# ---------------------------------------------------------
SERVICE_ACCOUNT_PATH = 'serviceAccountKey.json'
BATCH_SIZE = 50  # Firebase batch writes max out at 500, but 50 is safe for yfinance chunking.

# Attempt to initialize Firebase Admin
try:
    if not os.path.exists(SERVICE_ACCOUNT_PATH):
        print(f"ERROR: {SERVICE_ACCOUNT_PATH} not found.")
        print("Please download your Firebase Service Account key from the Firebase Console")
        print("and save it in this directory as 'serviceAccountKey.json'.")
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
    Fetches the S&P 500 list from Wikipedia to act as our 'Top 500 traded' list.
    S&P 500 contains the top traded US stocks (NYSE & NASDAQ).
    """
    print("Fetching top 500 tickers from Wikipedia (S&P 500)...")
    try:
        url = 'https://en.wikipedia.org/wiki/List_of_S%26P_500_companies'
        tables = pd.read_html(url)
        df = tables[0]
        # Replace dots with hyphens for yfinance (e.g. BRK.B -> BRK-B)
        tickers = df['Symbol'].str.replace('.', '-').tolist()
        names = df['Security'].tolist()
        
        # Create a dictionary of ticker -> company name
        ticker_map = dict(zip(tickers, names))
        print(f"Found {len(ticker_map)} tickers.")
        return ticker_map
    except Exception as e:
        print(f"Error fetching tickers: {e}")
        # Fallback list if wikipedia fails
        return {
            "AAPL": "Apple Inc.", "MSFT": "Microsoft", "JNJ": "Johnson & Johnson", 
            "V": "Visa", "PG": "Procter & Gamble", "JPM": "JPMorgan Chase", 
            "UNH": "UnitedHealth", "HD": "Home Depot", "DIS": "Walt Disney", 
            "BAC": "Bank of America"
        }

def update_stock_prices():
    ticker_map = get_top_tickers()
    tickers = list(ticker_map.keys())
    
    print(f"Starting price scrape for {len(tickers)} stocks...")
    
    # Process in batches
    for i in range(0, len(tickers), BATCH_SIZE):
        batch_tickers = tickers[i:i+BATCH_SIZE]
        tickers_str = " ".join(batch_tickers)
        
        print(f"Fetching batch {i//BATCH_SIZE + 1} ({len(batch_tickers)} stocks)...")
        try:
            # fast_info is faster, but `download` is best for bulk current prices.
            # Using history(period='1d') via yf.Tickers
            data = yf.Tickers(tickers_str)
            
            # Start a Firebase batch
            batch = db.batch()
            valid_updates = 0
            
            for ticker in batch_tickers:
                try:
                    # Tickers object contains individual Ticker objects
                    t = data.tickers[ticker]
                    hist = t.history(period="1d")
                    if len(hist) > 0:
                        current_price = float(hist['Close'].iloc[-1])
                        prev_close = float(t.info.get('previousClose', current_price))
                        change = current_price - prev_close
                        change_percent = (change / prev_close) * 100 if prev_close else 0
                        
                        doc_ref = db.collection('stocks').document(ticker)
                        batch.set(doc_ref, {
                            'symbol': ticker,
                            'name': ticker_map.get(ticker, ticker),
                            'price': current_price,
                            'change': change,
                            'changePercent': change_percent,
                            'updatedAt': firestore.SERVER_TIMESTAMP
                        }, merge=True)
                        valid_updates += 1
                except Exception as e:
                    # Some tickers might fail or be delisted
                    pass
            
            if valid_updates > 0:
                batch.commit()
                print(f"Pushed {valid_updates} updates to Firebase.")
            
        except Exception as e:
            print(f"Batch fetch error: {e}")
            
        # Small delay to avoid rate limiting
        time.sleep(1)

    print("Stock update complete.")

if __name__ == "__main__":
    update_stock_prices()
