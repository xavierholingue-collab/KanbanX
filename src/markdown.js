// Rendu Markdown sûr : tout est échappé d'abord, puis seul un petit sous-ensemble est reconnu.
// Aucun HTML brut n'est jamais transmis : le résultat ne contient que des balises produites ici.

const ECHAPPE = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const echapper = (s) => String(s).replace(/[&<>"']/g, (c) => ECHAPPE[c]);

export const normaliserNom = (n) => String(n).normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
export const prenom = (nom) => normaliserNom(String(nom).trim().split(/\s+/)[0] ?? '');

const RE_MENTION = /(^|[^\p{L}\p{N}_@])@([\p{L}][\p{L}\p{N}_-]*)/gu;

/** Prénoms (normalisés) cités avec @ dans un texte. */
export function extraireMentions(texte) {
  const out = new Set();
  for (const m of String(texte).replaceAll('\u0000', '').matchAll(RE_MENTION)) out.add(normaliserNom(m[2]));
  return out;
}

function enLigne(brut, prenomsConnus) {
  const morceaux = [];
  const garder = (html) => { morceaux.push(html); return `\u0000${morceaux.length - 1}\u0000`; };
  let s = echapper(brut.replaceAll('\u0000', ''));
  s = s.replace(/`([^`\n]+)`/g, (_, c) => garder(`<code>${c}</code>`));
  s = s.replace(/\[([^\]\n]+)\]\(([^)\s]+)\)/g, (m, texte, url) => {
    if (!/^(https?:\/\/|mailto:)/i.test(url)) return m;
    return garder(`<a href="${url}" target="_blank" rel="noopener noreferrer nofollow">${texte}</a>`);
  });
  s = s.replace(RE_MENTION, (m, avant, nom) => (prenomsConnus?.has(normaliserNom(nom))
    ? `${avant}${garder(`<span class="mention">@${nom}</span>`)}` : m));
  s = s.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/(^|[^*\w])\*([^*\s][^*\n]*?)\*(?!\*)/g, '$1<em>$2</em>');
  s = s.replace(/(^|[^\w])_([^_\s][^_\n]*?)_(?![\w])/g, '$1<em>$2</em>');
  return s.replace(/\u0000(\d+)\u0000/g, (_, i) => morceaux[Number(i)]);
}

/** @param {string} texte  @param {Set<string>} [prenomsConnus] prénoms normalisés des membres, pour surligner les mentions */
export function rendreMarkdown(texte, prenomsConnus) {
  const lignes = String(texte).replaceAll('\r\n', '\n').split('\n');
  const html = [];
  let i = 0;
  while (i < lignes.length) {
    const l = lignes[i];
    if (/^\s*$/.test(l)) { i++; continue; }
    if (/^```/.test(l)) {
      const code = [];
      i++;
      while (i < lignes.length && !/^```/.test(lignes[i])) code.push(lignes[i++]);
      i++;
      html.push(`<pre><code>${echapper(code.join('\n'))}</code></pre>`);
      continue;
    }
    const t = l.match(/^(#{1,3})\s+(.+)$/);
    if (t) { html.push(`<h${t[1].length + 2}>${enLigne(t[2], prenomsConnus)}</h${t[1].length + 2}>`); i++; continue; }
    if (/^>\s?/.test(l)) {
      const q = [];
      while (i < lignes.length && /^>\s?/.test(lignes[i])) q.push(lignes[i++].replace(/^>\s?/, ''));
      html.push(`<blockquote>${enLigne(q.join('\n'), prenomsConnus).replaceAll('\n', '<br>')}</blockquote>`);
      continue;
    }
    const puce = l.match(/^\s*([-*]|\d+\.)\s+/);
    if (puce) {
      const ordonnee = /\d/.test(puce[1]);
      const items = [];
      while (i < lignes.length) {
        const m = lignes[i].match(/^\s*([-*]|\d+\.)\s+(.*)$/);
        if (!m || /\d/.test(m[1]) !== ordonnee) break;
        items.push(`<li>${enLigne(m[2], prenomsConnus)}</li>`);
        i++;
      }
      html.push(ordonnee ? `<ol>${items.join('')}</ol>` : `<ul>${items.join('')}</ul>`);
      continue;
    }
    const para = [];
    while (i < lignes.length && !/^\s*$/.test(lignes[i]) && !/^(```|#{1,3}\s|>\s?|\s*([-*]|\d+\.)\s)/.test(lignes[i])) para.push(lignes[i++]);
    html.push(`<p>${enLigne(para.join('\n'), prenomsConnus).replaceAll('\n', '<br>')}</p>`);
  }
  return html.join('');
}
