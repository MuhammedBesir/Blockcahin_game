-- Kalıcı liderlik tablosu.
-- Her satır: bir oyuncunun bir turda bitirdiği süre. Sadece host yazar (bitişi doğruladıktan sonra).
-- Anon anahtar tarayıcıda göründüğü için kurallar tabloda: sadece ekleme ve okuma var, güncelleme/silme yok.

create table public.scores (
  id          bigint generated always as identity primary key,
  pid         text        not null check (pid ~ '^[a-z0-9]{3,12}$'),
  name        text        not null check (char_length(name) between 1 and 12),
  net_ms      integer     not null check (net_ms >= 0),
  raw_ms      integer     not null check (raw_ms between 4000 and 120000),
  stars       smallint    not null default 0 check (stars between 0 and 5),
  falls       smallint    not null default 0 check (falls between 0 and 999),
  room        text        not null check (room ~ '^[0-9]{4,6}$'),
  round       smallint    not null check (round between 1 and 20),
  seed        bigint      not null,
  created_at  timestamptz not null default now(),
  check (net_ms <= raw_ms)
);

create index scores_pid_net_idx on public.scores (pid, net_ms, created_at);
create index scores_net_idx on public.scores (net_ms);

alter table public.scores enable row level security;

create policy "herkes okuyabilir" on public.scores
  for select to anon, authenticated using (true);

create policy "herkes ekleyebilir" on public.scores
  for insert to anon, authenticated with check (true);

revoke update, delete, truncate on public.scores from anon, authenticated;

-- Her oyuncunun en iyi süresi, sıralı
create function public.leaderboard(p_limit integer default 50)
returns table (rank bigint, pid text, name text, net_ms integer, stars smallint, runs bigint, played_at timestamptz)
language sql stable security invoker set search_path = ''
as $$
  with best as (
    select distinct on (s.pid) s.pid, s.name, s.net_ms, s.stars, s.created_at
    from public.scores s
    order by s.pid, s.net_ms, s.created_at
  ), cnt as (
    select s.pid, count(*) as runs from public.scores s group by s.pid
  )
  select rank() over (order by b.net_ms), b.pid, b.name, b.net_ms, b.stars, c.runs, b.created_at
  from best b join cnt c using (pid)
  order by b.net_ms, b.created_at
  limit least(greatest(p_limit, 1), 500);
$$;

-- Tek oyuncunun genel durumu
create function public.player_standing(p_pid text)
returns table (best_ms integer, rank bigint, total bigint, runs bigint)
language sql stable security invoker set search_path = ''
as $$
  with best as (
    select s.pid, min(s.net_ms) as net_ms, count(*) as runs from public.scores s group by s.pid
  ), me as (select * from best where pid = p_pid)
  select me.net_ms,
         1 + (select count(*) from best b where b.net_ms < me.net_ms),
         (select count(*) from best),
         me.runs
  from me;
$$;

grant execute on function public.leaderboard(integer) to anon, authenticated;
grant execute on function public.player_standing(text) to anon, authenticated;
