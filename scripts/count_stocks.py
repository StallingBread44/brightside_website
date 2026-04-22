from supabase import create_client, Client
import os
from dotenv import load_dotenv

load_dotenv('.env')

SUPABASE_URL = os.environ.get("SUPABASE_URL")
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")

supabase = create_client(SUPABASE_URL, SUPABASE_KEY)
res = supabase.table('stocks').select('symbol', count='exact').execute()
print(f"Count: {res.count}")
