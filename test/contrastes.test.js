// Contrastes WCAG 2.2 AA calculés directement à partir du fichier de jetons, en clair et en sombre.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../public/css/jetons.css', import.meta.url), 'utf8');
function jetons(bloc) {
  const out = {};
  for (const m of bloc.matchAll(/--(c-[\w-]+):\s*(#[0-9a-f]{6})/gi)) out[m[1]] = m[2];
  return out;
}
const clair = jetons(css.split('@media (prefers-color-scheme: dark)')[0]);
const sombre = { ...clair, ...jetons(css.split('@media (prefers-color-scheme: dark)')[1]) };

const lum = (hex) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

// [premier plan, arrière-plan, seuil]
const PAIRES = [
  ['c-texte', 'c-fond', 4.5], ['c-texte', 'c-surface', 4.5], ['c-texte', 'c-colonne', 4.5],
  ['c-texte-doux', 'c-surface', 4.5], ['c-texte-doux', 'c-colonne', 4.5], ['c-texte-doux', 'c-fond', 4.5],
  ['c-sur-primaire', 'c-primaire', 4.5], ['c-sur-primaire', 'c-primaire-survol', 4.5], ['c-primaire', 'c-surface', 4.5],
  ['c-texte', 'c-primaire-pale', 4.5], ['c-sur-entete', 'c-entete', 4.5],
  ['c-sur-accent-pale', 'c-accent-pale', 4.5], ['c-sur-danger-pale', 'c-danger-pale', 4.5], ['c-danger', 'c-surface', 4.5], ['c-danger', 'c-colonne', 4.5],
  ['c-focus', 'c-surface', 3], ['c-focus', 'c-fond', 3], ['c-focus', 'c-colonne', 3], ['c-focus-sur-fonce', 'c-entete', 3],
  ['c-bordure-forte', 'c-surface', 3], ['c-primaire', 'c-fantome', 3],
  ...['bleu', 'turquoise', 'vert', 'orange', 'rouge', 'violet', 'ardoise', 'brun'].map((c) => ['c-sur-etiq', `c-etiq-${c}`, 4.5]),
  ['c-surface', 'c-texte', 4.5], // notifications (texte inversé)
];

for (const [nom, j] of [['clair', clair], ['sombre', sombre]]) {
  test(`contrastes AA en mode ${nom}`, () => {
    const echecs = PAIRES.filter(([a, b, s]) => ratio(j[a], j[b]) < s).map(([a, b, s]) => `${a} sur ${b} : ${ratio(j[a], j[b]).toFixed(2)} < ${s}`);
    assert.deepEqual(echecs, []);
  });
}

test('identité : dominante bleue, accent orange, ni jaune ni magenta en couleur principale', () => {
  const teinte = (hex) => {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
    const max = Math.max(r, g, b); const min = Math.min(r, g, b); const d = max - min;
    if (!d) return null;
    let hh = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    return (hh * 60 + 360) % 360;
  };
  for (const j of [clair, sombre]) {
    const hp = teinte(j['c-primaire']); assert.ok(hp > 195 && hp < 230, `primaire bleue (${hp})`);
    const ha = teinte(j['c-accent']); assert.ok(ha > 15 && ha < 35, `accent orange (${ha})`);
    for (const k of ['c-primaire', 'c-entete', 'c-accent', 'c-fond']) {
      const h = teinte(j[k]);
      assert.ok(h === null || !((h > 45 && h < 70) || (h > 285 && h < 335)), `${k} ni jaune ni magenta`);
    }
  }
});

test('un seul fichier de jetons : app.css ne contient aucune couleur en dur', () => {
  const app = readFileSync(new URL('../public/css/app.css', import.meta.url), 'utf8');
  assert.deepEqual(app.match(/#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/gi) ?? [], []);
});
