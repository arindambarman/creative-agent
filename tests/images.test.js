import { test } from 'node:test';
import assert from 'node:assert/strict';
import { IMAGE_MODELS, imageModel, imagePrice, buildImagePromptRequest, parseFramePrompts, generateImage, findImageData } from '../js/images.js';

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
  assert.deepEqual(frames[0], { frame: 7, name: 'Hero', aspect_ratio: '1:1', full: 'A jar', plate: 'No jar' });
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
