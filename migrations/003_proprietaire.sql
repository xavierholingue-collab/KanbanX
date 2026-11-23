-- Un tableau garde toujours au moins un propriétaire, et l'invitation ne modifie plus un membre existant.
--
-- Défaut corrigé : kx_inviter faisait « on conflict … do update set role = … ». Un propriétaire pouvait ainsi
-- changer un rôle sans passer par la vérification du dernier propriétaire ni par le journal, et même se
-- rétrograder lui-même en lecteur, laissant le tableau sans propriétaire.

-- Invitation : une personne déjà membre n'est jamais modifiée ici. Le rôle se change par une mise à jour dédiée.
create or replace function kx_inviter(p_board uuid, p_email text, p_nom text, p_role text) returns uuid
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
    on conflict (board_id, user_id) do nothing;
  if not found then
    raise exception 'Déjà membre du tableau' using errcode = '23505', constraint = 'deja_membre';
  end if;
  return u;
end $$;

-- Garde dans la base : après toute rétrogradation ou tout retrait, le tableau doit garder un propriétaire.
-- Le verrou sur la ligne du tableau fait passer l'une après l'autre deux modifications simultanées des membres
-- d'un même tableau : la seconde voit alors la première, et ne peut pas retirer le dernier propriétaire.
create function kx_garder_proprietaire() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform 1 from boards where id = old.board_id for update;
  -- Tableau en cours de suppression (cascade) : rien à garder.
  if found and not exists (select 1 from board_members where board_id = old.board_id and role = 'owner') then
    raise exception 'Un tableau doit toujours avoir au moins un propriétaire.'
      using errcode = '23514', constraint = 'un_proprietaire';
  end if;
  return null;
end $$;

revoke all on function kx_garder_proprietaire() from public;

create trigger board_members_garder_proprietaire
  after update or delete on board_members
  for each row execute function kx_garder_proprietaire();
