// Diffusion en direct (Server-Sent Events) aux membres connectés d'un tableau. En mémoire : un seul processus.
const abonnes = new Map(); // boardId -> Set<{res, userId}>

export function abonner(boardId, res, userId) {
  if (!abonnes.has(boardId)) abonnes.set(boardId, new Set());
  const a = { res, userId };
  abonnes.get(boardId).add(a);
  return () => { abonnes.get(boardId)?.delete(a); if (!abonnes.get(boardId)?.size) abonnes.delete(boardId); };
}

export function publier(boardId, evenement) {
  const subs = abonnes.get(boardId);
  if (!subs) return;
  const data = `event: maj\ndata: ${JSON.stringify(evenement)}\n\n`;
  for (const { res } of subs) res.write(data);
}

export function nbAbonnes(boardId) { return abonnes.get(boardId)?.size ?? 0; }
// Un abonné dont le droit d'accès a changé est déconnecté.
export function expulser(boardId, userId) {
  for (const a of [...(abonnes.get(boardId) ?? [])]) if (a.userId === userId) a.res.end();
}
