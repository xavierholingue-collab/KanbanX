-- Nuit 2, point 8 : relier les auteurs Trello aux comptes KanbanX.
-- Le commentaire importé reste la propriété de la personne qui importe (author_id) : on affiche seulement le nom
-- de la personne associée, avec « importé de Trello ». Règle des migrations : uniquement des ajouts.
alter table comments add column imported_from text check (imported_from in ('trello'));
alter table comments add column imported_author_id uuid references users(id) on delete set null;
alter table comments add column imported_author_name text check (length(imported_author_name) between 1 and 40);

-- Garde-fou de la base (politiques restrictives, qui s'ajoutent aux autres) : la personne associée partage déjà
-- un tableau avec l'auteur, c'est une personne (pas un agent), et son nom est le sien. L'ancien code, qui laisse
-- ces colonnes vides, n'est pas concerné.
create function kx_auteur_importe_valide(p_user uuid, p_nom text) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select p_user is null or (kx_shares_board(p_user)
    and exists (select 1 from users where id = p_user and kind = 'human' and name = p_nom))
$$;
revoke all on function kx_auteur_importe_valide from public;
grant execute on function kx_auteur_importe_valide to kanbanx_app;

create policy comm_import_ajout on comments as restrictive for insert
  with check (kx_auteur_importe_valide(imported_author_id, imported_author_name));
-- Après coup, l'association ne change plus (seule la suppression du compte associé peut la vider).
-- Un déclencheur plutôt qu'une politique : corriger le texte reste possible même si la personne associée
-- ne partage plus de tableau avec l'auteur.
create function kx_auteur_importe_fige() returns trigger language plpgsql as $$
begin
  if new.imported_from is distinct from old.imported_from or new.imported_author_name is distinct from old.imported_author_name
     or (new.imported_author_id is distinct from old.imported_author_id and new.imported_author_id is not null) then
    raise exception 'L''auteur importé d''un commentaire ne se modifie pas' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger comm_import_fige before update on comments for each row execute function kx_auteur_importe_fige();
