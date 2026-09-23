-- Oyuncu istatistikleri: oyun sayısı, ortalama süre, en iyi 3 skor
create or replace function public.player_stats(p_pid text)
returns table (
  games bigint,
  avg_ms numeric,
  best1_ms integer, best1_stars smallint, best1_at timestamptz,
  best2_ms integer, best2_stars smallint, best2_at timestamptz,
  best3_ms integer, best3_stars smallint, best3_at timestamptz
)
language sql stable security invoker set search_path = ''
as $$
  with agg as (
    select count(*) as games, avg(s.net_ms)::numeric as avg_ms
    from public.scores s
    where s.pid = p_pid
  ),
  top3 as (
    select s.net_ms, s.stars, s.created_at,
           row_number() over (order by s.net_ms, s.created_at) as rn
    from public.scores s
    where s.pid = p_pid
    limit 3
  ),
  t1 as (select * from top3 where rn = 1),
  t2 as (select * from top3 where rn = 2),
  t3 as (select * from top3 where rn = 3)
  select
    a.games, a.avg_ms,
    t1.net_ms, t1.stars, t1.created_at,
    t2.net_ms, t2.stars, t2.created_at,
    t3.net_ms, t3.stars, t3.created_at
  from agg a
  left join t1 on true
  left join t2 on true
  left join t3 on true;
$$;

grant execute on function public.player_stats(text) to anon, authenticated;
