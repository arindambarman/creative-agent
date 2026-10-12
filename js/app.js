import { CONFIG, MODELS, WEB_SEARCH_PRICE, USE_SUPABASE, modelInfo } from './config.js';
import { PHASES, SYSTEM, buildContent, summaryPrompt } from './phases.js';
import { store, newId } from './store.js';
import { md, esc, stripPreamble, splitSummary, normaliseBullets, withSummary, sectionText } from './markdown.js';
import { callModel, webSearchTool, costOf, RunError } from './model.js';
import { INTAKE_MODEL, INTAKE_SYSTEM, buildIntakePrompt, parseIntake, notesWithQuestions } from './intake.js';
import { projectDocument, buildDocx, buildPrintHtml, fileSlug, parseBlocks } from './document.js';
import { IMAGE_MODELS, IMAGE_PROMPT_SYSTEM, MAX_REFERENCES, SIZE_PIXELS, imageModel, imagePrice, buildImagePromptRequest, parseFramePrompts, generateImage, exportRows, coverage, longestSide } from './images.js';
import { putImage, getImage, deleteImage, assetRecord, referenceRecord, assetsForFrame, assetSummary, totalAssetCost } from './assets.js';

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
// Resolves true when the write succeeded.
async function persist(kind, ...args) {
  try {
    if (kind === 'docs') await store.saveDocs(state);
    else if (kind === 'project') await store.saveProject(state, ...args);
    else if (kind === 'phase') await store.savePhase(state, ...args);
    else if (kind === 'delete') await store.deleteProject(state, ...args);
    else await store.saveAll(state);
    if (store.mode === 'local') await store.saveAll(state);
    return true;
  } catch (e) {
    flash(`Couldn't save: ${e.message}`);
    return false;
  }
}

// ---- Brief auto-save ----------------------------------------------------------
// The brief saves shortly after typing stops. Anything still waiting is saved before the
// screen changes, before export, and when the page is closed.

const BRIEF_SAVE_DELAY = 800;
let briefTimer = null;
let pendingBriefSave = null;

function flushBriefSave() {
  clearTimeout(briefTimer);
  const save = pendingBriefSave;
  pendingBriefSave = null;
  return save ? save() : Promise.resolve(true);
}

function cancelBriefSave() {
  clearTimeout(briefTimer);
  pendingBriefSave = null;
}

window.addEventListener('beforeunload', e => {
  if (!pendingBriefSave) return;
  flushBriefSave();
  e.preventDefault(); // a remote save may not finish before the page closes, so ask first
});

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
  body.phase = phase.id; // for the usage log; the edge function doesn't forward it

  const { url, headers } = await apiTarget();
  if (!USE_SUPABASE) delete body.phase;
  // Web searches run server-side and the stream can stay silent for minutes while they do,
  // so research phases get a longer allowance before a quiet stream counts as stalled.
  const idleMs = phase.search ? 300000 : 120000;
  return callModel({ url, headers, body, signal, onText, onSearch, onRetry, idleMs });
}

// Where requests go: straight to Anthropic with the browser's key, or through the edge function.
async function apiTarget() {
  if (USE_SUPABASE) {
    const token = await store.accessToken();
    if (!token) throw new RunError('Your session has expired. Reload the page and sign in again.');
    return {
      url: `${CONFIG.supabaseUrl}/functions/v1/run-phase`,
      headers: { 'Content-Type': 'application/json', apikey: CONFIG.supabaseAnonKey, Authorization: `Bearer ${token}` }
    };
  }
  if (!state.apiKey) {
    throw Object.assign(new RunError('Add your Anthropic API key in Settings first.'), { needsKey: true });
  }
  return {
    url: 'https://api.anthropic.com/v1/messages',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': state.apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true'
    }
  };
}

async function extractBrief(request) {
  const { url, headers } = await apiTarget();
  const body = {
    model: INTAKE_MODEL,
    max_tokens: 3000,
    stream: true,
    system: INTAKE_SYSTEM,
    messages: [{ role: 'user', content: buildIntakePrompt(request) }]
  };
  if (USE_SUPABASE) body.phase = 'intake';
  const result = await callModel({ url, headers, body });
  return { ...parseIntake(result.text), usage: result.usage };
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
      <span class="dot ${done ? 'done' : ''}" style="${done ? `background:${ph.color}` : ''}"></span>${ph.name}${ph.optional ? ' <small>optional</small>' : ''}</div>`);
  }
  const hasAssets = p?.assets?.length;
  nav.push(`<div class="nav ${view.screen === 'assets' ? 'on' : ''}" data-go="assets">
    <span class="dot ${hasAssets ? 'done' : ''}" style="${hasAssets ? 'background:var(--brass)' : ''}"></span>Images</div>`);
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
  const briefEmpty = !FIELDS.some(([k]) => b[k]) && !b.notes;
  $('view').innerHTML = `
    <h1>Project brief</h1>
    <p class="sub">Everything the agent knows about this job. Each phase reads it and writes back to it.</p>
    <details class="card intake" ${briefEmpty || b.request ? 'open' : ''}>
      <summary>Start from a client request</summary>
      <div class="stack" style="margin-top:14px">
        <p class="meta" style="margin:0">Paste the whole job post or message, from Upwork, email or chat. The agent fills in
        the fields below for you to check, and lists anything the client didn't say.</p>
        <textarea id="f-request" rows="8" placeholder="Paste the client's request here">${esc(b.request || '')}</textarea>
        <div class="row">
          <button class="btn btn-go" id="extract">Fill in the brief</button>
          <span class="meta" style="margin:0">Uses Claude Haiku 4.5, usually under $0.01. The request and the filled-in brief save automatically.</span>
        </div>
        <div id="intake-msg"></div>
      </div>
    </details>
    <div class="card stack" style="margin-top:16px">
      <div><label for="f-name">Project name</label><input id="f-name" value="${esc(p.name)}"></div>
      <div class="grid2">
        ${FIELDS.map(([k, label, ph]) => `<div><label for="f-${k}">${label}</label><input id="f-${k}" value="${esc(b[k] || '')}" placeholder="${esc(ph)}"></div>`).join('')}
      </div>
      <div><label for="f-notes">Notes, references, constraints</label>
        <textarea id="f-notes" rows="4" placeholder="Anything else: brand guidelines, references they liked, NDA status, whether the work can be posted publicly.">${esc(b.notes || '')}</textarea></div>
      <div class="row"><button class="btn" id="save-brief">Save now</button>
        <span id="saved" class="meta save-status" role="status" aria-live="polite">Changes save automatically</span></div>
    </div>
    <p class="note" style="margin-top:18px">The brief doesn't need to be complete. Each phase will tell you what it still needs.</p>`;

  const status = text => { if ($('saved')) $('saved').textContent = text; };

  // Reads the form into the project straight away, before any await, so a save triggered by
  // leaving the screen captures the values before the form is replaced.
  const save = async () => {
    if (!$('f-name')) return true;
    p.brief ??= {};
    p.name = $('f-name').value.trim() || 'Untitled project';
    for (const [k] of FIELDS) p.brief[k] = $(`f-${k}`).value.trim();
    p.brief.notes = $('f-notes').value.trim();
    p.brief.request = $('f-request').value.trim();
    status('Saving…');
    const ok = await persist('project', p);
    renderRail();
    status(ok ? 'All changes saved' : "Couldn't save. Your text is still here; try Save now.");
    return ok;
  };

  const schedule = () => {
    clearTimeout(briefTimer);
    pendingBriefSave = save;
    status('Unsaved changes…');
    briefTimer = setTimeout(flushBriefSave, BRIEF_SAVE_DELAY);
  };

  for (const el of document.querySelectorAll('#f-name, #f-notes, #f-request, .grid2 input')) {
    el.addEventListener('input', schedule);
  }

  $('save-brief').onclick = () => {
    pendingBriefSave = save;
    flushBriefSave();
    document.querySelectorAll('.filled').forEach(el => el.classList.remove('filled'));
  };

  $('extract').onclick = async () => {
    const request = $('f-request').value.trim();
    const msg = $('intake-msg');
    if (request.length < 20) {
      msg.innerHTML = '<div class="err">Paste the client\'s request first. A sentence or two is enough to start.</div>';
      return;
    }
    const button = $('extract');
    button.disabled = true;
    button.textContent = 'Reading the request…';
    msg.innerHTML = '';
    try {
      const { fields, questions } = await extractBrief(request);
      // Moved to another screen or project while it ran: don't fill someone else's brief.
      if (state.currentId !== p.id || view.screen !== 'brief' || !$('f-name')) return;

      const set = (id, value) => {
        const el = $(id);
        if (!value || !el) return false;
        el.value = value;
        el.classList.add('filled');
        return true;
      };
      let count = 0;
      if (set('f-name', fields.name)) count++;
      for (const [k] of FIELDS) if (set(`f-${k}`, fields[k])) count++;
      if (set('f-notes', notesWithQuestions(fields.notes, questions))) count++;

      pendingBriefSave = save;
      const saved = await flushBriefSave();

      const missing = FIELDS.filter(([k]) => !fields[k]).map(([, label]) => label.toLowerCase());
      msg.innerHTML = `<div class="note">
        Filled ${count} ${count === 1 ? 'field' : 'fields'}${saved ? ' and saved the brief' : ''}. Check them below; any changes you make save as you type.
        ${missing.length ? `<br>Not in the request: ${esc(missing.join(', '))}.` : ''}
        ${questions.length ? `<br>${questions.length} open ${questions.length === 1 ? 'question was' : 'questions were'} added to the notes.` : ''}
      </div>`;
      $('f-name').scrollIntoView({ behavior: 'smooth', block: 'center' });
    } catch (e) {
      if (!$('intake-msg')) return;
      $('intake-msg').innerHTML = `<div class="err">${esc(e.message)}
        ${e.needsKey ? '<div class="row" style="margin-top:10px"><button class="btn" id="open-settings">Open Settings</button></div>' : ''}</div>`;
      if ($('open-settings')) $('open-settings').onclick = settings;
    } finally {
      if ($('extract')) { $('extract').disabled = false; $('extract').textContent = 'Fill in the brief'; }
    }
  };
}

function renderPhase(phase) {
  const p = current();
  if (!p) return renderEmpty();
  const out = p.outputs[phase.id];
  const idx = PHASES.findIndex(x => x.id === phase.id);
  // The nearest earlier phase that isn't optional: skipping Propose shouldn't nag in Direct.
  const prevPhase = PHASES.slice(0, idx).reverse().find(ph => !ph.optional) || null;
  const prevMissing = prevPhase && !p.outputs[prevPhase.id];
  const proposalText = phase.id === 'propose' && out ? sectionText(out, 'Proposal') : '';
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
    ${phase.optional && !out ? `<p class="note" style="margin-bottom:16px">Optional. Use it when the job needs a pitch, such as an Upwork post. Paste the client's request on the Brief screen first so the proposal meets their instructions. Later phases hold to the scope, price and timeline it promises.</p>` : ''}
    <div class="row" id="actions">
      <button class="btn btn-go" id="run" ${running ? 'disabled' : ''}>${busyHere ? 'Running…' : out ? 'Run again' : 'Run ' + phase.name}</button>
      <label class="model-pick" title="Model used for the next run">
        <span class="sr-only">Model</span>
        <select id="run-model" ${running ? 'disabled' : ''}>${MODELS.map(m => `<option value="${esc(m.id)}" ${m.id === currentModel().id ? 'selected' : ''}>${esc(m.label)} · $${m.input}/$${m.output}</option>`).join('')}</select>
      </label>
      ${busyHere ? '<button class="btn" id="stop">Stop</button>' : ''}
      ${out && !busyHere && proposalText ? '<button class="btn" id="copy-proposal">Copy proposal</button>' : ''}
      ${out && !busyHere ? '<button class="btn" id="edit">Edit output</button><button class="btn btn-quiet" id="history">History</button><button class="btn btn-quiet" id="copy">Copy all</button>' : ''}
      ${phase.search ? '<span class="meta" style="margin:0">Uses live web search</span>' : ''}
    </div>
    ${busyElsewhere ? '<p class="note" style="margin-top:16px">Another phase is still running. It will save when it finishes.</p>' : ''}
    <div id="err">${notice ? `<p class="note" style="margin-top:16px">${esc(notice)}</p>` : ''}</div>
    <div id="body">${busyHere ? '<p class="meta">Still running. The output will appear here when it finishes.</p>'
      : out ? `${outputHtml(phase, out)}
      <div class="meta">Last run ${new Date(p.runAt[phase.id] || Date.now()).toLocaleString()}${runCostLine(p.runInfo?.[phase.id])}</div>`
      : `<div class="empty" style="margin-top:18px">Nothing here yet. Run the phase to generate it, then edit anything you want to change.</div>`}</div>`;

  $('run').onclick = () => doRun(phase);
  // Same setting as the picker in Settings, so a choice here sticks for later runs.
  $('run-model').onchange = e => { state.model = e.target.value; persist('all'); };
  if ($('stop')) $('stop').onclick = () => running?.controller.abort();
  if (out && !busyHere) {
    if ($('add-summary')) $('add-summary').onclick = () => doAddSummary(p, phase);
    const copyButton = (id, text, label) => {
      $(id).onclick = async () => {
        try {
          await navigator.clipboard.writeText(text);
          $(id).textContent = 'Copied';
        } catch (e) {
          $(id).textContent = "Couldn't copy";
        }
        setTimeout(() => { if ($(id)) $(id).textContent = label; }, 1500);
      };
    };
    copyButton('copy', out, 'Copy all');
    if (proposalText) copyButton('copy-proposal', proposalText, 'Copy proposal');
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

// A phase output: its summary in a card on top, then the full text. While streaming, the
// cursor follows whichever part is being written. Saved outputs without a summary get a
// button to add one.
function outputHtml(phase, text, streaming = false) {
  const cursor = streaming ? '<span class="cursor"></span>' : '';
  // Older research outputs were saved with a lead-in line before the first heading.
  if (phase.search && !streaming) text = stripPreamble(text);
  const { summary, body } = splitSummary(text);
  const full = content => `<div class="out" style="border-left-color:${phase.color}">${content}</div>`;

  if (!summary) {
    if (streaming) return full(md(text) + cursor);
    return `<div class="summary summary-missing" style="border-top-color:${phase.color}">
        <div><strong>No summary yet</strong><span class="meta" style="margin:4px 0 0">This output was written before summaries were added.
        Add one for under $0.01 with Claude Haiku 4.5.</span></div>
        <button class="btn" id="add-summary">Add summary</button>
        <div id="summary-err" style="flex-basis:100%"></div>
      </div>${full(md(text))}`;
  }
  return `<section class="summary" style="border-top-color:${phase.color}" aria-label="${esc(phase.name)} summary">
      <h2 class="summary-title">Summary</h2>
      ${md(summary)}${streaming && !body ? cursor : ''}
    </section>
    ${body ? full(md(body) + cursor) : ''}`;
}

async function doAddSummary(p, phase) {
  const button = $('add-summary');
  button.disabled = true;
  button.textContent = 'Summarising…';
  try {
    const { url, headers } = await apiTarget();
    const body = {
      model: INTAKE_MODEL, // short, factual work: the cheapest model is enough
      max_tokens: 1000,
      stream: true,
      messages: [{ role: 'user', content: summaryPrompt(phase, p.outputs[phase.id]) }]
    };
    if (USE_SUPABASE) body.phase = phase.id;
    const result = await callModel({ url, headers, body });
    const bullets = normaliseBullets(result.text);
    const existing = phase.search ? stripPreamble(p.outputs[phase.id]) : p.outputs[phase.id];
    await savePhaseOutput(p, phase.id, withSummary(bullets, existing), false);
    phaseNotice = { phaseId: phase.id, text: 'Summary added. The previous version is in History.' };
    if (showing(p, phase)) { renderRail(); renderPhase(phase); }
  } catch (e) {
    if (!showing(p, phase) || !$('summary-err')) return;
    $('summary-err').innerHTML = `<div class="err" style="margin-top:10px">${esc(e.message)}
      ${e.needsKey ? '<div class="row" style="margin-top:10px"><button class="btn" id="open-settings">Open Settings</button></div>' : ''}</div>`;
    if ($('open-settings')) $('open-settings').onclick = settings;
    $('add-summary').disabled = false;
    $('add-summary').textContent = 'Add summary';
  }
}

async function doRun(phase) {
  if (running) return;
  const p = current();
  running = { projectId: p.id, phaseId: phase.id, controller: new AbortController() };
  renderPhase(phase);
  $('body').innerHTML = `<div class="meta" id="activity"></div>
    <div id="live">${outputHtml(phase, '', true)}</div>`;

  const searches = [];
  try {
    const result = await runPhase(p, phase, {
      signal: running.controller.signal,
      onText: partial => {
        const live = $('live');
        if (live && showing(p, phase)) live.innerHTML = outputHtml(phase, partial, true);
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

// ---- Images -----------------------------------------------------------------
// Two ways to work: generate here with an image key, or copy the prompt into another tool and
// import the result. Both end with the image stored against its frame.

function renderAssets() {
  const p = current();
  const plan = p.outputs?.plan;
  const frames = p.imagePrompts || [];
  const model = imageModel(state.imageModel);
  const price = imagePrice(model.id, state.imageSize);
  const spent = totalAssetCost(p.assets);

  if (!plan) {
    $('view').innerHTML = `<h1>Images</h1>
      <p class="sub">Pictures for the frames in your plan: generated here, or made in another tool and imported.</p>
      <div class="empty" style="margin-top:18px">Run the Plan phase first. Its frames become the prompts for each image.</div>
      <div class="row" style="margin-top:14px"><button class="btn btn-go" id="go-plan">Go to Plan</button></div>`;
    $('go-plan').onclick = () => { view = { screen: 'plan' }; render(); };
    return;
  }

  $('view').innerHTML = `
    <h1>Images</h1>
    <p class="sub">One prompt per frame, in two versions: the finished scene, and the scene without the
      product or text for you to composite onto.</p>
    <div class="row">
      <button class="btn btn-go" id="write-prompts">${frames.length ? 'Rewrite prompts from the plan' : 'Write image prompts'}</button>
      <label class="model-pick" title="Image model used by Generate">
        <span class="sr-only">Image model</span>
        <select id="image-model">${IMAGE_MODELS.map(m => `<option value="${esc(m.id)}" ${m.id === model.id ? 'selected' : ''}>${esc(m.label)} · $${imagePrice(m.id, state.imageSize).toFixed(3)}</option>`).join('')}</select>
      </label>
      <label class="model-pick" title="Image size">
        <span class="sr-only">Image size</span>
        <select id="image-size">${Object.keys(model.sizes).map(s => `<option value="${s}" ${s === state.imageSize ? 'selected' : ''}>${s}</option>`).join('')}</select>
      </label>
      <span class="meta" style="margin:0">${esc(model.note)}${spent ? ` · $${spent.toFixed(2)} spent on this project` : ''}</span>
    </div>
    <div id="assets-msg"></div>
    ${deliveryNote(p, frames)}
    ${referencePanel(p)}
    <div id="frames">${frames.length ? '' : `<div class="empty" style="margin-top:18px">
      <strong>Start with “Write image prompts”.</strong><br>
      It reads your plan${p.outputs?.deliver ? ' and delivery specification' : ''} and writes one prompt per frame,
      in both versions, for about $0.02. Then generate them here or copy them into your own tool.</div>`}</div>`;

  wireReferences(p);
  loadThumbnails();

  $('write-prompts').onclick = doWritePrompts;
  $('image-model').onchange = e => {
    state.imageModel = e.target.value;
    const sizes = Object.keys(imageModel(state.imageModel).sizes);
    if (!sizes.includes(state.imageSize)) state.imageSize = sizes[0];
    persist('all'); renderAssets();
  };
  $('image-size').onchange = e => { state.imageSize = e.target.value; persist('all'); renderAssets(); };

  if (frames.length) {
    $('frames').innerHTML = frames.map(f => frameCard(p, f, price)).join('');
    wireFrameCards(p, frames);
  }
}

// Checks the prompts against Deliver's export list, so nothing that has to ship is forgotten.
function deliveryNote(project, frames) {
  const deliver = project.outputs?.deliver;
  if (!deliver) {
    return `<p class="note" style="margin-top:16px">Deliver hasn't run yet. Run it and rewrite the prompts to
      pick up exact export sizes, formats and platform requirements for each frame.</p>`;
  }
  const rows = exportRows(deliver, parseBlocks);
  if (!rows.length) return '';
  if (!frames.length) {
    return `<p class="note" style="margin-top:16px">Your delivery specification lists ${rows.length}
      ${rows.length === 1 ? 'deliverable' : 'deliverables'}: ${esc(rows.slice(0, 4).map(r => r.deliverable).join(', '))}${rows.length > 4 ? '…' : ''}.
      Write the prompts to cover them, with the right size and format for each.</p>`;
  }
  const { covered, missing } = coverage(frames, rows);
  if (!missing.length) {
    return `<p class="note" style="margin-top:16px">All ${covered.length} deliverables in the export list have a prompt.</p>`;
  }
  return `<div class="err" style="margin-top:16px">These deliverables have no prompt yet:
    <ul style="margin:6px 0 0">${missing.map(r => `<li>${esc(r.deliverable)}${r.dimensions ? ` — ${esc(r.dimensions)}` : ''}</li>`).join('')}</ul>
    Rewrite the prompts, or add them by hand in the plan and rewrite.</div>`;
}

// Reference images go with every Generate, so the client's own product, logo and room stay
// themselves from one post to the next instead of being reinvented each time.
function referencePanel(project) {
  const refs = project.references || [];
  return `<details class="card intake" style="margin-top:16px" ${refs.length ? '' : 'open'}>
    <summary>Brand references ${refs.length ? `(${refs.length})` : ''}</summary>
    <div class="stack" style="margin-top:14px">
      <p class="meta" style="margin:0">Photos of the client's real product, logo, room or dishes. Up to ${MAX_REFERENCES} are
      sent with every Generate, with an instruction to keep them exactly as they are. Without them the model
      invents a product that changes between posts.</p>
      <div class="row"><button class="btn" id="add-reference">Add reference images</button>
        <span class="meta" style="margin:0">${refs.length ? `${refs.length} in use` : 'None yet'}</span></div>
      <div class="shots">${refs.map(r => `
        <figure class="shot" data-reference="${esc(r.id)}">
          <img alt="${esc(r.name)}" data-src="${esc(r.id)}">
          <figcaption class="meta">${esc(r.name)}<span style="flex:1"></span>
            <button class="btn btn-quiet" data-del-reference="${esc(r.id)}">Remove</button></figcaption>
        </figure>`).join('')}</div>
    </div>
  </details>`;
}

function wireReferences(project) {
  $('add-reference').onclick = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/png,image/jpeg,image/webp';
    input.multiple = true;
    input.onchange = async () => {
      for (const file of [...(input.files || [])].slice(0, MAX_REFERENCES)) {
        try {
          if (file.size > 12_000_000) throw new Error(`${file.name} is larger than 12 MB.`);
          const dataUrl = await readFileAsDataUrl(file);
          const id = newId();
          await putImage(id, dataUrl);
          (project.references ??= []).push(referenceRecord({ id, name: file.name.replace(/\.[^.]+$/, ''), bytes: file.size }));
        } catch (e) {
          if ($('assets-msg')) $('assets-msg').innerHTML = `<div class="err" style="margin-top:16px">${esc(e.message)}</div>`;
        }
      }
      await persist('project', project);
      if (view.screen === 'assets') renderAssets();
    };
    input.click();
  };

  for (const button of document.querySelectorAll('[data-del-reference]')) {
    button.onclick = async () => {
      const id = button.dataset.delReference;
      await deleteImage(id).catch(() => {});
      project.references = (project.references || []).filter(r => r.id !== id);
      await persist('project', project);
      renderAssets();
    };
  }
}

const readFileAsDataUrl = file => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(reader.result);
  reader.onerror = () => reject(new Error("Couldn't read that file."));
  reader.readAsDataURL(file);
});

const variantLabel = { full: 'Full scene', plate: 'Scene plate' };

function frameCard(project, frame, price) {
  const variants = ['full', 'plate'].filter(v => frame[v]);
  const needed = longestSide(frame.dimensions);
  const generating = SIZE_PIXELS[state.imageSize] || 1024;
  const tooSmall = needed > generating;
  const spec = [frame.platform, frame.dimensions, frame.format].filter(Boolean).join(' · ');
  return `<section class="card stack frame-card" style="margin-top:16px">
    <div class="row"><h2 style="margin:0;flex:1">Frame ${esc(String(frame.frame))} · ${esc(frame.name)}</h2>
      <span class="tag">${esc(frame.aspect_ratio)}</span></div>
    ${spec || frame.requirement ? `<p class="meta" style="margin:0">
      ${spec ? `Delivers: ${esc(spec)}` : ''}${frame.requirement ? `${spec ? ' · ' : ''}${esc(frame.requirement)}` : ''}
      ${tooSmall ? `<br>Needs ${needed} px on the long side; ${state.imageSize} generates about ${generating} px, so generate at a larger size or enlarge it in finishing.` : ''}</p>` : ''}
    ${variants.map(v => {
      const shots = assetsForFrame(project.assets, frame.frame, v);
      return `<div class="variant">
        <div class="row">
          <strong>${variantLabel[v]}</strong>
          <span class="meta" style="margin:0">${v === 'plate' ? 'No product, no text' : 'Includes product and text'}</span>
          <span style="flex:1"></span>
          <button class="btn btn-quiet" data-copy-prompt="${frame.frame}|${v}">Copy prompt</button>
          <button class="btn" data-import="${frame.frame}|${v}">Import image</button>
          <button class="btn btn-go" data-generate="${frame.frame}|${v}">Generate · $${price.toFixed(3)}</button>
        </div>
        <details><summary class="meta">Prompt</summary><p class="prompt-text">${esc(frame[v])}</p></details>
        ${v === 'full' && project.references?.length ? `<p class="meta" style="margin:6px 0 0">Generate will use ${project.references.length} brand reference${project.references.length === 1 ? '' : 's'}.</p>` : ''}
        <div class="shots" id="shots-${frame.frame}-${v}">${shots.map(a => `
          <figure class="shot" data-asset="${esc(a.id)}">
            <img alt="${esc(a.name)} ${variantLabel[v].toLowerCase()}" data-src="${esc(a.id)}">
            <figcaption class="meta">${a.source === 'generated' ? `Generated${a.cost ? ` · $${a.cost.toFixed(3)}` : ''}` : 'Imported'}
              <span style="flex:1"></span>
              <button class="btn btn-quiet" data-download="${esc(a.id)}">Download</button>
              <button class="btn btn-quiet" data-delete="${esc(a.id)}">Delete</button></figcaption>
          </figure>`).join('')}</div>
      </div>`;
    }).join('')}
  </section>`;
}

function wireFrameCards(project, frames) {
  const frameOf = key => {
    const [n, variant] = key.split('|');
    return { frame: frames.find(f => String(f.frame) === n), variant };
  };

  for (const button of document.querySelectorAll('[data-copy-prompt]')) {
    button.onclick = async () => {
      const { frame, variant } = frameOf(button.dataset.copyPrompt);
      try {
        await navigator.clipboard.writeText(frame[variant]);
        button.textContent = 'Copied';
      } catch (e) { button.textContent = "Couldn't copy"; }
      setTimeout(() => { if (button.isConnected) button.textContent = 'Copy prompt'; }, 1500);
    };
  }

  for (const button of document.querySelectorAll('[data-generate]')) {
    button.onclick = () => doGenerate(project, ...Object.values(frameOf(button.dataset.generate)), button);
  }

  for (const button of document.querySelectorAll('[data-import]')) {
    button.onclick = () => {
      const { frame, variant } = frameOf(button.dataset.import);
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/png,image/jpeg,image/webp';
      input.onchange = () => { if (input.files?.[0]) doImport(project, frame, variant, input.files[0]); };
      input.click();
    };
  }

  for (const button of document.querySelectorAll('[data-download]')) {
    button.onclick = async () => {
      const asset = project.assets.find(a => a.id === button.dataset.download);
      const dataUrl = await getImage(asset.id);
      if (!dataUrl) return flash('That image is no longer in this browser.');
      const a = document.createElement('a');
      a.href = dataUrl;
      a.download = `frame${asset.frame}-${asset.variant}.jpg`;
      document.body.appendChild(a); a.click(); a.remove();
    };
  }

  for (const button of document.querySelectorAll('[data-delete]')) {
    button.onclick = async () => {
      const id = button.dataset.delete;
      if (!confirm('Delete this image? This cannot be undone.')) return;
      await deleteImage(id).catch(() => {});
      project.assets = (project.assets || []).filter(a => a.id !== id);
      await persist('project', project);
      renderAssets();
    };
  }

  loadThumbnails();
}

// Thumbnails come out of IndexedDB after their cards are on the page.
function loadThumbnails() {
  for (const img of document.querySelectorAll('img[data-src]')) {
    getImage(img.dataset.src).then(dataUrl => {
      if (!img.isConnected) return;
      if (dataUrl) img.src = dataUrl;
      else img.replaceWith(Object.assign(document.createElement('p'), { className: 'meta', textContent: 'Image missing from this browser.' }));
    }).catch(() => {});
  }
}

async function doWritePrompts() {
  const p = current();
  const button = $('write-prompts');
  button.disabled = true;
  button.textContent = 'Reading the plan…';
  $('assets-msg').innerHTML = '';
  try {
    const { url, headers } = await apiTarget();
    const body = {
      model: currentModel().id,
      max_tokens: 8000,
      stream: true,
      system: IMAGE_PROMPT_SYSTEM,
      // Deliver's export list says what must actually ship, so prompts carry its dimensions.
      messages: [{ role: 'user', content: buildImagePromptRequest(p.outputs.plan, p.brief, p.outputs.deliver) }]
    };
    if (currentModel().effort) body.output_config = { effort: currentModel().effort };
    if (USE_SUPABASE) body.phase = 'image_prompts';
    const result = await callModel({ url, headers, body });
    p.imagePrompts = parseFramePrompts(result.text);
    await persist('project', p);
    if (view.screen === 'assets') renderAssets();
  } catch (e) {
    if (!$('assets-msg')) return;
    $('assets-msg').innerHTML = `<div class="err" style="margin-top:16px">${esc(e.message)}
      ${e.needsKey ? '<div class="row" style="margin-top:10px"><button class="btn" id="open-settings">Open Settings</button></div>' : ''}</div>`;
    if ($('open-settings')) $('open-settings').onclick = settings;
    button.disabled = false;
    button.textContent = 'Write image prompts';
  }
}

async function doGenerate(project, frame, variant, button) {
  const label = button.textContent;
  button.disabled = true;
  button.textContent = 'Generating…';
  $('assets-msg').innerHTML = '';
  try {
    // A plate is deliberately product-free, so references only go with the full scene.
    const references = variant === 'full'
      ? (await Promise.all((project.references || []).slice(0, MAX_REFERENCES).map(r => getImage(r.id)))).filter(Boolean)
      : [];
    const { dataUrl, bytes } = await generateImage({
      model: state.imageModel,
      prompt: frame[variant],
      aspect: frame.aspect_ratio,
      size: state.imageSize,
      apiKey: state.imageKey,
      references
    });
    await storeAsset(project, frame, variant, dataUrl, {
      source: 'generated', model: state.imageModel, cost: imagePrice(state.imageModel, state.imageSize), bytes
    });
  } catch (e) {
    if ($('assets-msg')) {
      $('assets-msg').innerHTML = `<div class="err" style="margin-top:16px">${esc(e.message)}
        <div class="row" style="margin-top:10px"><button class="btn" id="open-settings">Open Settings</button></div></div>`;
      $('open-settings').onclick = settings;
    }
    button.disabled = false;
    button.textContent = label;
  }
}

async function doImport(project, frame, variant, file) {
  try {
    if (file.size > 12_000_000) throw new Error('That image is larger than 12 MB. Export a smaller version and import again.');
    const dataUrl = await readFileAsDataUrl(file);
    await storeAsset(project, frame, variant, dataUrl, { source: 'imported', bytes: file.size });
  } catch (e) {
    if ($('assets-msg')) $('assets-msg').innerHTML = `<div class="err" style="margin-top:16px">${esc(e.message)}</div>`;
  }
}

async function storeAsset(project, frame, variant, dataUrl, meta) {
  const id = newId();
  await putImage(id, dataUrl);
  (project.assets ??= []).push(assetRecord({
    id, frame: frame.frame, variant, name: frame.name,
    deliverable: [frame.deliverable || frame.platform, frame.dimensions].filter(Boolean).join(' '),
    ...meta
  }));
  await persist('project', project);
  if (view.screen === 'assets' && state.currentId === project.id) renderAssets();
  renderRail();
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
  flushBriefSave(); // reads the brief form now, before this render replaces it
  renderRail();
  if (!$('flash')) $('view').insertAdjacentHTML('beforebegin', '<div id="flash"></div>');
  if (view.screen === 'studio') return renderStudio();
  if (view.screen === 'assets') return current() ? renderAssets() : renderEmpty();
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
    <div><label for="ik">Image API key (Google AI Studio)</label>
      <input id="ik" type="password" value="${esc(state.imageKey || '')}" placeholder="Leave empty to copy prompts instead" autocomplete="off">
      <p class="meta">Only needed for Generate on the Images screen. Stored in this browser and sent only to Google.
      Image models need a paid tier; the free tier allows none. Get a key at aistudio.google.com/apikey.</p></div>
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
    state.imageKey = $('ik').value.trim();
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

function download(data, filename, type) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([data], { type }));
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000); // revoking at once cancels the download in some browsers
}

function exportMarkdown(p) {
  const doc = projectDocument(p, PHASES, FIELDS);
  const text = [`# ${doc.title}`, doc.subtitle, doc.date, ...doc.sections.map(s => `---\n\n# ${s.title}\n\n${s.markdown}`)]
    .filter(Boolean).join('\n\n') + '\n';
  download(text, `${fileSlug(p.name)}.md`, 'text/markdown');
}

function exportWord(p) {
  download(buildDocx(projectDocument(p, PHASES, FIELDS)), `${fileSlug(p.name)}.docx`,
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
}

// Opens the browser's print dialog on a print-styled copy; choosing "Save as PDF" there makes
// a PDF with real, selectable text and no library needed.
function exportPdf(p) {
  const frame = document.createElement('iframe');
  frame.setAttribute('aria-hidden', 'true');
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden';
  frame.onload = () => {
    frame.contentWindow.focus();
    frame.contentWindow.print();
    setTimeout(() => frame.remove(), 60000);
  };
  frame.srcdoc = buildPrintHtml(projectDocument(p, PHASES, FIELDS));
  document.body.appendChild(frame);
}

function exportProject() {
  flushBriefSave();
  const p = current();
  if (!p) return flash('Open a project first, then export it.');
  const done = PHASES.filter(ph => p.outputs[ph.id]);
  $('modal-root').innerHTML = `<div class="modal" id="modal"><div class="card stack">
    <h2>Export project</h2>
    <p class="sub" style="margin:0">${esc(p.name)}: the brief${p.brief?.request ? ', the original client request' : ''} and
      ${done.length ? `${done.length} ${done.length === 1 ? 'phase' : 'phases'} (${esc(done.map(ph => ph.name).join(', '))})` : 'no phases yet'}.
      Each phase starts on a new page.</p>
    ${done.length < PHASES.length ? `<p class="note" style="margin:0">Phases that haven't run are left out. Run them first for a complete document.</p>` : ''}
    <div class="export-options">
      <button class="export-option" id="x-pdf"><strong>PDF</strong><span>Opens the print dialog. Choose "Save as PDF" as the printer.</span></button>
      <button class="export-option" id="x-word"><strong>Word document</strong><span>A .docx file for Word, Google Docs or Pages.</span></button>
      <button class="export-option" id="x-md"><strong>Markdown</strong><span>Plain text, for notes apps or version control.</span></button>
    </div>
    <div class="row"><button class="btn" id="x-close">Close</button></div>
  </div></div>`;
  const close = () => { $('modal-root').innerHTML = ''; };
  const run = fn => () => {
    try { fn(p); close(); }
    catch (e) { flash(`Couldn't export: ${e.message}`); close(); }
  };
  $('x-pdf').onclick = run(exportPdf);
  $('x-word').onclick = run(exportWord);
  $('x-md').onclick = run(exportMarkdown);
  $('x-close').onclick = close;
  $('modal').onclick = e => { if (e.target.id === 'modal') close(); };
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
      // A waiting brief save would recreate the project after it's deleted.
      if (state.currentId === id) cancelBriefSave(); else flushBriefSave();
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
  window.__appStarted = true; // tells the load-error notice in index.html that modules loaded
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
