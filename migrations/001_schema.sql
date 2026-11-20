-- Schéma de KanbanX. Les tables d'authentification ne sont pas accessibles au rôle applicatif.

create table users (
  id uuid primary key default gen_random_uuid(),
  email text not null unique check (email = lower(email) and length(email) <= 254),
  name text not null check (length(name) between 1 and 40),
  kind text not null default 'human' check (kind in ('human', 'agent')),
  disabled_at timestamptz,
  created_at timestamptz not null default now()
);

create table sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  token_hash bytea not null unique,
  csrf_token text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  last_seen_at timestamptz not null default now()
);

create table magic_links (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  token_hash bytea not null unique,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

create table api_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  name text not null,
  token_hash bytea not null unique,
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);

create table boards (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(name) between 1 and 100),
  created_by uuid not null references users(id),
  archived_at timestamptz,
  created_at timestamptz not null default now()
);

create table board_members (
  board_id uuid not null references boards(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  role text not null check (role in ('owner', 'member', 'reader')),
  created_at timestamptz not null default now(),
  primary key (board_id, user_id)
);
create index on board_members (user_id);

create table columns (
  id uuid primary key default gen_random_uuid(),
  board_id uuid not null references boards(id) on delete cascade,
  name text not null check (length(name) between 1 and 100),
  position double precision not null,
  wip_limit integer check (wip_limit is null or wip_limit > 0),
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  unique (id, board_id)
);
create index on columns (board_id, position);

create table cards (
  id uuid primary key default gen_random_uuid(),
  board_id uuid not null,
  column_id uuid not null,
  title text not null check (length(title) between 1 and 300),
  description text not null default '' check (length(description) <= 20000),
  position double precision not null,
  due_date date,
  archived_at timestamptz,
  created_by uuid not null references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, board_id),
  foreign key (board_id) references boards(id) on delete cascade,
  foreign key (column_id, board_id) references columns(id, board_id) on delete cascade
);
create index on cards (column_id, position);
create index on cards (board_id);

create table labels (
  id uuid primary key default gen_random_uuid(),
  board_id uuid not null references boards(id) on delete cascade,
  name text not null check (length(name) between 0 and 40),
  color text not null check (color in ('bleu', 'turquoise', 'vert', 'orange', 'rouge', 'violet', 'ardoise', 'brun')),
  created_at timestamptz not null default now(),
  unique (id, board_id)
);

create table card_labels (
  card_id uuid not null,
  label_id uuid not null,
  board_id uuid not null,
  primary key (card_id, label_id),
  foreign key (card_id, board_id) references cards(id, board_id) on delete cascade,
  foreign key (label_id, board_id) references labels(id, board_id) on delete cascade
);

create table card_assignees (
  card_id uuid not null,
  user_id uuid not null,
  board_id uuid not null,
  primary key (card_id, user_id),
  foreign key (card_id, board_id) references cards(id, board_id) on delete cascade,
  foreign key (board_id, user_id) references board_members(board_id, user_id) on delete cascade
);

create table comments (
  id uuid primary key default gen_random_uuid(),
  board_id uuid not null,
  card_id uuid not null,
  author_id uuid not null references users(id),
  body text not null check (length(body) between 1 and 10000),
  mentions uuid[] not null default '{}',
  created_at timestamptz not null default now(),
  edited_at timestamptz,
  deleted_at timestamptz,
  foreign key (card_id, board_id) references cards(id, board_id) on delete cascade
);
create index on comments (card_id, created_at);
create index on comments (board_id, created_at);
create index on comments using gin (mentions);

create table activity (
  id bigint generated always as identity primary key,
  board_id uuid not null references boards(id) on delete cascade,
  card_id uuid,
  actor_id uuid not null references users(id),
  via text not null default 'web' check (via in ('web', 'api', 'mcp', 'systeme')),
  action text not null,
  data jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index on activity (board_id, id desc);
create index on activity (card_id, id desc);

-- Droits du rôle applicatif : jamais de droit sur les tables d'authentification.
grant select on users to kanbanx_app;
grant select, update (name, archived_at) on boards to kanbanx_app;
grant select, update (role), delete on board_members to kanbanx_app;
grant select, insert, update, delete on columns, cards, labels, card_labels, card_assignees to kanbanx_app;
grant select, insert, update, delete on comments to kanbanx_app;
grant select, insert on activity to kanbanx_app;
