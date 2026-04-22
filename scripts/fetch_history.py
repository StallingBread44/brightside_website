import os
import time
import pandas as pd
from supabase import create_client, Client
from dotenv import load_dotenv
import yfinance as yf
from yahoo_fin import stock_info as si

# Load credentials from .env
load_dotenv()

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")

if not SUPABASE_URL or not SUPABASE_SERVICE_ROLE_KEY:
    print("ERROR: SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not found in .env")
    exit(1)

# Initialize Supabase client
supabase: Client = create_client(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

BATCH_SIZE = 20  # Slower batches for history to avoid rate limits
MAX_HISTORY_POINTS = 365 * 5  # 5 years of daily points

def get_nyse_tickers():
    """Fetches full list of US tickers via yahoo_fin."""
    print("Fetching tickers from yahoo_fin...")
    try:
        # Combining Other (NYSE/others) and NASDAQ for full US coverage
        other = si.tickers_other()
        nasdaq = si.tickers_nasdaq()
        tickers = list(set(other + nasdaq))
        print(f"Total tickers found: {len(tickers)}")
        return tickers
    except Exception as e:
        print(f"Failed to fetch tickers: {e}")
        return []

def fetch_and_store_history():
    tickers = get_nyse_tickers()
    if not tickers:
        print("No tickers to process.")
        return

    # Filter out redundant or invalid symbols (e.g. ones with dots or special chars if needed)
    tickers = [t for t in tickers if t.isalpha()]
    
    print(f"Fetching 5Y history for {len(tickers)} stocks into 'stock_history' collection...")
    print("NOTE: This is a heavy operation. Suggesting processing in batches.")

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
                    # print(f"  [SKIP] {ticker}: No data returned.")
                    fail_count += 1
                    continue

                # Build prices array — most recent last
                prices = []
                for date, row in hist.iterrows():
                    prices.append({
                        'date': date.strftime('%Y-%m-%d'),
                        'price': round(float(row['Close']), 2)
                    })

                # Cap to prevent oversized records
                prices = prices[-MAX_HISTORY_POINTS:]

                # Write history into the Supabase 'stock_history' table
                # We use upsert so it updates existing records
                res = supabase.table('stock_history').upsert({
                    'symbol': ticker,
                    'prices': prices
                }).execute()

                print(f"  [OK] {ticker}: {len(prices)} data points written.")
                success_count += 1

            except Exception as e:
                print(f"  [ERROR] {ticker}: {e}")
                fail_count += 1

        # Respect yfinance rate limits between batches
        time.sleep(2)

    print(f"\n{'='*50}")
    print(f"Processing complete. Success: {success_count} | Failed/Skipped: {fail_count}")
    print(f"\nNOTE: If you have ~6000 stocks, this will take significant time.")
    print(f"{'='*50}")

if __name__ == "__main__":
    confirm = input("This will fetch 5 YEARS of daily data for all NYSE/NASDAQ stocks and write to Supabase. Type 'START' to confirm: ")
    if confirm == "START":
        fetch_and_store_history()
    else:
        print("Cancelled.")
