-- Serbest oyun: bir oyuncu istediği kadar oynayabilir, "round" artık oyuncunun kaçıncı oyunu.
alter table public.scores drop constraint scores_round_check;
alter table public.scores add constraint scores_round_check check (round between 1 and 100000);
