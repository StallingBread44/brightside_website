import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm";

let SUPABASE_URL = "";
let SUPABASE_ANON_KEY = "";

try {
  // We use a dynamic import to allow the app to load even if the config file is missing
  const config = await import("./supabase-config.js");
  SUPABASE_URL = config.SUPABASE_URL;
  SUPABASE_ANON_KEY = config.SUPABASE_ANON_KEY;
} catch (e) {
  console.warn("Supabase config file (supabase-config.js) not found or invalid. Please create it using supabase-config.example.js as a template.");
}

let supabase = null;

if (SUPABASE_URL && SUPABASE_ANON_KEY) {
  try {
    supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  } catch (e) {
    console.error("Failed to initialize Supabase client:", e);
  }
}

export { supabase };
