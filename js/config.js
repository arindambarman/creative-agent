// Leave these empty to run in local mode: your API key stays in your own browser and
// projects are saved to this browser only. Nothing is sent anywhere except Anthropic.
//
// Fill them in to use the Supabase backend: sign-in, shared studio docs, projects saved
// to your account, and the API key held server-side in the edge function.

export const CONFIG = {
  supabaseUrl: '',      // https://xxxxxxxx.supabase.co
  supabaseAnonKey: '',  // the anon public key — safe to commit, it's protected by row-level security
  model: 'claude-sonnet-5',   // the default; people can pick another from MODELS in Settings
  searchLimit: 6              // most web searches Discover may run; each adds cost
};

// Models offered in Settings. Prices are US dollars per million tokens, used only to show
// what a run cost. `effort` is sent as output_config.effort where the model supports it.
// If you add a model here, add its id to ALLOWED_MODELS in the run-phase edge function too.
// Measured on the Direct phase of a test brief (14 September 2026): Sonnet 4.6 $0.058,
// Sonnet 5 $0.045 and twice as fast, Haiku 4.5 $0.018.
export const MODELS = [
  { id: 'claude-sonnet-5', label: 'Claude Sonnet 5', note: 'Recommended, good quality at lower cost',
    input: 2, output: 10, effort: 'medium' },
  { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6', note: 'Richest output, costs most',
    input: 3, output: 15, effort: null },
  { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5', note: 'Cheapest, less nuanced direction',
    input: 1, output: 5, effort: null }
];

export const WEB_SEARCH_PRICE = 0.01; // per search

export const modelInfo = id => MODELS.find(m => m.id === id) || MODELS.find(m => m.id === CONFIG.model);

export const USE_SUPABASE = Boolean(CONFIG.supabaseUrl && CONFIG.supabaseAnonKey);
