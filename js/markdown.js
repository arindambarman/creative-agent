// Minimal markdown renderer — headings, tables, lists, bold, italics, code, fenced code,
// quotes, rules, links. No DOM access, so it can be tested in Node.
// Extend this rather than adding a library.

export const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const inline = t => esc(t)
  .replace(/`([^`]+)`/g, '<code>$1</code>')
  .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  .replace(/(^|[\s(])\*([^*\n]+)\*/g, '$1<em>$2</em>')
  .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');

// Drops a short lead-in ("Now I have enough research…") and any rule after it, when the
// real content starts at a heading. Longer text before the first heading is left alone.
export function stripPreamble(src, maxChars = 300) {
  const text = String(src ?? '');
  const m = text.match(/^#{1,4}\s/m);
  if (!m || m.index === 0) return text;
  const lead = text.slice(0, m.index);
  if (lead.trim().length > maxChars) return text;
  return text.slice(m.index);
}

// Separates a leading "## Summary" section from the rest of an output, so the app can show it
// in its own card. The summary runs until the next heading or horizontal rule. Outputs without
// one come back with an empty summary and the text untouched.
export function splitSummary(src) {
  const text = String(src ?? '');
  const start = stripPreamble(text).replace(/^\s+/, '');
  const head = start.match(/^#{1,4}\s+summary\b[^\n]*(\n|$)/i);
  if (!head) return { summary: '', body: text };

  const rest = start.slice(head[0].length);
  const end = rest.search(/^(#{1,4}\s|(---|\*\*\*|___)\s*$)/m);
  const summary = (end === -1 ? rest : rest.slice(0, end)).trim();
  let body = end === -1 ? '' : rest.slice(end);
  body = body.replace(/^(---|\*\*\*|___)\s*\n/, '').replace(/^\s+/, '');
  return { summary, body };
}

// Cleans a model's bullet list: keeps list lines, normalises markers to "- ", at most six.
export function normaliseBullets(src, max = 6) {
  const bullets = String(src ?? '').split('\n')
    .map(l => l.trim().match(/^(?:[-*+•]|\d+[.)])\s+(.*\S)/))
    .filter(Boolean)
    .map(m => `- ${m[1]}`)
    .slice(0, max);
  if (!bullets.length) throw new Error("The summary came back empty. Try again.");
  return bullets.join('\n');
}

// The text under one "## Heading", up to the next heading of the same or higher level, as plain
// text ready to paste: bold, italics, code and link markup removed, paragraphs kept.
export function sectionText(src, title) {
  const lines = String(src ?? '').split('\n');
  const escaped = title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const start = lines.findIndex(l => new RegExp(`^(#{1,4})\\s+${escaped}\\s*$`, 'i').test(l.trim()));
  if (start === -1) return '';
  const level = lines[start].trim().match(/^#+/)[0].length;
  const out = [];
  for (const line of lines.slice(start + 1)) {
    const h = line.trim().match(/^(#{1,4})\s/);
    if (h && h[1].length <= level) break;
    out.push(line);
  }
  return out.join('\n')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/(^|[\s(])\*([^*\n]+)\*/g, '$1$2')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '$1 ($2)')
    .replace(/^\s*(---|\*\*\*|___)\s*$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export const withSummary = (bullets, body) => `## Summary\n\n${bullets}\n\n${String(body ?? '').replace(/^\s+/, '')}`;

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
