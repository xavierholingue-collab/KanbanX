-- Nuit 2, point 9 : images rapatriées de Trello, stockées en base (pas sur le disque du serveur).
-- Protégées comme le tableau (RLS). Images seulement : PNG, JPEG, GIF, WebP (jamais SVG), 5 Mo au plus.
-- Règle des migrations : uniquement des ajouts.
create table images (
  id uuid primary key default gen_random_uuid(),
  board_id uuid not null references boards(id) on delete cascade,
  mime text not null check (mime in ('image/png', 'image/jpeg', 'image/gif', 'image/webp')),
  taille int not null check (taille between 1 and 5242880),
  contenu bytea not null check (octet_length(contenu) between 1 and 5242880),
  created_by uuid not null references users(id),
  created_at timestamptz not null default now()
);
create index on images (board_id);

alter table images enable row level security;
create policy images_lecture on images for select using (kx_can_read(board_id));
create policy images_ajout on images for insert with check (kx_can_write(board_id) and created_by = kx_uid());
-- Ni modification ni suppression par l'application : la suppression du tableau l'emporte.
grant select, insert on images to kanbanx_app;
