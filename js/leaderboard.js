import { isConfigured, fetchLeaderboard, fetchStanding } from './net.js';

const $ = (s) => document.querySelector(s);
const REFRESH_MS = 15000;
let pid = null;
try { pid = localStorage.getItem('dl-pid'); } catch {}

const fmtSec = (ms) => (ms / 1000).toFixed(2).replace('.', ',');
const crown = '<svg width="20" height="16" viewBox="0 0 28 22" aria-label="Lider"><path d="M3 18L5 6L10.5 11L14 3L17.5 11L23 6L25 18Z" fill="#FFC94D" stroke="#000" stroke-width="1.2" stroke-linejoin="round"/><rect x="3" y="18" width="22" height="3" rx="1" fill="#FFC94D"/></svg>';

async function load() {
  if (!isConfigured()) { $('#foot').textContent = 'Supabase ayarlı değil.'; return; }
  try {
    const [rows, me] = await Promise.all([fetchLeaderboard(100), pid ? fetchStanding(pid) : null]);
    render(rows, me);
    $('#foot').textContent = `Son güncelleme ${new Date().toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })} · ${REFRESH_MS / 1000} sn’de bir yenilenir`;
  } catch (e) {
    console.error(e);
    $('#foot').textContent = 'Liderlik yüklenemedi, tekrar deneniyor…';
  }
}

function render(rows, me) {
  const ol = $('#list');
  ol.innerHTML = '';
  $('#empty').hidden = rows.length > 0;
  for (const r of rows) {
    const li = document.createElement('li');
    if (r.rank <= 3) li.classList.add(`top${r.rank}`);
    if (r.pid === pid) li.classList.add('mine');
    li.innerHTML = `<span class="r">${r.rank}</span>${r.rank === 1 ? crown : ''}<span class="nm"><b></b><small>${r.runs} tur · ${r.stars} yıldız</small></span><span class="t">${fmtSec(r.net_ms)}</span>`;
    li.querySelector('b').textContent = r.name;
    if (r.pid === pid) li.querySelector('b').insertAdjacentHTML('beforeend', '<span class="you">SEN</span>');
    ol.appendChild(li);
  }
  $('#me').hidden = !me;
  if (me) {
    $('#me-rank').textContent = `${me.rank}.`;
    $('#me-of').textContent = `${me.total} oyuncu içinde`;
    $('#me-best').textContent = `En iyi süren ${fmtSec(me.best_ms)} sn · ${me.runs} tur oynadın`;
  }
}

load();
setInterval(() => { if (document.visibilityState === 'visible') load(); }, REFRESH_MS);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') load(); });
