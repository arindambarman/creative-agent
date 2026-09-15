import { test } from 'node:test';
import assert from 'node:assert/strict';
import { md, esc, stripPreamble } from '../js/markdown.js';

test('strips a short lead-in before the first heading', () => {
  assert.equal(stripPreamble('Now I have enough research. Let me write the full response.\n\n---\n\n## Category landscape\nText'),
    '## Category landscape\nText');
  assert.equal(stripPreamble('## Already clean\nText'), '## Already clean\nText');
  assert.equal(stripPreamble('No headings at all.'), 'No headings at all.');
  const long = 'A real opening paragraph. '.repeat(20) + '\n## Heading';
  assert.equal(stripPreamble(long), long);
});

test('escapes html in model text', () => {
  assert.equal(esc('<img src=x onerror="a">&'), '&lt;img src=x onerror=&quot;a&quot;&gt;&amp;');
  assert.ok(!md('<script>alert(1)</script>').includes('<script>'));
});

test('headings shift down one level so the page keeps its own h1', () => {
  assert.equal(md('# Title'), '<h2>Title</h2>');
  assert.equal(md('### Sub'), '<h4>Sub</h4>');
  assert.equal(md('#### Deep'), '<h4>Deep</h4>');
});

test('lists switch type and close cleanly', () => {
  assert.equal(md('- a\n- b\n1. c'), '<ul><li>a</li><li>b</li></ul><ol><li>c</li></ol>');
});

test('tables skip the separator row', () => {
  const html = md('| Task | Hours |\n|---|---:|\n| Model | 4 |');
  assert.equal(html, '<table><thead><tr><th>Task</th><th>Hours</th></tr></thead><tbody><tr><td>Model</td><td>4</td></tr></tbody></table>');
});

test('inline bold, italics, code and links', () => {
  assert.equal(md('**Palette** uses *amber* `#C97B3F`'),
    '<p><strong>Palette</strong> uses <em>amber</em> <code>#C97B3F</code></p>');
  assert.equal(md('[Source](https://example.com/a?b=1&c=2)'),
    '<p><a href="https://example.com/a?b=1&amp;c=2" target="_blank" rel="noopener">Source</a></p>');
});

test('only http links become anchors', () => {
  assert.ok(!md('[x](javascript:alert(1))').includes('<a'));
});

test('fenced code is shown verbatim, including an unclosed fence mid-stream', () => {
  assert.equal(md('```\n# not a heading\n<b>\n```'), '<pre><code># not a heading\n&lt;b&gt;</code></pre>');
  assert.equal(md('```\npartial'), '<pre><code>partial</code></pre>');
});

test('blockquotes group consecutive lines', () => {
  assert.equal(md('> one\n> two\nafter'), '<blockquote><p>one</p><p>two</p></blockquote><p>after</p>');
});

test('handles empty and missing input', () => {
  assert.equal(md(''), '');
  assert.equal(md(undefined), '');
});
