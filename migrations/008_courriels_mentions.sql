-- Nuit 2, point 6 : prévenir la personne mentionnée par courriel, regroupé, désactivable.
-- Règle des migrations : uniquement des ajouts (l'ancien code ignore la colonne et la table).

-- Préférence de la personne : courriel quand on la mentionne (oui par défaut).
alter table users add column mention_emails boolean not null default true;
grant update (mention_emails) on users to kanbanx_app;
create policy users_preferences on users for update using (id = kx_uid()) with check (id = kx_uid());

-- File d'envoi : une ligne par mention d'une personne. Écrite pendant la requête qui mentionne (par son auteur),
-- lue et marquée par la boucle d'envoi, uniquement au travers des fonctions ci-dessous.
create table mention_emails (
  id bigint generated always as identity primary key,
  user_id uuid not null references users(id) on delete cascade,
  board_id uuid not null,
  card_id uuid not null,
  author_id uuid not null references users(id) on delete cascade,
  client_name text check (length(client_name) between 1 and 60),
  lieu text not null check (lieu in ('titre', 'description', 'commentaire')),
  extrait text not null check (length(extrait) <= 200),
  created_at timestamptz not null default now(),
  tentatives int not null default 0,
  prochain_essai_at timestamptz not null default now(),
  sent_at timestamptz,
  abandon_at timestamptz,
  foreign key (card_id, board_id) references cards(id, board_id) on delete cascade
);
create index on mention_emails (user_id) where sent_at is null and abandon_at is null;
create index on mention_emails (user_id, sent_at desc) where sent_at is not null;

alter table mention_emails enable row level security;
-- L'auteur, membre écrivain du tableau, met en file une mention d'un autre membre. Aucune lecture.
create policy file_ajout on mention_emails for insert with check (kx_can_write(board_id) and author_id = kx_uid() and user_id <> kx_uid()
  and exists (select 1 from board_members m where m.board_id = mention_emails.board_id and m.user_id = mention_emails.user_id));
grant insert on mention_emails to kanbanx_app;

-- Boucle d'envoi : courriels à envoyer maintenant, groupés par personne. Une personne reçoit au plus un
-- courriel par intervalle (p_intervalle) : elle n'apparaît que si son dernier envoi est plus ancien.
-- Les mentions d'une personne qui a désactivé les courriels (ou d'un compte désactivé ou agent) sont abandonnées.
create function kx_courriels_a_envoyer(p_intervalle interval, p_max int)
returns table (user_id uuid, email text, ids bigint[], mentions jsonb)
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update mention_emails f set abandon_at = now()
    from users u where u.id = f.user_id and f.sent_at is null and f.abandon_at is null
      and (not u.mention_emails or u.disabled_at is not null or u.kind <> 'human');
  -- Ménage : les envois de plus de 7 jours ne servent plus au regroupement.
  delete from mention_emails where coalesce(sent_at, abandon_at) < now() - interval '7 days';
  return query
    select u.id, u.email, array_agg(f.id order by f.id),
      jsonb_agg(jsonb_build_object('auteur', a.name, 'client', f.client_name, 'lieu', f.lieu, 'extrait', f.extrait,
        'tableau', b.name, 'tableauId', b.id, 'carte', k.title, 'carteId', k.id, 'date', f.created_at) order by f.id)
    from mention_emails f
      join users u on u.id = f.user_id join users a on a.id = f.author_id
      join boards b on b.id = f.board_id join cards k on k.id = f.card_id
    where f.sent_at is null and f.abandon_at is null
      -- La personne doit encore pouvoir lire le tableau.
      and exists (select 1 from board_members m where m.board_id = f.board_id and m.user_id = f.user_id)
      and not exists (select 1 from mention_emails g where g.user_id = f.user_id and g.sent_at > now() - p_intervalle)
    group by u.id, u.email
    having min(f.prochain_essai_at) <= now()
    limit p_max;
end $$;

create function kx_courriels_envoyes(p_ids bigint[]) returns void language sql security definer set search_path = public, pg_temp as
$$ update mention_emails set sent_at = now() where id = any(p_ids) $$;

-- Échec : nouvel essai plus tard (1, 2, 4… minutes, au plus une heure) ; abandon après 10 tentatives.
create function kx_courriels_echec(p_ids bigint[]) returns void language sql security definer set search_path = public, pg_temp as $$
  update mention_emails set tentatives = tentatives + 1,
    prochain_essai_at = now() + least(interval '1 hour', interval '1 minute' * power(2, tentatives)),
    abandon_at = case when tentatives + 1 >= 10 then now() end
  where id = any(p_ids)
$$;

revoke all on function kx_courriels_a_envoyer, kx_courriels_envoyes, kx_courriels_echec from public;
grant execute on function kx_courriels_a_envoyer, kx_courriels_envoyes, kx_courriels_echec to kanbanx_app;
