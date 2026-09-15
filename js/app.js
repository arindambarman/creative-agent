import { CONFIG, MODELS, WEB_SEARCH_PRICE, USE_SUPABASE, modelInfo } from './config.js';
import { PHASES, SYSTEM, buildContent } from './phases.js';
import { store, newId } from './store.js';
import { md, esc, stripPreamble } from './markdown.js';
import { callModel, webSearchTool, costOf, RunError } from './model.js';

const currentModel = () => modelInfo(state.model);

// "about $0.08" — rounded up to the cent so a run never looks free.
const dollars = n => `about $${(Math.ceil(n * 100) / 100).toFixed(2)}`;

function runCostLine(run) {
  if (!run) return '';
  const m = modelInfo(run.model);
  const searches = run.usage.searches ? ` · ${run.usage.searches} searches` : '';
  return ` · ${esc(m?.label || run.model)} · ${dollars(costOf(run.usage, m, WEB_SEARCH_PRICE))}${searches}`;
}

const $ = id => document.getElementById(id);

let state = { projects: [], currentId: null, docs: {}, apiKey: '' };
let view = { screen: 'brief' };
let running = null;      // { projectId, phaseId, controller } while a phase is streaming
let phaseNotice = null;  // { phaseId, text } shown once above a phase's output

const current = () => state.projects.find(p => p.id === state.currentId) || null;

// Every write goes through here so the two backends stay interchangeable.
async function persist(kind, ...args) {
  try {
    if (kind === 'docs') await store.saveDocs(state);
    else if (kind === 'project') await store.saveProject(state, ...args);
    else if (kind === 'phase') await store.savePhase(state, ...args);
    else if (kind === 'delete') await store.deleteProject(state, ...args);
    else await store.saveAll(state);
    if (store.mode === 'local') await store.saveAll(state);
  } catch (e) {
    flash(`Couldn't save: ${e.message}`);
  }
}

function flash(msg) {
  const el = $('flash');
  if (!el) return alert(msg);
  el.innerHTML = `<div class="err" style="margin-bottom:16px">${esc(msg)}</div>`;
  setTimeout(() => { if ($('flash')) $('flash').innerHTML = ''; }, 6000);
}

async function newProject() {
  const p = { id: newId(), name: 'Untitled project', created: Date.now(), brief: {}, outputs: {}, runAt: {} };
  state.projects.unshift(p);
  state.currentId = p.id;
  view = { screen: 'brief' };
  await persist('project', p);
  render();
}

// ---- Model call -------------------------------------------------------------

async function runPhase(project, phase, { signal, onText, onSearch, onRetry }) {
  const prior = {};
  for (const p of PHASES) { if (p.id === phase.id) break; if (project.outputs[p.id]) prior[p.id] = project.outputs[p.id]; }
  const model = currentModel();

  const body = {
    model: model.id,
    max_tokens: 16000,
    stream: true,
    system: SYSTEM,
    messages: [{ role: 'user', content: buildContent(phase, project, state.docs, prior) }]
  };
  if (model.effort) body.output_config = { effort: model.effort };
  if (phase.search) body.tools = [webSearchTool(model.id, CONFIG.searchLimit)];

  let url, headers;
  if (USE_SUPABASE) {
    const token = await store.accessToken();
    if (!token) throw new RunError('Your session has expired. Reload the page and sign in again to run a phase.');
    url = `${CONFIG.supabaseUrl}/functions/v1/run-phase`;
    headers = { 'Content-Type': 'application/json', apikey: CONFIG.supabaseAnonKey, Authorization: `Bearer ${token}` };
    body.phase = phase.id; // for the usage log; the edge function doesn't forward it
  } else {
    if (!state.apiKey) {
      throw Object.assign(new RunError('Add your Anthropic API key in Settings before running a phase.'), { needsKey: true });
    }
    url = 'https://api.anthropic.com/v1/messages';
    headers = {
      'Content-Type': 'application/json',
      'x-api-key': state.apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true'
    };
  }

  return callModel({ url, headers, body, signal, onText, onSearch, onRetry });
}

async function savePhaseOutput(project, phaseId, text, edited) {
  project.outputs[phaseId] = text;
  project.runAt[phaseId] = Date.now();
  await persist('phase', project, phaseId, text, edited);
}

const INCOMPLETE = {
  max_tokens: 'This output hit the length limit and stops mid-way. Edit it to finish, or run again.',
  pause_turn: 'The research took longer than one run allows, so this output may be unfinished. Run again if sections are missing.',
  refusal: 'The model stopped part-way and declined to continue. Check the brief, then run again.'
};

// ---- Rendering --------------------------------------------------------------

function renderRail() {
  $('mode').textContent = USE_SUPABASE ? 'supabase' : 'local';
  const p = current();
  $('projects').innerHTML = state.projects.length
    ? state.projects.map(x => `<div class="proj ${x.id === state.currentId ? 'on' : ''}" data-open="${x.id}">
        <span>${esc(x.name)}</span>
        <button class="btn btn-quiet" data-del="${x.id}" aria-label="Delete ${esc(x.name)}" title="Delete">×</button></div>`).join('')
    : '<div style="padding:4px 16px;font-size:13.5px;color:var(--faint)">No projects yet</div>';

  const nav = [`<div class="nav ${view.screen === 'brief' ? 'on' : ''}" data-go="brief">
      <span class="dot ${p && Object.keys(p.brief || {}).length ? 'done' : ''}" style="${p && Object.keys(p.brief || {}).length ? 'background:var(--brass)' : ''}"></span>Brief</div>`];
  for (const ph of PHASES) {
    const done = p && p.outputs[ph.id];
    nav.push(`<div class="nav ${view.screen === ph.id ? 'on' : ''}" data-go="${ph.id}">
      <span class="dot ${done ? 'done' : ''}" style="${done ? `background:${ph.color}` : ''}"></span>${ph.name}</div>`);
  }
  nav.push('<div class="rail-gap"></div>');
  nav.push(`<div class="nav ${view.screen === 'studio' ? 'on' : ''}" data-go="studio"><span class="dot"></span>Studio brain</div>`);
  $('nav').innerHTML = nav.join('');
}

const FIELDS = [
  ['client', 'Client or brand', 'Ember & Oak'],
  ['product', 'Product', 'Amber Harvest soy candle'],
  ['category', 'Category', 'Home and lifestyle'],
  ['goal', 'Goal', 'Launch the autumn scent in October'],
  ['platforms', 'Platforms', 'Instagram feed and Reels, Shopify'],
  ['deadline', 'Deadline', '25 September'],
  ['budget', 'Budget', '$400'],
  ['assets', 'Assets the client has', 'Phone photos, logo file']
];

function renderBrief() {
  const p = current();
  if (!p) return renderEmpty();
  const b = p.brief || {};
  $('view').innerHTML = `
    <h1>Project brief</h1>
    <p class="sub">Everything the agent knows about this job. Each phase reads it and writes back to it.</p>
    <div class="card stack">
      <div><label for="f-name">Project name</label><input id="f-name" value="${esc(p.name)}"></div>
      <div class="grid2">
        ${FIELDS.map(([k, label, ph]) => `<div><label for="f-${k}">${label}</label><input id="f-${k}" value="${esc(b[k] || '')}" placeholder="${esc(ph)}"></div>`).join('')}
      </div>
      <div><label for="f-notes">Notes, references, constraints</label>
        <textarea id="f-notes" rows="4" placeholder="Anything else: brand guidelines, references they liked, NDA status, whether the work can be posted publicly.">${esc(b.notes || '')}</textarea></div>
      <div class="row"><button class="btn btn-go" id="save-brief">Save brief</button><span id="saved" class="meta"></span></div>
    </div>
    <p class="note" style="margin-top:18px">The brief doesn't need to be complete. Each phase will tell you what it still needs.</p>`;

  $('save-brief').onclick = () => {
    p.name = $('f-name').value.trim() || 'Untitled project';
    for (const [k] of FIELDS) p.brief[k] = $(`f-${k}`).value.trim();
    p.brief.notes = $('f-notes').value.trim();
    persist('project', p); renderRail();
    $('saved').textContent = 'Saved';
    setTimeout(() => { const el = $('saved'); if (el) el.textContent = ''; }, 2000);
  };
}

function renderPhase(phase) {
  const p = current();
  if (!p) return renderEmpty();
  const out = p.outputs[phase.id];
  const idx = PHASES.findIndex(x => x.id === phase.id);
  const prevPhase = idx > 0 ? PHASES[idx - 1] : null;
  const prevMissing = prevPhase && !p.outputs[prevPhase.id];
  const busyHere = running && running.projectId === p.id && running.phaseId === phase.id;
  const busyElsewhere = running && !busyHere;
  const notice = phaseNotice?.phaseId === phase.id ? phaseNotice.text : '';
  phaseNotice = null;

  $('view').innerHTML = `
    <div class="phase-top">
      <span class="chip" style="background:${phase.color}"></span>
      <div><h1>${phase.name}</h1><p class="sub" style="margin:0">${phase.blurb}</p></div>
    </div>
    ${prevMissing ? `<p class="note" style="margin-bottom:16px">${prevPhase.name} hasn't run yet. This phase works better with it, but you can run it anyway.</p>` : ''}
    <div class="row" id="actions">
      <button class="btn btn-go" id="run" ${running ? 'disabled' : ''}>${busyHere ? 'Running…' : out ? 'Run again' : 'Run ' + phase.name}</button>
      ${busyHere ? '<button class="btn" id="stop">Stop</button>' : ''}
      ${out && !busyHere ? '<button class="btn" id="edit">Edit output</button><button class="btn btn-quiet" id="history">History</button><button class="btn btn-quiet" id="copy">Copy</button>' : ''}
      ${phase.search ? '<span class="meta" style="margin:0">Uses live web search</span>' : ''}
    </div>
    ${busyElsewhere ? '<p class="note" style="margin-top:16px">Another phase is still running. It will save when it finishes.</p>' : ''}
    <div id="err">${notice ? `<p class="note" style="margin-top:16px">${esc(notice)}</p>` : ''}</div>
    <div id="body">${busyHere ? '<p class="meta">Still running. The output will appear here when it finishes.</p>'
      : out ? `<div class="out" style="border-left-color:${phase.color}">${md(out)}</div>
      <div class="meta">Last run ${new Date(p.runAt[phase.id] || Date.now()).toLocaleString()}${runCostLine(p.runInfo?.[phase.id])}</div>`
      : `<div class="empty" style="margin-top:18px">Nothing here yet. Run the phase to generate it, then edit anything you want to change.</div>`}</div>`;

  $('run').onclick = () => doRun(phase);
  if ($('stop')) $('stop').onclick = () => running?.controller.abort();
  if (out && !busyHere) {
    $('copy').onclick = async () => { await navigator.clipboard.writeText(out); $('copy').textContent = 'Copied'; setTimeout(() => { if ($('copy')) $('copy').textContent = 'Copy'; }, 1500); };
    $('history').onclick = () => renderHistory(phase);
    $('edit').onclick = () => {
      $('body').innerHTML = `<div class="stack" style="margin-top:18px">
        <textarea id="ed" class="mono" rows="24">${esc(out)}</textarea>
        <div class="row"><button class="btn btn-go" id="ed-save">Save changes</button><button class="btn" id="ed-cancel">Cancel</button></div></div>`;
      $('ed-save').onclick = async () => {
        await savePhaseOutput(p, phase.id, $('ed').value, true);
        renderPhase(phase);
      };
      $('ed-cancel').onclick = () => renderPhase(phase);
    };
  }
}

// Only redraw if the person is still looking at this phase of this project.
const showing = (project, phase) => state.currentId === project.id && view.screen === phase.id;

async function doRun(phase) {
  if (running) return;
  const p = current();
  running = { projectId: p.id, phaseId: phase.id, controller: new AbortController() };
  renderPhase(phase);
  $('body').innerHTML = `<div class="meta" id="activity"></div>
    <div class="out" style="border-left-color:${phase.color}" id="live"><span class="cursor"></span></div>`;

  const searches = [];
  try {
    const result = await runPhase(p, phase, {
      signal: running.controller.signal,
      onText: partial => {
        const live = $('live');
        if (live && showing(p, phase)) live.innerHTML = md(partial) + '<span class="cursor"></span>';
      },
      onSearch: query => {
        searches.push(query);
        const el = $('activity');
        if (el && showing(p, phase)) el.textContent = `Searched: ${searches.join(' · ')}`;
      },
      onRetry: (n, ms, reason) => {
        const el = $('activity');
        if (el && showing(p, phase)) el.textContent = `${reason}. Trying again in ${Math.round(ms / 1000)} seconds (retry ${n} of 3).`;
      }
    });
    // Research runs narrate between searches; the saved output starts at the first heading.
    const text = phase.search ? stripPreamble(result.text) : result.text;
    (p.runInfo ??= {})[phase.id] = { model: currentModel().id, usage: result.usage };
    await savePhaseOutput(p, phase.id, text, false);
    if (result.incomplete) phaseNotice = { phaseId: phase.id, text: INCOMPLETE[result.stopReason] };
    running = null;
    renderRail();
    if (showing(p, phase)) renderPhase(phase);
  } catch (e) {
    running = null;
    renderRail();
    if (!showing(p, phase)) { flash(`${phase.name} didn't finish: ${e.message}`); return; }
    renderPhase(phase);
    const partial = e.partial?.trim() ? e.partial : '';
    $('err').innerHTML = `<div class="${e.aborted ? 'note' : 'err'}" style="margin-top:16px">${esc(e.message)}
      ${partial ? ' The text written so far is below.' : ''}
      ${e.needsKey ? '<div class="row" style="margin-top:10px"><button class="btn" id="open-settings">Open Settings</button></div>' : ''}</div>`;
    if ($('open-settings')) $('open-settings').onclick = settings;
    if (partial) {
      $('body').innerHTML = `<div class="out" style="border-left-color:${phase.color}">${md(partial)}</div>
        <div class="row" style="margin-top:14px"><button class="btn" id="keep">Keep this partial output</button>
        <span class="meta" style="margin:0">${p.outputs[phase.id] ? 'Replaces the current output. The current one stays in history.' : ''}</span></div>`;
      $('keep').onclick = async () => {
        if (e.usage) (p.runInfo ??= {})[phase.id] = { model: currentModel().id, usage: e.usage };
        await savePhaseOutput(p, phase.id, partial, true);
        phaseNotice = { phaseId: phase.id, text: 'Saved a partial run. Edit it to finish, or run again.' };
        renderRail(); renderPhase(phase);
      };
    }
  }
}

const preview = s => {
  const flat = String(s || '').replace(/[#*|`>_-]+/g, ' ').replace(/\s+/g, ' ').trim();
  return flat.length > 180 ? flat.slice(0, 180) + '…' : flat;
};

async function renderHistory(phase) {
  const p = current();
  $('body').innerHTML = '<p class="meta">Loading earlier runs…</p>';
  let runs;
  try {
    runs = await store.history(p, phase.id);
  } catch (e) {
    if (showing(p, phase)) $('body').innerHTML = `<div class="err" style="margin-top:16px">Couldn't load history: ${esc(e.message)}</div>`;
    return;
  }
  if (!showing(p, phase)) return;

  const back = '<button class="btn" id="h-back">Back to current output</button>';
  if (!runs.length) {
    $('body').innerHTML = `<div class="empty" style="margin-top:18px">No saved runs yet. From now on, every run and edit of this phase is kept here.</div>
      <div class="row" style="margin-top:14px">${back}</div>`;
  } else {
    const limit = store.mode === 'local' ? 'The last 5 runs and edits are kept in this browser.' : 'The last 10 runs and edits are shown.';
    $('body').innerHTML = `
      <div class="row" style="margin-top:22px"><h2 style="margin:0;flex:1">Earlier versions</h2>${back}</div>
      <p class="meta" style="margin-top:4px">${limit} Restoring a version makes it current and keeps the one it replaces.</p>
      <div class="stack" style="margin-top:14px">${runs.map((r, i) => `
        <div class="card hist">
          <div class="row">
            <span>${esc(new Date(r.created_at).toLocaleString())}</span>
            <span class="tag">${r.edited ? 'edited' : 'generated'}</span>
            ${r.is_current ? '<span class="tag tag-on">current</span>' : ''}
            <span style="flex:1"></span>
            <button class="btn btn-quiet" data-hview="${i}">View</button>
            ${r.is_current ? '' : `<button class="btn" data-hrestore="${i}">Restore this version</button>`}
          </div>
          <p class="hist-preview">${esc(preview(r.output))}</p>
          <div id="hfull-${i}"></div>
        </div>`).join('')}</div>`;

    document.querySelectorAll('[data-hview]').forEach(b => b.onclick = () => {
      const i = Number(b.dataset.hview);
      const box = $(`hfull-${i}`);
      const open = Boolean(box.innerHTML);
      box.innerHTML = open ? '' : `<div class="out" style="border-left-color:${phase.color}">${md(runs[i].output)}</div>`;
      b.textContent = open ? 'View' : 'Hide';
    });
    document.querySelectorAll('[data-hrestore]').forEach(b => b.onclick = async () => {
      const r = runs[Number(b.dataset.hrestore)];
      b.disabled = true;
      await savePhaseOutput(p, phase.id, r.output, r.edited);
      phaseNotice = { phaseId: phase.id, text: `Restored the version from ${new Date(r.created_at).toLocaleString()}.` };
      renderRail(); renderPhase(phase);
    });
  }
  $('h-back').onclick = () => renderPhase(phase);
}

function renderStudio() {
  const tabs = [['voice', 'Brand voice'], ['work', 'Work and services'], ['tools', 'Tools and clients']];
  const active = view.doc || 'voice';
  $('view').innerHTML = `
    <h1>Studio brain</h1>
    <p class="sub">Three documents that shape every suggestion. Written once, edited a few times a year.</p>
    <div class="tabs">${tabs.map(([k, l]) => `<button class="tab ${k === active ? 'on' : ''}" data-doc="${k}">${l}</button>`).join('')}</div>
    <textarea id="doc" class="mono" rows="26">${esc(state.docs[active] || '')}</textarea>
    <div class="row" style="margin-top:14px"><button class="btn btn-go" id="doc-save">Save document</button><span id="saved" class="meta"></span></div>
    <p class="note" style="margin-top:18px">Fill in everything in [square brackets]. The time costs in Tools and clients are what make task estimates realistic.</p>`;
  $('doc-save').onclick = () => {
    state.docs[active] = $('doc').value;
    persist('docs');
    $('saved').textContent = 'Saved';
    setTimeout(() => { const el = $('saved'); if (el) el.textContent = ''; }, 2000);
  };
  document.querySelectorAll('[data-doc]').forEach(b => b.onclick = () => {
    state.docs[active] = $('doc').value; persist('docs');
    view.doc = b.dataset.doc; renderStudio();
  });
}

function renderEmpty() {
  $('view').innerHTML = `<h1>No project open</h1>
    <p class="sub">Create a project to start, or fill in your studio brain first so the agent knows your work.</p>
    <div class="row"><button class="btn btn-go" id="e-new">New project</button><button class="btn" id="e-studio">Studio brain</button></div>`;
  $('e-new').onclick = newProject;
  $('e-studio').onclick = () => { view = { screen: 'studio' }; render(); };
}

function render() {
  renderRail();
  if (!$('flash')) $('view').insertAdjacentHTML('beforebegin', '<div id="flash"></div>');
  if (view.screen === 'studio') return renderStudio();
  if (!current()) return renderEmpty();
  if (view.screen === 'brief') return renderBrief();
  const phase = PHASES.find(p => p.id === view.screen);
  return phase ? renderPhase(phase) : renderBrief();
}

// ---- Settings, export, events ----------------------------------------------

function settings() {
  $('modal-root').innerHTML = `<div class="modal" id="modal"><div class="card stack">
    <h2>Settings</h2>
    ${USE_SUPABASE
      ? `<p class="note">Signed in as ${esc(store.user?.email || '')}. The API key is held server-side in the edge function, so there is nothing to enter here.</p>`
      : `<div><label for="k">Anthropic API key</label>
         <input id="k" type="password" value="${esc(state.apiKey)}" placeholder="sk-ant-…" autocomplete="off">
         <p class="meta">Stored in this browser only, and sent straight to Anthropic. Get a key at console.anthropic.com.</p></div>`}
    <div><label for="m">Model</label>
      <select id="m">${MODELS.map(m => `<option value="${esc(m.id)}" ${m.id === currentModel().id ? 'selected' : ''}>${esc(m.label)} — ${esc(m.note)} ($${m.input} in / $${m.output} out per million tokens)</option>`).join('')}</select>
      <p class="meta">Each phase shows what its last run cost. Web searches in Discover add $${WEB_SEARCH_PRICE.toFixed(2)} each.${USE_SUPABASE ? ' This choice lasts until you reload the page.' : ''}</p></div>
    <div class="row"><button class="btn btn-go" id="s-save">Save</button><button class="btn" id="s-close">Close</button>
      <span class="sp" style="flex:1"></span>
      ${USE_SUPABASE
        ? '<button class="btn btn-quiet" id="s-out">Sign out</button>'
        : '<button class="btn btn-quiet" id="s-reset">Reset all data</button>'}</div>
  </div></div>`;
  const close = () => { $('modal-root').innerHTML = ''; };
  $('s-close').onclick = close;
  $('s-save').onclick = () => {
    if ($('k')) state.apiKey = $('k').value.trim();
    state.model = $('m').value;
    persist('all'); close();
  };
  if ($('s-reset')) $('s-reset').onclick = async () => {
    if (confirm('Delete all projects and studio documents from this browser? This cannot be undone.')) {
      await store.reset();
      state = await store.load(); view = { screen: 'brief' }; close(); render();
    }
  };
  if ($('s-out')) $('s-out').onclick = async () => { await store.signOut(); location.reload(); };
  $('modal').onclick = e => { if (e.target.id === 'modal') close(); };
}

function exportProject() {
  const p = current();
  if (!p) return;
  const b = p.brief || {};
  const brief = FIELDS.filter(([k]) => b[k]).map(([k, l]) => `- **${l}:** ${b[k]}`).join('\n');
  const parts = [`# ${p.name}\n`, '## Brief\n', brief || '_Empty_', b.notes ? `\n\n**Notes:** ${b.notes}` : '', '\n'];
  for (const ph of PHASES) if (p.outputs[ph.id]) parts.push(`\n---\n\n# ${ph.name}\n\n${p.outputs[ph.id]}\n`);
  const blob = new Blob([parts.join('')], { type: 'text/markdown' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${p.name.replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-').toLowerCase() || 'project'}.md`;
  a.click();
  URL.revokeObjectURL(a.href);
}

document.addEventListener('click', e => {
  const open = e.target.closest('[data-open]');
  const del = e.target.closest('[data-del]');
  const go = e.target.closest('[data-go]');
  if (del) {
    e.stopPropagation();
    const id = del.dataset.del;
    const proj = state.projects.find(x => x.id === id);
    if (confirm(`Delete "${proj?.name}"? This cannot be undone.`)) {
      state.projects = state.projects.filter(x => x.id !== id);
      if (state.currentId === id) state.currentId = state.projects[0]?.id || null;
      persist('delete', id).then(render);
    }
    return;
  }
  if (open) { state.currentId = open.dataset.open; view = { screen: 'brief' }; render(); return; }
  if (go) { view = { screen: go.dataset.go, doc: view.doc }; render(); }
});

// ---- Sign-in ----------------------------------------------------------------

function renderSignIn(message = '') {
  document.querySelector('.shell').style.display = 'none';
  $('export-btn').style.display = 'none';
  $('settings-btn').style.display = 'none';
  document.body.insertAdjacentHTML('beforeend', `
    <div class="modal" style="position:static;min-height:calc(100vh - 54px)">
      <div class="card stack" style="max-width:420px">
        <h2>Sign in</h2>
        <p class="sub" style="margin:0">We'll email you a link. No password to remember.</p>
        ${message ? `<p class="note">${esc(message)}</p>` : ''}
        <div><label for="email">Email</label><input id="email" type="email" autocomplete="email" placeholder="you@example.com"></div>
        <div id="signin-err"></div>
        <button class="btn btn-go" id="send-link">Email me a link</button>
        <p class="meta" style="margin:0">Only approved addresses can sign in. Ask the owner of this
        site to add yours.</p>
      </div>
    </div>`);
  const send = async () => {
    const email = $('email').value.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      $('signin-err').innerHTML = '<div class="err">Enter a valid email address.</div>';
      return;
    }
    $('send-link').disabled = true;
    $('send-link').textContent = 'Sending…';
    try {
      await store.sendMagicLink(email);
      $('signin-err').innerHTML = '';
      $('send-link').replaceWith(Object.assign(document.createElement('p'), {
        className: 'note', textContent: `Link sent to ${email}. Open it on this device to finish signing in.`
      }));
    } catch (e) {
      $('signin-err').innerHTML = `<div class="err">${esc(e.message)}</div>`;
      $('send-link').disabled = false;
      $('send-link').textContent = 'Email me a link';
    }
  };
  $('send-link').onclick = send;
  $('email').addEventListener('keydown', e => { if (e.key === 'Enter') send(); });
  $('email').addEventListener('input', () => { $('signin-err').innerHTML = ''; });
}

// ---- Boot -------------------------------------------------------------------

async function boot() {
  $('new-btn').onclick = newProject;
  $('settings-btn').onclick = settings;
  $('export-btn').onclick = exportProject;

  $('mode').textContent = USE_SUPABASE ? 'supabase' : 'local';
  $('view').innerHTML = '<p class="sub">Loading…</p>';
  let authed = false;
  try {
    authed = await store.init();
  } catch (e) {
    $('view').innerHTML = `<div class="err">Couldn't reach Supabase: ${esc(e.message)}. Check the URL and key in js/config.js.</div>`;
    return;
  }
  if (store.needsAuth && !authed) return renderSignIn();

  try {
    state = await store.load();
  } catch (e) {
    $('view').innerHTML = `<div class="err">Couldn't load your projects: ${esc(e.message)}</div>`;
    return;
  }
  if (!state.projects.length) view = { screen: 'studio' };
  render();
}

boot();
