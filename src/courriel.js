// Envoi du lien magique. En développement : affiché dans la console. Sinon : SMTP minimal (SMTP_URL).
import net from 'node:net';
import tls from 'node:tls';
import { config } from './config.js';

export const boiteDev = []; // utile aux tests : derniers messages « envoyés »

export async function envoyerLien(email, lien) {
  const message = { a: email, sujet: 'Votre lien de connexion KanbanX', texte: `Bonjour,\n\nPour vous connecter à KanbanX, ouvrez ce lien (valable 15 minutes, usage unique) :\n\n${lien}\n\nSi vous n'êtes pas à l'origine de cette demande, ignorez ce message.\n` };
  boiteDev.push({ ...message, lien });
  if (boiteDev.length > 50) boiteDev.shift();
  if (!config.smtpUrl) {
    if (config.env !== 'test') console.log(`\n  ✉  Lien de connexion pour ${email} :\n     ${lien}\n`);
    return;
  }
  await smtp(message);
}

// TLS obligatoire : smtps:// (TLS dès la connexion) ou smtp:// avec STARTTLS exigé. Sans TLS, les identifiants
// SMTP et le lien de connexion circuleraient en clair : on refuse d'envoyer. Seule exception, hors production
// et explicite : ?tls=non, pour un faux serveur local de test.
function smtp({ a, sujet, texte }) {
  const u = new URL(config.smtpUrl);
  const implicite = u.protocol === 'smtps:';
  const sansTls = u.searchParams.get('tls') === 'non';
  if (sansTls && config.env === 'production') throw new Error('SMTP : TLS obligatoire en production (?tls=non refusé).');
  const port = Number(u.port || (implicite ? 465 : 587));
  const de = (config.smtpFrom.match(/<([^>]+)>/) || [, config.smtpFrom])[1];
  if (/[\r\n]/.test(a + sujet)) throw new Error('En-tête invalide');
  return new Promise((resolve, reject) => {
    let sock = implicite ? tls.connect({ host: u.hostname, port, servername: u.hostname }) : net.connect({ host: u.hostname, port });
    let tampon = '';
    let attente = null;
    const timer = setTimeout(() => { sock.destroy(); reject(new Error('SMTP : délai dépassé')); }, 15000);
    const lire = () => new Promise((res) => { attente = res; verifier(); });
    const verifier = () => {
      const m = tampon.match(/^(?:\d{3}-.*\r\n)*(\d{3}) .*\r\n/);
      if (m && attente) { const code = Number(m[1]); const t = tampon; tampon = ''; const a2 = attente; attente = null; a2({ code, t }); }
    };
    const brancher = (s) => {
      s.on('data', (d) => { tampon += d; verifier(); });
      s.on('error', (e) => { clearTimeout(timer); reject(e); });
      s.on('close', () => { clearTimeout(timer); reject(new Error('SMTP : connexion fermée')); }); // sans effet après succès
    };
    brancher(sock);
    const cmd = async (l, ok) => { sock.write(`${l}\r\n`); const r = await lire(); if (!ok.includes(r.code)) throw new Error(`SMTP ${r.code}`); return r; };
    (async () => {
      let r = await lire(); if (r.code !== 220) throw new Error(`SMTP ${r.code}`);
      r = await cmd('EHLO kanbanx', [250]);
      if (!implicite) {
        if (/STARTTLS/i.test(r.t)) {
          await cmd('STARTTLS', [220]);
          sock.removeAllListeners('data'); sock.removeAllListeners('close');
          sock = tls.connect({ socket: sock, host: u.hostname, servername: u.hostname }); brancher(sock);
          await new Promise((res) => sock.once('secureConnect', res));
          await cmd('EHLO kanbanx', [250]);
        } else if (!sansTls) {
          throw new Error('SMTP : le serveur ne propose pas STARTTLS ; envoi refusé (TLS obligatoire).');
        }
      }
      if (u.username) {
        const id = Buffer.from(`\0${decodeURIComponent(u.username)}\0${decodeURIComponent(u.password)}`).toString('base64');
        await cmd(`AUTH PLAIN ${id}`, [235]);
      }
      await cmd(`MAIL FROM:<${de}>`, [250]);
      await cmd(`RCPT TO:<${a}>`, [250, 251]);
      await cmd('DATA', [354]);
      const corps = texte.replace(/\r?\n/g, '\r\n').replace(/^\./gm, '..');
      await cmd(`From: ${config.smtpFrom}\r\nTo: ${a}\r\nSubject: ${sujet}\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n${corps}\r\n.`, [250]);
      await cmd('QUIT', [221]);
    })().then(() => { clearTimeout(timer); sock.end(); resolve(); }, (e) => { clearTimeout(timer); sock.destroy(); reject(e); });
  });
}
