// Supabase Realtime (Broadcast) sarmalayıcı.
// Kanal düzeni:
//   dl-<ROOM>         → herkes: host durum/sıra/sonuç yayını, oyuncuların "hello" mesajı
//   dl-<ROOM>-<pid>   → sadece o oyuncu + host: konum, bitiş, karşılama
// Konum trafiği kişisel kanalda aktığı için diğer telefonlara dağıtılmaz (fan-out yok).
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

let client = null;
export function sb() {
  if (!client) {
    client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
      realtime: { params: { eventsPerSecond: 20 } },
    });
  }
  return client;
}

export const isConfigured = () => !SUPABASE_URL.includes('PROJE-ID') && !SUPABASE_ANON_KEY.includes('BURAYA');
export const ctrlTopic = (room) => `dl-${room}`;
export const playerTopic = (room, pid) => `dl-${room}-${pid}`;

// handlers: { eventAdi: (payload) => {} }, onStatus: (status) => {}
export function joinChannel(topic, handlers = {}, onStatus = () => {}) {
  const ch = sb().channel(topic, { config: { broadcast: { self: false, ack: false } } });
  for (const [event, fn] of Object.entries(handlers)) {
    ch.on('broadcast', { event }, ({ payload }) => {
      try { fn(payload); } catch (e) { console.error(`[${topic}] ${event}`, e); }
    });
  }
  return new Promise((resolve) => {
    let resolved = false;
    ch.subscribe((status, err) => {
      onStatus(status);
      if (status === 'SUBSCRIBED' && !resolved) { resolved = true; resolve(ch); }
      if (err) console.warn(`[${topic}]`, status, err);
    });
  });
}

export function send(ch, event, payload) {
  if (!ch) return;
  ch.send({ type: 'broadcast', event, payload }).catch((e) => console.warn('send', event, e));
}

export function leave(ch) {
  if (ch) sb().removeChannel(ch);
}

// ---------- Kalıcı liderlik (Postgres, Realtime mesaj bütçesine sayılmaz) ----------
// rows: [{ pid, name, net_ms, raw_ms, stars, falls, room, round, seed }]
export async function saveScores(rows) {
  if (!rows.length) return;
  const { error } = await sb().from('scores').insert(rows);
  if (error) throw error;
}

export async function fetchLeaderboard(limit = 50) {
  const { data, error } = await sb().rpc('leaderboard', { p_limit: limit });
  if (error) throw error;
  return data || [];
}

// { best_ms, rank, total, runs } ya da henüz kaydı yoksa null
export async function fetchStanding(pid) {
  const { data, error } = await sb().rpc('player_standing', { p_pid: pid });
  if (error) throw error;
  return data?.[0] || null;
}
