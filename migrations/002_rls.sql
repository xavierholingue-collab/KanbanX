-- Isolement et droits par rôle appliqués par la base (RLS).
-- L'utilisateur courant est transmis par le serveur : select set_config('app.user_id', '<uuid>', true).

create function kx_uid() returns uuid language sql stable as
$$ select nullif(current_setting('app.user_id', true), '')::uuid $$;

-- Les fonctions SECURITY DEFINER s'exécutent avec les droits du propriétaire (migrations), hors RLS.
create function kx_role(b uuid) returns text language sql stable security definer set search_path = public, pg_temp as
$$ select role from board_members where board_id = b and user_id = kx_uid() $$;

create function kx_can_read(b uuid) returns boolean language sql stable security definer set search_path = public, pg_temp as
$$ select exists (select 1 from board_members where board_id = b and user_id = kx_uid()) $$;

create function kx_can_write(b uuid) returns boolean language sql stable security definer set search_path = public, pg_temp as
$$ select exists (select 1 from board_members where board_id = b and user_id = kx_uid() and role in ('owner', 'member')) $$;

create function kx_is_owner(b uuid) returns boolean language sql stable security definer set search_path = public, pg_temp as
$$ select exists (select 1 from board_members where board_id = b and user_id = kx_uid() and role = 'owner') $$;

create function kx_shares_board(u uuid) returns boolean language sql stable security definer set search_path = public, pg_temp as
$$ select u = kx_uid() or exists (
     select 1 from board_members a join board_members b on a.board_id = b.board_id
     where a.user_id = kx_uid() and b.user_id = u) $$;

alter table users enable row level security;
alter table boards enable row level security;
alter table board_members enable row level security;
alter table columns enable row level security;
alter table cards enable row level security;
alter table labels enable row level security;
alter table card_labels enable row level security;
alter table card_assignees enable row level security;
alter table comments enable row level security;
alter table activity enable row level security;
alter table sessions enable row level security;
alter table magic_links enable row level security;
alter table api_tokens enable row level security;
-- sessions, magic_links, api_tokens : RLS active, aucune politique, aucun droit → inaccessibles au rôle applicatif.

create policy users_lecture on users for select using (kx_shares_board(id));

create policy boards_lecture on boards for select using (kx_can_read(id));
create policy boards_maj on boards for update using (kx_is_owner(id)) with check (kx_is_owner(id));
-- Création uniquement par kx_creer_tableau().

create policy membres_lecture on board_members for select using (kx_can_read(board_id));
create policy membres_maj on board_members for update using (kx_is_owner(board_id)) with check (kx_is_owner(board_id));
create policy membres_sup on board_members for delete using (kx_is_owner(board_id) or user_id = kx_uid());

-- Tables dépendant d'un tableau : lecture pour tous les membres (lecteur compris), écriture pour propriétaire et membre.
create policy colonnes_lecture on columns for select using (kx_can_read(board_id));
create policy colonnes_ecriture on columns for all using (kx_can_write(board_id)) with check (kx_can_write(board_id));

create policy cartes_lecture on cards for select using (kx_can_read(board_id));
create policy cartes_ecriture on cards for all using (kx_can_write(board_id)) with check (kx_can_write(board_id));

create policy etiquettes_lecture on labels for select using (kx_can_read(board_id));
create policy etiquettes_ecriture on labels for all using (kx_can_write(board_id)) with check (kx_can_write(board_id));

create policy carte_etiq_lecture on card_labels for select using (kx_can_read(board_id));
create policy carte_etiq_ecriture on card_labels for all using (kx_can_write(board_id)) with check (kx_can_write(board_id));

create policy resp_lecture on card_assignees for select using (kx_can_read(board_id));
create policy resp_ecriture on card_assignees for all using (kx_can_write(board_id)) with check (kx_can_write(board_id));

create policy comm_lecture on comments for select using (kx_can_read(board_id));
create policy comm_ajout on comments for insert with check (kx_can_write(board_id) and author_id = kx_uid());
create policy comm_maj on comments for update using (kx_can_write(board_id) and author_id = kx_uid())
  with check (kx_can_write(board_id) and author_id = kx_uid());
create policy comm_sup on comments for delete using (kx_can_write(board_id) and author_id = kx_uid());

create policy activite_lecture on activity for select using (kx_can_read(board_id));
create policy activite_ajout on activity for insert with check (kx_can_write(board_id) and actor_id = kx_uid());

-- Opérations qui doivent dépasser les politiques, avec leurs propres contrôles.

create function kx_creer_tableau(p_nom text) returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare b uuid;
begin
  if kx_uid() is null then raise exception 'Non authentifié' using errcode = '28000'; end if;
  insert into boards (name, created_by) values (p_nom, kx_uid()) returning id into b;
  insert into board_members (board_id, user_id, role) values (b, kx_uid(), 'owner');
  return b;
end $$;

-- Invitation : seul un propriétaire du tableau peut inviter. Crée le compte nominatif s'il n'existe pas.
create function kx_inviter(p_board uuid, p_email text, p_nom text, p_role text) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare u uuid;
begin
  if not kx_is_owner(p_board) then raise exception 'Réservé au propriétaire' using errcode = '42501'; end if;
  if p_role not in ('owner', 'member', 'reader') then raise exception 'Rôle invalide' using errcode = '22023'; end if;
  select id into u from users where email = lower(p_email);
  if u is null then
    insert into users (email, name) values (lower(p_email), p_nom) returning id into u;
  end if;
  insert into board_members (board_id, user_id, role) values (p_board, u, p_role)
    on conflict (board_id, user_id) do update set role = excluded.role;
  return u;
end $$;

-- Authentification : lien magique, sessions, jetons d'API. Seules ces fonctions touchent aux tables sensibles.
create function kx_lien_demander(p_email text, p_hash bytea, p_ttl interval) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare u uuid;
begin
  select id into u from users where email = lower(p_email) and disabled_at is null and kind = 'human';
  if u is null then return null; end if;
  insert into magic_links (user_id, token_hash, expires_at) values (u, p_hash, now() + p_ttl);
  return u;
end $$;

create function kx_lien_consommer(p_hash bytea, p_session_hash bytea, p_csrf text, p_ttl interval) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare u uuid;
begin
  update magic_links set used_at = now()
    where token_hash = p_hash and used_at is null and expires_at > now()
    returning user_id into u;
  if u is null then return null; end if;
  insert into sessions (user_id, token_hash, csrf_token, expires_at) values (u, p_session_hash, p_csrf, now() + p_ttl);
  return u;
end $$;

create function kx_session_lire(p_hash bytea) returns table (user_id uuid, csrf_token text, name text, kind text)
language sql security definer set search_path = public, pg_temp as $$
  with s as (
    update sessions set last_seen_at = now()
      where token_hash = p_hash and expires_at > now()
      returning user_id, csrf_token)
  select s.user_id, s.csrf_token, u.name, u.kind from s join users u on u.id = s.user_id where u.disabled_at is null
$$;

create function kx_session_fermer(p_hash bytea) returns void language sql security definer set search_path = public, pg_temp as
$$ delete from sessions where token_hash = p_hash $$;

create function kx_jeton_lire(p_hash bytea) returns table (user_id uuid, name text, kind text)
language sql security definer set search_path = public, pg_temp as $$
  with t as (
    update api_tokens set last_used_at = now()
      where token_hash = p_hash and revoked_at is null
      returning user_id)
  select t.user_id, u.name, u.kind from t join users u on u.id = t.user_id where u.disabled_at is null
$$;

revoke all on function kx_lien_demander, kx_lien_consommer, kx_session_lire, kx_session_fermer, kx_jeton_lire,
  kx_creer_tableau, kx_inviter from public;
grant execute on function kx_uid, kx_role, kx_can_read, kx_can_write, kx_is_owner, kx_shares_board,
  kx_lien_demander, kx_lien_consommer, kx_session_lire, kx_session_fermer, kx_jeton_lire,
  kx_creer_tableau, kx_inviter to kanbanx_app;
