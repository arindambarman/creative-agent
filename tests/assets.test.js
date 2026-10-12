import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assetRecord, referenceRecord, assetsForFrame, assetSummary, referenceSummary, totalAssetCost } from '../js/assets.js';

test('a reference record keeps the picture out of the project too', () => {
  const ref = referenceRecord({ id: 'r1', name: 'Jar photo', bytes: 90000 });
  assert.equal(ref.id, 'r1');
  assert.equal(ref.name, 'Jar photo');
  assert.ok(!('dataUrl' in ref));
  assert.equal(referenceRecord({ id: 'r2' }).name, 'Reference');
});

test('references are listed for the later phases', () => {
  assert.equal(referenceSummary([{ name: 'Jar photo', note: 'client supplied' }, { name: 'Logo' }]),
    '- Jar photo: client supplied\n- Logo');
  assert.equal(referenceSummary([]), '');
});

test('an asset record keeps only what the project needs', () => {
  const record = assetRecord({ id: 'a1', frame: 2, variant: 'full', name: 'Label crop', source: 'generated', model: 'gemini-nano-banana-2.1', cost: 0.0336, bytes: 180000 });
  assert.equal(record.id, 'a1');
  assert.equal(record.variant, 'full');
  assert.equal(record.source, 'generated');
  assert.ok(record.created > 0);
  assert.ok(!('dataUrl' in record), 'the picture itself is not stored with the project');
});

test('assets can be found per frame and per variant', () => {
  const assets = [
    assetRecord({ id: 'a', frame: 1, variant: 'full', source: 'generated' }),
    assetRecord({ id: 'b', frame: 1, variant: 'plate', source: 'imported' }),
    assetRecord({ id: 'c', frame: 2, variant: 'full', source: 'imported' })
  ];
  assert.deepEqual(assetsForFrame(assets, 1).map(a => a.id), ['a', 'b']);
  assert.deepEqual(assetsForFrame(assets, 1, 'plate').map(a => a.id), ['b']);
  assert.deepEqual(assetsForFrame([], 1), []);
});

test('the summary tells later phases what exists', () => {
  const assets = [
    assetRecord({ id: 'a', frame: 1, variant: 'full', name: 'Counter scene', source: 'generated' }),
    assetRecord({ id: 'b', frame: 1, variant: 'plate', name: 'Counter scene', source: 'imported' }),
    assetRecord({ id: 'c', frame: 7, variant: 'full', name: 'Hero', source: 'imported' })
  ];
  assert.equal(assetSummary(assets),
    '- Frame 1 Counter scene: full scene (generated), scene plate (imported)\n- Frame 7 Hero: full scene (imported)');
  assert.equal(assetSummary([]), '');
});

test('costs add up across generated images', () => {
  assert.equal(totalAssetCost([{ cost: 0.0336 }, { cost: 0.0336 }, { source: 'imported' }]).toFixed(4), '0.0672');
  assert.equal(totalAssetCost(), 0);
});
