// Turning plan frames into pictures.
//
// Two ways to work, both supported here:
//   Generate — the app calls an image API with the key in Settings.
//   Copy prompt — the designer pastes the prompt into whatever tool they prefer, makes the
//                 image there, and imports the file back into the project.
//
// The prompts themselves are written by the text model from the Plan output, so they carry the
// frame's shot, light, props and copy. No DOM access, so this can be tested in Node.

// Prices are US dollars per image from https://ai.google.dev/gemini-api/docs/pricing,
// read on 12 October 2026. Keep the ids in step with the picker in Settings.
export const IMAGE_MODELS = [
  { id: 'gemini-nano-banana-2.1', label: 'Nano Banana 2.1', provider: 'google',
    note: 'Recommended. Accurate text on labels and headlines.', sizes: { '1K': 0.0336, '2K': 0.0504 } },
  { id: 'gemini-3.1-flash-lite-image', label: 'Flash Lite Image', provider: 'google',
    note: 'Cheapest and fastest, 1K only.', sizes: { '1K': 0.0336 } },
  { id: 'gemini-3-pro-image', label: 'Nano Banana Pro', provider: 'google',
    note: 'Highest quality, four times the price.', sizes: { '1K': 0.134, '2K': 0.134 } }
];

export const imageModel = id => IMAGE_MODELS.find(m => m.id === id) || IMAGE_MODELS[0];
export const imagePrice = (id, size = '1K') => {
  const m = imageModel(id);
  return m.sizes[size] ?? m.sizes[Object.keys(m.sizes)[0]];
};

export const IMAGE_PROMPT_SYSTEM =
  'You are an art director writing image generation instructions for a photographer or image model. Reply with JSON only.';

// Asks the text model for one prompt per frame, in two versions: the finished scene, and the
// same scene with the product and text left out for the designer to composite.
export function buildImagePromptRequest(planOutput, brief = {}, deliverOutput = '') {
  const product = [brief.product, brief.client].filter(Boolean).join(' by ');
  return `Below is the production plan for a visual content project.

<plan>
${planOutput}
</plan>
${deliverOutput ? `
The delivery specification below lists what must actually be exported: platforms, exact pixel
dimensions, file formats and platform requirements. Every deliverable in it that needs a picture
must have a frame here, even if the plan missed it.

<delivery_specification>
${deliverOutput}
</delivery_specification>
` : ''}
${product ? `The product is: ${product}.\n` : ''}${brief.notes ? `Brief notes: ${brief.notes}\n` : ''}
For every frame in the plan, write image generation instructions in two versions.

"full": the complete scene, including the product and any on-image text the frame calls for.
Describe the product exactly as the plan and brief describe it, including label wording.

"plate": the same scene with no product and no text anywhere — the surface, props and light
only, lit and composed so the designer can add the real product photo and set the type
afterwards. End it by naming what must not appear.

Each version is one paragraph of 60 to 120 words covering: subject, setting, surface, props,
light direction and quality, colour palette with any hex values from the plan, camera angle and
lens feel, depth of field, mood, and where empty space must be left for type. Describe what to
see, not which tool to use. Never name a brand, an artist, or a photographer.

Give every frame its delivery details where the specification provides them: the platform, the
exact pixel dimensions, the file format, and any platform requirement. Take the aspect ratio
from those dimensions. Where the specification says nothing, use the plan and leave the rest empty.

Reply with JSON only, keeping the plan's own frame numbers:
{"frames":[{"frame":1,"name":"short name","aspect_ratio":"4:5","deliverable":"Instagram feed post",
"platform":"Instagram","dimensions":"1080 x 1350","format":"JPG","requirement":"label sharp at 1x",
"full":"...","plate":"..."}]}`;
}

export function parseFramePrompts(text) {
  const raw = String(text ?? '');
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start === -1 || end <= start) throw new Error("Couldn't read the image prompts. Run it again.");
  let data;
  try { data = JSON.parse(raw.slice(start, end + 1)); } catch (e) {
    throw new Error("Couldn't read the image prompts. Run it again.");
  }
  const frames = Array.isArray(data?.frames) ? data.frames : [];
  const clean = v => (typeof v === 'string' ? v.trim() : '');
  const out = frames.map((f, i) => {
    const dimensions = clean(f?.dimensions);
    const stated = clean(f?.aspect_ratio);
    return {
      frame: Number.isFinite(f?.frame) ? f.frame : i + 1,
      name: clean(f?.name) || `Frame ${i + 1}`,
      // The exported dimensions are the truth about shape; the stated ratio is the fallback.
      aspect_ratio: aspectFromDimensions(dimensions) || (/^\d{1,2}:\d{1,2}$/.test(stated) ? stated : '4:5'),
      deliverable: clean(f?.deliverable),
      platform: clean(f?.platform),
      dimensions,
      format: clean(f?.format),
      requirement: clean(f?.requirement),
      full: clean(f?.full),
      plate: clean(f?.plate)
    };
  }).filter(f => f.full || f.plate);
  if (!out.length) throw new Error('No frames came back. Check that the Plan output lists frames, then try again.');
  return out;
}

// ---- Delivery specification ---------------------------------------------------
// The Deliver phase lists what has to be exported. These helpers carry that through to the
// pictures, so every deliverable that needs an image has a prompt and the right shape.

// "1080 x 1350" -> "4:5". Unreadable or square-ish oddities come back as null.
export function aspectFromDimensions(text) {
  const match = /(\d{3,5})\s*[x×*]\s*(\d{3,5})/i.exec(String(text ?? ''));
  if (!match) return null;
  let [w, h] = [Number(match[1]), Number(match[2])];
  if (!w || !h) return null;
  const gcd = (a, b) => (b ? gcd(b, a % b) : a);
  const d = gcd(w, h);
  return `${w / d}:${h / d}`;
}

// The longest side the export needs, so the app can tell when 1K is too small for it.
export const longestSide = text => {
  const match = /(\d{3,5})\s*[x×*]\s*(\d{3,5})/i.exec(String(text ?? ''));
  return match ? Math.max(Number(match[1]), Number(match[2])) : 0;
};

export const SIZE_PIXELS = { '0.5K': 512, '1K': 1024, '2K': 2048, '4K': 4096 };

// Rows of the Deliver phase's export table, whatever its column order.
export function exportRows(deliverOutput, parseBlocks) {
  const tables = parseBlocks(deliverOutput || '').filter(b => b.type === 'table' && b.rows.length > 1);
  const rows = [];
  for (const table of tables) {
    const header = table.rows[0].map(c => c.toLowerCase());
    const at = names => header.findIndex(h => names.some(n => h.includes(n)));
    const columns = {
      deliverable: at(['deliverable', 'asset', 'item', 'frame']),
      platform: at(['platform', 'channel']),
      dimensions: at(['dimension', 'size', 'pixel']),
      format: at(['format', 'file type']),
      requirement: at(['requirement', 'note', 'platform requirement'])
    };
    if (columns.deliverable === -1 || columns.dimensions === -1) continue; // not an export table
    for (const row of table.rows.slice(1)) {
      const value = i => (i >= 0 ? (row[i] || '').trim() : '');
      const deliverable = value(columns.deliverable);
      if (!deliverable) continue;
      rows.push({
        deliverable,
        platform: value(columns.platform),
        dimensions: value(columns.dimensions),
        format: value(columns.format),
        requirement: value(columns.requirement)
      });
    }
  }
  return rows;
}

// Which exports have a prompt, and which don't. Matched on frame number first, then on the
// deliverable's own words, so "Frame 4 — Reel" finds the Reel prompt.
export function coverage(frames, rows) {
  const covered = [], missing = [];
  for (const row of rows) {
    const frameNumber = /frame\s*(\d+)/i.exec(row.deliverable)?.[1];
    const words = row.deliverable.toLowerCase().replace(/frame\s*\d+/i, '').split(/[^a-z0-9]+/).filter(w => w.length > 3);
    const match = frames.find(f => (frameNumber && String(f.frame) === frameNumber))
      || frames.find(f => {
        const hay = `${f.deliverable} ${f.name} ${f.platform}`.toLowerCase();
        return words.length > 0 && words.every(w => hay.includes(w));
      })
      || frames.find(f => row.dimensions && f.dimensions && longestSide(f.dimensions) === longestSide(row.dimensions)
        && aspectFromDimensions(f.dimensions) === aspectFromDimensions(row.dimensions));
    if (match) covered.push({ row, frame: match });
    else missing.push(row);
  }
  return { covered, missing };
}

// At most this many reference images travel with a request: enough for a product, a logo and a
// room shot, without slowing every generation down.
export const MAX_REFERENCES = 4;

// Tested wording: with this instruction and one product photo, the same jar, label design and
// label text came back across five different scenes. Without it, the label was redrawn each time.
export const REFERENCE_INSTRUCTION =
  'Use the product and brand materials from the reference images exactly as they appear: the same shapes and proportions, the same label and logo design, the same typography and the same wording. Do not redesign or re-letter anything shown in the references.';

export const withReferences = (prompt, count) =>
  (count > 0 ? `${REFERENCE_INSTRUCTION} ${prompt}` : prompt);

// data:image/jpeg;base64,xxxx -> the shape the API wants for an image part.
export function dataUrlToPart(dataUrl) {
  const match = /^data:(image\/[a-z+]+);base64,(.+)$/i.exec(String(dataUrl || ''));
  if (!match) return null;
  return { type: 'image', mime_type: match[1].toLowerCase(), data: match[2] };
}

// Errors the user fixes in Settings are marked, so the app can offer the button.
const keyError = message => Object.assign(new Error(message), { needsKey: true });

// One image from Google's image API. Returns the bytes as a data URL, ready to show or store.
// `references` are data URLs of the client's own product, logo or room photos.
export async function generateImage({ model, prompt, aspect = '4:5', size = '1K', apiKey, references = [], fetchImpl = fetch, signal }) {
  if (!apiKey) throw keyError('Add an image API key in Settings, or use Copy prompt and import the image instead.');
  const referenceParts = references.slice(0, MAX_REFERENCES).map(dataUrlToPart).filter(Boolean);
  const res = await fetchImpl('https://generativelanguage.googleapis.com/v1beta/interactions', {
    method: 'POST',
    headers: { 'x-goog-api-key': apiKey, 'Content-Type': 'application/json' },
    signal,
    body: JSON.stringify({
      model,
      input: referenceParts.length
        ? [...referenceParts, { type: 'text', text: withReferences(prompt, referenceParts.length) }]
        : prompt,
      // The API accepts JPEG only for these models.
      response_format: { type: 'image', mime_type: 'image/jpeg', aspect_ratio: aspect, image_size: size }
    })
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch (e) { data = null; }
  if (!res.ok) {
    const message = data?.error?.message || text.slice(0, 200);
    if (res.status === 429 && /free tier/i.test(message)) {
      throw new Error('This key has no image quota. Image models need a paid tier, even though text models are free.');
    }
    // The usual mix-up is the Anthropic key in the image box, which Google rejects as invalid.
    if (res.status === 401 || res.status === 403 || /api[\s_-]?key not valid|invalid api key/i.test(message)) {
      throw keyError('Your image API key was rejected. Check it in Settings: it comes from aistudio.google.com/apikey and goes in the image box, not the Anthropic one.');
    }
    throw new Error(`Image request failed (${res.status}). ${message}`.trim());
  }
  const base64 = findImageData(data);
  if (!base64) throw new Error('The model returned no image. Try again, or simplify the prompt.');
  return { dataUrl: `data:image/jpeg;base64,${base64}`, bytes: Math.round(base64.length * 0.75) };
}

// The image block moves around between API versions, so look for it anywhere in the response.
export function findImageData(node, depth = 0) {
  if (!node || depth > 8) return null;
  if (Array.isArray(node)) {
    for (const item of node) {
      const found = findImageData(item, depth + 1);
      if (found) return found;
    }
    return null;
  }
  if (typeof node !== 'object') return null;
  if (typeof node.data === 'string' && (node.type === 'image' || node.mime_type?.startsWith('image/'))) return node.data;
  if (typeof node.inlineData?.data === 'string') return node.inlineData.data;
  for (const value of Object.values(node)) {
    const found = findImageData(value, depth + 1);
    if (found) return found;
  }
  return null;
}
