import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm";

// --- Supabase Config ---
// The Anon Key is safe to expose in public repositories as it respects Row Level Security (RLS).
const SUPABASE_URL = "https://evqlqsfapvjdwxcdybjm.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_1ikE-564SUlEt2PqrEc39w_ZITnf02M";
// -----------------------

let supabase = null;

if (SUPABASE_URL && SUPABASE_ANON_KEY) {
  try {
    supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    console.log("Supabase initialized successfully.");
  } catch (e) {
    console.error("Failed to initialize Supabase client:", e);
  }
} else {
  console.error("Supabase URL or Anon Key is missing in supabase-init.js!");
}

window.supabase = supabase; // Fallback for non-module scripts
export { supabase };
