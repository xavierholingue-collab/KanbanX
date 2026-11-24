-- Nuit 2 : mentions @prénom dans le titre et la description d'une carte, et « @Claude ».
-- Règle des migrations : uniquement des ajouts. Les mentions des commentaires restent dans comments.mentions,
-- que l'ancien code continue de lire et d'écrire.

-- Une ligne par mention nouvelle d'une personne dans le titre ou la description d'une carte.
-- user_id vide : « @Claude », adressée au Claude de chaque membre du tableau (point 3).
create table card_mentions (
  id uuid primary key default gen_random_uuid(),
  board_id uuid not null,
  card_id uuid not null,
  field text not null check (field in ('titre', 'description')),
  user_id uuid references users(id) on delete cascade,
  author_id uuid not null references users(id),
  client_name text check (length(client_name) between 1 and 60),
  created_at timestamptz not null default now(),
  foreign key (card_id, board_id) references cards(id, board_id) on delete cascade
);
create index on card_mentions (user_id, created_at desc);
create index on card_mentions (board_id, created_at desc) where user_id is null;
create index on card_mentions (card_id);

-- « @Claude » dans un commentaire (l'ancien code laisse la valeur par défaut).
alter table comments add column mentions_claude boolean not null default false;
create index on comments (board_id, created_at desc) where mentions_claude;

alter table card_mentions enable row level security;
create policy mentions_lecture on card_mentions for select using (kx_can_read(board_id));
-- Écrite par son auteur, membre écrivain du tableau ; la personne citée est membre du même tableau.
create policy mentions_ajout on card_mentions for insert with check (kx_can_write(board_id) and author_id = kx_uid()
  and (user_id is null or exists (select 1 from board_members m where m.board_id = card_mentions.board_id and m.user_id = card_mentions.user_id)));

-- Une mention est un fait : ni modification ni suppression par l'application (la suppression de la carte l'emporte).
grant select, insert on card_mentions to kanbanx_app;
