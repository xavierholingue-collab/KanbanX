-- Un compte agent (Claude) n'est jamais propriétaire d'un tableau : il ne peut ni gérer les membres, ni renommer
-- un tableau, même si on le lui demande dans un commentaire. Moindre privilège, garanti par la base.
-- Conséquence : un agent ne crée pas de tableau ; il travaille dans les tableaux où une personne l'a invité.

create function kx_agent_non_proprietaire() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.role = 'owner' and exists (select 1 from users where id = new.user_id and kind = 'agent') then
    raise exception 'Un agent ne peut pas être propriétaire d''un tableau.'
      using errcode = '23514', constraint = 'agent_non_proprietaire';
  end if;
  return new;
end $$;

revoke all on function kx_agent_non_proprietaire() from public;

create trigger board_members_agent_non_proprietaire
  before insert or update on board_members
  for each row execute function kx_agent_non_proprietaire();
