// Documentation lisible, générée à partir du document OpenAPI.
import { h } from './dom.js';

const doc = await (await fetch('/api/openapi.json')).json();
const parTag = {};
for (const [chemin, ops] of Object.entries(doc.paths)) {
  for (const [m, op] of Object.entries(ops)) (parTag[op.tags[0]] ??= []).push({ m: m.toUpperCase(), chemin, op });
}
document.getElementById('routes').replaceChildren(...Object.entries(parTag).map(([tag, ops]) => h('section.detail-section',
  h('h2', tag),
  h('ul.doc-routes', ops.map(({ m, chemin, op }) => h('li',
    h('p', h('code.methode', m), ' ', h('code', chemin), op.security?.length === 0 ? ' (public)' : ''),
    h('p.aide', op.summary),
    op.requestBody ? h('pre', JSON.stringify(op.requestBody.content['application/json'].schema.properties, null, 2)) : ''))))));
