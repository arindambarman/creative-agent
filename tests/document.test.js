import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseBlocks, parseInline, crc32, zipStore, buildDocxFiles, buildDocx, buildPrintHtml, projectDocument, fileSlug } from '../js/document.js';

test('splits markdown into the blocks the app renders', () => {
  const blocks = parseBlocks('## Palette\nWarm tones.\n\n- one\n- two\n1. first\n\n| A | B |\n|---|---|\n| 1 | 2 |\n\n> quote\n---\n```\ncode\n```');
  assert.deepEqual(blocks.map(b => b.type), ['heading', 'para', 'list', 'list', 'table', 'quote', 'rule', 'code']);
  assert.deepEqual(blocks[2], { type: 'list', ordered: false, items: ['one', 'two'] });
  assert.equal(blocks[3].ordered, true);
  assert.deepEqual(blocks[4].rows, [['A', 'B'], ['1', '2']]);
});

test('splits inline markdown into runs', () => {
  assert.deepEqual(parseInline('**Palette** uses *amber* `#C97B3F` [src](https://a.com/x?y=1)'), [
    { text: 'Palette', bold: true },
    { text: ' uses ' },
    { text: 'amber', italic: true },
    { text: ' ' },
    { text: '#C97B3F', code: true },
    { text: ' ' },
    { text: 'src', link: 'https://a.com/x?y=1' }
  ]);
});

test('crc32 matches the standard value', () => {
  assert.equal(crc32(new TextEncoder().encode('hello')), 0x3610a686);
});

test('zip has a header per file and an end record with the right count', () => {
  const zip = zipStore({ 'a.txt': 'hi', 'dir/b.txt': 'there' });
  const view = new DataView(zip.buffer);
  assert.equal(view.getUint32(0, true), 0x04034b50);
  const end = zip.length - 22;
  assert.equal(view.getUint32(end, true), 0x06054b50);
  assert.equal(view.getUint16(end + 10, true), 2);
});

test('docx contains the required parts, escapes text, and links hyperlinks', () => {
  const files = buildDocxFiles({
    title: 'Ember & Oak <launch>',
    sections: [{ title: 'Discover', markdown: '## Sources\n- [Vogue](https://vogue.com)\n1. a\n\n1. b', newPage: true }]
  });
  for (const part of ['[Content_Types].xml', '_rels/.rels', 'word/document.xml', 'word/styles.xml', 'word/numbering.xml', 'word/_rels/document.xml.rels']) {
    assert.ok(files[part], `missing ${part}`);
  }
  const body = files['word/document.xml'];
  assert.match(body, /Ember &amp; Oak &lt;launch&gt;/);
  assert.match(body, /<w:br w:type="page"\/>/);
  assert.match(files['word/_rels/document.xml.rels'], /Id="rLink1"[^>]*Target="https:\/\/vogue.com" TargetMode="External"/);
  // Two separate numbered lists each restart at 1.
  assert.match(files['word/numbering.xml'], /w:numId="2"[\s\S]*w:numId="3"/);
  assert.ok(buildDocx({ title: 'x', sections: [] }).length > 1000);
});

test('control characters from model text are removed from the XML', () => {
  const body = buildDocxFiles({ title: 'Badtitle', sections: [] })['word/document.xml'];
  assert.ok(!body.includes(''));
});

test('project document orders brief, request, then completed phases', () => {
  const phases = [
    { id: 'discover', name: 'Discover', blurb: 'Trends and the marketing angle' },
    { id: 'direct', name: 'Direct', blurb: 'Concept, colour and type' }
  ];
  const fields = [['client', 'Client or brand'], ['budget', 'Budget']];
  const doc = projectDocument(
    { name: 'Launch', brief: { client: 'Crumb | Bakery', notes: 'Six posts', request: 'Need posts\nThanks' }, outputs: { direct: '## Idea' } },
    phases, fields, new Date('2026-09-15T12:00:00Z')
  );
  assert.deepEqual(doc.sections.map(s => s.title), ['Brief', 'Original client request', 'Direct: concept, colour and type']);
  assert.match(doc.sections[0].markdown, /\| Client or brand \| Crumb \/ Bakery \|/);
  assert.equal(doc.sections[1].markdown, '> Need posts\n> Thanks');
  assert.equal(doc.subtitle, 'Crumb | Bakery · 1 of 2 phases complete');
  assert.equal(doc.date, 'Exported 15 September 2026');
});

test('older research outputs lose their lead-in on export', () => {
  const doc = projectDocument(
    { name: 'x', brief: {}, outputs: { discover: 'Now I have enough research.\n\n## Category landscape\nText' } },
    [{ id: 'discover', name: 'Discover', blurb: 'Trends', search: true }], []
  );
  assert.equal(doc.sections[1].markdown, '## Category landscape\nText');
});

test('print page escapes the title and starts phases on new pages', () => {
  const html = buildPrintHtml({ title: '<b>x</b>', sections: [{ title: 'Plan', markdown: 'Text', newPage: true }] });
  assert.match(html, /&lt;b&gt;x&lt;\/b&gt;/);
  assert.match(html, /<section class="new-page">/);
});

test('file names are safe', () => {
  assert.equal(fileSlug('Hearth & Grain: Toasted Oat Latte launch'), 'hearth-grain-toasted-oat-latte-launch');
  assert.equal(fileSlug(''), 'project');
});
