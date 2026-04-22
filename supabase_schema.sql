-- 1. Create the `stocks` table
CREATE TABLE public.stocks (
    symbol TEXT PRIMARY KEY,
    name TEXT,
    price FLOAT,
    change FLOAT,
    "changePercent" FLOAT,
    volume BIGINT,
    "dayHigh" FLOAT,
    "dayLow" FLOAT,
    "high52w" FLOAT,
    "low52w" FLOAT,
    bid FLOAT,
    ask FLOAT,
    "updatedAt" TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Create the `stock_history` table
CREATE TABLE public.stock_history (
    symbol TEXT PRIMARY KEY,
    prices JSONB DEFAULT '[]'::jsonb,
    "updatedAt" TIMESTAMPTZ DEFAULT NOW()
);

-- 3. Create the `game_state` table for users portoflios
CREATE TABLE public.game_state (
    uid TEXT PRIMARY KEY,
    cash FLOAT DEFAULT 100000.0,
    holdings JSONB DEFAULT '{}'::jsonb
);

-- 4. Create the `profiles` table
CREATE TABLE public.profiles (
    id UUID PRIMARY KEY REFERENCES auth.users ON DELETE CASCADE,
    full_name TEXT,
    email TEXT,
    photo_url TEXT,
    dob TEXT,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. Enable Row Level Security (RLS) but allow anonymous/authenticated read access for stocks
ALTER TABLE public.stocks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.game_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- Create policies for Stocks & History (Everyone can read, nobody can write from client)
CREATE POLICY "Enable read access for all users on stocks" ON public.stocks FOR SELECT USING (true);
CREATE POLICY "Enable read access for all users on stock_history" ON public.stock_history FOR SELECT USING (true);

-- Create policies for Game State (Users can read/update their own records)
-- (Assuming `uid` matches the user's Supabase auth.users ID)
CREATE POLICY "Users can view own game state" ON public.game_state FOR SELECT USING (auth.uid()::text = uid);
CREATE POLICY "Users can insert own game state" ON public.game_state FOR INSERT WITH CHECK (auth.uid()::text = uid);
CREATE POLICY "Users can update own game state" ON public.game_state FOR UPDATE USING (auth.uid()::text = uid);

-- Create policies for Profiles (Users can read/update their own records)
CREATE POLICY "Public profiles are viewable by everyone" ON public.profiles FOR SELECT USING (true);
CREATE POLICY "Users can insert their own profile" ON public.profiles FOR INSERT WITH CHECK (auth.uid() = id);
CREATE POLICY "Users can update own profile" ON public.profiles FOR UPDATE USING (auth.uid() = id);

-- 5. Enable Supabase Realtime for `stocks` and `game_state`
alter publication supabase_realtime add table stocks;
alter publication supabase_realtime add table game_state;
