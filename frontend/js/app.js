/* ---------- 카카오톡 인앱브라우저 탈출 ---------- */
function isKakao() { return /KAKAOTALK/i.test(navigator.userAgent); }
function openExternal() {
  location.href = 'kakaotalk://web/openExternal?url=' + encodeURIComponent(location.href);
}
function dismissKakao() {
  document.getElementById('kakaoOverlay').style.display = 'none';
}
if (isKakao()) {
  document.getElementById('kakaoOverlay').style.display = 'block';
  setTimeout(openExternal, 300); // 자동 전환 시도, 막히면 오버레이 버튼으로
}

const CHUNK = 8 * 1024 * 1024; // 릴레이 폴백용 8MB (Drive resumable: 256KB 배수 필수)
let DATA = { members: [], raid: [], disaster: [] };
let category = 'raid';

// run(액션, 인자...) 은 js/api.js 가 제공 (fetch 기반 — 호출부는 GAS 시절과 동일)

/* ---------- 날짜 표준 표기 ----------
 * 백엔드가 내려주는 dateInfo({iso,ym,weekday,time,display})를 우선 사용,
 * 파싱 실패(null)면 원본 라벨 폴백. 번개는 위치(loc)를 뒤에 붙인다.
 */
function fmtVoteDate(r) {
  if (r && r.dateInfo && r.dateInfo.display) {
    return r.dateInfo.display + (r.loc ? ' @ ' + r.loc : '');
  }
  return (r && r.date) || '';
}

// 라벨 → Date (D-day 계산용, 클라이언트 보조 파서)
function parseDateClient(label, monthHint) {
  if (!label) return null;
  label = String(label);
  let y = null, mo = null, da = null;
  let m = label.match(/(\d{4})\s*[.\-\/년]\s*(\d{1,2})\s*[.\-\/월]\s*(\d{1,2})/);
  if (m) { y = +m[1]; mo = +m[2]; da = +m[3]; }
  else {
    m = label.match(/(\d{1,2})\s*[.\-\/월]\s*(\d{1,2})/);
    if (!m) return null;
    mo = +m[1]; da = +m[2];
    y = (monthHint && /^\d{4}-\d{2}$/.test(monthHint)) ? +monthHint.slice(0, 4) : new Date().getFullYear();
  }
  if (mo < 1 || mo > 12 || da < 1 || da > 31) return null;
  return new Date(y, mo - 1, da);
}

function ddayText(d) {
  if (!d) return '';
  const today = new Date();
  const diff = Math.round((new Date(d.getFullYear(), d.getMonth(), d.getDate()) -
    new Date(today.getFullYear(), today.getMonth(), today.getDate())) / 86400000);
  if (diff === 0) return 'D-DAY';
  return diff > 0 ? 'D-' + diff : 'D+' + (-diff);
}

/* ---------- 업로드 코어 ----------
 * 1차: 브라우저 → Drive 직접 PUT (빠름, 진행률 정확)
 * 2차: 직접 업로드가 막히면 서버 릴레이 청크 방식으로 자동 폴백
 */
function uploadDirect(uploadUrl, file, onProgress) {
  return new Promise(function(resolve, reject) {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', uploadUrl, true);
    xhr.upload.onprogress = function(ev) {
      if (ev.lengthComputable) onProgress(ev.loaded / ev.total);
    };
    xhr.onload = function() {
      if (xhr.status === 200 || xhr.status === 201) {
        try { resolve(JSON.parse(xhr.responseText).id); }
        catch (e) { reject(new Error('응답 파싱 실패')); }
      } else {
        reject(new Error('업로드 실패 (' + xhr.status + ')'));
      }
    };
    xhr.onerror = function() { reject(new Error('CORS_OR_NETWORK')); };
    xhr.send(file);
  });
}

async function uploadFileSmart(startFnName, startArgs, file, st, fill) {
  st.textContent = '업로드 준비 중…';
  const uploadUrl = await run.apply(null, [startFnName].concat(startArgs));

  // 1차: 브라우저 → Drive 직접 업로드
  try {
    const id = await uploadDirect(uploadUrl, file, function(p) {
      st.textContent = '업로드 중 ' + Math.round(p * 100) + '% — 화면을 켜둔 채 기다려주세요';
      fill.style.width = (p * 90) + '%';
    });
    return id; // 성공 시 여기서 종료 (폴백 실행 안 함)
  } catch (e) {
    if (e.message !== 'CORS_OR_NETWORK') throw e;
    // 직접 업로드가 CORS로 응답을 못 읽은 것일 수 있음 → 세션이 이미 끝났는지 먼저 확인
    try {
      const chk = await run('checkUploadStatus', uploadUrl, file.size);
      if (chk.done) return chk.fileId; // 이미 올라감 → 폴백 생략 (중복 방지)
    } catch (e2) { /* 조회 실패 시 아래 폴백으로 */ }
  }

  // 2차: 릴레이 폴백 — 반드시 새 업로드 세션으로 (기존 세션은 위에서 소모됨)
  const relayUrl = await run.apply(null, [startFnName].concat(startArgs));
  const buf = await file.arrayBuffer();
  let fileId = null;
  for (let start = 0; start < file.size; start += CHUNK) {
    const end = Math.min(start + CHUNK, file.size);
    const b64 = toB64(buf.slice(start, end));
    st.textContent = '업로드 중 ' + Math.round(end / file.size * 100) + '% — 화면을 켜둔 채 기다려주세요';
    fill.style.width = (end / file.size * 90) + '%';
    const r = await run('uploadChunk', relayUrl, b64, start, end - 1, file.size);
    if (r.done) fileId = r.fileId;
  }
  return fileId;
}

/* ---------- 세션 상태 ---------- */
let ME = { name: '', token: '', isAdmin: false };

function getMe() { return ME.name; }

/* ---------- 초기화 ---------- */
window.addEventListener('load', async function() {
  try {
    DATA = await run('getInitData');

    // 로그인 화면 이름 목록 채우기
    const lsel = document.getElementById('loginName');
    DATA.members.forEach(function(m) {
      const o = document.createElement('option');
      o.value = o.textContent = m;
      lsel.appendChild(o);
    });
    // 숨겨진 myName 셀렉트도 채워둠 (기존 코드 호환)
    const sel = document.getElementById('myName');
    DATA.members.forEach(function(m) {
      const o = document.createElement('option');
      o.value = o.textContent = m;
      sel.appendChild(o);
    });

    document.getElementById('loading').style.display = 'none';

    // 저장된 세션 복원 시도
    const saved = JSON.parse(localStorage.getItem('sga_session') || 'null');
    if (saved && saved.name && saved.token && DATA.members.indexOf(saved.name) > -1) {
      applyLogin(saved);
    } else {
      showLogin();
    }
  } catch (e) {
    document.getElementById('loading').textContent = '불러오기 실패: ' + (e.message || e);
  }
});

function showLogin() {
  document.getElementById('loginScreen').style.display = 'block';
  const lp = document.getElementById('loginPin');
  lp.addEventListener('keydown', function(e) { if (e.key === 'Enter') doLogin(); });
}

async function doLogin() {
  const name = document.getElementById('loginName').value;
  const pin = document.getElementById('loginPin').value;
  const st = document.getElementById('loginStatus');
  const btn = document.getElementById('loginBtn');
  if (!name) { st.className = 'status err'; st.textContent = '이름을 선택하세요.'; return; }
  if (!pin) { st.className = 'status err'; st.textContent = 'PIN을 입력하세요.'; return; }
  btn.disabled = true;
  st.className = 'status';
  st.textContent = '확인 중…';
  try {
    const res = await run('loginWithPin', name, pin);
    localStorage.setItem('sga_session', JSON.stringify(res));
    if (res.firstSet) {
      st.className = 'status ok';
      st.textContent = '✓ PIN이 등록되었어요!';
    }
    applyLogin(res);
  } catch (e) {
    st.className = 'status err';
    st.textContent = e.message || String(e);
    btn.disabled = false;
  }
}

function applyLogin(session) {
  ME = {
    name: session.name, token: session.token, isAdmin: !!session.isAdmin,
    driveApiKey: session.driveApiKey || ''   // 로그인 응답으로만 전달됨 (익명 노출 방지)
  };
  apiSetSession(session); // 업로드 계열 API 의 name/token 자동 주입용
  document.getElementById('myName').value = session.name;
  document.getElementById('myNameLabel').textContent =
    session.name + (session.isAdmin ? ' 👑' : '');
  document.getElementById('loginScreen').style.display = 'none';

  buildChips('photoChips');
  buildDateSelect('photo');
  buildMonthFilter();
  applyAdminUI();
  renderCertLine();
  renderVotes();
  renderHome();
  setTab('home');
}

function doLogout() {
  localStorage.removeItem('sga_session');
  location.reload();
}

async function changePinPrompt() {
  const oldPin = prompt('기존 PIN을 입력하세요');
  if (oldPin === null) return;
  const newPin = prompt('새 PIN을 입력하세요 (4자리 이상)');
  if (newPin === null) return;
  if (String(newPin).trim().length < 4) return alert('새 PIN은 4자리 이상이어야 해요.');
  try {
    const res = await run('changePin', getMe(), oldPin, newPin, ME.token);
    localStorage.setItem('sga_session', JSON.stringify(res));
    ME.token = res.token;
    ME.driveApiKey = res.driveApiKey || ME.driveApiKey;
    apiSetSession(res);
    alert('✓ PIN이 변경되었어요.');
  } catch (e) {
    alert(e.message || e);
  }
}

/* ---------- 탭 ---------- */
function setTab(t) {
  ['home','vote','photo','gallery','hall','more'].forEach(function(k) {
    document.getElementById('tab-' + k).classList.toggle('on', k === t);
    document.getElementById('nav-' + k).classList.toggle('on', k === t);
  });
  if (t === 'gallery' && !galleryLoaded) loadGallery();
  if (t === 'hall' && !hallLoaded) loadHall();
  if (t === 'more' && !moreLoaded) loadMore();
}

function goVote(cat) {
  setCategory(cat);
  setTab('vote');
}

function openNotion() {
  if (DATA.notionUrl) window.open(DATA.notionUrl, '_blank');
  else alert('안내문 링크가 아직 설정되지 않았어요. 추장에게 문의!');
}

/* ---------- 홈 ---------- */

// 다음 모임 D-day 배너 (#19): 확정된 정기공격 중 가장 가까운 미래 일정
function renderDday() {
  const el = document.getElementById('ddayBanner');
  el.innerHTML = '';
  let next = null;
  (DATA.raidMonths || []).forEach(function (g) {
    if (!g.confirmed) return;
    const d = parseDateClient(g.confirmed.date, g.month);
    if (!d) return;
    const today = new Date();
    if (d < new Date(today.getFullYear(), today.getMonth(), today.getDate())) return; // 지난 일정 제외
    if (!next || d < next.d) next = { d: d, conf: g.confirmed, month: g.month };
  });
  if (!next) return;
  const opt = null; // 위치는 confirmed.loc 사용
  el.innerHTML =
    '<div class="confirm-banner" style="cursor:pointer">🔥 다음 정기공격 <b>' + ddayText(next.d) + '</b>' +
    '<div class="cdate">' + esc(next.conf.date) + '</div>' +
    (next.conf.loc ? '📍 ' + esc(next.conf.loc) : '') + '</div>';
  el.firstChild.onclick = function () { goVote('raid'); };
}

function renderHome() {
  renderDday();
  const box = document.getElementById('homeCards');
  box.innerHTML = '';

  // 정기공격: 월별 요약
  const raidCard = document.createElement('div');
  const months = DATA.raidMonths || [];
  let raidStatus;
  if (!months.length) {
    raidCard.className = 'home-card';
    raidStatus = '등록된 일정 없음';
  } else {
    const confirmedMonths = months.filter(function(g) { return g.confirmed; });
    const openMonths = months.filter(function(g) { return !g.confirmed; });
    raidCard.className = openMonths.length ? 'home-card' : 'home-card fixed';
    const parts = [];
    months.forEach(function(g) {
      const mm = parseInt((g.month || '').split('-')[1], 10);
      if (g.confirmed) {
        parts.push('📌 ' + mm + '월: <b>' + esc(g.confirmed.date) + '</b>' +
          (g.confirmed.loc ? ' @' + esc(g.confirmed.loc) : ''));
      } else if (g.closed) {
        parts.push('⛔ ' + mm + '월: 투표 마감 (확정 대기)');
      } else {
        let top = null;
        g.options.forEach(function(r) { if (!top || r.voters.length > top.voters.length) top = r; });
        parts.push('🗳️ ' + mm + '월: 투표 중' +
          (g.deadline ? ' (~' + g.deadline + ')' : '') +
          (top && top.voters.length ? '<br>&nbsp;&nbsp;&nbsp;1위 ' + esc(top.date) + ' ' + top.voters.length + '명' : ''));
      }
    });
    raidStatus = parts.join('<br>');
  }
  raidCard.innerHTML = '<div class="hc-title">⚔️ 정기공격</div>' +
    '<div class="hc-status">' + raidStatus + '</div>';
  raidCard.onclick = function() { goVote('raid'); };
  // 확정된 달마다 캘린더 버튼
  months.filter(function(g){return g.confirmed;}).forEach(function(g) {
    const mm = parseInt((g.month || '').split('-')[1], 10);
    const cb = document.createElement('button');
    cb.className = 'mini-btn';
    cb.textContent = '📅 ' + mm + '월 캘린더';
    cb.onclick = function(e) { e.stopPropagation(); addToCalendar(g.confirmed); };
    raidCard.appendChild(cb);
  });
  box.appendChild(raidCard);

  // 자연재해(번개)
  const disCard = document.createElement('div');
  const flashes = DATA.disaster || [];
  disCard.className = 'home-card';
  disCard.innerHTML = '<div class="hc-title">🌋 자연재해 (번개)</div>' +
    '<div class="hc-status">' +
    (flashes.length ? '⚡ 열린 번개 ' + flashes.length + '개' : '열린 번개 없음 — 직접 열어보자') +
    '</div>';
  disCard.onclick = function() { goVote('disaster'); };
  box.appendChild(disCard);

  const done = DATA.members.filter(function(m) { return DATA.certified[m]; }).length;
  const mm = parseInt((DATA.month || '').split('-')[1], 10);
  document.getElementById('homeCertLine').innerHTML =
    '🖼️ ' + mm + '월 벽화 인증: <b>' + done + '</b> / ' + DATA.members.length + '명';
}

/* ---------- 투표 ---------- */
function setCategory(c) {
  category = c;
  document.getElementById('segRaid').classList.toggle('on', c === 'raid');
  document.getElementById('segDisaster').classList.toggle('on', c === 'disaster');
  renderVotes();
}

function renderVotes() {
  const list = document.getElementById('voteList');
  document.getElementById('deadlineLine').textContent = '';
  list.innerHTML = '';
  if (category === 'raid') renderRaid(list);
  else renderDisaster(list);
}

/* ---------- 정기공격 (월별) ---------- */
function renderRaid(list) {
  const me = getMe();
  const isAdmin = ME.isAdmin;
  const sel = voteMonthValue();
  const months = (DATA.raidMonths || []).filter(function (g) { return !sel || g.month === sel; });
  if (!months.length) {
    list.insertAdjacentHTML('beforeend', '<div class="loading">' +
      (sel ? sel + ' 정기공격 일정이 없어요' : '등록된 정기공격 일정이 없어요') + '</div>');
    return;
  }
  months.forEach(function(g) {
    const mm = parseInt((g.month || '').split('-')[1], 10);
    const head = document.createElement('div');
    head.className = 'month-head';
    head.textContent = '📆 ' + mm + '월 정기공격';
    list.appendChild(head);

    // 마감 안내
    if (!g.confirmed) {
      const dl = document.createElement('div');
      if (g.closed) {
        dl.className = 'deadline-line over';
        dl.textContent = '⛔ 투표 마감됨' + (g.deadline ? ' (' + g.deadline + ')' : '');
      } else if (g.deadline) {
        dl.className = 'deadline-line';
        const dd = ddayText(parseDateClient(g.deadline, g.month)); // 마감 D-day (#19)
        dl.textContent = '⏳ 투표 마감: ' + g.deadline + ' 까지' + (dd ? ' · ' + dd : '');
      }
      if (dl.textContent) list.appendChild(dl);
    }

    if (g.confirmed) {
      const b = document.createElement('div');
      b.className = 'confirm-banner';
      b.innerHTML = '📌 ' + mm + '월 확정<div class="cdate">' + esc(g.confirmed.date) + '</div>' +
        (g.confirmed.loc ? '📍 ' + esc(g.confirmed.loc) + '<br>' : '') + '투표 마감';
      const cal = document.createElement('button');
      cal.className = 'mini-btn';
      cal.textContent = '📅 캘린더 추가';
      cal.onclick = function() { addToCalendar(g.confirmed); };
      b.appendChild(document.createElement('br'));
      b.appendChild(cal);
      const sbtn = document.createElement('button');
      sbtn.className = 'mini-btn';
      sbtn.textContent = '💬 카톡 공유';
      sbtn.onclick = function() {
        const opt = g.options.find(function(x){return x.date===g.confirmed.date;}) || {voters:[]};
        shareText('⚔️ ' + mm + '월 정기공격 확정!\n📅 ' + g.confirmed.date +
          (g.confirmed.loc ? '\n📍 ' + g.confirmed.loc : '') +
          (opt.voters.length ? '\n🧗 참여(' + opt.voters.length + '): ' + opt.voters.join(', ') : ''),
          '확정 소식 복사 완료!');
      };
      b.appendChild(sbtn);
      if (isAdmin) {
        const u = document.createElement('button');
        u.className = 'mini-btn';
        u.textContent = '확정 취소';
        u.onclick = function() { doConfirm(g.month, ''); };
        b.appendChild(u);
      }
      list.appendChild(b);
    }

    g.options.forEach(function(r) {
      const mine = me && r.voters.indexOf(me) > -1;
      const isC = g.confirmed && r.date === g.confirmed.date;
      const blocked = !!g.confirmed || g.closed;
      const card = document.createElement('div');
      card.className = 'vote-card' + (mine ? ' mine' : '') +
        (isC ? ' confirmed' : '') + (blocked && !isC ? ' closed' : '');
      card.innerHTML =
        '<div class="top"><span class="date">' + esc(fmtVoteDate(r)) + (isC ? ' ✅' : '') + '</span>' +
        '<span class="count">' + r.voters.length + '명</span></div>' +
        (r.voters.length ? '<div class="voters">' + r.voters.map(esc).join(' · ') + '</div>' : '') +
        (!blocked && mine ? '<div class="hint">✓ 참여 중 — 탭하면 취소</div>' : '');
      if (!blocked) {
        card.onclick = function() { voteRaid(g.month, r.date, card); };
      }
      // 확정 버튼: 확정 전이면 마감 후에도 노출 (마감 → 확정 순서)
      if (!g.confirmed && isAdmin) {
        const cb = document.createElement('button');
        cb.className = 'mini-btn';
        cb.textContent = '📌 이 날짜로 확정';
        cb.onclick = function(e) { e.stopPropagation(); doConfirm(g.month, r.date); };
        card.appendChild(cb);
      }
      list.appendChild(card);
    });
  });
}

/* ---------- 자연재해 (번개) ---------- */
function renderDisaster(list) {
  const me = getMe();
  const isAdmin = ME.isAdmin;
  const sel = voteMonthValue();
  const rows = (DATA.disaster || []).filter(function (r) {
    return !sel || (r.dateInfo && r.dateInfo.ym === sel); // 월 파싱 안 되는 라벨은 '전체'에서만 노출
  });

  const addBtn = document.createElement('button');
  addBtn.className = 'btn2';
  addBtn.style.marginBottom = '10px';
  addBtn.textContent = '⚡ 번개 열기';
  addBtn.onclick = openFlashPrompt;
  list.appendChild(addBtn);

  if (!rows.length) {
    list.insertAdjacentHTML('beforeend', '<div class="loading">' +
      (sel ? sel + '에 열린 번개가 없어요' : '아직 열린 번개가 없어요') + '</div>');
    return;
  }

  rows.forEach(function(r) {
    const mine = me && r.voters.indexOf(me) > -1;
    const card = document.createElement('div');
    card.className = 'vote-card' + (mine ? ' mine' : '');
    card.innerHTML =
      '<div class="top"><span class="date">' + esc(fmtVoteDate(r)) + '</span>' +
      '<span class="count">' + r.voters.length + '명</span></div>' +
      (r.voters.length ? '<div class="voters">' + r.voters.map(esc).join(' · ') + '</div>' : '') +
      (mine ? '<div class="hint">✓ 참여 중 — 탭하면 취소</div>' : '');
    card.onclick = function() { voteFlash(r.date, card); };
    const shareBtn = document.createElement('button');
    shareBtn.className = 'mini-btn';
    shareBtn.textContent = '💬 공유';
    shareBtn.onclick = function(e) {
      e.stopPropagation();
      shareText('⚡ 번개 소집!\n' + r.date +
        (r.voters.length ? '\n🧗 참여(' + r.voters.length + '): ' + r.voters.join(', ') : '') +
        '\n\n같이 갈 사람 모여라 🔥', '번개 소식 복사 완료!');
    };
    card.appendChild(shareBtn);
    const owner = DATA.flashOwners && DATA.flashOwners[r.date];
    if (owner === me || isAdmin) {
      const db = document.createElement('button');
      db.className = 'mini-btn';
      db.textContent = '🗑️ 번개 취소';
      db.onclick = function(e) { e.stopPropagation(); deleteFlashClick(r.date); };
      card.appendChild(db);
    }
    list.appendChild(card);
  });
}

/* ---------- 번개(자연재해) 등록/삭제 ---------- */
async function openFlashPrompt() {
  const date = prompt('⚡ 번개 날짜/시간 (예: 7/15(화) 20:00)');
  if (date === null || !date.trim()) return;
  const loc = prompt('📍 번개 위치 (예: 더클라임 강남)');
  if (loc === null || !loc.trim()) return;
  try {
    DATA.disaster = await run('addFlash', date.trim(), loc.trim(), getMe(), ME.token);
    if (!DATA.flashOwners) DATA.flashOwners = {};
    DATA.flashOwners[date.trim() + ' @ ' + loc.trim()] = getMe();
    renderVotes();
    renderHome();
  } catch (e) {
    alert(e.message || e);
  }
}

async function deleteFlashClick(dateText) {
  if (!confirm('이 번개를 취소할까요?')) return;
  try {
    DATA.disaster = await run('deleteFlash', dateText, getMe(), ME.token);
    if (DATA.flashOwners) delete DATA.flashOwners[dateText];
    renderVotes();
    renderHome();
  } catch (e) {
    alert(e.message || e);
  }
}

/* ---------- 공유 (클립보드 복사 → 카톡 붙여넣기) ---------- */
async function shareText(text, okMsg) {
  // 네이티브 공유 시트 우선 (모바일), 없으면 클립보드 복사
  if (navigator.share) {
    try { await navigator.share({ text: text }); return; } catch (e) { if (e.name === 'AbortError') return; }
  }
  try {
    await navigator.clipboard.writeText(text);
    alert((okMsg || '복사됐어요!') + '\n\n카톡에 붙여넣기 하세요 📋');
  } catch (e) {
    // clipboard API 실패 시 폴백
    const ta = document.createElement('textarea');
    ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); alert((okMsg || '복사됐어요!') + '\n\n카톡에 붙여넣기 하세요 📋'); }
    catch (e2) { prompt('아래 내용을 복사하세요', text); }
    ta.remove();
  }
}

/* ---------- 구글 캘린더 등록 링크 ---------- */
function gcalUrl(conf) {
  const label = conf.date;
  let y = new Date().getFullYear();
  const ymatch = label.match(/(\d{4})/);
  if (ymatch) y = +ymatch[1];
  const md = label.match(/(\d{1,2})\s*[\/월.\-]\s*(\d{1,2})/);
  if (!md) return null;
  const mo = pad2(md[1]), da = pad2(md[2]);
  const tm = label.match(/(\d{1,2}):(\d{2})/);
  let dates;
  if (tm) {
    const s = y + mo + da + 'T' + pad2(tm[1]) + tm[2] + '00';
    const e = y + mo + da + 'T' + pad2((+tm[1] + 2) % 24) + tm[2] + '00'; // 기본 2시간
    dates = s + '/' + e;
  } else {
    const nd = new Date(y, +md[1] - 1, +md[2] + 1);
    dates = y + mo + da + '/' +
      nd.getFullYear() + pad2(nd.getMonth() + 1) + pad2(nd.getDate()); // 종일
  }
  return 'https://calendar.google.com/calendar/render?action=TEMPLATE' +
    '&text=' + encodeURIComponent('⚔️ 🪨석기시대 정기공격') +
    '&dates=' + dates +
    (conf.loc ? '&location=' + encodeURIComponent(conf.loc) : '') +
    '&ctz=Asia/Seoul';
}

function addToCalendar(conf) {
  if (!conf || !conf.date) return;
  const url = gcalUrl(conf);
  if (!url) return alert('날짜 형식을 인식하지 못했어요 — 캘린더에 수동 등록 부탁!');
  window.open(url, '_blank');
}

let adminPin = '';
let galleryLoaded = false;
let hallLoaded = false;
let HALL = null;

/* ---------- 명예의전당 ---------- */
async function loadHall() {
  const feed = document.getElementById('hallFeed');
  feed.className = 'loading';
  feed.textContent = '전당을 불러오는 중…';
  try {
    HALL = await run('getHallData');
    hallLoaded = true;
    renderHall();
  } catch (e) {
    feed.textContent = '불러오기 실패: ' + (e.message || e);
  }
}

function renderHall() {
  const me = getMe();
  const w = document.getElementById('hallWinner');
  if (HALL.winner) {
    const pm = parseInt(HALL.winnerMonth.split('-')[1], 10);
    w.innerHTML = '<div class="confirm-banner">👑 ' + pm + '월 명예의 전당' +
      '<div class="cdate">' + esc(HALL.winner.title) + '</div>' +
      esc(HALL.winner.by) + ' · ' + HALL.winner.voters.length + '표</div>';
  } else {
    w.innerHTML = '';
  }

  const feed = document.getElementById('hallFeed');
  if (!HALL.entries.length) {
    feed.className = 'loading';
    feed.textContent = '이번 달 출품작이 아직 없습니다. 첫 주인공이 되어보자 🏆';
    return;
  }
  feed.className = '';
  feed.innerHTML = '';
  // 득표순 정렬
  HALL.entries.slice().sort(function(a, b) { return b.voters.length - a.voters.length; })
    .forEach(function(e, idx) {
      const c = document.createElement('div');
      c.className = 'feed-card';
      const th = document.createElement('div');
      th.className = 'hall-thumb';
      const img = document.createElement('img');
      img.loading = 'lazy';
      img.src = 'https://drive.google.com/thumbnail?id=' + e.fileId + '&sz=w800';
      img.onerror = function() {
        img.style.display = 'none';
        const p = document.createElement('div');
        p.className = 'processing';
        p.textContent = '영상 처리 중… 잠시 후 다시 열어보세요';
        th.appendChild(p);
      };
      th.appendChild(img);
      const badge = document.createElement('div');
      badge.className = 'play-badge';
      badge.textContent = '▶️';
      th.appendChild(badge);
      th.onclick = function() { playInApp(th, e.fileId, e.link); };
      c.appendChild(th);
      const meta = document.createElement('div');
      meta.className = 'feed-meta';
      meta.innerHTML =
        '<div class="fm-top">' + (idx === 0 && e.voters.length ? '👑 ' : '') + esc(e.title) + '</div>' +
        '<span class="fm-dim">' + esc(e.by) + ' 출품' +
        (e.voters.length ? ' · 🔥 ' + e.voters.map(esc).join(', ') : '') + '</span>';
      c.appendChild(meta);
      const vb = document.createElement('button');
      const mine = me && e.voters.indexOf(me) > -1;
      vb.className = 'vote-btn' + (mine ? ' on' : '');
      vb.textContent = mine
        ? '🔥 투표함 (' + e.voters.length + ') — 탭하면 취소'
        : '🔥 이 영상에 투표 (' + e.voters.length + ')';
      vb.onclick = function() { voteHallClick(e.fileId, vb); };
      c.appendChild(vb);
      if (e.by === me || ME.isAdmin) {
        const del = document.createElement('button');
        del.className = 'vote-btn';
        del.textContent = '🗑️ 삭제';
        del.onclick = function() { deleteHall(e.fileId); };
        c.appendChild(del);
      }
      feed.appendChild(c);
    });
}

async function deleteHall(fileId) {
  if (!confirm('이 영상을 삭제할까요? 되돌릴 수 없어요.')) return;
  try {
    HALL = await run('deleteHallEntry', fileId, getMe(), ME.token);
    renderHall();
  } catch (e) {
    alert(e.message || e);
  }
}

async function voteHallClick(fileId, btn) {
  const me = getMe();
  if (!me) return alert('상단에서 이름을 먼저 선택하세요.');
  btn.disabled = true;
  try {
    HALL = await run('voteHall', fileId, me, ME.token);
    renderHall();
  } catch (e) {
    alert(e.message || e);
    btn.disabled = false;
  }
}

function playInApp(thumb, fileId, link) {
  // API 키가 있으면 네이티브 video로 인앱 재생 (모바일에서 안 짤림)
  if (ME.driveApiKey) {
    const v = document.createElement('video');
    v.className = 'hall-video';
    v.controls = true;
    v.autoplay = true;
    v.playsInline = true;
    v.setAttribute('webkit-playsinline', '');
    v.src = 'https://www.googleapis.com/drive/v3/files/' + fileId +
      '?alt=media&key=' + ME.driveApiKey;
    v.onerror = function() { window.open(link, '_blank'); }; // 실패 시 Drive로
    thumb.replaceWith(v);
  } else {
    // 키 미설정 → iframe 임베드 (데스크톱은 OK, 모바일은 확대 이슈 가능)
    const wrap = document.createElement('div');
    wrap.style.cssText = 'position:relative;aspect-ratio:16/9;background:#000';
    const ifr = document.createElement('iframe');
    ifr.className = 'hall-video';
    ifr.src = 'https://drive.google.com/file/d/' + fileId + '/preview';
    ifr.allow = 'autoplay; fullscreen';
    wrap.appendChild(ifr);
    thumb.replaceWith(wrap);
  }
}

function toggleHallForm() {
  const f = document.getElementById('hallForm');
  f.style.display = f.style.display === 'none' ? 'block' : 'none';
}

(function() {
  const input = document.getElementById('hallFile');
  input.addEventListener('change', function() {
    const f = input.files[0];
    if (!f) return;
    document.getElementById('hallDrop').style.display = 'none';
    document.getElementById('hallName').textContent = f.name;
    document.getElementById('hallSub').textContent =
      (f.size / 1048576).toFixed(1) + 'MB · 탭하면 다시 선택';
    document.getElementById('hallSel').style.display = 'flex';
  });
})();

async function submitHall() {
  const me = getMe();
  const file = document.getElementById('hallFile').files[0];
  const title = document.getElementById('hallTitle').value.trim();
  const btn = document.getElementById('hallBtn');
  const bar = document.getElementById('hallBar');
  const fill = bar.querySelector('i');
  const st = document.getElementById('hallStatus');

  if (!me) return alert('상단에서 이름을 먼저 선택하세요.');
  if (!file) return alert('영상을 선택하세요.');
  if (!title) return alert('제목을 입력하세요.');

  btn.disabled = true;
  bar.style.display = 'block';
  st.className = 'status';
  try {
    const mime = file.type || 'application/octet-stream';
    const fileId = await uploadFileSmart('startHallUpload',
      [file.name, mime, file.size], file, st, fill);
    st.textContent = '전당에 새기는 중…';
    HALL = await run('finalizeHallEntry', fileId, title, me, ME.token);
    fill.style.width = '100%';
    st.className = 'status ok';
    st.textContent = '✓ 출품 완료!';
    document.getElementById('hallFile').value = '';
    document.getElementById('hallTitle').value = '';
    document.getElementById('hallSel').style.display = 'none';
    document.getElementById('hallDrop').style.display = 'block';
    document.getElementById('hallForm').style.display = 'none';
    renderHall();
  } catch (e) {
    st.className = 'status err';
    st.textContent = '실패: ' + (e.message || e);
  } finally {
    btn.disabled = false;
  }
}


/* ---------- 벽화 갤러리 ---------- */
async function deleteGalleryItem(fileId, card) {
  if (!confirm('이 사진을 삭제할까요? 되돌릴 수 없어요.')) return;
  card.style.opacity = '.4';
  try {
    await run('deleteProof', fileId, getMe(), ME.token);
    card.remove();
    galleryLoaded = false;
    renderCertLine();
  } catch (e) {
    alert(e.message || e);
    card.style.opacity = '1';
  }
}

let galleryOffset = 0;
const GALLERY_PAGE = 12;

function makeGalleryCard(it) {
  const cell = document.createElement('div');
  cell.className = 'grid-cell';
  const img = document.createElement('img');
  img.loading = 'lazy';
  img.src = 'https://drive.google.com/thumbnail?id=' + it.fileId + '&sz=w400';
  img.onerror = function() { img.style.opacity = '.2'; };
  cell.appendChild(img);

  const info = document.createElement('div');
  info.className = 'cell-info';
  info.innerHTML =
    '<div class="ci-loc">📍 ' + esc(it.loc) + '</div>' +
    '<div>🧗 ' + esc(it.people) + '</div>' +
    '<div class="ci-dim">' + esc(it.actDate || it.when) + ' · ' + esc(it.by) + '</div>';

  const openBtn = document.createElement('button');
  openBtn.className = 'open-link';
  openBtn.textContent = '원본 보기';
  openBtn.onclick = function(e) { e.stopPropagation(); window.open(it.link, '_blank'); };
  info.appendChild(openBtn);

  if (it.by === getMe() || ME.isAdmin) {
    const del = document.createElement('button');
    del.textContent = '🗑️ 삭제';
    del.onclick = function(e) { e.stopPropagation(); deleteGalleryItem(it.fileId, cell); };
    info.appendChild(del);
  }
  cell.appendChild(info);

  cell.onclick = function() { cell.classList.toggle('show'); };
  return cell;
}

async function loadGallery(more) {
  const feed = document.getElementById('galleryFeed');
  if (!more) {
    galleryOffset = 0;
    feed.className = 'loading';
    feed.textContent = '벽화를 불러오는 중…';
  }
  try {
    const res = await run('getGallery', GALLERY_PAGE, galleryOffset);
    galleryLoaded = true;
    const oldBtn = document.getElementById('galleryMore');
    if (oldBtn) oldBtn.remove();

    if (!more) {
      if (!res.items.length) {
        feed.textContent = '아직 새겨진 벽화가 없습니다';
        return;
      }
      feed.className = '';
      feed.innerHTML = '';
    }
    res.items.forEach(function(it) { feed.appendChild(makeGalleryCard(it)); });
    galleryOffset += res.items.length;

    if (res.hasMore) {
      const btn = document.createElement('button');
      btn.id = 'galleryMore';
      btn.className = 'btn2';
      btn.textContent = '더 보기';
      btn.onclick = function() { loadGallery(true); };
      feed.appendChild(btn);
    }
  } catch (e) {
    feed.textContent = '불러오기 실패: ' + (e.message || e);
  }
}

async function doConfirm(month, dateText) {
  const me = getMe();
  let loc = '';
  if (dateText) {
    loc = prompt('📍 모임 위치 입력 (예: 더클라임 강남)') || '';
    if (!loc.trim()) return alert('위치를 입력해야 확정할 수 있어요.');
  }
  if (!adminPin) {
    adminPin = prompt(dateText ? '확정하려면 관리자 PIN 입력' : '확정을 취소하려면 관리자 PIN 입력') || '';
    if (!adminPin) return;
  }
  try {
    DATA.raidMonths = await run('confirmDate', month, dateText, loc.trim(), me, adminPin);
    renderVotes();
    renderHome();
  } catch (e) {
    adminPin = '';
    alert(e.message || e);
  }
}

async function voteRaid(month, dateText, card) {
  const me = getMe();
  card.style.opacity = '.5';
  try {
    const r = await run('toggleVote', 'raid', dateText, me, ME.token, month);
    const g = (DATA.raidMonths || []).find(function(x) { return x.month === month; });
    if (g) { const row = g.options.find(function(x) { return x.date === dateText; }); if (row) row.voters = r.voters; }
    renderVotes();
    renderHome();
  } catch (e) {
    alert(e.message || e);
    card.style.opacity = '1';
  }
}

async function voteFlash(dateText, card) {
  const me = getMe();
  card.style.opacity = '.5';
  try {
    const r = await run('toggleVote', 'disaster', dateText, me, ME.token);
    const row = (DATA.disaster || []).find(function(x) { return x.date === dateText; });
    if (row) row.voters = r.voters;
    renderVotes();
    renderHome();
  } catch (e) {
    alert(e.message || e);
    card.style.opacity = '1';
  }
}

/* ---------- 참여 날짜 선택 ---------- */
function buildDateSelect(kind) {
  const sel = document.getElementById(kind + 'Date');
  const custom = document.getElementById(kind + 'DateCustom');
  sel.innerHTML = '<option value="">날짜 선택</option>';
  (DATA.raidMonths || []).forEach(function(g) {
    g.options.forEach(function(r) { addOpt(sel, r.date, '⚔️ ' + fmtVoteDate(r)); }); // 값은 원본(투표 키), 표기만 표준화
  });
  (DATA.disaster || []).forEach(function(r) { addOpt(sel, r.date, '🌋 ' + fmtVoteDate(r)); });
  addOpt(sel, '__custom', '📅 직접 선택');
  sel.addEventListener('change', function() {
    custom.style.display = sel.value === '__custom' ? 'block' : 'none';
  });
}
function addOpt(sel, val, label) {
  const o = document.createElement('option');
  o.value = val; o.textContent = label;
  sel.appendChild(o);
}

// 날짜 텍스트 → 'YYYY-MM' (Drive 폴더 라우팅용)
function parseYM(label) {
  var m = label.match(/(\d{4})\s*[.\-\/년]\s*(\d{1,2})/);
  if (m) return m[1] + '-' + pad2(m[2]);
  m = label.match(/(\d{1,2})\s*[\/월]/);
  if (m) return new Date().getFullYear() + '-' + pad2(m[1]);
  return null;
}
function pad2(n) { return ('0' + n).slice(-2); }

function getActivityDate(kind) {
  const sel = document.getElementById(kind + 'Date');
  if (!sel.value) return null;
  if (sel.value === '__custom') {
    const v = document.getElementById(kind + 'DateCustom').value; // yyyy-mm-dd
    if (!v) return null;
    return { label: v, ym: v.slice(0, 7) };
  }
  const today = new Date();
  const fallback = today.getFullYear() + '-' + pad2(today.getMonth() + 1);
  return { label: sel.value, ym: parseYM(sel.value) || fallback };
}

/* ---------- 인증 (사진/영상 공통) ---------- */
function buildChips(id) {
  const box = document.getElementById(id);
  box.innerHTML = '';
  DATA.members.forEach(function(m) {
    const c = document.createElement('span');
    const done = !!(DATA.certified && DATA.certified[m]);
    c.className = 'chip' + (done ? ' done' : '');
    c.dataset.name = m;
    c.textContent = done ? m + ' ✓' : m;
    c.onclick = function() { c.classList.toggle('on'); };
    box.appendChild(c);
  });
}

function renderCertLine() {
  const el = document.getElementById('certLine');
  const done = DATA.members.filter(function(m) { return DATA.certified[m]; });
  const mm = parseInt((DATA.month || '').split('-')[1], 10);
  el.innerHTML = '🗿 ' + mm + '월 벽화 인증: <b>' + done.length + '</b> / ' +
    DATA.members.length + '명 완료' +
    (done.length ? '<br>✓ ' + done.map(esc).join(' · ') : '');
}

function openAlbum() {
  if (DATA.shareUrl) {
    window.open(DATA.shareUrl, '_blank');
  } else {
    alert('앨범 링크가 아직 설정되지 않았어요. 추장에게 문의!');
  }
}

(function() {
  const input = document.getElementById('photoFile');
  input.addEventListener('change', function() {
    const f = input.files[0];
    if (!f) return;
    document.getElementById('photoDrop').style.display = 'none';
    document.getElementById('photoThumb').src = URL.createObjectURL(f);
    document.getElementById('photoName').textContent = f.name;
    document.getElementById('photoSub').textContent =
      (f.size / 1048576).toFixed(1) + 'MB · 탭하면 다시 선택';
    document.getElementById('photoSel').style.display = 'flex';
  });
})();

async function submitProof(kind) {
  const me = getMe();
  const file = document.getElementById(kind + 'File').files[0];
  const loc = document.getElementById(kind + 'Loc').value.trim();
  const chips = Array.prototype.slice.call(document.querySelectorAll('#' + kind + 'Chips .chip.on'))
    .map(function(c) { return c.dataset.name; });
  const btn = document.getElementById(kind + 'Btn');
  const bar = document.getElementById(kind + 'Bar');
  const fill = bar.querySelector('i');
  const st = document.getElementById(kind + 'Status');

  const act = getActivityDate(kind);

  if (!me) return alert('상단에서 이름을 먼저 선택하세요.');
  if (!file) return alert('파일을 선택하세요.');
  if (!act) return alert('참여 날짜를 선택하세요.');
  if (!loc) return alert('장소를 입력하세요.');
  if (chips.indexOf(me) < 0) chips.unshift(me);

  btn.disabled = true;
  bar.style.display = 'block';
  st.className = 'status';
  try {
    const mime = file.type || 'application/octet-stream';
    const fileId = await uploadFileSmart('startUpload',
      [file.name, mime, file.size, act.ym], file, st, fill);
    st.textContent = '벽화에 새기는 중…';
    const result = await run('finalizeProof', fileId, {
      kind: kind === 'photo' ? '사진' : '영상',
      mimeType: mime, fileSize: file.size,
      participants: chips, location: loc, uploader: me,
      activityLabel: act.label
    }, ME.token);
    fill.style.width = '100%';
    st.className = 'status ok';
    st.textContent = '✓ 완료! Drive 저장 · Photos: ' + result.photos;
    if (kind === 'photo') {
      chips.forEach(function(n) { DATA.certified[n] = true; });
      buildChips('photoChips');
      renderCertLine();
      renderHome();
      galleryLoaded = false;
    }
    resetForm(kind);
  } catch (e) {
    st.className = 'status err';
    st.textContent = '실패: ' + (e.message || e);
  } finally {
    btn.disabled = false;
  }
}

function resetForm(kind) {
  document.getElementById(kind + 'File').value = '';
  document.getElementById(kind + 'Loc').value = '';
  document.getElementById(kind + 'Date').value = '';
  document.getElementById(kind + 'DateCustom').value = '';
  document.getElementById(kind + 'DateCustom').style.display = 'none';
  document.getElementById('photoSel').style.display = 'none';
  document.getElementById('photoDrop').style.display = 'block';
  document.querySelectorAll('#' + kind + 'Chips .chip.on').forEach(function(c) { c.classList.remove('on'); });
}

/* ---------- 유틸 ---------- */
function toB64(buf) {
  const bytes = new Uint8Array(buf);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 32768) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 32768));
  }
  return btoa(bin);
}
function esc(s) {
  return String(s).replace(/[&<>"']/g, function(c) {
    return { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c];
  });
}

/* ==================== 투표 월별 필터 (#14) ==================== */
function voteMonthValue() {
  const el = document.getElementById('voteMonth');
  return el ? el.value : '';
}

function buildMonthFilter() {
  const el = document.getElementById('voteMonth');
  el.innerHTML = '';
  addOpt(el, '', '전체 월');
  const months = DATA.months || [];
  months.forEach(function (m) { addOpt(el, m, '📆 ' + m); });
  // 기본값: 이번 달 데이터가 있으면 이번 달
  const now = new Date();
  const nowYM = now.getFullYear() + '-' + pad2(now.getMonth() + 1);
  if (months.indexOf(nowYM) > -1) el.value = nowYM;
  el.onchange = renderVotes;
}

/* ==================== 더보기 탭 (#18 #20 #21 #23 #24) ==================== */
let moreLoaded = false;

function applyAdminUI() {
  // 관리자 전용 섹션 노출 제어
  document.querySelectorAll('.admin-only').forEach(function (el) {
    el.style.display = ME.isAdmin ? '' : 'none';
  });
}

function loadMore() {
  moreLoaded = true;
  loadNotices();
  loadStats();
  loadArchive();
  if (ME.isAdmin) {
    loadSettle();
    buildResetPinSelect();
  }
}

/* ---------- 공지사항 (#24) ---------- */
async function loadNotices() {
  const box = document.getElementById('noticeList');
  box.className = 'loading';
  box.textContent = '공지를 불러오는 중…';
  try {
    const res = await run('getNotices', 20);
    renderNotices(res.items);
  } catch (e) {
    box.textContent = '불러오기 실패: ' + (e.message || e);
  }
}

function renderNotices(items) {
  const box = document.getElementById('noticeList');
  if (!items.length) {
    box.className = 'loading';
    box.textContent = '등록된 공지가 없어요';
    return;
  }
  box.className = '';
  box.innerHTML = '';
  items.forEach(function (n) {
    const c = document.createElement('div');
    c.className = 'notice-card';
    c.innerHTML = '<div class="nc-text">' + esc(n.text).replace(/\n/g, '<br>') + '</div>' +
      '<div class="nc-meta">' + esc(n.by) + ' · ' + esc(n.when) + '</div>';
    if (ME.isAdmin) {
      const del = document.createElement('button');
      del.className = 'mini-btn';
      del.textContent = '🗑️ 삭제';
      del.onclick = async function () {
        if (!confirm('이 공지를 삭제할까요?')) return;
        try {
          const res = await run('deleteNotice', n.row, n.when, getMe(), ME.token);
          renderNotices(res.items);
        } catch (e) { alert(e.message || e); }
      };
      c.appendChild(del);
    }
    box.appendChild(c);
  });
}

async function submitNotice() {
  const ta = document.getElementById('noticeText');
  const text = ta.value.trim();
  if (!text) return alert('공지 내용을 입력하세요.');
  const btn = document.getElementById('noticeBtn');
  btn.disabled = true;
  try {
    const res = await run('postNotice', text, getMe(), ME.token);
    ta.value = '';
    renderNotices(res.items);
  } catch (e) {
    alert(e.message || e);
  } finally {
    btn.disabled = false;
  }
}

/* ---------- 출석/인증 통계 (#20) ---------- */
async function loadStats() {
  const box = document.getElementById('statsBox');
  box.className = 'loading';
  box.textContent = '통계를 내는 중…';
  try {
    const s = await run('getStats');
    box.className = '';
    if (!s.months.length) { box.className = 'loading'; box.textContent = '아직 데이터가 없어요'; return; }
    const months = s.months.slice(-6); // 최근 6개월
    let html = '<div class="stats-scroll"><table class="stats-table"><thead><tr><th>부족원</th>';
    months.forEach(function (m) { html += '<th>' + esc(m.slice(2)) + '</th>'; }); // '26-07'
    html += '</tr></thead><tbody>';
    s.members.forEach(function (mb) {
      html += '<tr' + (mb.independent ? ' class="indep"' : '') + '><td>' +
        esc(mb.name) + (mb.independent ? ' <span class="dim">(독립)</span>' : '') + '</td>';
      months.forEach(function (m) {
        const c = s.cert[m] && s.cert[m][mb.name];
        const v = s.votes[m] && s.votes[m][mb.name];
        html += '<td>' + (c ? '📸' : '') + (v ? '🗳️' : '') + (!c && !v ? '·' : '') + '</td>';
      });
      html += '</tr>';
    });
    html += '</tbody></table></div><div class="dim" style="font-size:11.5px;margin-top:6px">📸 사진 인증 · 🗳️ 투표 참여 (최근 6개월)</div>';
    box.innerHTML = html;
  } catch (e) {
    box.textContent = '불러오기 실패: ' + (e.message || e);
  }
}

/* ---------- 역대 우승자 (#23) ---------- */
async function loadArchive() {
  const box = document.getElementById('archiveBox');
  box.className = 'loading';
  box.textContent = '기록을 꺼내는 중…';
  try {
    const res = await run('getHallArchive');
    if (!res.winners.length) { box.textContent = '아직 역대 우승 기록이 없어요'; return; }
    box.className = '';
    box.innerHTML = '';
    res.winners.forEach(function (w) {
      const c = document.createElement('div');
      c.className = 'notice-card';
      c.innerHTML = '<div class="nc-text">👑 <b>' + esc(w.ym) + '</b> — ' + esc(w.title) + '</div>' +
        '<div class="nc-meta">' + esc(w.by) + ' · 🔥 ' + w.voters.length + '표</div>';
      c.onclick = function () { window.open(w.link, '_blank'); };
      box.appendChild(c);
    });
  } catch (e) {
    box.textContent = '불러오기 실패: ' + (e.message || e);
  }
}

/* ---------- 정산 현황 (#21, 관리자) ---------- */
async function loadSettle() {
  const box = document.getElementById('settleBox');
  box.className = 'loading';
  box.textContent = '정산 현황을 여는 중…';
  try {
    const res = await run('getSettleStatus');
    if (!res.rows.length) { box.textContent = '아직 정산 기록이 없어요 (시트 메뉴에서 정산 실행)'; return; }
    box.className = '';
    let html = '<div class="dim" style="margin-bottom:6px">대상월: <b>' + esc(res.ym || '') + '</b></div>' +
      '<div class="stats-scroll"><table class="stats-table"><thead><tr><th>이름</th><th>인증</th><th>활동일</th><th>장소</th></tr></thead><tbody>';
    res.rows.forEach(function (r) {
      html += '<tr><td>' + esc(r.name) + '</td><td>' + esc(r.status) + '</td><td>' +
        esc(r.actDate) + '</td><td>' + esc(r.loc) + '</td></tr>';
    });
    html += '</tbody></table></div>';
    box.innerHTML = html;
  } catch (e) {
    box.textContent = '불러오기 실패: ' + (e.message || e);
  }
}

/* ---------- PIN 초기화 (#18, 관리자) ---------- */
function buildResetPinSelect() {
  const sel = document.getElementById('resetPinName');
  sel.innerHTML = '<option value="">부족원 선택</option>';
  DATA.members.forEach(function (m) { addOpt(sel, m, m); });
}

async function doResetPin() {
  const target = document.getElementById('resetPinName').value;
  if (!target) return alert('초기화할 부족원을 선택하세요.');
  if (!confirm(target + ' 님의 PIN을 초기화할까요?\n다음 로그인 때 새 PIN을 직접 설정하게 됩니다.')) return;
  try {
    await run('resetPin', target, getMe(), ME.token);
    alert('✓ ' + target + ' 님 PIN이 초기화되었어요.');
    document.getElementById('resetPinName').value = '';
  } catch (e) {
    alert(e.message || e);
  }
}
