/* ---------- 인앱 브라우저 → 기본 브라우저 자동 탈출 (#1) ----------
 * 카톡/기타 인앱에서 열리면 Safari·Chrome 등 기본 브라우저로 즉시 넘긴다.
 * 성공하면 사용자는 오버레이를 볼 일이 없고, 실패(자동 탈출 불가)할 때만 안내 오버레이 노출.
 */
function inAppKind() {
  const ua = navigator.userAgent || '';
  if (/KAKAOTALK/i.test(ua)) return 'kakao';
  if (/(Instagram|FBAN|FBAV|FB_IAB|Line\/|NAVER|DaumApps|Snapchat|everytimeApp)/i.test(ua)) return 'other';
  return null;
}
function isAndroid() { return /Android/i.test(navigator.userAgent); }

function openExternal() {
  const url = location.href;
  if (/KAKAOTALK/i.test(navigator.userAgent)) {
    // 카카오 공식 스킴 — 기본 브라우저로 URL 오픈 (iOS/Android 공통)
    location.href = 'kakaotalk://web/openExternal?url=' + encodeURIComponent(url);
  } else if (isAndroid()) {
    // 안드로이드 기타 인앱: intent 로 크롬 강제
    location.href = 'intent://' + url.replace(/^https?:\/\//, '') +
      '#Intent;scheme=https;package=com.android.chrome;end';
  }
}
function dismissKakao() {
  sessionStorage.setItem('stay_inapp', '1'); // 이 세션 동안 다시 권하지 않음
  document.getElementById('kakaoOverlay').style.display = 'none';
}

(function escapeInApp() {
  if (!inAppKind() || sessionStorage.getItem('stay_inapp')) return;
  openExternal(); // 즉시 탈출 시도
  // 1.4초 뒤에도 이 화면이 살아있으면(=탈출 실패) 안내 오버레이 표시
  setTimeout(function () {
    if (document.hidden) return; // 이미 기본 브라우저로 넘어감
    const ov = document.getElementById('kakaoOverlay');
    if (ov && !sessionStorage.getItem('stay_inapp')) ov.style.display = 'block';
  }, 1400);
})();

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

/* ---------- 인앱 UI: 토스트 & 모달 ----------
 * 브라우저 기본 alert/confirm/prompt 대신 테마에 맞는 컴포넌트 사용.
 */
function toast(msg, ok) {
  const root = document.getElementById('toastRoot');
  const t = document.createElement('div');
  t.className = 'toast' + (ok ? ' ok' : '');
  t.textContent = msg;
  root.appendChild(t);
  setTimeout(function () { t.classList.add('show'); }, 10);
  setTimeout(function () {
    t.classList.remove('show');
    setTimeout(function () { t.remove(); }, 300);
  }, 2600);
}

/* modal(opts) → Promise
 * opts: { title, message?, fields?: [{key,label,type,placeholder,value,inputmode}],
 *         confirmText?, cancelText?, busyText?,
 *         validate?(values) → 에러문자열|null,
 *         onConfirm?(values) → Promise (throw 시 모달 안에 에러 표시, 닫히지 않음) }
 * 취소/바깥탭 → null 로 resolve. 성공 → values 로 resolve.
 */
function modal(opts) {
  return new Promise(function (resolve) {
    const root = document.getElementById('modalRoot');
    root.innerHTML = '';
    const ov = document.createElement('div');
    ov.className = 'modal-ov';
    const card = document.createElement('div');
    card.className = 'modal-card';
    card.innerHTML = '<div class="modal-title">' + esc(opts.title || '') + '</div>' +
      (opts.message ? '<p class="modal-msg">' + esc(opts.message).replace(/\n/g, '<br>') + '</p>' : '');
    const inputs = {};
    (opts.fields || []).forEach(function (f) {
      const w = document.createElement('div');
      w.className = 'field';
      if (f.label) {
        const s = document.createElement('span');
        s.textContent = f.label;
        w.appendChild(s);
      }
      const inp = document.createElement('input');
      inp.type = f.type || 'text';
      if (f.placeholder) inp.placeholder = f.placeholder;
      if (f.value !== undefined) inp.value = f.value;
      if (f.inputmode) inp.setAttribute('inputmode', f.inputmode);
      inp.autocomplete = 'off';
      inputs[f.key] = inp;
      w.appendChild(inp);
      card.appendChild(w);
    });
    const st = document.createElement('div');
    st.className = 'status err';
    card.appendChild(st);
    const row = document.createElement('div');
    row.className = 'modal-btns';
    const cancel = document.createElement('button');
    cancel.className = 'btn2';
    cancel.textContent = opts.cancelText || '취소';
    const okb = document.createElement('button');
    okb.className = 'btn';
    okb.textContent = opts.confirmText || '확인';
    row.appendChild(cancel);
    row.appendChild(okb);
    card.appendChild(row);
    ov.appendChild(card);
    root.appendChild(ov);

    function close(v) { root.innerHTML = ''; resolve(v); }
    cancel.onclick = function () { close(null); };
    ov.onclick = function (e) { if (e.target === ov) close(null); };
    okb.onclick = async function () {
      const values = {};
      Object.keys(inputs).forEach(function (k) { values[k] = inputs[k].value; });
      if (opts.validate) {
        const err = opts.validate(values);
        if (err) { st.className = 'status err'; st.textContent = err; return; }
      }
      if (opts.onConfirm) {
        okb.disabled = true;
        st.className = 'status';
        st.textContent = opts.busyText || '처리 중…';
        try {
          await opts.onConfirm(values);
          close(values);
        } catch (e) {
          okb.disabled = false;
          st.className = 'status err';
          st.textContent = e.message || String(e);
        }
      } else {
        close(values);
      }
    };
    // 첫 입력 포커스 + Enter 로 확인
    const list = Object.keys(inputs).map(function (k) { return inputs[k]; });
    list.forEach(function (inp) {
      inp.addEventListener('keydown', function (e) { if (e.key === 'Enter') okb.click(); });
    });
    if (list[0]) setTimeout(function () { list[0].focus(); }, 60);
  });
}

// 확인 다이얼로그: 확인 → true, 취소 → false
function modalConfirm(message, opts) {
  opts = opts || {};
  return modal({
    title: opts.title || '확인',
    message: message,
    confirmText: opts.confirmText || '확인'
  }).then(function (v) { return v !== null; });
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

/* ---------- 업로드 진행 오버레이 (#3) ---------- */
function upShow(text) {
  upProgress(0, text || '업로드 준비 중…');
  document.getElementById('uploadOverlay').style.display = 'flex';
}
function upHide() { document.getElementById('uploadOverlay').style.display = 'none'; }
function upProgress(pct, text) {
  pct = Math.max(0, Math.min(100, Math.round(pct)));
  document.getElementById('upPct').textContent = pct + '%';
  document.getElementById('upFill').style.width = pct + '%';
  if (text != null) document.getElementById('upText').textContent = text;
}

/* ---------- 처리 중 오버레이 (정산 실행/지원대상/담당자/공지 등, 실퍼센트 없는 단발성 작업) ----------
 * 업로드 오버레이와 같은 카드를 재사용. 실제 진행률을 모르므로 CSS 트리클 애니메이션이
 * 0%→90%까지 감속하며 한 방향으로만 채우고 멈춘다(서버 응답 대기 표현). 성공 시 100%로
 * 스냅 후 닫고, 실패 시엔 완료 연출 없이 바로 닫는다.
 */
function busyShow(text) {
  document.getElementById('upPct').style.display = 'none';
  const fill = document.getElementById('upFill');
  fill.classList.remove('indet');
  fill.style.width = '0%';
  void fill.offsetWidth; // 강제 리플로우 — 클래스 재적용 시 애니메이션이 항상 처음부터 재생되도록
  fill.classList.add('indet');
  document.getElementById('upText').textContent = text || '처리 중…';
  document.getElementById('uploadOverlay').style.display = 'flex';
}
function busyUpdate(text) { document.getElementById('upText').textContent = text; }
// ok=false(실패)면 완료 연출 없이 즉시 닫음. ok=true(기본, 성공)면 막대를 100%로 채운 뒤 짧게 보여주고 닫음.
function busyHide(ok) {
  const overlay = document.getElementById('uploadOverlay');
  const fill = document.getElementById('upFill');
  if (ok === false) {
    overlay.style.display = 'none';
    fill.classList.remove('indet');
    document.getElementById('upPct').style.display = '';
    return;
  }
  fill.classList.remove('indet');
  fill.style.width = '100%';
  setTimeout(function () {
    overlay.style.display = 'none';
    document.getElementById('upPct').style.display = '';
  }, 280);
}

async function uploadFileSmart(startFnName, startArgs, file) {
  upProgress(0, '업로드 준비 중…');
  const uploadUrl = await run.apply(null, [startFnName].concat(startArgs));

  // 1차: 브라우저 → Drive 직접 업로드
  try {
    const id = await uploadDirect(uploadUrl, file, function(p) {
      upProgress(p * 92, '업로드 중… ' + Math.round(p * 100) + '%');
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
    upProgress(end / file.size * 92, '업로드 중… ' + Math.round(end / file.size * 100) + '%');
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
    driveApiKey: session.driveApiKey || '',  // 로그인 응답으로만 전달됨 (익명 노출 방지)
    certNudge: !!session.certNudge           // 완료된 모임 참여자인데 이번 달 인증 안 했으면 true (본인만)
  };
  apiSetSession(session); // 업로드 계열 API 의 name/token 자동 주입용
  document.getElementById('myName').value = session.name;
  document.getElementById('myNameLabel').textContent =
    session.name + (session.isAdmin ? ' 👑' : '');
  document.getElementById('loginScreen').style.display = 'none';

  buildChips('photoChips');
  buildDateSelect('photo');
  buildMonthFilter();
  buildGalleryFilters();
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

function changePinPrompt() {
  modal({
    title: '🔑 PIN 변경',
    fields: [
      { key: 'oldPin', label: '기존 PIN', type: 'password', inputmode: 'numeric' },
      { key: 'newPin', label: '새 PIN (4자리 이상)', type: 'password', inputmode: 'numeric' },
      { key: 'newPin2', label: '새 PIN 확인', type: 'password', inputmode: 'numeric' }
    ],
    confirmText: '변경',
    busyText: '변경 중…',
    validate: function (v) {
      if (!v.oldPin) return '기존 PIN을 입력하세요.';
      if (String(v.newPin).trim().length < 4) return '새 PIN은 4자리 이상이어야 해요.';
      if (v.newPin !== v.newPin2) return '새 PIN이 서로 달라요.';
      return null;
    },
    onConfirm: async function (v) {
      const res = await run('changePin', getMe(), v.oldPin, v.newPin, ME.token);
      localStorage.setItem('sga_session', JSON.stringify(res));
      ME.token = res.token;
      ME.driveApiKey = res.driveApiKey || ME.driveApiKey;
      apiSetSession(res);
      toast('✓ PIN이 변경되었어요.', true);
    }
  });
}

/* ---------- 탭 ---------- */
function setTab(t) {
  ['home','vote','photo','gallery','hall','more','admin'].forEach(function(k) {
    document.getElementById('tab-' + k).classList.toggle('on', k === t);
    document.getElementById('nav-' + k).classList.toggle('on', k === t);
  });
  if (t === 'gallery' && !galleryLoaded) loadGallery();
  if (t === 'hall' && !hallLoaded) loadHall();
  if (t === 'more' && !moreLoaded) loadMore();
  if (t === 'admin' && !adminLoaded) loadAdmin();
  if (t === 'photo') renderMyProofs(); // 내 인증 목록(취소용) 갱신
}

/* ---------- 내 인증 취소 (인증 탭) ----------
 * 이번 달 내가 업로더인 인증을 나열, 취소(삭제) 시 사진·기록이 지워지고
 * 참여자 전원의 이번 달 인증 여부가 갱신된다 (기존 deleteProof 재사용).
 */
async function renderMyProofs() {
  const box = document.getElementById('myProofs');
  if (!box || !getMe()) return;
  try {
    const res = await run('getGallery', 30, 0, DATA.month, getMe());
    const mine = res.items.filter(function (it) { return it.by === getMe(); });
    box.innerHTML = '';
    if (!mine.length) return;
    const head = document.createElement('div');
    head.className = 'myproof-head';
    head.textContent = '🧾 내가 올린 이번 달 인증 — 잘못 올렸으면 취소';
    box.appendChild(head);
    mine.forEach(function (it) {
      const row = document.createElement('div');
      row.className = 'myproof-row';
      const txt = document.createElement('span');
      txt.className = 'mp-txt';
      txt.textContent = (it.actDate || it.when) + ' · 📍 ' + it.loc + ' · 🧗 ' + it.people;
      row.appendChild(txt);
      const del = document.createElement('button');
      del.className = 'mini-btn';
      del.style.margin = '0';
      del.textContent = '취소';
      del.onclick = async function () {
        if (!(await modalConfirm('이 인증을 취소할까요?\n' + (it.actDate || '') + ' @ ' + it.loc +
          '\n\n사진과 기록이 삭제되고, 함께 태그된 참여자의 인증에서도 빠집니다.',
          { title: '🧾 인증 취소', confirmText: '취소하기' }))) return;
        del.disabled = true;
        try {
          await run('deleteProof', it.fileId, getMe(), ME.token);
          toast('인증을 취소했어요.', true);
          galleryLoaded = false;
          refreshCertified();
          renderMyProofs();
        } catch (e) {
          del.disabled = false;
          toast(e.message || e);
        }
      };
      row.appendChild(del);
      box.appendChild(row);
    });
  } catch (e) { /* 목록 실패는 조용히 — 인증 제출 기능엔 영향 없음 */ }
}

// 인증 취소/추가 후 서버 기준으로 인증 현황 재동기화
async function refreshCertified() {
  try {
    const d = await run('getInitData');
    DATA.certified = d.certified;
    buildChips('photoChips');
    renderCertLine();
    renderHome();
  } catch (e) {}
}

function goVote(cat) {
  setCategory(cat);
  setTab('vote');
}

function openNotion() {
  if (DATA.notionUrl) window.open(DATA.notionUrl, '_blank');
  else toast('안내문 링크가 아직 설정되지 않았어요. 추장에게 문의!');
}

function openChat() {
  if (DATA.openchatUrl) window.open(DATA.openchatUrl, '_blank');
  else toast('오픈카톡방 링크가 아직 설정되지 않았어요.');
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

// 개인 활동 요약 (#2): 로그인한 나의 이번 달 인증/투표 상태
function renderMySummary() {
  const el = document.getElementById('mySummary');
  if (!el) return;
  const me = getMe();
  const certed = !!(DATA.certified && DATA.certified[me]);
  const mm = parseInt((DATA.month || '').split('-')[1], 10);
  // 이번 달 정기공격에 내가 투표했는지
  const nowYM = DATA.month;
  let voted = false;
  (DATA.raidMonths || []).forEach(function (g) {
    if (g.month !== nowYM) return;
    g.options.forEach(function (o) { if (o.voters.indexOf(me) > -1) voted = true; });
  });
  el.innerHTML =
    '<div class="my-title">🙋 ' + esc(me) + ' 님의 ' + mm + '월</div>' +
    '<div class="my-badges">' +
      '<span class="badge ' + (certed ? 'on' : '') + '">' + (certed ? '✅' : '⬜') + ' 사진 인증</span>' +
      '<span class="badge ' + (voted ? 'on' : '') + '">' + (voted ? '✅' : '⬜') + ' 정기공격 투표</span>' +
    '</div>' +
    (!certed && ME.certNudge ? '<div class="my-hint">완료된 모임에 참여하셨네요 — 벽화 인증 잊지 마세요! 📸</div>' :
     !certed ? '<div class="my-hint">이번 달 벽화 인증을 아직 안 했어요 📸</div>' : '');
}

// 공지사항 홈 노출 (#2): getInitData의 notices(최신 3건) + 더보기 탭에서 등록/삭제 직후 동기화
function renderHomeNotices() {
  const el = document.getElementById('homeNotices');
  if (!el) return;
  const items = DATA.notices || [];
  if (!items.length) { el.innerHTML = ''; return; }
  el.innerHTML = '<div class="month-head" style="margin-top:0">📢 공지사항</div>' +
    items.map(function (n) {
      return '<div class="notice-card"><div class="nc-text">' +
        esc(n.text).replace(/\n/g, '<br>') + '</div>' +
        '<div class="nc-meta">' + esc(n.by) + ' · ' + esc(n.when) + '</div></div>';
    }).join('');
}

function renderHome() {
  renderDday();
  renderMySummary();
  renderHomeNotices();
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
  renderCalendar();
  if (category === 'raid') renderRaid(list);
  else renderDisaster(list);
}

/* ---------- 투표 달력 (#6) ----------
 * 선택 월(없으면 이번 달)의 일정을 한눈에. 정기공격 후보=점, 확정=꽉찬 원, 번개=주황 테두리.
 * 날짜 탭 → 아래 목록에서 해당 항목으로 스크롤.
 */
function renderCalendar() {
  const el = document.getElementById('voteCalendar');
  const now = new Date();
  const sel = voteMonthValue();
  const ym = /^\d{4}-\d{2}$/.test(sel) ? sel : (now.getFullYear() + '-' + pad2(now.getMonth() + 1));
  const y = +ym.slice(0, 4), mo = +ym.slice(5, 7);

  // 날짜별 마킹 수집
  const marks = {}; // iso → {raid, confirmed, flash, top}
  function mark(iso, key) { if (!iso) return; (marks[iso] = marks[iso] || {})[key] = true; }
  (DATA.raidMonths || []).forEach(function (g) {
    if (g.month !== ym) return;
    g.options.forEach(function (o) { if (o.dateInfo) mark(o.dateInfo.iso, 'raid'); });
    if (g.confirmed) {
      const ci = g.options.find(function (x) { return x.date === g.confirmed.date; });
      if (ci && ci.dateInfo) mark(ci.dateInfo.iso, 'confirmed');
    }
  });
  (DATA.disaster || []).forEach(function (r) { if (r.dateInfo && r.dateInfo.ym === ym) mark(r.dateInfo.iso, 'flash'); });

  const first = new Date(y, mo - 1, 1).getDay();
  const days = new Date(y, mo, 0).getDate();
  const todayIso = now.getFullYear() + '-' + pad2(now.getMonth() + 1) + '-' + pad2(now.getDate());
  const wd = ['일', '월', '화', '수', '목', '금', '토'];

  let html = '<div class="cal-head">' + mo + '월</div><div class="cal-grid">';
  wd.forEach(function (d, i) { html += '<div class="cal-wd' + (i === 0 ? ' sun' : '') + '">' + d + '</div>'; });
  for (let i = 0; i < first; i++) html += '<div></div>';
  for (let d = 1; d <= days; d++) {
    const iso = ym + '-' + pad2(d);
    const m = marks[iso] || {};
    const cls = ['cal-day'];
    if (m.confirmed) cls.push('confirmed');
    else if (m.raid) cls.push('raid');
    if (m.flash) cls.push('flash');
    if (iso === todayIso) cls.push('today');
    const dot = (m.raid || m.confirmed || m.flash) ? '<span class="cal-dot"></span>' : '';
    html += '<div class="' + cls.join(' ') + '" data-iso="' + iso + '">' + d + dot + '</div>';
  }
  html += '</div>';
  el.innerHTML = html;

  // 날짜 탭 → 해당 항목으로 스크롤 (표시된 카드 중 날짜 일치)
  el.querySelectorAll('.cal-day').forEach(function (c) {
    if (!c.querySelector('.cal-dot')) return;
    c.onclick = function () {
      const iso = c.dataset.iso;
      // 번개 표시면 disaster 탭으로, 아니면 raid 유지
      const m = marks[iso] || {};
      if (m.flash && !m.raid && !m.confirmed && category !== 'disaster') { setCategory('disaster'); }
      else if ((m.raid || m.confirmed) && category !== 'raid') { setCategory('raid'); }
      setTimeout(function () {
        const card = Array.prototype.find.call(document.querySelectorAll('#voteList .vote-card .date'),
          function (e) { return e.textContent.indexOf(iso) > -1 || (e.textContent.match(/\d{4}-\d{2}-\d{2}/) || [''])[0] === iso; });
        if (card) card.closest('.vote-card').scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 30);
    };
  });
}

/* ---------- 정기공격 (월별) ---------- */
function renderRaid(list) {
  const me = getMe();
  const isAdmin = ME.isAdmin;
  const sel = voteMonthValue();
  const all = (DATA.raidMonths || []).filter(function (g) { return !sel || g.month === sel; });
  if (!all.length) {
    list.insertAdjacentHTML('beforeend', '<div class="loading">' +
      (sel ? sel + ' 정기공격 일정이 없어요' : '등록된 정기공격 일정이 없어요') + '</div>');
    return;
  }
  // 마감 자동 정리(#3): 특정 월 선택 시 전부 표시, '전체'면 지난 달은 접기
  const past = sel ? [] : all.filter(function (g) { return isPastMonth_(g.month); });
  const active = sel ? all : all.filter(function (g) { return !isPastMonth_(g.month); });
  const months = showPastVotes ? active.concat(past) : active;
  if (!months.length && past.length) {
    list.insertAdjacentHTML('beforeend', '<div class="loading">진행 중인 정기공격이 없어요</div>');
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
      // 확정 없이 마감된 채 방치된 달 정리 (#완료처리): 관리자만
      if (g.closed && isAdmin) {
        const voidBtn = document.createElement('button');
        voidBtn.className = 'btn2';
        voidBtn.style.marginBottom = '10px';
        voidBtn.textContent = '🚫 이번 달 종료 (모임 없음)';
        voidBtn.onclick = function () { doCompleteRaid(g.month); };
        list.appendChild(voidBtn);
      }
    }

    if (g.confirmed) {
      const b = document.createElement('div');
      b.className = 'confirm-banner';
      const cinfo = g.options.find(function (x) { return x.date === g.confirmed.date; });
      const cdisp = cinfo ? fmtVoteDate(cinfo) : g.confirmed.date;
      const expired = !!(cinfo && cinfo.dateInfo && isPastIso_(cinfo.dateInfo.iso)); // 완료 처리 (#완료처리)
      b.innerHTML = '📌 ' + mm + '월 확정<div class="cdate">' + esc(cdisp) + '</div>' +
        (g.confirmed.loc ? '📍 ' + esc(g.confirmed.loc) + '<br>' : '') +
        (g.confirmed.note ? '<div class="cnote">📝 ' + esc(g.confirmed.note).replace(/\n/g, '<br>') + '</div>' : '') +
        (expired ? '<div class="warn">⏰ 모임 날짜가 지났어요 — 완료 처리해 주세요</div>' : '') +
        '투표 마감';
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
        shareText('⚔️ ' + mm + '월 정기공격 확정!\n📅 ' + (opt.dateInfo ? opt.dateInfo.display : g.confirmed.date) +
          (g.confirmed.loc ? '\n📍 ' + g.confirmed.loc : '') +
          (g.confirmed.note ? '\n📝 ' + g.confirmed.note : '') +
          (opt.voters.length ? '\n🧗 참여(' + opt.voters.length + '): ' + opt.voters.join(', ') : ''),
          '확정 소식 복사 완료!');
      };
      b.appendChild(sbtn);
      if (isAdmin) {
        // 확정 상태에서도 위치·설명 수정 (#2): 같은 날짜로 다시 확정
        const ed = document.createElement('button');
        ed.className = 'mini-btn';
        ed.textContent = '📝 위치·설명 수정';
        ed.onclick = function() { doConfirm(g.month, g.confirmed.date); };
        b.appendChild(ed);
        const u = document.createElement('button');
        u.className = 'mini-btn';
        u.textContent = '확정 취소';
        u.onclick = function() { doConfirm(g.month, ''); };
        b.appendChild(u);
        const done = document.createElement('button');
        done.className = 'mini-btn';
        done.textContent = '✅ 완료 처리';
        done.onclick = function() { doCompleteRaid(g.month); };
        b.appendChild(done);
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
      // 날짜는 윗줄, 위치(후보별)는 아랫줄 — 번개 카드와 동일한 리듬
      const dateTxt = r.dateInfo ? r.dateInfo.display : r.date;
      card.innerHTML =
        '<div class="top"><span class="date">' + esc(dateTxt) + (isC ? ' ✅' : '') + '</span>' +
        '<span class="count">' + r.voters.length + '명</span></div>' +
        (r.loc ? '<div class="vloc">📍 ' + esc(r.loc) + '</div>' : '') +
        (r.voters.length ? '<div class="voters">' + r.voters.map(esc).join(' · ') + '</div>' : '') +
        (!blocked && mine ? '<div class="hint">✓ 참여 중 — 탭하면 취소</div>' : '');
      if (!blocked) {
        card.onclick = function() { voteRaid(g.month, r.date); };
      }
      // 관리자: 확정 전이면 확정/수정/삭제 노출 (확정되면 월 잠금 → 숨김)
      if (!g.confirmed && isAdmin) {
        const cb = document.createElement('button');
        cb.className = 'mini-btn';
        cb.textContent = '📌 이 날짜로 확정';
        cb.onclick = function(e) { e.stopPropagation(); doConfirm(g.month, r.date); };
        card.appendChild(cb);
        const ed = document.createElement('button');
        ed.className = 'mini-btn';
        ed.textContent = '✏️ 수정';
        ed.onclick = function(e) { e.stopPropagation(); editRaidOptionPrompt(g.month, r); };
        card.appendChild(ed);
        const del = document.createElement('button');
        del.className = 'mini-btn';
        del.textContent = '🗑️ 삭제';
        del.onclick = function(e) { e.stopPropagation(); deleteRaidOptionClick(g.month, r.date); };
        card.appendChild(del);
      }
      list.appendChild(card);
    });
  });
  if (past.length && !sel) appendPastToggle_(list, past.length);
}

/* ---------- 자연재해 (번개) ---------- */
function renderDisaster(list) {
  const me = getMe();
  const isAdmin = ME.isAdmin;
  const sel = voteMonthValue();
  const filtered = (DATA.disaster || []).filter(function (r) {
    return !sel || (r.dateInfo && r.dateInfo.ym === sel); // 월 파싱 안 되는 라벨은 '전체'에서만 노출
  });

  const addBtn = document.createElement('button');
  addBtn.className = 'btn2';
  addBtn.style.marginBottom = '10px';
  addBtn.textContent = '⚡ 번개 열기';
  addBtn.onclick = openFlashPrompt;
  list.appendChild(addBtn);

  // 마감 자동 정리(#3): 지난 번개(오늘 이전)는 접기
  const past = sel ? [] : filtered.filter(function (r) { return isPastFlash_(r); });
  const active = sel ? filtered : filtered.filter(function (r) { return !isPastFlash_(r); });
  const rows = showPastVotes ? active.concat(past) : active;

  if (!rows.length) {
    list.insertAdjacentHTML('beforeend', '<div class="loading">' +
      (sel ? sel + '에 열린 번개가 없어요' : (past.length ? '진행 중인 번개가 없어요' : '아직 열린 번개가 없어요')) + '</div>');
    if (past.length && !sel) appendPastToggle_(list, past.length);
    return;
  }

  rows.forEach(function(r) {
    const mine = me && r.voters.indexOf(me) > -1;
    const card = document.createElement('div');
    card.className = 'vote-card' + (mine ? ' mine' : '');
    // 날짜는 윗줄, 위치는 아랫줄 — 정기공격 카드와 폭/리듬 통일
    const dateTxt = r.dateInfo ? r.dateInfo.display : r.date;
    const expired = isPastFlash_(r); // 완료 처리 안 된 채 기한이 지난 경우 표시 (#완료처리)
    card.innerHTML =
      '<div class="top"><span class="date">' + esc(dateTxt) +
      (expired ? ' <span class="tag-over">⏰ 기한 지남</span>' : '') + '</span>' +
      '<span class="count">' + r.voters.length + '명</span></div>' +
      (r.loc ? '<div class="vloc">📍 ' + esc(r.loc) + '</div>' : '') +
      (r.voters.length ? '<div class="voters">' + r.voters.map(esc).join(' · ') + '</div>' : '') +
      (mine ? '<div class="hint">✓ 참여 중 — 탭하면 취소</div>' : '');
    card.onclick = function() { voteFlash(r.date); };
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
    // flash_owners에 기록이 없으면(마이그레이션 이전 번개 등) B열 폴백과 동일하게 첫 투표자를 개설자로 본다.
    const owner = (DATA.flashOwners && DATA.flashOwners[r.date]) || (r.voters && r.voters[0]) || '';
    if (owner === me || isAdmin) {
      const ed = document.createElement('button');
      ed.className = 'mini-btn';
      ed.textContent = '✏️ 수정';
      ed.onclick = function(e) { e.stopPropagation(); editFlashPrompt(r); };
      card.appendChild(ed);
      const done = document.createElement('button');
      done.className = 'mini-btn';
      done.textContent = '✅ 완료 처리';
      done.onclick = function(e) { e.stopPropagation(); doCompleteFlash(r.date); };
      card.appendChild(done);
      const db = document.createElement('button');
      db.className = 'mini-btn';
      db.textContent = '🗑️ 번개 취소';
      db.onclick = function(e) { e.stopPropagation(); deleteFlashClick(r.date); };
      card.appendChild(db);
    }
    list.appendChild(card);
  });
  if (past.length && !sel) appendPastToggle_(list, past.length);
}

/* ---------- 마감 자동 정리 헬퍼 (#3) ---------- */
let showPastVotes = false;

function isPastMonth_(ym) {
  const now = new Date();
  return ym < (now.getFullYear() + '-' + pad2(now.getMonth() + 1));
}
function isPastIso_(iso) { // 완료 처리 배지/버튼 판정에도 재사용 (#완료처리)
  if (!iso) return false;
  const now = new Date();
  return iso < (now.getFullYear() + '-' + pad2(now.getMonth() + 1) + '-' + pad2(now.getDate()));
}
function isPastFlash_(r) {
  return (r.dateInfo && r.dateInfo.iso) ? isPastIso_(r.dateInfo.iso) : false; // 날짜 못 읽으면 유지
}
function appendPastToggle_(list, n) {
  const b = document.createElement('button');
  b.className = 'btn2';
  b.style.marginTop = '4px';
  b.textContent = showPastVotes ? '지난 일정 접기' : '🕓 지난 일정 ' + n + '개 보기';
  b.onclick = function () { showPastVotes = !showPastVotes; renderVotes(); };
  list.appendChild(b);
}

/* ---------- 번개(자연재해) 등록/수정/완료/삭제 ---------- */
function openFlashPrompt() {
  const today = new Date();
  modal({
    title: '⚡ 번개 열기',
    fields: [
      { key: 'date', label: '날짜', type: 'date',
        value: today.getFullYear() + '-' + pad2(today.getMonth() + 1) + '-' + pad2(today.getDate()) },
      { key: 'time', label: '시간 (선택)', type: 'time' },
      { key: 'loc', label: '위치', type: 'text', placeholder: '예: 더클라임 강남' }
    ],
    confirmText: '⚡ 번개 열기',
    busyText: '여는 중…',
    validate: function (v) {
      if (!v.date) return '날짜를 선택하세요.';
      if (!v.loc.trim()) return '위치를 입력하세요.';
      return null;
    },
    onConfirm: async function (v) {
      const dateText = v.date + (v.time ? ' ' + v.time : ''); // '2026-07-15 20:00' — 표준 표기로 표시됨
      DATA.disaster = await run('addFlash', dateText, v.loc.trim(), getMe(), ME.token);
      if (!DATA.flashOwners) DATA.flashOwners = {};
      DATA.flashOwners[dateText + ' @ ' + v.loc.trim()] = getMe();
      renderVotes();
      renderHome();
      toast('⚡ 번개를 열었어요! 같이 갈 사람을 모아보세요.', true);
    }
  });
}

async function deleteFlashClick(dateText) {
  if (!(await modalConfirm('이 번개를 취소할까요?'))) return;
  try {
    DATA.disaster = await run('deleteFlash', dateText, getMe(), ME.token);
    if (DATA.flashOwners) delete DATA.flashOwners[dateText];
    renderVotes();
    renderHome();
  } catch (e) {
    toast(e.message || e);
  }
}

// 번개 수정: 날짜/시간/위치만 변경 (투표자는 유지)
function editFlashPrompt(r) {
  modal({
    title: '✏️ 번개 수정',
    fields: [
      { key: 'date', label: '날짜', type: 'date', value: r.dateInfo ? r.dateInfo.iso : '' },
      { key: 'time', label: '시간 (선택)', type: 'time', value: (r.dateInfo && r.dateInfo.time) || '' },
      { key: 'loc', label: '위치', type: 'text', value: r.loc || '', placeholder: '예: 더클라임 강남' }
    ],
    confirmText: '수정 완료',
    busyText: '수정하는 중…',
    validate: function (v) {
      if (!v.date) return '날짜를 선택하세요.';
      if (!v.loc.trim()) return '위치를 입력하세요.';
      return null;
    },
    onConfirm: async function (v) {
      const newDateText = v.date + (v.time ? ' ' + v.time : '');
      const newLabel = newDateText + ' @ ' + v.loc.trim();
      DATA.disaster = await run('editFlash', r.date, newDateText, v.loc.trim(), getMe(), ME.token);
      if (DATA.flashOwners && r.date in DATA.flashOwners) {
        DATA.flashOwners[newLabel] = DATA.flashOwners[r.date];
        if (newLabel !== r.date) delete DATA.flashOwners[r.date];
      }
      renderVotes();
      renderHome();
      toast('✏️ 번개 정보를 수정했어요.', true);
    }
  });
}

// 번개 완료 처리: 등록자 또는 관리자. 완료 후 목록에서 사라지고 '완료기록' 시트에 남는다.
async function doCompleteFlash(dateText) {
  if (!(await modalConfirm('이 번개를 완료 처리할까요?\n완료 후 목록에서 사라지고 시트에 기록돼요.',
    { title: '✅ 완료 처리', confirmText: '완료 처리' }))) return;
  try {
    DATA.disaster = await run('completeFlash', dateText, getMe(), ME.token);
    if (DATA.flashOwners) delete DATA.flashOwners[dateText];
    renderVotes();
    renderHome();
    toast('✅ 완료 처리했어요.', true);
  } catch (e) {
    toast(e.message || e);
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
    toast((okMsg || '복사됐어요!') + '\n\n카톡에 붙여넣기 하세요 📋');
  } catch (e) {
    // clipboard API 실패 시 폴백
    const ta = document.createElement('textarea');
    ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); toast((okMsg || '복사됐어요!') + '\n\n카톡에 붙여넣기 하세요 📋'); }
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
  if (!url) return toast('날짜 형식을 인식하지 못했어요 — 캘린더에 수동 등록 부탁!');
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
  if (!(await modalConfirm('이 영상을 삭제할까요? 되돌릴 수 없어요.'))) return;
  try {
    HALL = await run('deleteHallEntry', fileId, getMe(), ME.token);
    renderHall();
  } catch (e) {
    toast(e.message || e);
  }
}

async function voteHallClick(fileId, btn) {
  const me = getMe();
  if (!me) return toast('상단에서 이름을 먼저 선택하세요.');
  btn.disabled = true;
  try {
    HALL = await run('voteHall', fileId, me, ME.token);
    renderHall();
  } catch (e) {
    toast(e.message || e);
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

  if (!me) return toast('상단에서 이름을 먼저 선택하세요.');
  if (!file) return toast('영상을 선택하세요.');
  if (!title) return toast('제목을 입력하세요.');

  btn.disabled = true;
  upShow();
  try {
    const mime = file.type || 'application/octet-stream';
    const fileId = await uploadFileSmart('startHallUpload',
      [file.name, mime, file.size], file);
    upProgress(96, '전당에 새기는 중…');
    HALL = await run('finalizeHallEntry', fileId, title, me, ME.token);
    upProgress(100, '완료!');
    setTimeout(upHide, 400);
    toast('✓ 전당에 출품했어요!', true);
    document.getElementById('hallFile').value = '';
    document.getElementById('hallTitle').value = '';
    document.getElementById('hallSel').style.display = 'none';
    document.getElementById('hallDrop').style.display = 'block';
    document.getElementById('hallForm').style.display = 'none';
    renderHall();
  } catch (e) {
    upHide();
    toast('실패: ' + (e.message || e));
  } finally {
    btn.disabled = false;
  }
}


/* ---------- 벽화 갤러리 ---------- */
async function deleteGalleryItem(fileId, card) {
  if (!(await modalConfirm('이 사진을 삭제할까요? 되돌릴 수 없어요.'))) return;
  card.style.opacity = '.4';
  try {
    await run('deleteProof', fileId, getMe(), ME.token);
    card.remove();
    galleryLoaded = false;
    renderCertLine();
  } catch (e) {
    toast(e.message || e);
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
    const gm = document.getElementById('galleryMonth');
    const gp = document.getElementById('galleryPerson');
    const res = await run('getGallery', GALLERY_PAGE, galleryOffset,
      gm ? gm.value : '', gp ? gp.value : ''); // 월/사람 필터 (#22)
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

function doConfirm(month, dateText) {
  const me = getMe();
  const isCancel = !dateText;
  const g = (DATA.raidMonths || []).find(function (x) { return x.month === month; });
  const prev = g && g.confirmed;
  // 위치 기본값: 이전 확정 위치 > 이 후보에 지정된 위치 순
  const cand = g && (g.options || []).find(function (o) { return o.date === dateText; });
  const defaultLoc = (prev && prev.loc) || (cand && cand.loc) || '';
  const fields = isCancel ? [] : [
    { key: 'loc', label: '모임 위치', type: 'text', placeholder: '예: 더클라임 강남',
      value: defaultLoc },
    { key: 'note', label: '설명 (선택)', type: 'text', placeholder: '예: 20시 정각 로비 집합, 회비 1만원',
      value: prev ? (prev.note || '') : '' }
  ];
  fields.push({ key: 'pin', label: '관리자 PIN', type: 'password', inputmode: 'numeric', value: adminPin });
  modal({
    title: isCancel ? '📌 확정 취소' : '📌 일정 확정',
    message: isCancel
      ? month + ' 확정을 취소하고 투표를 다시 엽니다.'
      : month + ' 모임을 아래 일정으로 확정합니다.\n' + dateText,
    fields: fields,
    confirmText: isCancel ? '확정 취소' : '📌 확정',
    busyText: '처리 중…',
    validate: function (v) {
      if (!isCancel && !v.loc.trim()) return '위치를 입력해야 확정할 수 있어요.';
      if (!v.pin) return '관리자 PIN을 입력하세요.';
      return null;
    },
    onConfirm: async function (v) {
      try {
        DATA.raidMonths = await run('confirmDate', month, dateText,
          isCancel ? '' : v.loc.trim(), me, v.pin, isCancel ? '' : v.note.trim());
      } catch (e) {
        adminPin = ''; // 틀린 PIN 은 캐시하지 않음
        throw e;       // 모달 안에 에러 표시
      }
      adminPin = v.pin; // 성공한 PIN 은 세션 동안 기억 (다음 확정 때 미리 채움)
      renderVotes();
      renderHome();
      toast(isCancel ? '확정을 취소했어요. 투표가 다시 열렸습니다.' : '📌 확정 완료!', true);
    }
  });
}

// 정기공격 완료 처리: 관리자 전용. 확정된 월은 "완료", 확정 없이 마감된 월은 "모임 없음"으로 종료.
// 완료(종료) 후 목록에서 사라지고 '완료기록' 시트에 남는다.
async function doCompleteRaid(month) {
  const g = (DATA.raidMonths || []).find(function (x) { return x.month === month; });
  const isVoid = !(g && g.confirmed);
  const msg = isVoid
    ? month + ' 정기공격을 "모임 없음"으로 종료할까요?\n종료 후 목록에서 사라지고 시트에 기록돼요.'
    : month + ' 정기공격을 완료 처리할까요?\n완료 후 목록에서 사라지고 시트에 기록돼요.';
  if (!(await modalConfirm(msg,
    { title: isVoid ? '🚫 이번 달 종료' : '✅ 완료 처리', confirmText: isVoid ? '종료' : '완료 처리' }))) return;
  try {
    DATA.raidMonths = await run('completeRaid', month, getMe(), ME.token);
    renderVotes();
    renderHome();
    toast(isVoid ? '🚫 이번 달을 종료했어요.' : '✅ 완료 처리했어요.', true);
  } catch (e) {
    toast(e.message || e);
  }
}

// 정기공격 후보 수정 (관리자): 날짜/위치 변경 — 투표자는 유지
function editRaidOptionPrompt(month, r) {
  modal({
    title: '✏️ 후보 수정',
    fields: [
      { key: 'date', label: '날짜', type: 'text', value: r.date, placeholder: '예: 7/20 월요일' },
      { key: 'loc', label: '위치 (선택)', type: 'text', value: r.loc || '', placeholder: '예: 더클라임 강남' }
    ],
    confirmText: '수정 완료',
    busyText: '수정하는 중…',
    validate: function (v) { if (!v.date.trim()) return '날짜를 입력하세요.'; return null; },
    onConfirm: async function (v) {
      DATA.raidMonths = await run('editRaidOption', month, r.date, v.date.trim(), v.loc.trim(), getMe(), ME.token);
      renderVotes();
      renderHome();
      toast('✏️ 후보를 수정했어요.', true);
    }
  });
}

// 정기공격 후보 삭제 (관리자): 해당 날짜 행 삭제 — 그 날짜의 투표도 함께 사라짐
async function deleteRaidOptionClick(month, dateText) {
  if (!(await modalConfirm('이 후보 날짜를 삭제할까요?\n삭제하면 이 날짜의 투표도 함께 사라져요.',
    { title: '🗑️ 후보 삭제', confirmText: '삭제' }))) return;
  try {
    DATA.raidMonths = await run('deleteRaidOption', month, dateText, getMe(), ME.token);
    renderVotes();
    renderHome();
    toast('🗑️ 후보를 삭제했어요.', true);
  } catch (e) {
    toast(e.message || e);
  }
}

// 낙관적 토글: 로컬 voters 를 즉시 반영 → 화면 바로 갱신 → 서버는 백그라운드,
// 실패하면 원복. 체감 속도가 서버 왕복(GAS 콜드스타트 ~1-2s)을 기다리지 않는다.
function toggleVoterLocal_(row, me) {
  if (!row) return;
  const i = row.voters.indexOf(me);
  if (i > -1) row.voters.splice(i, 1);
  else row.voters.push(me);
}

function voteRaid(month, dateText) {
  const me = getMe();
  const g = (DATA.raidMonths || []).find(function (x) { return x.month === month; });
  const row = g && g.options.find(function (x) { return x.date === dateText; });
  if (!row) return;
  const before = row.voters.slice();
  toggleVoterLocal_(row, me);         // 즉시 반영
  renderVotes(); renderHome();
  run('toggleVote', 'raid', dateText, me, ME.token, month)
    .then(function (r) { row.voters = r.voters; renderVotes(); renderHome(); }) // 서버 확정값으로 동기화
    .catch(function (e) { row.voters = before; renderVotes(); renderHome(); toast(e.message || e); });
}

function voteFlash(dateText) {
  const me = getMe();
  const row = (DATA.disaster || []).find(function (x) { return x.date === dateText; });
  if (!row) return;
  const before = row.voters.slice();
  toggleVoterLocal_(row, me);
  renderVotes(); renderHome();
  run('toggleVote', 'disaster', dateText, me, ME.token)
    .then(function (r) { row.voters = r.voters; renderVotes(); renderHome(); })
    .catch(function (e) { row.voters = before; renderVotes(); renderHome(); toast(e.message || e); });
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
    toast('앨범 링크가 아직 설정되지 않았어요. 추장에게 문의!');
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

  if (!me) return toast('상단에서 이름을 먼저 선택하세요.');
  if (!file) return toast('파일을 선택하세요.');
  if (!act) return toast('참여 날짜를 선택하세요.');
  if (!loc) return toast('장소를 입력하세요.');
  if (chips.indexOf(me) < 0) chips.unshift(me);

  btn.disabled = true;
  upShow();
  try {
    const mime = file.type || 'application/octet-stream';
    const fileId = await uploadFileSmart('startUpload',
      [file.name, mime, file.size, act.ym], file);
    upProgress(96, '벽화에 새기는 중…');
    const result = await run('finalizeProof', fileId, {
      kind: kind === 'photo' ? '사진' : '영상',
      mimeType: mime, fileSize: file.size,
      participants: chips, location: loc, uploader: me,
      activityLabel: act.label
    }, ME.token);
    upProgress(100, '완료!');
    setTimeout(upHide, 400);
    // Photos 앨범 연동 안 됐어도 Drive 저장은 성공 → 사용자에겐 깔끔하게
    toast(result.photos === '완료' ? '✓ 벽화에 새겼어요! (Drive + 포토 앨범)' : '✓ 벽화에 새겼어요! (Drive 저장 완료)', true);
    if (kind === 'photo') {
      galleryLoaded = false;
      // 활동월이 이번 달이 아닐 수도 있으므로(예: 지난달 활동을 뒤늦게 인증) 무조건 "이번 달 완료"로
      // 낙관 처리하지 않고, 서버가 활동일자 기준으로 계산한 실제 인증 현황을 다시 받아온다.
      await refreshCertified();
      renderMyProofs(); // 방금 올린 인증이 취소 목록에 바로 보이게
    }
    resetForm(kind);
  } catch (e) {
    upHide();
    toast('실패: ' + (e.message || e));
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

// 정산 실행 권한: 관리자 또는 지정된 정산 담당자
function canSettleMe() {
  return ME.isAdmin || ((DATA.settlers || []).indexOf(ME.name) > -1);
}

function applyAdminUI() {
  // 관리자 전용 섹션 노출 제어
  document.querySelectorAll('.admin-only').forEach(function (el) {
    el.style.display = ME.isAdmin ? '' : 'none';
  });
  // 관리 탭: 관리자 또는 정산 담당자에게만 노출
  document.getElementById('nav-admin').style.display =
    (ME.isAdmin || canSettleMe()) ? '' : 'none';
}

function loadMore() {
  moreLoaded = true;
  if (ME.isAdmin) loadNotices();
  loadStats();
  loadVenue();
  loadArchive();
  loadCompletionLog();
}

/* ---------- 암장별 방문 통계 (#1) ---------- */
async function loadVenue() {
  const box = document.getElementById('venueBox');
  box.className = 'loading';
  box.textContent = '집계 중…';
  try {
    const v = await run('getVenueStats');
    if (!v.total.length) { box.textContent = '아직 방문 기록이 없어요'; return; }
    box.className = '';
    const max = v.total[0].count;
    const thisMonth = {};
    v.thisMonth.forEach(function (x) { thisMonth[x.loc] = x.count; });
    box.innerHTML = v.total.slice(0, 12).map(function (x) {
      const pct = Math.round(x.count / max * 100);
      const tm = thisMonth[x.loc] ? ' <span class="vs-tm">이번달 ' + thisMonth[x.loc] + '</span>' : '';
      return '<div class="vs-row">' +
        '<div class="vs-head"><span class="vs-loc">' + esc(x.loc) + '</span>' +
        '<span class="vs-cnt">' + x.count + '회' + tm + '</span></div>' +
        '<div class="vs-bar"><i style="width:' + pct + '%"></i></div></div>';
    }).join('');
  } catch (e) {
    box.textContent = '불러오기 실패: ' + (e.message || e);
  }
}

/* ---------- 공지사항 (#24) ---------- */
async function loadNotices() {
  const box = document.getElementById('noticeList');
  box.className = 'loading';
  box.textContent = '공지를 불러오는 중…';
  try {
    const res = await run('getNotices', 20, getMe(), ME.token);
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
        if (!(await modalConfirm('이 공지를 삭제할까요?'))) return;
        try {
          const res = await run('deleteNotice', n.row, n.when, getMe(), ME.token);
          renderNotices(res.items);
          DATA.notices = res.items.slice(0, 3);
          renderHomeNotices();
        } catch (e) { toast(e.message || e); }
      };
      c.appendChild(del);
    }
    box.appendChild(c);
  });
}

async function submitNotice() {
  const ta = document.getElementById('noticeText');
  const text = ta.value.trim();
  if (!text) return toast('공지 내용을 입력하세요.');
  const btn = document.getElementById('noticeBtn');
  btn.disabled = true;
  busyShow('공지 등록 중…');
  try {
    const res = await run('postNotice', text, getMe(), ME.token);
    ta.value = '';
    renderNotices(res.items);
    DATA.notices = res.items.slice(0, 3);
    renderHomeNotices();
    busyHide();
    toast('✓ 공지를 등록했어요.', true);
  } catch (e) {
    busyHide(false);
    toast(e.message || e);
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
    const s = await run('getStats', getMe(), ME.token);
    box.className = '';
    if (!s.months.length) { box.className = 'loading'; box.textContent = '아직 데이터가 없어요'; return; }
    const months = s.months.slice(-6); // 최근 6개월
    let html = '<div class="stats-scroll"><table class="stats-table"><thead><tr><th>부족원</th>';
    months.forEach(function (m) { html += '<th>' + esc(m.slice(2)) + '</th>'; }); // '26-07'
    html += '</tr></thead><tbody>';
    s.members.forEach(function (mb) {
      // 지원 제외 여부는 관리자에게만 표시 (일반 부족원에게는 노출하지 않음)
      const off = ME.isAdmin && mb.supported === false;
      html += '<tr' + (off ? ' class="indep"' : '') + '><td>' +
        esc(mb.name) + (off ? ' <span class="dim">(지원 제외)</span>' : '') + '</td>';
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

/* ---------- 완료된 모임 기록 (#완료처리) ---------- */
async function loadCompletionLog() {
  const box = document.getElementById('completionBox');
  box.className = 'loading';
  box.textContent = '기록을 불러오는 중…';
  try {
    const res = await run('getCompletionLog', 10);
    if (!res.items.length) { box.textContent = '아직 완료 처리된 모임이 없어요'; return; }
    box.className = '';
    box.innerHTML = '';
    res.items.forEach(function (it) {
      const c = document.createElement('div');
      c.className = 'notice-card';
      const label = (it.kind === '자연재해' ? '🌋 ' : '⚔️ ') + esc(it.date) +
        (it.loc ? ' @ ' + esc(it.loc) : '');
      c.innerHTML = '<div class="nc-text">' + label + '</div>' +
        '<div class="nc-meta">' + esc(it.by) + ' · ' + esc(it.when) +
        (it.people ? ' · 🧗 ' + esc(it.people) : '') + '</div>';
      box.appendChild(c);
    });
  } catch (e) {
    box.textContent = '불러오기 실패: ' + (e.message || e);
  }
}

/* ---------- 정산 현황 (#21, 관리자) ---------- */
function renderSettle(res) {
  const box = document.getElementById('settleBox');
  const ym = res.ym || '';
  if (!res.rows.length) {
    box.className = 'loading';
    box.textContent = ym + ' 정산 기록이 없어요 (위에서 정산 실행)';
    return;
  }
  box.className = '';
  const canManage = canSettleMe();
  const table = document.createElement('div');
  table.className = 'stats-scroll';
  let html = '<table class="stats-table"><thead><tr><th>이름</th><th>인증</th>' +
    (canManage ? '<th></th>' : '') + '</tr></thead><tbody>';
  res.rows.forEach(function (r) {
    const canceled = r.status === '정산 취소';
    const isSupport = r.status !== '지원 제외'; // 지원 제외는 영구(J열) — 여기선 건드리지 않음
    const btn = (canManage && isSupport)
      ? '<td><button class="mini-btn stx" data-name="' + esc(r.name) + '" data-on="' + (canceled ? '1' : '0') +
        '" style="margin:0;padding:4px 9px">' + (canceled ? '↩ 복구' : '취소') + '</button></td>'
      : (canManage ? '<td></td>' : '');
    html += '<tr' + (canceled ? ' class="indep"' : '') + '><td>' + esc(r.name) + '</td><td>' +
      esc(r.status) + '</td>' + btn + '</tr>';
  });
  html += '</tbody></table>';
  table.innerHTML = html;
  box.innerHTML = '<div class="dim" style="margin-bottom:6px">대상월: <b>' + esc(ym) + '</b></div>';
  box.appendChild(table);
  // 인원별 취소/복구
  box.querySelectorAll('.stx').forEach(function (b) {
    b.onclick = async function () {
      b.disabled = true;
      try { renderSettle(await run('cancelSettle', ym, b.dataset.name, getMe(), ME.token)); }
      catch (e) { b.disabled = false; toast(e.message || e); }
    };
  });
  // 이번 달 정산 초기화
  if (canManage) {
    const rst = document.createElement('button');
    rst.className = 'btn2';
    rst.style.marginTop = '10px';
    rst.textContent = '🗑️ ' + ym + ' 정산 초기화';
    rst.onclick = async function () {
      if (!(await modalConfirm(ym + ' 정산 기록을 초기화할까요?\n인증현황이 비워지고 이번 달 취소 내역도 리셋됩니다.'))) return;
      try { await run('resetSettle', ym, getMe(), ME.token); loadSettle(); toast('정산을 초기화했어요.', true); }
      catch (e) { toast(e.message || e); }
    };
    box.appendChild(rst);
  }
}

// ym 생략 시 관리 탭의 '정산할 월' 선택값을 대상으로 조회 (실행/취소/초기화와 동일 월 기준)
async function loadSettle(ym) {
  ym = ym || document.getElementById('settleYm').value;
  const box = document.getElementById('settleBox');
  box.className = 'loading';
  box.textContent = '정산 현황을 여는 중…';
  try {
    renderSettle(await run('getSettleStatus', ym));
  } catch (e) {
    box.className = 'loading';
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
  if (!target) return toast('초기화할 부족원을 선택하세요.');
  if (!(await modalConfirm(target + ' 님의 PIN을 초기화할까요?\n다음 로그인 때 새 PIN을 직접 설정하게 됩니다.'))) return;
  try {
    await run('resetPin', target, getMe(), ME.token);
    toast('✓ ' + target + ' 님 PIN이 초기화되었어요.');
    document.getElementById('resetPinName').value = '';
  } catch (e) {
    toast(e.message || e);
  }
}

/* ==================== 벽화 갤러리 필터 (#22) ==================== */
function buildGalleryFilters() {
  const gm = document.getElementById('galleryMonth');
  const gp = document.getElementById('galleryPerson');
  gm.innerHTML = ''; gp.innerHTML = '';
  addOpt(gm, '', '전체 월');
  (DATA.months || []).forEach(function (m) { addOpt(gm, m, '📆 ' + m); });
  addOpt(gp, '', '전체 부족원');
  (DATA.members || []).forEach(function (m) { addOpt(gp, m, '🧗 ' + m); });
  gm.onchange = gp.onchange = function () {
    galleryLoaded = false;
    loadGallery(); // 필터 변경 시 첫 페이지부터 다시
  };
}

/* ==================== 관리 탭 (관리자/정산 담당자) ==================== */
let adminLoaded = false;

function loadAdmin() {
  adminLoaded = true;
  // 정산할 월 기본값 = 이번 달
  const now = new Date();
  const ymSel = document.getElementById('settleYm');
  ymSel.value = now.getFullYear() + '-' + pad2(now.getMonth() + 1);
  ymSel.onchange = function () { loadSettle(); }; // 월 변경 시 그 달 정산 현황으로 갱신
  loadSettle();
  if (ME.isAdmin) {
    buildSupportChips();
    buildSettlerChips();
    buildResetPinSelect();
  }
}

/* ---------- 지원(정산) 대상 설정 (관리자) ---------- */
function buildSupportChips() {
  const box = document.getElementById('supportChips');
  box.innerHTML = '';
  DATA.members.forEach(function (m) {
    // 지원여부: J열 기준. 맵에 없거나 true 면 지원 (빈칸 = 지원)
    const on = !DATA.support || DATA.support[m] !== false;
    const c = document.createElement('span');
    c.className = 'chip' + (on ? ' on' : '');
    c.dataset.name = m;
    c.textContent = m;
    c.onclick = function () { c.classList.toggle('on'); };
    box.appendChild(c);
  });
}

async function saveSupports() {
  const names = Array.prototype.slice.call(document.querySelectorAll('#supportChips .chip.on'))
    .map(function (c) { return c.dataset.name; });
  const st = document.getElementById('supportStatus');
  if (!(await modalConfirm('지원 대상 ' + names.length + '명으로 저장할까요?\n(해제된 부족원은 정산에서 "지원 제외" 처리)'))) return;
  busyShow('지원 대상 저장 중…');
  try {
    const res = await run('setSupports', names, getMe(), ME.token);
    DATA.support = res.support;
    busyHide();
    st.className = 'status ok';
    st.textContent = '✓ 저장됨 — 지원 ' + names.length + '명 / 제외 ' + (DATA.members.length - names.length) + '명';
  } catch (e) {
    busyHide(false);
    st.className = 'status err';
    st.textContent = e.message || e;
  }
}

/* ---------- 웹 정산 실행 ---------- */
async function runSettleClick() {
  const ym = document.getElementById('settleYm').value; // 'yyyy-MM'
  const st = document.getElementById('settleRunStatus');
  const btn = document.getElementById('settleRunBtn');
  if (!ym) return toast('정산할 월을 선택하세요.');
  if (!(await modalConfirm(ym + ' 정산을 실행할까요?\n인증현황 시트가 갱신되고 정산 폴더에 사진이 복사됩니다.'))) return;
  btn.disabled = true;
  st.textContent = '';
  busyShow(ym + ' 정산 실행 중… (사진 수에 따라 수십 초 걸릴 수 있어요)');
  try {
    const r = await run('runSettle', ym, getMe(), ME.token);
    busyHide();
    st.className = 'status ok';
    st.innerHTML = '✓ ' + esc(r.ym) + ' 정산 완료<br>' +
      '인증(지원 대상): <b>' + r.done + '</b> / ' + r.total + '명 · 지원 제외: ' + r.independent + '명<br>' +
      '추출 사진: ' + r.copied + '장' +
      (r.uncovered && r.uncovered.length ? '<br>⚠ 사진 누락: ' + r.uncovered.map(esc).join(', ') : '');
    loadSettle(); // 정산 현황 새로고침
  } catch (e) {
    busyHide(false);
    st.className = 'status err';
    st.textContent = '실패: ' + (e.message || e);
  } finally {
    btn.disabled = false;
  }
}

/* ---------- 정산 담당자 설정 (관리자) ---------- */
function buildSettlerChips() {
  const box = document.getElementById('settlerChips');
  box.innerHTML = '';
  const cur = DATA.settlers || [];
  DATA.members.forEach(function (m) {
    const c = document.createElement('span');
    c.className = 'chip' + (cur.indexOf(m) > -1 ? ' on' : '');
    c.dataset.name = m;
    c.textContent = m;
    c.onclick = function () { c.classList.toggle('on'); };
    box.appendChild(c);
  });
}

async function saveSettlers() {
  const names = Array.prototype.slice.call(document.querySelectorAll('#settlerChips .chip.on'))
    .map(function (c) { return c.dataset.name; });
  const st = document.getElementById('settlerStatus');
  busyShow('정산 담당자 저장 중…');
  try {
    const res = await run('setSettlers', names, getMe(), ME.token);
    DATA.settlers = res.settlers;
    busyHide();
    st.className = 'status ok';
    st.textContent = '✓ 저장됨: ' + (res.settlers.length ? res.settlers.join(', ') : '(없음)');
  } catch (e) {
    busyHide(false);
    st.className = 'status err';
    st.textContent = e.message || e;
  }
}
