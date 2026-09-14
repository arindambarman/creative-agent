// Leave these empty to run in local mode: your API key stays in your own browser and
// projects are saved to this browser only. Nothing is sent anywhere except Anthropic.
//
// Fill them in to use the Supabase backend: sign-in, shared studio docs, projects saved
// to your account, and the API key held server-side in the edge function.

export const CONFIG = {
  supabaseUrl: '',      // https://xxxxxxxx.supabase.co
  supabaseAnonKey: '',  // the anon public key — safe to commit, it's protected by row-level security
  model: 'claude-sonnet-4-6'
};

export const USE_SUPABASE = Boolean(CONFIG.supabaseUrl && CONFIG.supabaseAnonKey);
