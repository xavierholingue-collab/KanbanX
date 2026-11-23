import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rendreMarkdown, extraireMentions } from '../src/markdown.js';

const CHARGES = [
  '<script>alert(1)</script>',
  '<img src=x onerror=alert(1)>',
  '"><svg onload=alert(1)>',
  '[clic](javascript:alert(1))',
  '[clic](JaVaScRiPt:alert(1))',
  '[clic](data:text/html,<script>alert(1)</script>)',
  '[x](https://a.fr/" onmouseover="alert(1))',
  '[x](https://a.fr/*gras*)',
  '`<script>`',
  '```\n<script>alert(1)</script>\n```',
  '**<b onclick=alert(1)>x</b>**',
  '@<script>',
  '\u0000<script>alert(1)</script>',
  '> <iframe src=javascript:alert(1)>',
  '- <a href="javascript:alert(1)">x</a>',
];

const BALISES = new Set(['p', 'strong', 'em', 'code', 'pre', 'ul', 'ol', 'li', 'a', 'span', 'blockquote', 'h3', 'h4', 'h5', 'br']);
/** Toute balise doit être dans la liste blanche, avec des attributs exactement prévus ; aucun guillemet ou < brut dans les valeurs. */
function verifierStructure(h, contexte) {
  for (const m of h.matchAll(/<(\/?)([a-z0-9]+)([^>]*)>/gi)) {
    const [, fermante, nom, attrs] = m;
    assert.ok(BALISES.has(nom), `balise non autorisée <${nom}> pour : ${contexte} → ${h}`);
    if (fermante) assert.equal(attrs, "", contexte);
    else if (nom === 'a') assert.match(attrs, /^ href="(https?:\/\/|mailto:)[^"<>]*" target="_blank" rel="noopener noreferrer nofollow"$/i, `${contexte} → ${h}`);
    else if (nom === 'span') assert.match(attrs, /^ class="mention"$/, contexte);
    else assert.equal(attrs, '', `${contexte} → ${h}`);
  }
  assert.doesNotMatch(h, /\u0000/);
}

test('aucun HTML brut ni script ne traverse le rendu Markdown (XSS)', () => {
  for (const c of CHARGES) {
    const h = rendreMarkdown(c, new Set(['xavier']));
    verifierStructure(h, c);
  }
});

test('les liens http(s) sont conservés, avec rel sécurisé', () => {
  const h = rendreMarkdown('[Doc](https://exemple.fr/a?b=1&c=2)');
  assert.match(h, /<a href="https:\/\/exemple\.fr\/a\?b=1&amp;c=2" target="_blank" rel="noopener noreferrer nofollow">Doc<\/a>/);
});

test('un guillemet dans une URL ne sort pas de l\'attribut', () => {
  const h = rendreMarkdown('[x](https://a.fr/" onmouseover="alert(1))');
  verifierStructure(h, 'guillemet');
  verifierStructure(rendreMarkdown('[x](https://a.fr/"onmouseover="alert(1))'), 'guillemet collé');
});

test('mise en forme usuelle', () => {
  assert.equal(rendreMarkdown('**gras** et *italique* et `code`'), '<p><strong>gras</strong> et <em>italique</em> et <code>code</code></p>');
  assert.equal(rendreMarkdown('- a\n- b'), '<ul><li>a</li><li>b</li></ul>');
  assert.equal(rendreMarkdown('1. a\n2. b'), '<ol><li>a</li><li>b</li></ol>');
  assert.equal(rendreMarkdown('# Titre'), '<h3>Titre</h3>');
});

test('mentions : seuls les prénoms connus sont surlignés ; extraction insensible aux accents et à la casse', () => {
  assert.match(rendreMarkdown('Salut @Xavier et @inconnu', new Set(['xavier'])), /<span class="mention">@Xavier<\/span> et @inconnu/);
  assert.deepEqual([...extraireMentions('merci @Éric, @ALEXIS !')], ['eric', 'alexis']);
  assert.deepEqual([...extraireMentions('mail a@b.fr')], []);
});
