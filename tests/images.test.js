import { test } from 'node:test';
import assert from 'node:assert/strict';
import { IMAGE_MODELS, MAX_REFERENCES, imageModel, imagePrice, buildImagePromptRequest, parseFramePrompts, generateImage, findImageData, dataUrlToPart, withReferences, aspectFromDimensions, longestSide, exportRows, coverage } from '../js/images.js';
import { parseBlocks } from '../js/document.js';

test('aspect ratios and sizes come from the export dimensions', () => {
  assert.equal(aspectFromDimensions('1080 x 1350'), '4:5');
  assert.equal(aspectFromDimensions('1080x1920'), '9:16');
  assert.equal(aspectFromDimensions('2048 × 2048'), '1:1');
  assert.equal(aspectFromDimensions('no numbers here'), null);
  assert.equal(longestSide('1080 x 1350'), 1350);
  assert.equal(longestSide(''), 0);
});

test('the export table is read whatever its column order', () => {
  const deliver = `## Export list

| Platform | Deliverable | File format | Dimensions | Requirement |
|---|---|---|---|---|
| Instagram | Frame 1 — feed post | JPG | 1080 x 1350 | none |
| Pinterest | Frame 5 — pin | JPG | 1000 x 1500 | text safe margin |

## Something else

| Task | Hours |
|---|---|
| Composite | 2 |`;
  const rows = exportRows(deliver, parseBlocks);
  assert.equal(rows.length, 2, 'the hours table is not an export table');
  assert.deepEqual(rows[0], { deliverable: 'Frame 1 — feed post', platform: 'Instagram', dimensions: '1080 x 1350', format: 'JPG', requirement: 'none' });
});

test('coverage finds the prompt for each deliverable, and what is missing', () => {
  const frames = [
    { frame: 1, name: 'Counter scene', deliverable: 'Instagram feed post', platform: 'Instagram', dimensions: '1080 x 1350' },
    { frame: 4, name: 'Reel', deliverable: '', platform: 'Instagram', dimensions: '1080 x 1920' }
  ];
  const rows = [
    { deliverable: 'Frame 1 — feed post', dimensions: '1080 x 1350' },
    { deliverable: 'Reel teaser', dimensions: '1080 x 1920' },
    { deliverable: 'Table card A4 print', dimensions: '2480 x 3508' }
  ];
  const { covered, missing } = coverage(frames, rows);
  assert.deepEqual(covered.map(c => c.frame.frame), [1, 4]);
  assert.deepEqual(missing.map(m => m.deliverable), ['Table card A4 print']);
});

test('frames carry their delivery details, taking the shape from the dimensions', () => {
  const [frame] = parseFramePrompts(JSON.stringify({ frames: [{
    frame: 4, name: 'Reel', aspect_ratio: '4:5', deliverable: 'Instagram Reel', platform: 'Instagram',
    dimensions: '1080 x 1920', format: 'MP4', requirement: '7-10 sec', full: 'A jar', plate: 'No jar'
  }] }));
  assert.equal(frame.aspect_ratio, '9:16', 'the dimensions win over a wrong stated ratio');
  assert.equal(frame.deliverable, 'Instagram Reel');
  assert.equal(frame.format, 'MP4');
  assert.equal(frame.requirement, '7-10 sec');
});

test('the delivery specification is included in the prompt request when it exists', () => {
  const withSpec = buildImagePromptRequest('plan text', {}, '| Deliverable | Dimensions |\n|---|---|\n| Hero | 2048 x 2048 |');
  assert.match(withSpec, /<delivery_specification>/);
  assert.match(withSpec, /must have a frame here/);
  assert.doesNotMatch(buildImagePromptRequest('plan text', {}), /<delivery_specification>/);
});

test('the reference instruction is only added when there are references', () => {
  assert.match(withReferences('A scene.', 2), /exactly as they appear[\s\S]*A scene\./);
  assert.equal(withReferences('A scene.', 0), 'A scene.');
});

test('image models have prices and a sensible default', () => {
  assert.ok(IMAGE_MODELS.length >= 3);
  assert.equal(imageModel('nope').id, IMAGE_MODELS[0].id);
  assert.equal(imagePrice('gemini-nano-banana-2.1', '1K'), 0.0336);
  assert.equal(imagePrice('gemini-3.1-flash-lite-image', '2K'), 0.0336); // falls back to the only size
});

test('the prompt request carries the plan, the product and both versions', () => {
  const req = buildImagePromptRequest('**Frame 1** — shot details', { product: 'Toasted Oat Latte candle', client: 'Hearth & Grain' });
  assert.match(req, /<plan>\n\*\*Frame 1\*\* — shot details\n<\/plan>/);
  assert.match(req, /Toasted Oat Latte candle by Hearth & Grain/);
  assert.match(req, /"full"/);
  assert.match(req, /"plate"/);
});

test('parses frames, keeping plan numbering and filling gaps', () => {
  const frames = parseFramePrompts('```json\n{"frames":[{"frame":7,"name":" Hero ","aspect_ratio":"1:1","full":"A jar","plate":"No jar"},{"full":"Second","aspect_ratio":"wrong"}]}\n```');
  assert.deepEqual(frames[0], {
    frame: 7, name: 'Hero', aspect_ratio: '1:1', full: 'A jar', plate: 'No jar',
    deliverable: '', platform: '', dimensions: '', format: '', requirement: ''
  });
  assert.equal(frames[1].frame, 2);
  assert.equal(frames[1].aspect_ratio, '4:5'); // bad ratios fall back
  assert.equal(frames[1].name, 'Frame 2');
});

test('unusable replies raise a readable error', () => {
  assert.throws(() => parseFramePrompts('Sorry, no.'), /Couldn't read the image prompts/);
  assert.throws(() => parseFramePrompts('{"frames":[]}'), /No frames came back/);
});

test('finds the image however the response nests it', () => {
  assert.equal(findImageData({ output_image: { type: 'image', data: 'AAA' } }), 'AAA');
  assert.equal(findImageData({ steps: [{ model_output: { content: [{ type: 'image', data: 'BBB' }] } }] }), 'BBB');
  assert.equal(findImageData({ candidates: [{ content: { parts: [{ inlineData: { data: 'CCC' } }] } }] }), 'CCC');
  assert.equal(findImageData({ nothing: true }), null);
});

const okResponse = body => ({ ok: true, status: 200, text: async () => JSON.stringify(body) });
const errResponse = (status, body) => ({ ok: false, status, text: async () => JSON.stringify(body) });

test('generates an image and returns a data URL', async () => {
  let sent = null;
  const fetchImpl = async (url, init) => { sent = { url, body: JSON.parse(init.body) }; return okResponse({ output_image: { type: 'image', data: 'Zm9v' } }); };
  const result = await generateImage({ model: 'gemini-nano-banana-2.1', prompt: 'A jar', aspect: '9:16', size: '2K', apiKey: 'test-value', fetchImpl });
  assert.equal(result.dataUrl, 'data:image/jpeg;base64,Zm9v');
  assert.match(sent.url, /generativelanguage\.googleapis\.com/);
  assert.deepEqual(sent.body.response_format, { type: 'image', mime_type: 'image/jpeg', aspect_ratio: '9:16', image_size: '2K' });
  assert.equal(sent.body.model, 'gemini-nano-banana-2.1');
});

test('reference images are sent with the prompt and the keep-it-the-same instruction', async () => {
  let sent = null;
  const fetchImpl = async (url, init) => { sent = JSON.parse(init.body); return okResponse({ output_image: { type: 'image', data: 'Zm9v' } }); };
  await generateImage({
    model: 'm', prompt: 'On an oak counter.', apiKey: 'test-value', fetchImpl,
    references: ['data:image/jpeg;base64,AAA', 'data:image/png;base64,BBB', 'not-a-data-url']
  });
  assert.equal(sent.input.length, 3); // two usable references plus the text
  assert.deepEqual(sent.input[0], { type: 'image', mime_type: 'image/jpeg', data: 'AAA' });
  assert.deepEqual(sent.input[1], { type: 'image', mime_type: 'image/png', data: 'BBB' });
  assert.match(sent.input[2].text, /^Use the product and brand materials from the reference images exactly/);
  assert.match(sent.input[2].text, /On an oak counter\.$/);
});

test('without references the prompt goes as plain text', async () => {
  let sent = null;
  const fetchImpl = async (url, init) => { sent = JSON.parse(init.body); return okResponse({ output_image: { type: 'image', data: 'Zm9v' } }); };
  await generateImage({ model: 'm', prompt: 'A plate with no product.', apiKey: 'test-value', fetchImpl });
  assert.equal(sent.input, 'A plate with no product.');
});

test('at most four references travel with a request', async () => {
  let sent = null;
  const fetchImpl = async (url, init) => { sent = JSON.parse(init.body); return okResponse({ output_image: { type: 'image', data: 'Zm9v' } }); };
  const many = Array.from({ length: 7 }, (_, i) => `data:image/jpeg;base64,IMG${i}`);
  await generateImage({ model: 'm', prompt: 'x', apiKey: 'test-value', fetchImpl, references: many });
  assert.equal(sent.input.filter(p => p.type === 'image').length, MAX_REFERENCES);
});

test('data URLs convert to image parts, and anything else is dropped', () => {
  assert.deepEqual(dataUrlToPart('data:image/webp;base64,QQ=='), { type: 'image', mime_type: 'image/webp', data: 'QQ==' });
  assert.equal(dataUrlToPart('https://example.com/a.jpg'), null);
  assert.equal(dataUrlToPart(''), null);
});

test('a missing key points at the other way of working', async () => {
  await assert.rejects(generateImage({ model: 'x', prompt: 'y' }), /Copy prompt and import the image instead/);
});

test('a free-tier key gets an explanation, not a raw error', async () => {
  const fetchImpl = async () => errResponse(429, { error: { message: 'Rate limit exceeded (limit: 0 requests per day on Free Tier).' } });
  await assert.rejects(generateImage({ model: 'x', prompt: 'y', apiKey: 'test-value', fetchImpl }), /needs? a paid tier/i);
});

test('other failures surface the API message', async () => {
  const fetchImpl = async () => errResponse(400, { error: { message: "mime_type 'image/png' is not supported" } });
  await assert.rejects(generateImage({ model: 'x', prompt: 'y', apiKey: 'test-value', fetchImpl }), /Image request failed \(400\)\. mime_type/);
});

test('a response with no image is an error', async () => {
  const fetchImpl = async () => okResponse({ steps: [] });
  await assert.rejects(generateImage({ model: 'x', prompt: 'y', apiKey: 'test-value', fetchImpl }), /returned no image/);
});
