-- « Continuer avec Google » (OpenID Connect). Demande de Xavier du 25/11.
-- Réservé aux comptes déjà invités : Google ouvre un compte KanbanX existant, il n'en crée jamais. Une fois
-- connectée, la personne a exactement les mêmes droits qu'avec le lien par courriel (politiques RLS).
-- Le compte Google est reconnu par son identifiant (sub), jamais par son adresse, qui peut changer.
-- Tables réservées au propriétaire : le rôle applicatif n'y accède que par les fonctions ci-dessous.
-- Règle des migrations : uniquement des ajouts.

create table identites_google (
  sujet text primary key check (length(sujet) between 1 and 255),
  user_id uuid not null unique references users(id) on delete cascade,
  email text not null check (email = lower(email) and length(email) between 3 and 254), -- affichage seulement
  created_at timestamptz not null default now(),
  last_used_at timestamptz
);

-- Une demande en cours chez Google : state (haché), nonce et vérificateur PKCE. Sert une fois, 10 minutes au plus.
-- user_id n'est rempli que pour une liaison commencée depuis « Mon compte ».
create table google_demandes (
  etat_hash bytea primary key,
  nonce text not null check (length(nonce) between 43 and 128),
  verificateur text not null check (length(verificateur) between 43 and 128),
  user_id uuid references users(id) on delete cascade,
  expires_at timestamptz not null
);
create index on google_demandes (expires_at);
-- Aucune politique : même si un droit était accordé par erreur au rôle applicatif, il ne verrait aucune ligne.
alter table identites_google enable row level security;
alter table google_demandes enable row level security;

-- Ouvre une demande. Liaison : pour l'utilisateur courant (app.user_id) seulement, humain et actif.
-- Purge les demandes expirées ; au-delà de 10 000 demandes en cours, refuse (protection contre l'inondation).
create function kx_google_demande_creer(p_etat bytea, p_nonce text, p_verificateur text, p_liaison boolean, p_ttl interval)
returns boolean language plpgsql security definer set search_path = public, pg_temp as $$
declare u uuid := null;
begin
  if p_liaison then
    u := kx_uid();
    if u is null or not exists (select 1 from users where id = u and disabled_at is null and kind = 'human') then
      raise exception 'Utilisateur courant absent ou non autorisé' using errcode = '42501';
    end if;
  end if;
  delete from google_demandes where expires_at <= now();
  if (select count(*) from google_demandes) >= 10000 then return false; end if;
  insert into google_demandes (etat_hash, nonce, verificateur, user_id, expires_at)
    values (p_etat, p_nonce, p_verificateur, u, now() + p_ttl);
  return true;
end $$;

-- Consomme une demande : elle disparaît dès sa première présentation, valable ou non.
create function kx_google_demande_consommer(p_etat bytea)
returns table (nonce text, verificateur text, user_id uuid, liaison boolean)
language plpgsql security definer set search_path = public, pg_temp as $$
declare d google_demandes%rowtype;
begin
  delete from google_demandes g where g.etat_hash = p_etat returning g.* into d;
  if not found or d.expires_at <= now() then return; end if;
  return query select d.nonce, d.verificateur, d.user_id, d.user_id is not null;
end $$;

-- Connexion : par l'identifiant Google déjà lié ; sinon, seulement si Google fait autorité sur l'adresse (Gmail ou
-- Workspace), par l'adresse d'un compte invité, qui est alors lié. Ouvre la session. Statuts :
-- ok, inconnu (aucun compte invité actif), non_autoritaire, autre_compte (déjà lié à un autre compte Google).
create function kx_google_connexion(p_sujet text, p_email text, p_autorite boolean, p_session bytea, p_csrf text, p_ttl interval)
returns text language plpgsql security definer set search_path = public, pg_temp as $$
declare u uuid;
begin
  select i.user_id into u from identites_google i where i.sujet = p_sujet;
  if u is not null then
    if not exists (select 1 from users where id = u and disabled_at is null and kind = 'human') then return 'inconnu'; end if;
    update identites_google set email = lower(p_email), last_used_at = now() where sujet = p_sujet;
  else
    -- Avant toute recherche : on ne révèle pas si une adresse non garantie par Google a un compte.
    if not p_autorite then return 'non_autoritaire'; end if;
    select id into u from users where email = lower(p_email) and disabled_at is null and kind = 'human';
    if u is null then return 'inconnu'; end if;
    if exists (select 1 from identites_google where user_id = u) then return 'autre_compte'; end if;
    insert into identites_google (sujet, user_id, email, last_used_at) values (p_sujet, u, lower(p_email), now());
  end if;
  insert into sessions (user_id, token_hash, csrf_token, expires_at) values (u, p_session, p_csrf, now() + p_ttl);
  return 'ok';
end $$;

-- Liaison du compte courant (session web) au compte Google qui vient de s'authentifier, quelle que soit l'adresse.
-- Statuts : lie, deja_lie (ce compte Google l'est à quelqu'un d'autre), autre_compte (un autre compte Google l'est déjà).
create function kx_google_lier(p_sujet text, p_email text) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare u uuid := kx_uid(); autre uuid;
begin
  if u is null or not exists (select 1 from users where id = u and disabled_at is null and kind = 'human') then
    raise exception 'Utilisateur courant absent ou non autorisé' using errcode = '42501';
  end if;
  select user_id into autre from identites_google where sujet = p_sujet;
  if autre = u then
    update identites_google set email = lower(p_email), last_used_at = now() where sujet = p_sujet;
    return 'lie';
  end if;
  if autre is not null then return 'deja_lie'; end if;
  if exists (select 1 from identites_google where user_id = u) then return 'autre_compte'; end if;
  insert into identites_google (sujet, user_id, email) values (p_sujet, u, lower(p_email));
  return 'lie';
end $$;

-- Compte Google lié à l'utilisateur courant (adresse, pour l'affichage), ou rien.
create function kx_google_lire() returns text language sql stable security definer set search_path = public, pg_temp as
$$ select email from identites_google where user_id = kx_uid() $$;

-- Délie le compte Google de l'utilisateur courant. La connexion par courriel reste toujours possible.
create function kx_google_delier() returns boolean language sql security definer set search_path = public, pg_temp as
$$ with d as (delete from identites_google where user_id = kx_uid() returning 1) select exists (select 1 from d) $$;

revoke all on function kx_google_demande_creer, kx_google_demande_consommer, kx_google_connexion, kx_google_lier,
  kx_google_lire, kx_google_delier from public;
grant execute on function kx_google_demande_creer, kx_google_demande_consommer, kx_google_connexion, kx_google_lier,
  kx_google_lire, kx_google_delier to kanbanx_app;
