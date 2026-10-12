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
export function buildImagePromptRequest(planOutput, brief = {}) {
  const product = [brief.product, brief.client].filter(Boolean).join(' by ');
  return `Below is the production plan for a visual content project.

<plan>
${planOutput}
</plan>

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

Reply with JSON only, keeping the plan's own frame numbers:
{"frames":[{"frame":1,"name":"short name","aspect_ratio":"4:5","full":"...","plate":"..."}]}`;
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
  const out = frames.map((f, i) => ({
    frame: Number.isFinite(f?.frame) ? f.frame : i + 1,
    name: clean(f?.name) || `Frame ${i + 1}`,
    aspect_ratio: /^\d{1,2}:\d{1,2}$/.test(clean(f?.aspect_ratio)) ? clean(f.aspect_ratio) : '4:5',
    full: clean(f?.full),
    plate: clean(f?.plate)
  })).filter(f => f.full || f.plate);
  if (!out.length) throw new Error('No frames came back. Check that the Plan output lists frames, then try again.');
  return out;
}

// One image from Google's image API. Returns the bytes as a data URL, ready to show or store.
export async function generateImage({ model, prompt, aspect = '4:5', size = '1K', apiKey, fetchImpl = fetch, signal }) {
  if (!apiKey) throw new Error('Add an image API key in Settings, or use Copy prompt and import the image instead.');
  const res = await fetchImpl('https://generativelanguage.googleapis.com/v1beta/interactions', {
    method: 'POST',
    headers: { 'x-goog-api-key': apiKey, 'Content-Type': 'application/json' },
    signal,
    body: JSON.stringify({
      model,
      input: prompt,
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
