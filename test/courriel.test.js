// Envoi du lien magique par SMTP, contre un faux serveur SMTP local.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { config } from '../src/config.js';
import { envoyerLien } from '../src/courriel.js';

function fauxSmtp() {
  const recu = { commandes: [], data: '' };
  const s = net.createServer((sock) => {
    let tampon = ''; let enData = false;
    sock.write('220 faux ESMTP\r\n');
    sock.on('data', (d) => {
      tampon += d;
      let i;
      while ((i = tampon.indexOf('\r\n')) >= 0) {
        const ligne = tampon.slice(0, i); tampon = tampon.slice(i + 2);
        if (enData) {
          if (ligne === '.') { enData = false; sock.write('250 OK\r\n'); } else recu.data += `${ligne}\n`;
          continue;
        }
        recu.commandes.push(ligne);
        if (/^EHLO/.test(ligne)) sock.write('250-faux\r\n250 AUTH PLAIN\r\n');
        else if (/^AUTH/.test(ligne)) sock.write('235 OK\r\n');
        else if (/^DATA/.test(ligne)) { enData = true; sock.write('354 go\r\n'); }
        else if (/^QUIT/.test(ligne)) { sock.write('221 bye\r\n'); sock.end(); }
        else sock.write('250 OK\r\n');
      }
    });
  });
  return new Promise((r) => s.listen(0, '127.0.0.1', () => r({ s, recu, port: s.address().port })));
}

test('le lien magique part par SMTP quand SMTP_URL est défini', async () => {
  const { s, recu, port } = await fauxSmtp();
  const avant = config.smtpUrl;
  // Faux serveur sans TLS : autorisé uniquement hors production, et explicitement (?tls=non).
  config.smtpUrl = `smtp://utilisateur:secret-de-test@127.0.0.1:${port}?tls=non`;
  try {
    await envoyerLien('xavier@exemple.invalid', 'http://localhost:3000/connexion/verifier?token=abc');
  } finally { config.smtpUrl = avant; s.close(); }
  assert.ok(recu.commandes.includes('RCPT TO:<xavier@exemple.invalid>'));
  assert.ok(recu.commandes.some((c) => c.startsWith('AUTH PLAIN ')));
  assert.match(recu.data, /Subject: Votre lien de connexion KanbanX/);
  assert.match(recu.data, /token=abc/);
});

test('sans TLS, rien ne part : ni identifiants, ni destinataire, ni lien', async () => {
  const { s, recu, port } = await fauxSmtp();
  const avant = config.smtpUrl;
  config.smtpUrl = `smtp://utilisateur:secret-de-test@127.0.0.1:${port}`;
  try {
    await assert.rejects(envoyerLien('xavier@exemple.invalid', 'http://localhost:3000/connexion/verifier?token=abc'), /TLS/);
  } finally { config.smtpUrl = avant; s.close(); }
  assert.ok(!recu.commandes.some((c) => /^(AUTH|MAIL|RCPT|DATA)/.test(c)), JSON.stringify(recu.commandes));
  assert.equal(recu.data, '');
});

test('en production, un SMTP sans TLS est refusé même avec ?tls=non', async () => {
  const { s, recu, port } = await fauxSmtp();
  const [avantUrl, avantEnv] = [config.smtpUrl, config.env];
  config.smtpUrl = `smtp://utilisateur:secret-de-test@127.0.0.1:${port}?tls=non`;
  config.env = 'production';
  try {
    await assert.rejects(envoyerLien('xavier@exemple.invalid', 'x'), /TLS/);
  } finally { config.smtpUrl = avantUrl; config.env = avantEnv; s.close(); }
  assert.ok(!recu.commandes.some((c) => /^(AUTH|MAIL|RCPT|DATA)/.test(c)));
});

test('aucune injection d\'en-tête par l\'adresse du destinataire', async () => {
  const avant = config.smtpUrl;
  config.smtpUrl = 'smtp://127.0.0.1:1';
  try {
    await assert.rejects(envoyerLien('a@b.fr\r\nBcc: victime@exemple.invalid', 'x'), /En-tête invalide/);
  } finally { config.smtpUrl = avant; }
});

test('le message est conforme (RFC 5322) : Date, Message-ID, MIME, encodage, EHLO avec l\'hôte public', async () => {
  const { s, recu, port } = await fauxSmtp();
  const [avantUrl, avantDe] = [config.smtpUrl, config.smtpFrom];
  config.smtpUrl = `smtp://127.0.0.1:${port}?tls=non`;
  config.smtpFrom = 'KanbanX <kanbanx@exemple.invalid>';
  try {
    await envoyerLien('xavier@exemple.invalid', 'http://localhost:3000/connexion/verifier?token=abc');
  } finally { config.smtpUrl = avantUrl; config.smtpFrom = avantDe; s.close(); }
  assert.equal(recu.commandes[0], `EHLO ${new URL(config.baseUrl).hostname}`);
  assert.match(recu.data, /^Date: (Mon|Tue|Wed|Thu|Fri|Sat|Sun), \d{2} [A-Z][a-z]{2} \d{4} \d{2}:\d{2}:\d{2} \+0000$/m);
  assert.match(recu.data, /^Message-ID: <[A-Za-z0-9.-]+@exemple\.invalid>$/m);
  assert.match(recu.data, /^MIME-Version: 1\.0$/m);
  assert.match(recu.data, /^Content-Type: text\/plain; charset=utf-8$/m);
  assert.match(recu.data, /^Content-Transfer-Encoding: 8bit$/m);
  assert.match(recu.data, /^From: KanbanX <kanbanx@exemple\.invalid>$/m);
});

test('un sujet accentué est encodé selon la RFC 2047, un sujet ASCII reste tel quel', async () => {
  const { encoderSujet } = await import('../src/courriel.js');
  assert.equal(encoderSujet('Votre lien de connexion KanbanX'), 'Votre lien de connexion KanbanX');
  assert.equal(encoderSujet('Connexion à KanbanX'), `=?UTF-8?B?${Buffer.from('Connexion à KanbanX').toString('base64')}?=`);
});
