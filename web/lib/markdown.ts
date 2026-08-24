// Markdown-lite: alcanza para nuestras propias notas (headers, bold, code,
// listas, links, code fences) — no es un parser completo a propósito. Mismo
// que la versión vanilla anterior, portado a TS.
function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

export function renderMarkdown(md: string): string {
  let html = escapeHtml(md);
  html = html.replace(/```([\s\S]*?)```/g, (_, code) => `<pre><code>${code.trim()}</code></pre>`);
  html = html.replace(/^### (.*)$/gm, "<h3>$1</h3>");
  html = html.replace(/^## (.*)$/gm, "<h2>$1</h2>");
  html = html.replace(/^# (.*)$/gm, "<h1>$1</h1>");
  html = html.replace(/`([^`]+)`/g, "<code>$1</code>");
  html = html.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  html = html
    .split(/\n{2,}/)
    .map((block) => {
      if (/^<h[1-3]>|^<pre>/.test(block.trim())) return block;
      const lines = block.split("\n").filter(Boolean);
      if (lines.length > 0 && lines.every((l) => /^[-*]\s+/.test(l))) {
        return "<ul>" + lines.map((l) => `<li>${l.replace(/^[-*]\s+/, "")}</li>`).join("") + "</ul>";
      }
      return `<p>${block.trim().replace(/\n/g, "<br>")}</p>`;
    })
    .join("\n");
  return html;
}
