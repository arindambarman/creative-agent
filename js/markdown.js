// Minimal markdown renderer — headings, tables, lists, bold, italics, code, fenced code,
// quotes, rules, links. No DOM access, so it can be tested in Node.
// Extend this rather than adding a library.

export const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const inline = t => esc(t)
  .replace(/`([^`]+)`/g, '<code>$1</code>')
  .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  .replace(/(^|[\s(])\*([^*\n]+)\*/g, '$1<em>$2</em>')
  .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');

export function md(src) {
  const lines = String(src ?? '').split('\n');
  let out = '', list = null, table = null, quote = false, fence = null;
  const closeList = () => { if (list) { out += `</${list}>`; list = null; } };
  const closeTable = () => { if (table) { out += '</tbody></table>'; table = null; } };
  const closeQuote = () => { if (quote) { out += '</blockquote>'; quote = false; } };

  for (const line of lines) {
    const t = line.trim();

    // Fenced code: everything until the closing fence is shown as-is.
    if (fence !== null) {
      if (/^```/.test(t)) { out += `<pre><code>${esc(fence.join('\n'))}</code></pre>`; fence = null; }
      else fence.push(line);
      continue;
    }
    if (/^```/.test(t)) { closeList(); closeTable(); closeQuote(); fence = []; continue; }

    if (/^\|(.+)\|$/.test(t)) {
      if (/^[-: |]+$/.test(t)) continue; // the |---|---| separator row
      const cells = t.slice(1, -1).split('|').map(c => c.trim());
      closeQuote();
      if (!table) {
        closeList();
        table = 1;
        out += '<table><thead><tr>' + cells.map(c => `<th>${inline(c)}</th>`).join('') + '</tr></thead><tbody>';
      } else {
        out += '<tr>' + cells.map(c => `<td>${inline(c)}</td>`).join('') + '</tr>';
      }
      continue;
    }
    closeTable();

    const q = t.match(/^>\s?(.*)$/);
    if (q) {
      closeList();
      if (!quote) { out += '<blockquote>'; quote = true; }
      if (q[1]) out += `<p>${inline(q[1])}</p>`;
      continue;
    }
    closeQuote();

    if (!t) { closeList(); continue; }
    const h = t.match(/^(#{1,4})\s+(.*)$/);
    if (h) {
      closeList();
      const level = Math.min(h[1].length + 1, 4);
      out += `<h${level}>${inline(h[2])}</h${level}>`;
      continue;
    }
    if (/^(---|___|\*\*\*)$/.test(t)) { closeList(); out += '<hr>'; continue; }
    const ol = t.match(/^\d+[.)]\s+(.*)$/);
    const ul = t.match(/^[-*+]\s+(.*)$/);
    if (ol || ul) {
      const want = ol ? 'ol' : 'ul';
      if (list !== want) { closeList(); out += `<${want}>`; list = want; }
      out += `<li>${inline((ol || ul)[1])}</li>`;
      continue;
    }
    closeList();
    out += `<p>${inline(t)}</p>`;
  }
  // An unclosed fence is common mid-stream; show what has arrived so far.
  if (fence !== null) out += `<pre><code>${esc(fence.join('\n'))}</code></pre>`;
  closeList(); closeTable(); closeQuote();
  return out;
}
