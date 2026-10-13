// The Leads screens: campaigns, the search, and what happens to each business afterwards.
//
// The only file in the lead agent that touches the DOM. Everything it needs from the app —
// the state, saving, the API call, the project handoff — arrives once through initLeads(),
// so this file never has to know whether it is running on localStorage or Supabase.

import { md, esc, sectionText } from './markdown.js';
import { MODELS, modelInfo, CONFIG } from './config.js';
import { LEAD_SYSTEM, JSON_ONLY, REACH, buildTargetRequest, buildFindRequest, buildAuditRequest, buildApproachRequest, imageBlock } from './leads.js';
import { parseLeads, dedupe, rankLeads, applyAudit, scoreLead, isVerified, worthApproaching, APPROACH_THRESHOLD } from './leadparse.js';
import { STATUSES, statusInfo, advance, dueFollowUps, counts, outcomeSummary } from './pipeline.js';
import { putImage, getImage } from './assets.js';

let app = null;               // set by initLeads
let ui = { filter: 'all' };   // which leads are on screen; not worth saving
let busy = false;             // a search or a write is running

export function initLeads(ctx) { app = ctx; }

const $ = id => document.getElementById(id);
const state = () => app.state();
const dollars = n => `about $${(Math.ceil(n * 100) / 100).toFixed(2)}`;
const campaigns = () => (state().campaigns ??= []);
const current = () => campaigns().find(c => c.id === app.view().campaignId) || null;

// ---- Campaign list ----------------------------------------------------------

export function renderLeads() {
  const campaign = current();
  if (campaign) return renderCampaign(campaign);

  const rows = campaigns();
  $('view').innerHTML = `
    <h1>Leads</h1>
    <p class="sub">Find small businesses in one place whose pictures are holding them back, and
      write the first message. A campaign is one place and one category, run again whenever you want more.</p>
    <div class="row"><button class="btn btn-go" id="new-campaign">New campaign</button></div>
    <div id="campaign-list">${rows.length ? '' : `<div class="empty" style="margin-top:18px">
      <strong>Start with one place and one category.</strong><br>
      One at a time, because the same message and the same sample image then work across the whole list.
      A run of twenty businesses costs about $0.20.</div>`}</div>`;

  $('new-campaign').onclick = newCampaign;
  if (!rows.length) return;

  $('campaign-list').innerHTML = rows.map(c => {
    const n = counts(c.leads || []);
    const due = dueFollowUps(c.leads || []).length;
    const ready = (c.leads || []).filter(worthApproaching).length;
    return `<div class="card stack" style="margin-top:16px">
      <div class="row">
        <div style="flex:1"><h2 style="margin:0">${esc(c.name)}</h2>
          <p class="meta" style="margin:4px 0 0">${esc(c.place || 'no place set')} · ${esc(c.niche || 'no category set')}</p></div>
        <button class="btn btn-go" data-open-campaign="${esc(c.id)}">Open</button>
        <button class="btn btn-quiet" data-del-campaign="${esc(c.id)}" aria-label="Delete ${esc(c.name)}">×</button>
      </div>
      <p class="meta" style="margin:0">${n.total} ${n.total === 1 ? 'business' : 'businesses'} ·
        ${ready} worth approaching · ${n.approached} approached · ${n.replied + n.talking} in conversation
        ${due ? ` · <strong>${due} follow-up${due === 1 ? '' : 's'} due</strong>` : ''}</p>
    </div>`;
  }).join('');

  for (const b of document.querySelectorAll('[data-open-campaign]')) {
    b.onclick = () => { app.setView({ screen: 'leads', campaignId: b.dataset.openCampaign }); };
  }
  for (const b of document.querySelectorAll('[data-del-campaign]')) {
    b.onclick = async () => {
      const c = campaigns().find(x => x.id === b.dataset.delCampaign);
      if (!confirm(`Delete "${c?.name}" and its ${(c?.leads || []).length} businesses? This cannot be undone.`)) return;
      state().campaigns = campaigns().filter(x => x.id !== c.id);
      await app.persist('delete-campaign', c.id);
      renderLeads();
    };
  }
}

async function newCampaign() {
  const campaign = {
    id: app.newId(), name: 'New campaign', created: Date.now(),
    place: '', reach: 'region', niche: '', platforms: 'Instagram and an online shop', notes: '',
    target: '', leads: [], runInfo: {}
  };
  campaigns().unshift(campaign);
  await app.persist('campaign', campaign);
  app.setView({ screen: 'leads', campaignId: campaign.id });
}

// ---- One campaign -----------------------------------------------------------

function renderCampaign(c) {
  const leads = c.leads || [];
  const n = counts(leads);
  const due = dueFollowUps(leads);
  const ready = leads.filter(worthApproaching).length;
  const model = modelInfo(state().model);
  const settingsOpen = !c.place || !c.niche;

  $('view').innerHTML = `
    <div class="row" style="margin-bottom:10px">
      <button class="btn btn-quiet" id="back-campaigns">← All campaigns</button>
    </div>
    <h1>${esc(c.name)}</h1>
    <p class="sub">${esc(c.place || 'No place set yet')} · ${esc(c.niche || 'no category yet')} ·
      ${esc((REACH.find(r => r.id === c.reach) || REACH[0]).label.toLowerCase())}</p>

    <details class="card intake" ${settingsOpen ? 'open' : ''}>
      <summary>Hunting ground</summary>
      <div class="stack" style="margin-top:14px">
        <div class="grid2">
          <div><label for="c-name">Campaign name</label><input id="c-name" value="${esc(c.name)}"></div>
          <div><label for="c-place">Place</label><input id="c-place" value="${esc(c.place || '')}" placeholder="Bristol, or Kolkata, or the Cotswolds"></div>
        </div>
        <div class="grid2">
          <div><label for="c-reach">How far</label>
            <select id="c-reach">${REACH.map(r => `<option value="${r.id}" ${r.id === (c.reach || 'region') ? 'selected' : ''}>${esc(r.label)}</option>`).join('')}</select></div>
          <div><label for="c-niche">Category</label><input id="c-niche" value="${esc(c.niche || '')}" placeholder="small-batch food and drink"></div>
        </div>
        <div><label for="c-platforms">Platforms that matter</label><input id="c-platforms" value="${esc(c.platforms || '')}" placeholder="Instagram and an online shop"></div>
        <div><label for="c-notes">Notes</label><textarea id="c-notes" rows="3" placeholder="Anything to steer it: price range, types of business to avoid, a market you already know.">${esc(c.notes || '')}</textarea></div>
        <div class="row"><button class="btn btn-go" id="c-save">Save campaign</button><span id="c-saved" class="meta" style="margin:0"></span></div>
      </div>
    </details>

    <div class="row" style="margin-top:18px">
      <button class="btn ${c.target ? '' : 'btn-go'}" id="run-target" ${busy ? 'disabled' : ''}>${c.target ? 'Rewrite the hunting plan' : 'Write the hunting plan'}</button>
      <button class="btn ${c.target ? 'btn-go' : ''}" id="run-find" ${busy ? 'disabled' : ''}>Find businesses · ${dollars(CONFIG.leadSearches * 0.01 + 0.06)}</button>
      <label class="model-pick" title="Model used for the next run">
        <span class="sr-only">Model</span>
        <select id="lead-model" ${busy ? 'disabled' : ''}>${MODELS.map(m => `<option value="${esc(m.id)}" ${m.id === model.id ? 'selected' : ''}>${esc(m.label)}</option>`).join('')}</select>
      </label>
      <span class="meta" style="margin:0">Uses live web search</span>
    </div>
    <div id="lead-msg"></div>
    ${due.length ? `<p class="note" style="margin-top:16px"><strong>${due.length} follow-up${due.length === 1 ? '' : 's'} due:</strong>
      ${esc(due.slice(0, 5).map(l => l.name).join(', '))}${due.length > 5 ? '…' : ''}. One follow-up, then stop.</p>` : ''}
    ${c.target ? `<details class="card intake" style="margin-top:16px"><summary>Hunting plan</summary>
      <div class="out" style="border-left-color:var(--brass);margin-top:12px">${md(c.target)}</div></details>` : ''}

    ${leads.length ? `
      <div class="row" style="margin-top:22px"><h2 style="margin:0;flex:1">Businesses</h2>
        <span class="meta" style="margin:0">${n.total} found · ${ready} worth approaching · ${n.approached} approached</span></div>
      <div class="filters">${filterButtons(leads)}</div>
      <div id="lead-list"></div>
      ${outcomeNote(leads)}`
      : `<div class="empty" style="margin-top:18px">No businesses yet.
        ${c.target ? 'Run <strong>Find businesses</strong> to search the ground in your plan.'
          : 'Start with <strong>Write the hunting plan</strong>: it names the markets, stockists and awards worth searching in your place, for about $0.02.'}</div>`}`;

  $('back-campaigns').onclick = () => app.setView({ screen: 'leads' });
  $('c-save').onclick = () => saveSettings(c);
  $('run-target').onclick = () => doTarget(c);
  $('run-find').onclick = () => doFind(c);
  $('lead-model').onchange = e => { state().model = e.target.value; app.persist('all'); };

  if (leads.length) {
    for (const b of document.querySelectorAll('[data-filter]')) {
      b.onclick = () => { ui.filter = b.dataset.filter; renderCampaign(c); };
    }
    drawLeads(c);
  }
}

const FILTERS = [
  { id: 'all', label: 'All', fn: () => true },
  { id: 'ready', label: 'Worth approaching', fn: l => worthApproaching(l) && !l.approachedAt },
  { id: 'unseen', label: 'Not looked at', fn: l => !isVerified(l) },
  { id: 'open', label: 'In play', fn: l => ['approached', 'replied', 'talking'].includes(l.status) },
  { id: 'due', label: 'Follow-up due', fn: l => l.nextAt && l.nextAt <= Date.now() && !statusInfo(l.status).done }
];

const filterButtons = leads => FILTERS
  .map(f => ({ ...f, n: leads.filter(f.fn).length }))
  .filter(f => f.id === 'all' || f.n)
  .map(f => `<button class="filter ${ui.filter === f.id ? 'on' : ''}" data-filter="${f.id}">${f.label} ${f.n}</button>`).join('');

function outcomeNote(leads) {
  const s = outcomeSummary(leads);
  if (!s.approached) return '';
  if (!s.rate) return `<p class="meta" style="margin-top:18px">${s.approached} approached, ${s.replied} replied.
    After ten approaches this will show which kind of trigger earns answers.</p>`;
  return `<div class="card" style="margin-top:18px"><h2 style="margin:0 0 8px">What is working</h2>
    <p class="meta" style="margin:0">${s.replied} replies from ${s.approached} approaches, ${s.rate}%.</p>
    <table class="lead-table"><thead><tr><th>Trigger</th><th>Approached</th><th>Replied</th><th>Won</th></tr></thead>
      <tbody>${s.rows.map(r => `<tr><td>${esc(r.trigger)}</td><td>${r.approached}</td><td>${r.replied}</td><td>${r.won}</td></tr>`).join('')}</tbody></table></div>`;
}

async function saveSettings(c) {
  c.name = $('c-name').value.trim() || 'New campaign';
  c.place = $('c-place').value.trim();
  c.reach = $('c-reach').value;
  c.niche = $('c-niche').value.trim();
  c.platforms = $('c-platforms').value.trim();
  c.notes = $('c-notes').value.trim();
  const ok = await app.persist('campaign', c);
  if ($('c-saved')) $('c-saved').textContent = ok ? 'Saved' : "Couldn't save";
  renderCampaign(c);
}

// ---- The leads themselves ---------------------------------------------------

function drawLeads(c) {
  const filter = FILTERS.find(f => f.id === ui.filter) || FILTERS[0];
  const leads = rankLeads((c.leads || []).filter(filter.fn));
  const box = $('lead-list');
  if (!box) return;
  box.innerHTML = leads.length
    ? leads.map(l => leadCard(c, l)).join('')
    : '<div class="empty" style="margin-top:18px">Nothing in this view.</div>';
  wireLeads(c);
  for (const img of document.querySelectorAll('img[data-shot]')) {
    getImage(img.dataset.shot).then(url => { if (url && img.isConnected) img.src = url; }).catch(() => {});
  }
}

function evidence(rows, { dim = false } = {}) {
  return rows.map(r => `<li class="${dim ? 'unseen' : ''}">${esc(r.label)}${r.detail ? `: ${esc(r.detail)}` : ''}
    ${r.date ? `<span class="meta" style="display:inline;margin:0">(${esc(r.date)})</span>` : ''}
    ${r.source && /^https?:/i.test(r.source) ? `<a href="${esc(r.source)}" target="_blank" rel="noopener">source</a>` : ''}</li>`).join('');
}

function leadCard(c, lead) {
  const score = lead.score || scoreLead(lead);
  const status = statusInfo(lead.status);
  const seen = (lead.gaps || []).filter(g => g.seen);
  const guessed = (lead.gaps || []).filter(g => !g.seen);
  const ready = score.total >= APPROACH_THRESHOLD;
  return `<section class="card stack lead" style="margin-top:16px" data-lead="${esc(lead.id)}">
    <div class="row">
      <h2 style="margin:0;flex:1">${esc(lead.name)}</h2>
      <span class="score ${ready ? 'go' : ''}" title="Trigger ${score.a}, gap ${score.b}, can pay ${score.c}">${score.total}/10</span>
      ${isVerified(lead) ? '' : '<span class="tag">not looked at</span>'}
      <span class="tag ${status.done ? '' : 'tag-on'}">${esc(status.label)}</span>
    </div>
    <p class="meta" style="margin:0">${[lead.what, lead.area, lead.size].filter(Boolean).map(esc).join(' · ')}
      ${lead.website ? `· <a href="${esc(lead.website)}" target="_blank" rel="noopener">site</a>` : ''}
      ${lead.instagram ? `· <a href="https://instagram.com/${esc(lead.instagram)}" target="_blank" rel="noopener">@${esc(lead.instagram)}</a>` : ''}</p>
    ${lead.skip ? `<p class="err" style="margin:0">Possible disqualifier: ${esc(lead.skip)}</p>` : ''}

    ${lead.triggers?.length ? `<div><strong>Why now</strong><ul class="ev">${evidence(lead.triggers)}</ul></div>`
      : '<p class="meta" style="margin:0">No trigger found. Worth watching, not worth a message yet.</p>'}
    ${seen.length ? `<div><strong>What their pictures are not doing</strong><ul class="ev">${evidence(seen)}</ul></div>` : ''}
    ${guessed.length ? `<div><strong>Unconfirmed, from search results only</strong><ul class="ev">${evidence(guessed, { dim: true })}</ul></div>` : ''}
    ${lead.strengths?.length ? `<p class="meta" style="margin:0">Already works: ${esc(lead.strengths.join('; '))}</p>` : ''}
    ${lead.pays?.length ? `<p class="meta" style="margin:0">Can pay: ${esc(lead.pays.map(p => p.detail || p.label).join('; '))}</p>` : ''}
    ${lead.contact ? `<p class="meta" style="margin:0">Contact: ${esc(lead.contact)}</p>` : ''}
    ${lead.shotId ? `<img class="shot-thumb" data-shot="${esc(lead.shotId)}" alt="Screenshot of ${esc(lead.name)}">` : ''}

    <div class="row">
      <button class="btn" data-audit="${esc(lead.id)}">${isVerified(lead) ? 'Look again' : 'Add a screenshot'}</button>
      <button class="btn ${ready && !lead.approach ? 'btn-go' : ''}" data-approach="${esc(lead.id)}">${lead.approach ? 'Rewrite the message' : 'Write the message'}</button>
      <label class="model-pick"><span class="sr-only">Status for ${esc(lead.name)}</span>
        <select data-status="${esc(lead.id)}">${STATUSES.map(s => `<option value="${s.id}" ${s.id === (lead.status || 'new') ? 'selected' : ''}>${esc(s.label)}</option>`).join('')}</select></label>
      ${lead.projectId ? `<button class="btn btn-quiet" data-open-project="${esc(lead.projectId)}">Open its project</button>`
        : `<button class="btn btn-quiet" data-start-project="${esc(lead.id)}">Start a project</button>`}
    </div>
    ${lead.nextAction ? `<p class="meta" style="margin:0">Next: ${esc(lead.nextAction)}${lead.nextAt ? ` · ${new Date(lead.nextAt).toLocaleDateString()}` : ''}</p>` : ''}
    <div id="lead-work-${esc(lead.id)}">${lead.approach ? approachBlock(lead) : ''}</div>
  </section>`;
}

function approachBlock(lead) {
  return `<div class="out" style="border-left-color:var(--brass)">${md(lead.approach)}</div>
    <div class="row" style="margin-top:12px">
      <button class="btn" data-copy-message="${esc(lead.id)}">Copy the message</button>
      <button class="btn btn-quiet" data-copy-all="${esc(lead.id)}">Copy all of it</button>
      <span class="meta" style="margin:0">Send it yourself from your own address. Mark it approached when you do.</span>
    </div>`;
}

function wireLeads(c) {
  const find = id => (c.leads || []).find(l => l.id === id);

  for (const b of document.querySelectorAll('[data-audit]')) {
    b.onclick = () => pickScreenshot(c, find(b.dataset.audit));
  }
  for (const b of document.querySelectorAll('[data-approach]')) {
    b.onclick = () => doApproach(c, find(b.dataset.approach), b);
  }
  for (const s of document.querySelectorAll('[data-status]')) {
    s.onchange = async () => {
      const lead = find(s.dataset.status);
      Object.assign(lead, advance(lead, s.value));
      await app.persist('campaign', c);
      renderCampaign(c);
    };
  }
  for (const b of document.querySelectorAll('[data-start-project]')) {
    b.onclick = async () => {
      const lead = find(b.dataset.startProject);
      const project = await app.startProject(lead, c);
      lead.projectId = project.id;
      await app.persist('campaign', c);
    };
  }
  for (const b of document.querySelectorAll('[data-open-project]')) {
    b.onclick = () => app.openProject(b.dataset.openProject);
  }
  const copy = (attr, pick, label) => {
    for (const b of document.querySelectorAll(`[${attr}]`)) {
      b.onclick = async () => {
        const text = pick(find(b.getAttribute(attr)));
        try { await navigator.clipboard.writeText(text); b.textContent = 'Copied'; }
        catch (e) { b.textContent = "Couldn't copy"; }
        setTimeout(() => { if (b.isConnected) b.textContent = label; }, 1500);
      };
    }
  };
  copy('data-copy-message', l => sectionText(l.approach, 'Message') || l.approach, 'Copy the message');
  copy('data-copy-all', l => l.approach, 'Copy all of it');
}

// ---- The four runs ----------------------------------------------------------

const say = html => { if ($('lead-msg')) $('lead-msg').innerHTML = html; };
const problem = (e, extra = '') => say(`<div class="err" style="margin-top:16px">${esc(e.message)}${extra}
  ${e.needsKey ? '<div class="row" style="margin-top:10px"><button class="btn" id="open-settings">Open Settings</button></div>' : ''}</div>`);
const wireSettings = () => { if ($('open-settings')) $('open-settings').onclick = app.settings; };

async function doTarget(c) {
  if (busy) return;
  if (!c.place || !c.niche) return say('<div class="err" style="margin-top:16px">Set a place and a category first, under Hunting ground.</div>');
  busy = true;
  const button = $('run-target');
  button.disabled = true;
  button.textContent = 'Reading the ground…';
  say('');
  try {
    const result = await app.callApi({
      body: {
        model: state().model, max_tokens: 2500, stream: true, system: LEAD_SYSTEM,
        messages: [{ role: 'user', content: buildTargetRequest(c, state().docs) }]
      },
      phase: 'lead_target'
    });
    c.target = result.text.trim();
    (c.runInfo ??= {}).target = { model: state().model, usage: result.usage };
    busy = false;
    await app.persist('campaign', c);
    if (showing(c)) renderCampaign(c);
  } catch (e) {
    busy = false;
    if (!showing(c)) return;
    renderCampaign(c);
    problem(e);
    wireSettings();
  }
}

async function doFind(c) {
  if (busy) return;
  if (!c.place || !c.niche) return say('<div class="err" style="margin-top:16px">Set a place and a category first, under Hunting ground.</div>');
  busy = true;
  const button = $('run-find');
  button.disabled = true;
  button.textContent = 'Searching…';
  const searches = [];
  say('<p class="meta" style="margin-top:16px">Searching. This takes a minute or two and runs several searches.</p>');
  try {
    const result = await app.callApi({
      body: {
        model: state().model, max_tokens: 8000, stream: true, system: JSON_ONLY,
        messages: [{ role: 'user', content: buildFindRequest(c, c.target, { already: (c.leads || []).map(l => l.name) }) }]
      },
      phase: 'lead_find',
      search: true,
      onSearch: q => {
        searches.push(q);
        say(`<p class="meta" style="margin-top:16px">Searched: ${esc(searches.join(' · '))}</p>`);
      }
    });
    const found = parseLeads(result.text);
    const { fresh, duplicates, skipped } = dedupe(found, c.leads || [], state().doNotContact || []);
    const now = Date.now();
    for (const lead of fresh) {
      (c.leads ??= []).push({ ...lead, id: app.newId(), status: 'new', created: now, touches: [] });
    }
    (c.runInfo ??= {}).find = { model: state().model, usage: result.usage };
    busy = false;
    await app.persist('campaign', c);
    if (!showing(c)) return;
    renderCampaign(c);
    const ready = fresh.filter(worthApproaching).length;
    say(`<div class="note" style="margin-top:16px">Added ${fresh.length} ${fresh.length === 1 ? 'business' : 'businesses'}
      from ${searches.length} ${searches.length === 1 ? 'search' : 'searches'}${duplicates.length ? `, ${duplicates.length} already in the list` : ''}${skipped.length ? `, ${skipped.length} on the do-not-contact list` : ''}.
      ${ready ? `${ready} already clear the bar.` : 'None clear the bar yet: add a screenshot to the ones with a trigger, which is what scores the gap.'}
      ${app.costLine({ model: state().model, usage: result.usage }).replace(/^ · /, 'Cost: ')}</div>`);
  } catch (e) {
    busy = false;
    if (!showing(c)) return;
    renderCampaign(c);
    problem(e, e.partial ? ' The reply arrived unfinished; running it again usually works.' : '');
    wireSettings();
  }
}

// A screenshot is the only honest way to say anything about a business's pictures.
function pickScreenshot(c, lead) {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/png,image/jpeg,image/webp';
  input.onchange = () => { if (input.files?.[0]) doAudit(c, lead, input.files[0]); };
  input.click();
}

// Big screenshots cost tokens for detail nobody needs, so they are shrunk before they are sent.
export function shrink(dataUrl, max = 1568) {
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, max / Math.max(img.width, img.height));
      if (scale === 1 && dataUrl.length < 1_500_000) return resolve(dataUrl);
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL('image/jpeg', 0.85));
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
}

async function doAudit(c, lead, file) {
  if (busy) return;
  busy = true;
  say(`<p class="meta" style="margin-top:16px">Reading the screenshot of ${esc(lead.name)}…</p>`);
  try {
    if (file.size > 12_000_000) throw new Error('That screenshot is larger than 12 MB. Take a smaller one.');
    const raw = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error("Couldn't read that file."));
      reader.readAsDataURL(file);
    });
    const dataUrl = await shrink(raw);
    const block = imageBlock(dataUrl);
    if (!block) throw new Error('That file is not a PNG, JPEG or WebP image.');

    const result = await app.callApi({
      body: {
        model: state().model, max_tokens: 1500, stream: true, system: JSON_ONLY,
        messages: [{ role: 'user', content: [block, { type: 'text', text: buildAuditRequest(lead, c) }] }]
      },
      phase: 'lead_audit'
    });
    let audit;
    try { audit = JSON.parse(result.text.slice(result.text.indexOf('{'), result.text.lastIndexOf('}') + 1)); }
    catch (e) { throw new Error("Couldn't read the audit. Try again with a clearer screenshot."); }

    const shotId = lead.shotId || app.newId();
    await putImage(shotId, dataUrl);
    Object.assign(lead, applyAudit(lead, audit), { shotId, verdict: audit.verdict || '', oneLine: audit.one_line || '' });
    busy = false;
    await app.persist('campaign', c);
    if (!showing(c)) return;
    renderCampaign(c);
    const good = /already good/i.test(lead.verdict || '');
    say(`<div class="${good ? 'err' : 'note'}" style="margin-top:16px">${esc(lead.name)}:
      ${good ? 'their pictures are already good. Not a lead — mark it skip and spend the message somewhere else.'
        : `${(lead.gaps || []).filter(g => g.seen).length} things to work with. ${esc(lead.oneLine || '')}`}</div>`);
  } catch (e) {
    busy = false;
    if (!showing(c)) return;
    renderCampaign(c);
    problem(e);
    wireSettings();
  }
}

async function doApproach(c, lead, button) {
  if (busy) return;
  busy = true;
  button.disabled = true;
  button.textContent = 'Writing…';
  say('');
  try {
    const result = await app.callApi({
      body: {
        model: state().model, max_tokens: 2000, stream: true, system: LEAD_SYSTEM,
        messages: [{ role: 'user', content: buildApproachRequest(lead, c, state().docs) }]
      },
      phase: 'lead_approach'
    });
    lead.approach = result.text.trim();
    lead.approachModel = { model: state().model, usage: result.usage };
    busy = false;
    await app.persist('campaign', c);
    if (showing(c)) renderCampaign(c);
  } catch (e) {
    busy = false;
    if (!showing(c)) return;
    renderCampaign(c);
    problem(e);
    wireSettings();
  }
}

const showing = c => app.view().screen === 'leads' && app.view().campaignId === c.id;
