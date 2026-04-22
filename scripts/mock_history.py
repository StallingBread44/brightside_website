import os
import random
from datetime import datetime, timedelta
from supabase import create_client
from dotenv import load_dotenv

load_dotenv()

SUPABASE_URL = os.environ.get("SUPABASE_URL")
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")

if not SUPABASE_URL or not SUPABASE_KEY:
    print("Missing environment variables.")
    exit(1)

supabase = create_client(SUPABASE_URL, SUPABASE_KEY)

def mock_history():
    print("Fetching top 100 stocks to add mock history...")
    res = supabase.table("stocks").select("symbol, price").limit(100).execute()
    stocks = res.data
    
    if not stocks:
        print("No stocks found in database.")
        return

    upserts = []
    for s in stocks:
        sym = s['symbol']
        base_price = s.get('price', 100.0)
        
        prices = []
        for i in range(14, -1, -1):
            date = (datetime.now() - timedelta(days=i)).strftime('%Y-%m-%d')
            # Add some randomness
            price = base_price * (1 + (random.random() - 0.5) * 0.1)
            prices.append({"date": date, "price": round(price, 2)})
            
        upserts.append({
            "symbol": sym,
            "prices": prices,
            "updatedAt": "now()"
        })

    if upserts:
        supabase.table("stock_history").upsert(upserts).execute()
        print(f"Mocked history for {len(upserts)} stocks.")

if __name__ == "__main__":
    mock_history()
