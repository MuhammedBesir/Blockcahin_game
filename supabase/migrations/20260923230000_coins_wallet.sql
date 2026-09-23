-- Coin sütunları (tür başına) ve cüzdan fonksiyonu
ALTER TABLE scores ADD COLUMN IF NOT EXISTS coins smallint NOT NULL DEFAULT 0;
ALTER TABLE scores ADD COLUMN IF NOT EXISTS coins_btc smallint NOT NULL DEFAULT 0;
ALTER TABLE scores ADD COLUMN IF NOT EXISTS coins_eth smallint NOT NULL DEFAULT 0;
ALTER TABLE scores ADD COLUMN IF NOT EXISTS coins_alt smallint NOT NULL DEFAULT 0;

CREATE OR REPLACE FUNCTION player_wallet(p_pid text)
RETURNS TABLE(total_coins bigint, btc bigint, eth bigint, alt bigint) AS $$
  SELECT
    COALESCE(SUM(s.coins), 0) AS total_coins,
    COALESCE(SUM(s.coins_btc), 0) AS btc,
    COALESCE(SUM(s.coins_eth), 0) AS eth,
    COALESCE(SUM(s.coins_alt), 0) AS alt
  FROM scores s
  WHERE s.pid = p_pid;
$$ LANGUAGE sql STABLE;
