-- OAuth 2.1 du serveur MCP (réponse d'InfraLWS du 23/11, § 5). Brancher Claude depuis claude.ai ou Claude Code,
-- au nom de la personne qui donne son accord, jamais au nom du compte agent.
-- Les tables sont réservées au propriétaire : le rôle applicatif n'y accède que par les fonctions ci-dessous.
-- Codes et jetons sont stockés hachés (SHA-256), comme les autres jetons.
-- Règle des migrations : uniquement des ajouts.

create table oauth_clients (
  id text primary key check (id ~ '^kxc_[A-Za-z0-9_-]{20,64}$'),
  name text not null check (length(name) between 1 and 60),
  redirect_uris text[] not null check (cardinality(redirect_uris) between 1 and 5),
  created_at timestamptz not null default now(),
  last_used_at timestamptz
);
create index on oauth_clients (created_at) where last_used_at is null;

-- Un accès est l'accord d'une personne à un client. C'est la lignée de ses jetons, et ce que montre la page
-- « Applications connectées ». Le révoquer invalide tous ses jetons.
create table oauth_acces (
  id uuid primary key default gen_random_uuid(),
  client_id text not null references oauth_clients(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  redirect_uri text not null,
  scope text not null,
  resource text not null,
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);
create index on oauth_acces (user_id) where revoked_at is null;

create table oauth_codes (
  code_hash bytea primary key,
  client_id text not null references oauth_clients(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  redirect_uri text not null,
  code_challenge text not null,
  scope text not null,
  resource text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz,
  acces_id uuid references oauth_acces(id) on delete set null
);
create index on oauth_codes (expires_at);

create table oauth_jetons (
  token_hash bytea primary key,
  type text not null check (type in ('acces', 'rafraichissement')),
  acces_id uuid not null references oauth_acces(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz
);
create index on oauth_jetons (acces_id);
create index on oauth_jetons (expires_at);

-- Qui agit pour qui : nom du client OAuth qui a agi au nom de l'auteur (« Claude pour Eric »). Vide sinon.
alter table activity add column client_name text check (length(client_name) between 1 and 60);
alter table comments add column client_name text check (length(client_name) between 1 and 60);

-- ---------- Clients (enregistrement dynamique, RFC 7591) ----------

-- Purge les clients jamais utilisés au bout de 24 heures, puis enregistre le client s'il reste de la place.
create function kx_oauth_client_creer(p_id text, p_nom text, p_retours text[]) returns boolean
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform pg_advisory_xact_lock(727002);
  delete from oauth_clients where last_used_at is null and created_at < now() - interval '24 hours';
  delete from oauth_codes where expires_at < now() - interval '1 hour';
  delete from oauth_jetons where expires_at < now();
  if (select count(*) from oauth_clients) >= 1000 then return false; end if;
  insert into oauth_clients (id, name, redirect_uris) values (p_id, p_nom, p_retours);
  return true;
end $$;

create function kx_oauth_client_lire(p_id text) returns table (name text, redirect_uris text[])
language sql stable security definer set search_path = public, pg_temp as
$$ select name, redirect_uris from oauth_clients where id = p_id $$;

-- ---------- Codes d'autorisation ----------

-- Crée un code pour l'utilisateur courant (app.user_id), après son accord explicite.
create function kx_oauth_code_creer(p_hash bytea, p_client text, p_retour text, p_defi text, p_scope text, p_ressource text, p_ttl interval)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare u uuid := kx_uid();
begin
  if u is null or not exists (select 1 from users where id = u and disabled_at is null and kind = 'human') then
    raise exception 'Utilisateur courant absent ou non autorisé' using errcode = '42501';
  end if;
  insert into oauth_codes (code_hash, client_id, user_id, redirect_uri, code_challenge, scope, resource, expires_at)
    values (p_hash, p_client, u, p_retour, p_defi, p_scope, p_ressource, now() + p_ttl);
end $$;

-- Échange un code contre un jeton d'accès et un jeton de rafraîchissement. Le code est brûlé dès la première
-- présentation, valide ou non. Rejoué, il révoque l'accès qu'il avait déjà délivré.
create function kx_oauth_code_echanger(p_hash bytea, p_client text, p_retour text, p_defi_calcule text,
  p_acces bytea, p_rafraichissement bytea, p_ttl_acces interval, p_ttl_rafraichissement interval)
returns table (statut text, user_id uuid, scope text)
language plpgsql security definer set search_path = public, pg_temp as $$
declare c oauth_codes%rowtype; a uuid;
begin
  select * into c from oauth_codes where code_hash = p_hash for update;
  if not found then return query select 'invalid_grant', null::uuid, null::text; return; end if;
  if c.used_at is not null then
    update oauth_acces set revoked_at = now() where id = c.acces_id and revoked_at is null;
    return query select 'invalid_grant', null::uuid, null::text; return;
  end if;
  update oauth_codes set used_at = now() where code_hash = p_hash;
  if c.expires_at <= now() or c.client_id <> p_client or c.redirect_uri <> p_retour or c.code_challenge <> p_defi_calcule
     or not exists (select 1 from users u where u.id = c.user_id and u.disabled_at is null) then
    return query select 'invalid_grant', null::uuid, null::text; return;
  end if;
  insert into oauth_acces (client_id, user_id, redirect_uri, scope, resource)
    values (c.client_id, c.user_id, c.redirect_uri, c.scope, c.resource) returning id into a;
  update oauth_codes set acces_id = a where code_hash = p_hash;
  update oauth_clients set last_used_at = now() where id = c.client_id;
  insert into oauth_jetons (token_hash, type, acces_id, expires_at) values
    (p_acces, 'acces', a, now() + p_ttl_acces),
    (p_rafraichissement, 'rafraichissement', a, now() + p_ttl_rafraichissement);
  return query select 'ok', c.user_id, c.scope;
end $$;

-- ---------- Jetons ----------

-- Rafraîchissement : renouvelle les deux jetons. Un jeton déjà échangé, ou présenté par un autre client,
-- révoque toute la lignée (vol présumé).
create function kx_oauth_rafraichir(p_hash bytea, p_client text, p_acces bytea, p_rafraichissement bytea,
  p_ttl_acces interval, p_ttl_rafraichissement interval)
returns table (statut text, user_id uuid, scope text)
language plpgsql security definer set search_path = public, pg_temp as $$
declare j oauth_jetons%rowtype; a oauth_acces%rowtype;
begin
  select * into j from oauth_jetons where token_hash = p_hash and type = 'rafraichissement' for update;
  if not found then return query select 'invalid_grant', null::uuid, null::text; return; end if;
  select * into a from oauth_acces where id = j.acces_id for update;
  if j.used_at is not null or a.client_id <> p_client then
    update oauth_acces set revoked_at = now() where id = a.id and revoked_at is null;
    return query select 'invalid_grant', null::uuid, null::text; return;
  end if;
  if a.revoked_at is not null or j.expires_at <= now()
     or not exists (select 1 from users u where u.id = a.user_id and u.disabled_at is null) then
    return query select 'invalid_grant', null::uuid, null::text; return;
  end if;
  update oauth_jetons set used_at = now() where token_hash = p_hash;
  update oauth_acces set last_used_at = now() where id = a.id;
  insert into oauth_jetons (token_hash, type, acces_id, expires_at) values
    (p_acces, 'acces', a.id, now() + p_ttl_acces),
    (p_rafraichissement, 'rafraichissement', a.id, now() + p_ttl_rafraichissement);
  return query select 'ok', a.user_id, a.scope;
end $$;

-- Lit un jeton d'accès présenté au serveur MCP : valide, non expiré, accès non révoqué, compte actif, et émis
-- pour cette ressource (audience).
create function kx_oauth_jeton_lire(p_hash bytea, p_ressource text)
returns table (user_id uuid, name text, kind text, client_name text)
language plpgsql security definer set search_path = public, pg_temp as $$
declare a uuid;
begin
  select ac.id into a from oauth_jetons j join oauth_acces ac on ac.id = j.acces_id
    where j.token_hash = p_hash and j.type = 'acces' and j.expires_at > now()
      and ac.revoked_at is null and ac.resource = p_ressource;
  if a is null then return; end if;
  update oauth_acces set last_used_at = now()
    where id = a and (last_used_at is null or last_used_at < now() - interval '1 minute');
  return query select u.id, u.name, u.kind, c.name
    from oauth_acces ac join users u on u.id = ac.user_id join oauth_clients c on c.id = ac.client_id
    where ac.id = a and u.disabled_at is null;
end $$;

-- ---------- Applications connectées (utilisateur courant) ----------

create function kx_oauth_acces_lister()
returns table (id uuid, client_name text, redirect_uri text, created_at timestamptz, last_used_at timestamptz)
language sql stable security definer set search_path = public, pg_temp as $$
  select a.id, c.name, a.redirect_uri, a.created_at, a.last_used_at
  from oauth_acces a join oauth_clients c on c.id = a.client_id
  where a.user_id = kx_uid() and a.revoked_at is null
  order by a.created_at desc
$$;

create function kx_oauth_acces_revoquer(p_id uuid) returns boolean
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update oauth_acces set revoked_at = now() where id = p_id and user_id = kx_uid() and revoked_at is null;
  return found;
end $$;

revoke all on function kx_oauth_client_creer, kx_oauth_client_lire, kx_oauth_code_creer, kx_oauth_code_echanger,
  kx_oauth_rafraichir, kx_oauth_jeton_lire, kx_oauth_acces_lister, kx_oauth_acces_revoquer from public;
grant execute on function kx_oauth_client_creer, kx_oauth_client_lire, kx_oauth_code_creer, kx_oauth_code_echanger,
  kx_oauth_rafraichir, kx_oauth_jeton_lire, kx_oauth_acces_lister, kx_oauth_acces_revoquer to kanbanx_app;
