// One storage interface, two backends.
//
// Local:    everything in localStorage, no sign-in. Works with zero setup.
// Supabase: sign-in by magic link, projects and studio docs on your account,
//           every phase run kept as history.
//
// Both return and accept the same shape, so app.js doesn't know which is running:
//   { docs: {voice, work, tools}, projects: [{id, name, brief, outputs, runAt}] }
//
// History rows from both backends look like: { id, output, edited, is_current, created_at }

import { CONFIG, USE_SUPABASE } from './config.js';
import { SEED } from './seed.js';

const LOCAL_KEY = 'creative-agent-v1';
const LOCAL_HISTORY_LIMIT = 5; // per phase; localStorage holds about 5 MB in total
const blank = () => ({ docs: { ...SEED }, projects: [], currentId: null, apiKey: '', model: CONFIG.model });
export const newId = () =>
  (crypto.randomUUID ? crypto.randomUUID()
    : Date.now().toString(36) + Math.random().toString(36).slice(2, 10));

// ---- Local ------------------------------------------------------------------
// Individual saves only update state in memory; app.js follows every one with saveAll.

const localStore = {
  mode: 'local',
  needsAuth: false,
  user: null,

  async init() { return true; },

  async load() {
    try {
      const s = JSON.parse(localStorage.getItem(LOCAL_KEY));
      if (s && Array.isArray(s.projects)) return { ...blank(), ...s };
    } catch (e) { /* corrupt or empty — start fresh */ }
    return blank();
  },

  async saveAll(state) {
    try {
      localStorage.setItem(LOCAL_KEY, JSON.stringify(state));
    } catch (e) {
      if (e?.name === 'QuotaExceededError') {
        throw new Error('this browser is out of storage space. Export and delete old projects to free some up.');
      }
      throw e;
    }
  },

  async saveDocs() {},
  async saveProject() {},
  async deleteProject() {},

  async savePhase(state, project, phase, text, edited = false) {
    const runs = ((project.history ??= {})[phase] ??= []);
    for (const r of runs) r.is_current = false;
    runs.unshift({ id: newId(), output: text, edited, is_current: true, created_at: new Date().toISOString() });
    runs.length = Math.min(runs.length, LOCAL_HISTORY_LIMIT);
  },

  async history(project, phase) {
    return project.history?.[phase] || [];
  },

  async accessToken() { return null; },
  async reset() { localStorage.removeItem(LOCAL_KEY); },
  async signOut() {}
};

// ---- Supabase ---------------------------------------------------------------

const PHASE_IDS = ['discover', 'direct', 'plan', 'deliver', 'publish'];

const remoteStore = {
  mode: 'supabase',
  needsAuth: true,
  user: null,
  sb: null,

  async init() {
    const { createClient } = await import('https://esm.sh/@supabase/supabase-js@2');
    this.sb = createClient(CONFIG.supabaseUrl, CONFIG.supabaseAnonKey);
    const { data } = await this.sb.auth.getSession();
    this.user = data?.session?.user ?? null;
    this.sb.auth.onAuthStateChange((_e, session) => { this.user = session?.user ?? null; });
    return Boolean(this.user);
  },

  // The edge function identifies the caller from this token, not from the anon key.
  async accessToken() {
    const { data } = await this.sb.auth.getSession();
    return data?.session?.access_token ?? null;
  },

  async sendMagicLink(email) {
    const { error } = await this.sb.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: window.location.href.split('#')[0] }
    });
    if (error) throw new Error(error.message);
  },

  async signOut() {
    await this.sb.auth.signOut();
    this.user = null;
  },

  async load() {
    const state = blank();
    state.apiKey = ''; // never needed: the key lives in the edge function

    const [docsRes, projRes, runRes] = await Promise.all([
      this.sb.from('studio_docs').select('voice, work, tools').eq('user_id', this.user.id).maybeSingle(),
      this.sb.from('projects').select('id, name, brief, created_at').eq('archived', false).order('updated_at', { ascending: false }),
      this.sb.from('phase_runs').select('project_id, phase, output, created_at').eq('is_current', true)
    ]);

    for (const r of [docsRes, projRes, runRes]) {
      if (r.error) throw new Error(r.error.message);
    }

    // A brand-new account has an empty docs row; seed it so they start from something.
    const d = docsRes.data;
    if (!d || (!d.voice && !d.work && !d.tools)) {
      state.docs = { ...SEED };
      await this.sb.from('studio_docs')
        .upsert({ user_id: this.user.id, ...state.docs, updated_at: new Date().toISOString() });
    } else {
      state.docs = { voice: d.voice || '', work: d.work || '', tools: d.tools || '' };
    }

    const byProject = {};
    for (const run of runRes.data || []) {
      (byProject[run.project_id] ??= {})[run.phase] = run;
    }

    state.projects = (projRes.data || []).map(p => {
      const runs = byProject[p.id] || {};
      const outputs = {}, runAt = {};
      for (const id of PHASE_IDS) {
        if (runs[id]) { outputs[id] = runs[id].output; runAt[id] = new Date(runs[id].created_at).getTime(); }
      }
      return { id: p.id, name: p.name, brief: p.brief || {}, outputs, runAt, created: new Date(p.created_at).getTime() };
    });
    state.currentId = state.projects[0]?.id || null;
    return state;
  },

  async saveDocs(state) {
    const { error } = await this.sb.from('studio_docs')
      .upsert({ user_id: this.user.id, ...state.docs, updated_at: new Date().toISOString() });
    if (error) throw new Error(error.message);
  },

  async saveProject(state, project) {
    if (!project) return;
    const row = { id: project.id, user_id: this.user.id, name: project.name, brief: project.brief || {} };
    const { error } = await this.sb.from('projects').upsert(row);
    if (error) throw new Error(error.message);
  },

  // Called after a phase finishes, after the user edits an output by hand, or on restore.
  async savePhase(state, project, phase, text, edited = false) {
    const { error: clearError } = await this.sb.from('phase_runs')
      .update({ is_current: false })
      .eq('project_id', project.id).eq('phase', phase).eq('is_current', true);
    if (clearError) throw new Error(clearError.message);
    const { error } = await this.sb.from('phase_runs').insert({
      project_id: project.id, user_id: this.user.id, phase, output: text, edited, is_current: true
    });
    if (error) throw new Error(error.message);
  },

  async deleteProject(state, id) {
    const { error } = await this.sb.from('projects').delete().eq('id', id);
    if (error) throw new Error(error.message);
  },

  // Earlier runs of one phase, newest first, for comparing attempts.
  async history(project, phase) {
    const { data, error } = await this.sb.from('phase_runs')
      .select('id, output, edited, is_current, created_at')
      .eq('project_id', project.id).eq('phase', phase)
      .order('created_at', { ascending: false }).limit(10);
    if (error) throw new Error(error.message);
    return data || [];
  },

  async reset() { /* not offered in Supabase mode */ },
  async saveAll() { /* nothing to do: writes are per-record */ }
};

export const store = USE_SUPABASE ? remoteStore : localStore;
