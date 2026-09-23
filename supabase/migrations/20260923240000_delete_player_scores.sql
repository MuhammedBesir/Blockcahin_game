CREATE OR REPLACE FUNCTION delete_player_scores(p_secret text, p_pid text)
RETURNS void AS $$
BEGIN
  IF NOT check_admin(p_secret) THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;
  DELETE FROM scores WHERE pid = p_pid;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
