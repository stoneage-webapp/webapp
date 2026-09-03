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
let currentTab = 'home'; // 현재 보고 있는 탭 (당겨 새로고침이 이 탭을 유지)

// 이름 목록을 가나다순으로 (표시용 — 원본 배열은 그대로 둠, 번개 개설자=첫 투표자 로직 보존)
function koSort(arr) {
  return (arr || []).slice().sort(function (a, b) { return String(a).localeCompare(String(b), 'ko'); });
}
// 쉼표로 이어진 이름 문자열을 가나다순으로 다시 이어붙임 (참여자/참여인원 표시용)
function koSortStr(s) {
  return koSort(String(s || '').split(',').map(function (x) { return x.trim(); }).filter(Boolean)).join(', ');
}
// 암장/장소를 구글 지도 검색 링크로 (#지도링크). 카드 탭 이벤트는 막는다.
function locHtml(loc, prefix) {
  if (!loc) return '';
  return (prefix == null ? '📍 ' : prefix) + '<a class="maplink" href="https://www.google.com/maps/search/?api=1&query=' +
    encodeURIComponent(loc) + '" target="_blank" rel="noopener" onclick="event.stopPropagation()">' + esc(loc) + '</a>';
}

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
      const isTA = f.type === 'textarea';
      const isSel = f.type === 'select';
      const inp = document.createElement(isSel ? 'select' : (isTA ? 'textarea' : 'input'));
      if (isSel) {
        (f.options || []).forEach(function (o) {
          const op = document.createElement('option');
          op.value = (o && o.value !== undefined) ? o.value : o;
          op.textContent = (o && o.label !== undefined) ? o.label : o;
          inp.appendChild(op);
        });
      } else if (isTA) { inp.rows = f.rows || 3; } else { inp.type = f.type || 'text'; }
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
      if (inp.tagName === 'TEXTAREA') return; // 여러 줄 입력은 Enter=줄바꿈
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
// 이름 셀렉트(로그인·숨김 myName) 채우기 — 최초 로드 + 부족원 명단 변경 후 재호출
function fillNameSelects() {
  const lsel = document.getElementById('loginName');
  const keepL = lsel.value;
  lsel.innerHTML = '<option value="">이름 선택</option>';
  (DATA.members || []).forEach(function (m) { addOpt(lsel, m, m); });
  if (keepL) lsel.value = keepL;

  const sel = document.getElementById('myName'); // 숨김 셀렉트 (기존 코드 호환)
  const keepM = sel.value;
  sel.innerHTML = '';
  (DATA.members || []).forEach(function (m) { addOpt(sel, m, m); });
  if (keepM) sel.value = keepM;
}

/* ---------- 아래로 당겨 새로고침 (pull-to-refresh) ----------
 * 문서 스크롤이 최상단일 때 아래로 당기면 인디케이터가 따라오고, 임계값을 넘겨 놓으면
 * location.reload() 로 새로고침. 가로 스와이프·위로 스크롤·업로드/모달 진행 중엔 무시한다.
 */
function initPullToRefresh() {
  const el = document.getElementById('ptr');
  if (!el) return;
  const spin = el.querySelector('.ptr-spin');
  const THRESHOLD = 70;   // 이만큼 당기면 새로고침
  const MAX = 110;        // 인디케이터 최대 이동
  let startY = 0, startX = 0, pulling = false, decided = false, dist = 0;

  function atTop() { return (window.scrollY || document.documentElement.scrollTop || 0) <= 0; }
  function busy() { // 업로드 오버레이/모달이 떠 있으면 새로고침 제스처 비활성 (진행 중 작업 보호)
    const up = document.getElementById('uploadOverlay');
    const md = document.getElementById('modalRoot');
    return (up && up.style.display === 'flex') || (md && md.children.length > 0);
  }
  function setPull(d) {
    dist = d;
    el.style.transform = 'translateX(-50%) translateY(' + Math.min(d, MAX) + 'px)';
    el.classList.toggle('ready', d >= THRESHOLD);
    if (spin) spin.style.transform = 'rotate(' + Math.min(d / THRESHOLD, 1) * 180 + 'deg)';
  }
  function reset() {
    el.classList.add('snap');
    el.classList.remove('ready', 'active');
    el.style.transform = '';
    if (spin) spin.style.transform = '';
    setTimeout(function () { el.classList.remove('snap'); }, 250);
  }

  window.addEventListener('touchstart', function (e) {
    if (busy() || e.touches.length !== 1 || !atTop()) { pulling = false; return; }
    startY = e.touches[0].clientY; startX = e.touches[0].clientX;
    pulling = true; decided = false; dist = 0;
  }, { passive: true });

  window.addEventListener('touchmove', function (e) {
    if (!pulling) return;
    const dy = e.touches[0].clientY - startY;
    const dx = e.touches[0].clientX - startX;
    if (!decided) { // 첫 유의미한 이동으로 방향 결정: 가로거나 위로면 PTR 취소
      if (Math.abs(dx) > Math.abs(dy) || dy <= 0) { pulling = false; return; }
      decided = true; el.classList.add('active');
    }
    if (dy > 0 && atTop()) {
      e.preventDefault();  // 네이티브 고무줄/새로고침 억제
      setPull(dy * 0.5);   // 저항감
    } else { pulling = false; reset(); }
  }, { passive: false });

  async function end() {
    if (!pulling) return;
    pulling = false;
    if (dist >= THRESHOLD) {
      // 전체 리로드 대신 현재 탭을 유지한 채 데이터만 갱신 (홈으로 안 돌아감)
      el.classList.add('refreshing');
      if (spin) { spin.style.transform = ''; spin.textContent = '↻'; }
      el.style.transform = 'translateX(-50%) translateY(' + THRESHOLD + 'px)';
      try { await softRefresh(); }
      finally {
        el.classList.remove('refreshing');
        if (spin) spin.textContent = '↓';
        reset();
      }
    } else { reset(); }
  }
  window.addEventListener('touchend', end, { passive: true });
  window.addEventListener('touchcancel', function () { if (pulling) { pulling = false; reset(); } }, { passive: true });
}

/* 당겨 새로고침 본체 — 전체 페이지 리로드 없이 getInitData 를 다시 받아
 * 현재 탭을 유지한 채 화면을 다시 그린다. (location.reload 는 항상 홈으로 돌아가는 문제 해결)
 */
async function softRefresh() {
  let fresh;
  try {
    fresh = await run('getInitData');
  } catch (e) {
    toast('새로고침 실패: ' + (e.message || e));
    return;
  }
  DATA = fresh;
  fillNameSelects();
  if (!getMe()) return; // 로그인 전이면 이름 목록만 갱신하고 끝

  // 로그인 상태: DATA 의존 화면 다시 그리기 (applyLogin 의 렌더부와 동일, ME/탭은 유지)
  buildChips('photoChips');
  buildDateSelect('photo');
  buildMonthFilter();
  buildGalleryFilters();
  applyAdminUI();
  renderCertLine();
  renderVotes();
  renderHome();

  // 지연 로딩 탭은 플래그를 리셋해 다음 방문 때 새로 받게 하고, 지금 보고 있는 탭만 즉시 재로딩
  galleryLoaded = hallLoaded = moreLoaded = adminLoaded = false;
  if (currentTab === 'gallery') loadGallery();
  else if (currentTab === 'hall') loadHall();
  else if (currentTab === 'more') loadMore();
  else if (currentTab === 'admin') await loadAdmin();
  else if (currentTab === 'photo') renderMyProofs();
}

window.addEventListener('load', async function() {
  initPullToRefresh(); // 아래로 당겨 새로고침
  try {
    DATA = await run('getInitData');

    fillNameSelects(); // 로그인/숨김 이름 목록 채우기

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
  initPush();       // 푸시 알림: 로그인 회원 태깅 + 권한 버튼 갱신
  setTab('home');
}

/* ---------- 푸시 알림 (OneSignal) — #4 ----------
 * 목데이터/미로딩 환경에선 window.OneSignalDeferred 가 없으므로 조용히 무시.
 * 로그인한 회원을 external_id 로 태깅 → 백엔드가 개인 지정 발송 가능(D-1·번개 인증 등).
 */
function initPush() {
  if (typeof window.OneSignalDeferred === 'undefined') { updatePushBtn(); return; }
  window.OneSignalDeferred.push(async function (OneSignal) {
    try { if (getMe()) await OneSignal.login(getMe()); } catch (e) {}
    updatePushBtn();
  });
}
function updatePushBtn() {
  const btn = document.getElementById('pushBtn');
  if (!btn) return;
  if (typeof window.OneSignalDeferred === 'undefined') { btn.style.display = 'none'; return; }
  window.OneSignalDeferred.push(async function (OneSignal) {
    try { btn.style.display = OneSignal.Notifications.permission ? 'none' : ''; }
    catch (e) { btn.style.display = 'none'; }
  });
}
function askPush() {
  if (typeof window.OneSignalDeferred === 'undefined') return toast('이 환경에선 알림을 켤 수 없어요.');
  window.OneSignalDeferred.push(async function (OneSignal) {
    try {
      await OneSignal.Notifications.requestPermission();
      if (getMe()) await OneSignal.login(getMe());
      toast('🔔 알림 설정을 확인했어요.', true);
    } catch (e) {}
    updatePushBtn();
  });
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
  currentTab = t;
  ['home','schedule','photo','gallery','hall','more','admin'].forEach(function(k) {
    document.getElementById('tab-' + k).classList.toggle('on', k === t);
    document.getElementById('nav-' + k).classList.toggle('on', k === t);
  });
  if (t === 'gallery' && !galleryLoaded) loadGallery();
  if (t === 'hall' && !hallLoaded) loadHall();
  if (t === 'more' && !moreLoaded) loadMore();
  if (t === 'admin' && !adminLoaded) loadAdmin();
  if (t === 'photo') renderMyProofs(); // 내 인증 목록(취소용) 갱신
  if (t === 'home') markNoticesSeen();  // 홈을 보면 공지 뱃지 해제 (#5)
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
      txt.textContent = (it.actDate || it.when) + ' · 📍 ' + it.loc + ' · 🧗 ' + koSortStr(it.people);
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
  (DATA.raidSchedule || []).forEach(function (g) {
    const d = parseDateClient(g.date, g.month);
    if (!d) return;
    const today = new Date();
    if (d < new Date(today.getFullYear(), today.getMonth(), today.getDate())) return; // 지난 일정 제외
    if (!next || d < next.d) next = { d: d, entry: g };
  });
  if (!next) return;
  // D-1 리마인더(#7): 다음 정기공격이 오늘/내일이면 강조
  const t0 = new Date();
  const todayMid = new Date(t0.getFullYear(), t0.getMonth(), t0.getDate());
  const nextMid = new Date(next.d.getFullYear(), next.d.getMonth(), next.d.getDate());
  const diffDays = Math.round((nextMid - todayMid) / 86400000);
  const remind = diffDays === 0 ? '🔔 오늘 정기공격이에요!' : diffDays === 1 ? '🔔 내일 정기공격이에요!' : '';
  el.innerHTML =
    '<div class="confirm-banner' + (remind ? ' reminder' : '') + '" style="cursor:pointer">' +
    (remind ? '<div class="remind">' + remind + '</div>' : '') +
    '🔥 다음 정기공격 <b>' + ddayText(next.d) + '</b>' +
    '<div class="cdate">' + esc(next.entry.date) + '</div>' +
    (next.entry.loc ? locHtml(next.entry.loc) : '') + '</div>';
  el.firstChild.onclick = function () { setTab('schedule'); };
}

// 개인 활동 요약 (#2): 로그인한 나의 이번 달 인증/투표 상태
function renderMySummary() {
  const el = document.getElementById('mySummary');
  if (!el) return;
  const me = getMe();
  const certed = !!(DATA.certified && DATA.certified[me]);
  const mm = parseInt((DATA.month || '').split('-')[1], 10);
  // 이번 달 정기공격에 참석 확정(RSVP)했는지
  const nowYM = DATA.month;
  const going = !!(DATA.rsvp && DATA.rsvp[nowYM] && DATA.rsvp[nowYM][me] === 'yes');
  el.innerHTML =
    '<div class="my-title">🙋 ' + esc(me) + ' 님의 ' + mm + '월</div>' +
    '<div class="my-badges">' +
      '<span class="badge ' + (certed ? 'on' : '') + '">' + (certed ? '✅' : '⬜') + ' 사진 인증</span>' +
      '<span class="badge ' + (going ? 'on' : '') + '">' + (going ? '✅' : '⬜') + ' 참석 확정(RSVP)</span>' +
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
      return '<div class="notice-card' + (n.pinned ? ' pinned' : '') + '"><div class="nc-text">' +
        (n.pinned ? '📌 ' : '') + esc(n.text).replace(/\n/g, '<br>') + '</div>' +
        '<div class="nc-meta">' + esc(n.by) + ' · ' + esc(n.when) + '</div></div>';
    }).join('');
}

/* 번개 인증 리마인더 (#4 인앱): 최근(2일 내) 참여한 번개가 있는데 이번 달 인증을 안 했으면 홈에 안내.
 * (실제 시각 푸시 알림은 별도 인프라(Firebase)가 필요 — 여기선 앱을 열 때 뜨는 인앱 리마인더) */
function renderFlashReminder() {
  const el = document.getElementById('flashReminder');
  if (!el) return;
  el.innerHTML = '';
  const me = getMe();
  if (!me || (DATA.certified && DATA.certified[me])) return; // 이미 인증했으면 생략
  const now = new Date();
  let hit = null;
  (DATA.disaster || []).forEach(function (r) {
    if (!r.voters || r.voters.indexOf(me) < 0) return; // 내가 참여한 번개만
    const iso = r.dateInfo && r.dateInfo.iso;
    if (!iso) return;
    const time = (r.dateInfo && r.dateInfo.time) || '00:00';
    const dt = new Date(iso + 'T' + time + ':00'); // 번개 시각
    const hrs = (now - dt) / 3600000;              // 번개 시각 이후 경과 시간
    if (hrs >= 0 && hrs <= 36 && (!hit || dt > hit)) hit = dt; // 시각 지난 직후 ~ 다음날까지
  });
  if (!hit) return;
  const sameDay = (now - hit) / 3600000 < 12;
  el.innerHTML = '<div class="flash-remind">⚡ 번개 다녀오셨죠? <b>지금 바로 사진 인증</b>하세요!' +
    (sameDay ? ' <span class="dim" style="font-size:12px">그날 암장에서 바로!</span>' : '') +
    '<span class="fr-go">📸 인증하러 가기</span></div>';
  el.firstChild.onclick = function () { setTab('photo'); };
}

// 'M/d(요일)' — 이번 주 일정 요약 카드 전용 짧은 날짜 표기
function fmtWeekDate_(d) {
  const wd = ['일', '월', '화', '수', '목', '금', '토'][d.getDay()];
  return (d.getMonth() + 1) + '/' + d.getDate() + '(' + wd + ')';
}

/* 이번 주(오늘~+6일) 정기공격·정기 오픈 세션·번개를 한 카드에 모아 보여준다. 탭하면 일정 탭으로 이동. */
function renderWeekSummary() {
  const el = document.getElementById('homeWeekSummary');
  if (!el) return;
  const today = new Date();
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const items = []; // {d: Date, html}

  (DATA.raidSchedule || []).forEach(function (g) {
    const d = parseDateClient(g.date, g.month);
    if (!d) return;
    const diff = Math.round((d - start) / 86400000);
    if (diff >= 0 && diff <= 6) {
      items.push({ d: d, html: '⚔️ ' + fmtWeekDate_(d) + ' 정기공격' + (g.loc ? ' @ ' + esc(g.loc) : '') });
    }
  });
  (DATA.disaster || []).forEach(function (r) {
    if (!r.dateInfo) return;
    const d = new Date(r.dateInfo.iso + 'T00:00:00');
    const diff = Math.round((d - start) / 86400000);
    if (diff >= 0 && diff <= 6) {
      items.push({ d: d, html: '⚡ ' + fmtWeekDate_(d) + ' 번개' + (r.loc ? ' @ ' + esc(r.loc) : '') });
    }
  });
  (DATA.openSessions || []).forEach(function (s) {
    if (!s.date) return;
    const d = new Date(s.date + 'T00:00:00');
    const diff = Math.round((d - start) / 86400000);
    if (diff >= 0 && diff <= 6) {
      items.push({ d: d, html: '🧭 ' + fmtWeekDate_(d) + ' 오픈세션 @ ' + esc(s.loc) });
    }
  });

  items.sort(function (a, b) { return a.d - b.d; });
  if (!items.length) { el.innerHTML = ''; return; }
  el.innerHTML = '<div class="week-summary"><div class="ws-head">🗓️ 이번 주 일정</div>' +
    items.map(function (it) { return '<div class="ws-item">' + it.html + '</div>'; }).join('') + '</div>';
  el.querySelector('.week-summary').onclick = function () { setTab('schedule'); };
}

/* 최근 24시간 벽화/전당 (#6 새 소식) — 하루 지나면 백엔드에서 빠지므로 자동으로 사라짐 */
function renderHomeRecent() {
  const el = document.getElementById('homeRecent');
  if (!el) return;
  const rec = DATA.recent || {};
  const murals = rec.murals || [], hall = rec.hall || [];
  if (!murals.length && !hall.length) { el.innerHTML = ''; return; }
  let items = '';
  murals.forEach(function (m) {
    items += '<div class="rec-item" data-tab="gallery">🖼️ <b>' + esc(m.by) + '</b> ' + esc(m.kind || '사진') +
      (m.loc ? ' · ' + esc(m.loc) : '') + '<span class="rec-when">' + esc(m.when) + '</span></div>';
  });
  hall.forEach(function (h) {
    items += '<div class="rec-item" data-tab="hall">🏆 <b>' + esc(h.by) + '</b> 전당 · ' + esc(h.title) +
      '<span class="rec-when">' + esc(h.when) + '</span></div>';
  });
  el.innerHTML = '<div class="recent-box"><div class="rec-head">🆕 새 소식 <span class="dim" style="font-size:11px">· 최근 24시간</span></div>' + items + '</div>';
  el.querySelectorAll('.rec-item').forEach(function (it) { it.onclick = function () { setTab(it.dataset.tab); }; });
}

/* 새 공지 뱃지 (#5): 가장 최근 공지 ts > 마지막으로 홈 본 시각이면 홈 탭 아이콘에 점 */
function newestNoticeTs_() {
  return (DATA.notices || []).reduce(function (m, n) { return Math.max(m, n.ts || 0); }, 0);
}
function updateNoticeBadge() {
  const dot = document.getElementById('homeNoticeDot');
  if (!dot) return;
  const seen = Number(localStorage.getItem('sga_notice_seen') || 0);
  dot.style.display = newestNoticeTs_() > seen ? '' : 'none';
}
function markNoticesSeen() {
  localStorage.setItem('sga_notice_seen', String(newestNoticeTs_()));
  updateNoticeBadge();
}

function renderHome() {
  renderDday();
  renderMySummary();
  renderFlashReminder();
  renderWeekSummary();
  renderHomeRecent();
  renderHomeNotices();
  updateNoticeBadge();
  const box = document.getElementById('homeCards');
  box.innerHTML = '';

  // 정기공격: 월별 고정 일정 (더 이상 투표하지 않음 — 관리자가 지정)
  const raidCard = document.createElement('div');
  const months = DATA.raidSchedule || [];
  raidCard.className = 'home-card fixed';
  raidCard.innerHTML = '<div class="hc-title">⚔️ 정기공격</div>' +
    '<div class="hc-status">' + (months.length ? months.map(function(g) {
      const mm = parseInt((g.month || '').split('-')[1], 10);
      return '📌 ' + mm + '월: <b>' + esc(g.date) + '</b>' + (g.loc ? ' @' + esc(g.loc) : '');
    }).join('<br>') : '등록된 일정 없음') + '</div>';
  raidCard.onclick = function() { setTab('schedule'); };
  months.forEach(function(g) {
    const mm = parseInt((g.month || '').split('-')[1], 10);
    const cb = document.createElement('button');
    cb.className = 'mini-btn';
    cb.textContent = '📅 ' + mm + '월 캘린더';
    cb.onclick = function(e) { e.stopPropagation(); addToCalendar(g); };
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
  disCard.onclick = function() { setTab('schedule'); };
  box.appendChild(disCard);

  const done = DATA.members.filter(function(m) { return DATA.certified[m]; }).length;
  const mm = parseInt((DATA.month || '').split('-')[1], 10);
  document.getElementById('homeCertLine').innerHTML =
    '🖼️ ' + mm + '월 벽화 인증: <b>' + done + '</b> / ' + DATA.members.length + '명';
}

/* ---------- 일정 (정기공격 · 정기 오픈 세션 · 자연재해를 한 화면에) ---------- */
// 정기공격만 상시 카드로 유지 — 오픈세션/번개는 캘린더 날짜를 눌러 모달(openDayModal)로 본다.
function renderVotes() {
  renderCalendar();
  renderCalLegend();
  const raidList = document.getElementById('raidSection');
  raidList.innerHTML = '';
  renderRaid(raidList);
  renderScheduleActions();
}

// 캘린더 아래 색상 범례 + 번개 열기·오픈세션 등록 진입 버튼
function renderCalLegend() {
  const el = document.getElementById('calLegend');
  if (!el) return;
  el.innerHTML =
    '<div class="cal-legend">' +
      '<span><i class="cal-legend-swatch raid"></i>정기공격</span>' +
      '<span><i class="cal-legend-swatch flash"></i>번개</span>' +
      '<span><i class="cal-legend-swatch open"></i>오픈세션</span>' +
    '</div>';
}

function renderScheduleActions() {
  const box = document.getElementById('scheduleActions');
  if (!box) return;
  box.innerHTML = '';
  const flashBtn = document.createElement('button');
  flashBtn.className = 'btn2';
  flashBtn.textContent = '⚡ 번개 열기';
  flashBtn.onclick = function () { openFlashPrompt(); };
  box.appendChild(flashBtn);
  if (canOpenSession_()) {
    const openBtn = document.createElement('button');
    openBtn.className = 'btn2';
    openBtn.textContent = '🧭 오픈 세션 등록';
    openBtn.onclick = openOpenSessionDatePicker;
    box.appendChild(openBtn);
  }
}

/* ---------- 일정 달력 (#6) ----------
 * 선택 월(없으면 이번 달)의 정기공격 고정일정(꽉찬 원)·번개(sky 테두리)·정기 오픈 세션(moss 점)을 한 캘린더에서 확인.
 * 여러 일정이 겹치는 날은 점(cal-dots)이 종류별로 함께 표시된다. 날짜 탭 → 그 날 일정을 모달로.
 */
function renderCalendar() {
  const el = document.getElementById('voteCalendar');
  const now = new Date();
  const sel = voteMonthValue();
  const ym = /^\d{4}-\d{2}$/.test(sel) ? sel : (now.getFullYear() + '-' + pad2(now.getMonth() + 1));
  const y = +ym.slice(0, 4), mo = +ym.slice(5, 7);

  // 날짜별 마킹 수집
  const marks = {}; // iso → {confirmed, flash, open}
  function mark(iso, key) { if (!iso) return; (marks[iso] = marks[iso] || {})[key] = true; }
  (DATA.raidSchedule || []).forEach(function (g) {
    if (g.month !== ym || !g.dateInfo) return;
    mark(g.dateInfo.iso, 'confirmed');
  });
  (DATA.disaster || []).forEach(function (r) { if (r.dateInfo && r.dateInfo.ym === ym) mark(r.dateInfo.iso, 'flash'); });
  (DATA.openSessions || []).forEach(function (s) { if (s.date && s.date.slice(0, 7) === ym) mark(s.date, 'open'); });

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
    if (m.flash) cls.push('flash');
    if (iso === todayIso) cls.push('today');
    const dots = ['confirmed', 'open', 'flash'].filter(function (k) { return m[k]; })
      .map(function (k) { return '<i class="cal-dot ' + k + '"></i>'; }).join('');
    html += '<div class="' + cls.join(' ') + '" data-iso="' + iso + '">' + d +
      (dots ? '<span class="cal-dots">' + dots + '</span>' : '') + '</div>';
  }
  html += '</div>';
  el.innerHTML = html;

  // 날짜 탭 → 그 날의 일정을 모달로 보여준다 (정기공격/오픈세션/번개 모두, 없으면 번개 열기 제안).
  el.querySelectorAll('.cal-day[data-iso]').forEach(function (c) {
    c.onclick = function () { openDayModal(c.dataset.iso); };
  });
}

/* 날짜 하나를 탭했을 때 그 날의 정기공격/오픈세션/번개를 모아 모달로 보여준다.
 * 카드 안의 버튼(수정/삭제/완료/RSVP/투표 등)은 그대로 동작 — 성공 시 자체 모달을 새로 띄우는
 * 액션(수정/삭제/완료 등)은 modal()이 #modalRoot를 통째로 비우면서 자연스럽게 이 창을 대체하고,
 * RSVP·투표 토글처럼 별도 모달 없이 바로 끝나는 액션은 클릭 직후 이 창을 닫는다(내용은 뒤의
 * 일정 탭 목록에 이미 반영돼 있음).
 */
function openDayModal(iso) {
  const root = document.getElementById('modalRoot');
  root.innerHTML = '';
  const d = new Date(iso + 'T00:00:00');
  const weekday = d.getDay();
  const wd = ['일', '월', '화', '수', '목', '금', '토'][weekday];
  const me = getMe();
  const isAdmin = ME.isAdmin;

  const ov = document.createElement('div');
  ov.className = 'modal-ov';
  const card = document.createElement('div');
  card.className = 'modal-card';
  card.innerHTML = '<div class="modal-title">📅 ' + (d.getMonth() + 1) + '월 ' + d.getDate() + '일 (' + wd + ')</div>';

  function close() { if (root.contains(card)) root.innerHTML = ''; }

  let any = false;
  const raidHit = (DATA.raidSchedule || []).find(function (g) { return g.dateInfo && g.dateInfo.iso === iso; });
  if (raidHit) { any = true; card.appendChild(buildRaidCard_(raidHit, me, isAdmin)); }
  (DATA.openSessions || []).filter(function (s) { return s.date === iso; }).forEach(function (s) {
    any = true; card.appendChild(buildOpenSessionCard_(s));
  });
  (DATA.disaster || []).filter(function (r) { return r.dateInfo && r.dateInfo.iso === iso; }).forEach(function (r) {
    any = true; card.appendChild(buildFlashCard_(r, me, isAdmin));
  });

  if (!any) {
    const p = document.createElement('p');
    p.className = 'modal-msg';
    p.textContent = '이 날은 등록된 일정이 없어요.';
    card.appendChild(p);
    const addB = document.createElement('button');
    addB.className = 'btn';
    addB.textContent = '⚡ 이 날짜로 번개 열기';
    addB.onclick = function () { close(); openFlashPrompt(iso); };
    card.appendChild(addB);
  }

  const btnRow = document.createElement('div');
  btnRow.className = 'modal-btns';
  const closeBtn = document.createElement('button');
  closeBtn.className = 'btn2';
  closeBtn.textContent = '닫기';
  closeBtn.onclick = close;
  btnRow.appendChild(closeBtn);
  card.appendChild(btnRow);

  // 캡처 단계라 카드 내부 버튼의 stopPropagation()과 무관하게 항상 먼저 걸린다.
  // setTimeout으로 한 틱 미뤄, 버튼 자신의 클릭 핸들러(투표/RSVP/수정 모달 열기 등)가 먼저 실행되게 한다.
  card.addEventListener('click', function () { setTimeout(close, 0); }, true);

  ov.appendChild(card);
  root.appendChild(ov);
  ov.onclick = function (e) { if (e.target === ov) close(); };
}

/* ---------- 참석 확정 (RSVP, #3) ---------- */
// 확정 배너 b 에 참석/불참 + 인원수 + 명단을 붙인다.
function appendRsvp_(b, month, me) {
  const map = (DATA.rsvp && DATA.rsvp[month]) || {};
  const going = Object.keys(map).filter(function (n) { return map[n] === 'yes'; });
  const notGoing = Object.keys(map).filter(function (n) { return map[n] === 'no'; });
  const mine = me ? map[me] : '';
  const wrap = document.createElement('div');
  wrap.className = 'rsvp';
  wrap.innerHTML = '<div class="rsvp-count">🙋 참석 <b>' + going.length + '</b>' +
    (notGoing.length ? ' · 불참 ' + notGoing.length : '') + '</div>' +
    (going.length ? '<div class="rsvp-list">✅ ' + koSort(going).map(esc).join(' · ') + '</div>' : '');
  if (me) {
    const row = document.createElement('div');
    row.className = 'rsvp-btns';
    const yes = document.createElement('button');
    yes.className = 'rsvp-btn' + (mine === 'yes' ? ' on-yes' : '');
    yes.textContent = '✅ 갈게';
    yes.onclick = function (e) { e.stopPropagation(); doRsvp(month, mine === 'yes' ? '' : 'yes'); };
    const no = document.createElement('button');
    no.className = 'rsvp-btn' + (mine === 'no' ? ' on-no' : '');
    no.textContent = '❌ 못가';
    no.onclick = function (e) { e.stopPropagation(); doRsvp(month, mine === 'no' ? '' : 'no'); };
    row.appendChild(yes); row.appendChild(no);
    wrap.appendChild(row);
  }
  b.appendChild(wrap);
}
async function doRsvp(month, status) {
  try {
    const res = await run('setRsvp', month, status, getMe(), ME.token);
    DATA.rsvp = res.rsvp || DATA.rsvp;
    renderVotes();
  } catch (e) { toast(e.message || e); }
}

/* ---------- 정기공격 (월별) ---------- */
// 정기공격은 더 이상 투표하지 않는다 — 월마다 고정 일정(기본값: 둘째 주 금요일 + 위치 로테이션) 하나만 존재.
// 관리자만 날짜/장소를 수정(setRaidDate)할 수 있고, 참석확정(RSVP)·완료처리는 그대로 유지된다.
function renderRaid(list) {
  const me = getMe();
  const isAdmin = ME.isAdmin;
  const sel = voteMonthValue();
  const all = (DATA.raidSchedule || []).filter(function (g) { return !sel || g.month === sel; });
  if (!all.length) {
    list.insertAdjacentHTML('beforeend', '<div class="loading">' +
      (sel ? sel + ' 정기공격 일정이 없어요' : '등록된 정기공격 일정이 없어요') + '</div>');
    return;
  }
  // 지난 달은 접기(#3): 특정 월 선택 시 전부 표시, '전체'면 지난 달은 접기
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
    list.appendChild(buildRaidCard_(g, me, isAdmin));
  });
  if (past.length && !sel) appendPastToggle_(list, past.length);
}

// 정기공격 고정 일정 카드 하나(참석확정·캘린더추가·공유·관리자 수정/완료 버튼 포함). 일정 탭 목록과 날짜별 모달 둘 다에서 재사용.
function buildRaidCard_(g, me, isAdmin) {
  const mm = parseInt((g.month || '').split('-')[1], 10);
  const b = document.createElement('div');
  b.className = 'confirm-banner';
  const cdisp = g.dateInfo ? g.dateInfo.display : g.date;
  const expired = !!(g.dateInfo && isPastIso_(g.dateInfo.iso)); // 완료 처리 (#완료처리)
  b.innerHTML = '📌 ' + mm + '월 일정<div class="cdate">' + esc(cdisp) + '</div>' +
    (g.loc ? locHtml(g.loc) + '<br>' : '') +
    (g.note ? '<div class="cnote">📝 ' + esc(g.note).replace(/\n/g, '<br>') + '</div>' : '') +
    (expired ? '<div class="warn">⏰ 모임 날짜가 지났어요 — 완료 처리해 주세요</div>' : '') +
    (g.isOverride ? '' : '<div class="dim" style="font-size:11.5px">기본 일정(둘째 주 금요일 로테이션) — 관리자가 아직 따로 지정하지 않았어요</div>');
  appendRsvp_(b, g.month, me); // 참석 확정 (#3)
  const cal = document.createElement('button');
  cal.className = 'mini-btn';
  cal.textContent = '📅 캘린더 추가';
  cal.onclick = function() { addToCalendar(g); };
  b.appendChild(document.createElement('br'));
  b.appendChild(cal);
  const sbtn = document.createElement('button');
  sbtn.className = 'mini-btn';
  sbtn.textContent = '💬 카톡 공유';
  sbtn.onclick = function() {
    const rsvpMap = (DATA.rsvp && DATA.rsvp[g.month]) || {};
    const going = Object.keys(rsvpMap).filter(function (n) { return rsvpMap[n] === 'yes'; });
    shareText('⚔️ ' + mm + '월 정기공격!\n📅 ' + cdisp +
      (g.loc ? '\n📍 ' + g.loc : '') +
      (g.note ? '\n📝 ' + g.note : '') +
      (going.length ? '\n🙋 참석(' + going.length + '): ' + koSort(going).join(', ') : '') +
      '\n\n👉 ' + location.origin,
      '일정 소식 복사 완료!');
  };
  b.appendChild(sbtn);
  if (isAdmin) {
    const ed = document.createElement('button');
    ed.className = 'mini-btn';
    ed.textContent = '📝 날짜·장소 수정';
    ed.onclick = function() { editRaidDatePrompt(g); };
    b.appendChild(ed);
    const done = document.createElement('button');
    done.className = 'mini-btn';
    done.textContent = '✅ 완료 처리';
    done.onclick = function() { doCompleteRaid(g.month, false); };
    b.appendChild(done);
    const voidBtn = document.createElement('button');
    voidBtn.className = 'mini-btn';
    voidBtn.textContent = '🚫 모임 없음으로 종료';
    voidBtn.onclick = function() { doCompleteRaid(g.month, true); };
    b.appendChild(voidBtn);
  }
  return b;
}

// 관리자: 그 달 정기공격 날짜/장소/설명을 직접 지정 (또는 비워서 기본값으로 복귀)
function editRaidDatePrompt(g) {
  modal({
    title: '📝 ' + parseInt((g.month || '').split('-')[1], 10) + '월 정기공격 지정',
    message: g.isOverride ? '' : '아직 관리자가 지정하지 않아 기본값(둘째 주 금요일 + 로테이션)이 보이고 있어요.',
    fields: [
      { key: 'date', label: '날짜', type: 'text', value: g.date, placeholder: '예: 7/10 20:00' },
      { key: 'loc', label: '위치', type: 'text', value: g.loc || '', placeholder: '예: 신림' },
      { key: 'note', label: '설명 (선택)', type: 'text', value: g.note || '', placeholder: '예: 20시 정각 로비 집합' }
    ],
    confirmText: '저장',
    busyText: '저장 중…',
    validate: function (v) { if (!v.date.trim()) return '날짜를 입력하세요.'; return null; },
    onConfirm: async function (v) {
      DATA.raidSchedule = await run('setRaidDate', g.month, v.date.trim(), v.loc.trim(), v.note.trim(), getMe(), ME.token);
      renderVotes();
      renderHome();
      toast('📝 일정을 저장했어요.', true);
    }
  });
}

/* ---------- 자연재해 (번개) ---------- */
function buildFlashCard_(r, me, isAdmin) {
  const mine = me && r.voters.indexOf(me) > -1;
  const card = document.createElement('div');
  card.className = 'vote-card flash-card' + (mine ? ' mine' : '');
  // 날짜는 윗줄, 위치는 아랫줄 — 정기공격 카드와 폭/리듬 통일
  const dateTxt = r.dateInfo ? r.dateInfo.display : r.date;
  const expired = isPastFlash_(r); // 완료 처리 안 된 채 기한이 지난 경우 표시 (#완료처리)
  card.innerHTML =
    '<div class="top"><span class="date">' + esc(dateTxt) +
    (expired ? ' <span class="tag-over">⏰ 기한 지남</span>' : '') + '</span>' +
    '<span class="count">' + r.voters.length + '명</span></div>' +
    (r.loc ? '<div class="vloc">📍 ' + esc(r.loc) + '</div>' : '') +
    (r.voters.length ? '<div class="voters">' + koSort(r.voters).map(esc).join(' · ') + '</div>' : '') +
    (mine ? '<div class="hint">✓ 참여 중 — 탭하면 취소</div>' : '');
  card.onclick = function() { voteFlash(r.date); };
  const shareBtn = document.createElement('button');
  shareBtn.className = 'mini-btn';
  shareBtn.textContent = '💬 공유';
  shareBtn.onclick = function(e) {
    e.stopPropagation();
    shareText('⚡ 번개 소집!\n' + r.date +
      (r.voters.length ? '\n🧗 참여(' + r.voters.length + '): ' + koSort(r.voters).join(', ') : '') +
      '\n\n같이 갈 사람 모여라 🔥\n👉 ' + location.origin, '번개 소식 복사 완료!');
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
  return card;
}

/* ---------- 정기 오픈 세션 (특정 날짜+장소, 투표/참석확정 없음) ----------
 * 개설: 관리자 또는 DATA.openSessionRoles(기본 팀장)에 포함된 직책. 수정/삭제: 개설자 또는 관리자.
 * 캘린더에서 여러 날짜를 골라 한 번에 등록(openOpenSessionDatePicker). 상시 목록은 없고
 * 캘린더 날짜별 모달(openDayModal)에서만 노출된다.
 */
function canOpenSession_() {
  if (ME.isAdmin) return true;
  const roles = DATA.openSessionRoles || ['팀장'];
  return roles.indexOf(roleOf_(getMe())) > -1;
}

// 오픈 세션 카드 하나(수정/삭제 버튼 포함). 일정 탭 목록과 날짜별 모달 둘 다에서 재사용.
function buildOpenSessionCard_(s) {
  const card = document.createElement('div');
  card.className = 'vote-card open-session';
  const dateTxt = s.dateInfo ? s.dateInfo.display : s.date;
  card.innerHTML =
    '<div class="top"><span class="date">🧭 ' + esc(dateTxt) + '</span></div>' +
    '<div class="vloc">' + locHtml(s.loc) + '</div>' +
    (s.note ? '<div class="voters">' + esc(s.note) + '</div>' : '') +
    '<div class="hint">개설: ' + esc(s.createdBy) + '</div>';
  if (s.createdBy === getMe() || ME.isAdmin) {
    const ed = document.createElement('button');
    ed.className = 'mini-btn';
    ed.textContent = '✏️ 수정';
    ed.onclick = function (e) { e.stopPropagation(); editOpenSessionPrompt(s); };
    card.appendChild(ed);
    const del = document.createElement('button');
    del.className = 'mini-btn';
    del.textContent = '🗑️ 삭제';
    del.onclick = function (e) { e.stopPropagation(); deleteOpenSessionClick(s.id); };
    card.appendChild(del);
  }
  return card;
}

function editOpenSessionPrompt(s) {
  modal({
    title: '✏️ 오픈 세션 수정',
    fields: [
      { key: 'date', label: '날짜', type: 'date', value: s.date },
      { key: 'loc', label: '장소', type: 'text', value: s.loc },
      { key: 'note', label: '설명 (선택)', type: 'text', value: s.note || '' }
    ],
    confirmText: '수정 완료',
    busyText: '수정하는 중…',
    validate: function (v) { if (!v.date) return '날짜를 선택하세요.'; return v.loc.trim() ? null : '장소를 입력하세요.'; },
    onConfirm: async function (v) {
      const res = await run('editOpenSession', s.id, v.date, v.loc.trim(), v.note.trim(), getMe(), ME.token);
      DATA.openSessions = res.items;
      renderVotes();
      toast('✏️ 오픈 세션을 수정했어요.', true);
    }
  });
}

async function deleteOpenSessionClick(id) {
  if (!(await modalConfirm('이 정기 오픈 세션을 삭제할까요?'))) return;
  try {
    const res = await run('deleteOpenSession', id, getMe(), ME.token);
    DATA.openSessions = res.items;
    renderVotes();
  } catch (e) {
    toast(e.message || e);
  }
}

/* 캘린더에서 여러 날짜를 골라 한 번에 같은 장소/설명으로 오픈 세션을 등록한다. */
function openOpenSessionDatePicker() {
  const root = document.getElementById('modalRoot');
  root.innerHTML = '';
  const selected = {}; // iso → true
  const now = new Date();
  let viewYM = (/^\d{4}-\d{2}$/.test(voteMonthValue()) ? voteMonthValue() : now.getFullYear() + '-' + pad2(now.getMonth() + 1));

  const ov = document.createElement('div');
  ov.className = 'modal-ov';
  const card = document.createElement('div');
  card.className = 'modal-card';
  card.innerHTML = '<div class="modal-title">🧭 오픈 세션 날짜 선택</div>' +
    '<p class="modal-msg">달력에서 날짜를 여러 개 탭하면 같은 장소로 한 번에 등록돼요.</p>';

  const nav = document.createElement('div');
  nav.className = 'cal-nav';
  const prevBtn = document.createElement('button');
  prevBtn.type = 'button'; prevBtn.className = 'mini-btn'; prevBtn.textContent = '‹';
  const navLabel = document.createElement('span');
  navLabel.className = 'cal-nav-label';
  const nextBtn = document.createElement('button');
  nextBtn.type = 'button'; nextBtn.className = 'mini-btn'; nextBtn.textContent = '›';
  nav.appendChild(prevBtn); nav.appendChild(navLabel); nav.appendChild(nextBtn);
  card.appendChild(nav);

  const gridWrap = document.createElement('div');
  card.appendChild(gridWrap);

  const pickedLine = document.createElement('div');
  pickedLine.className = 'dim';
  pickedLine.style.cssText = 'font-size:12.5px; margin:8px 0';
  card.appendChild(pickedLine);

  function shiftYM(ym, delta) {
    const d = new Date(+ym.slice(0, 4), +ym.slice(5, 7) - 1 + delta, 1);
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1);
  }
  function renderGrid() {
    const y = +viewYM.slice(0, 4), mo = +viewYM.slice(5, 7);
    navLabel.textContent = y + '년 ' + mo + '월';
    const first = new Date(y, mo - 1, 1).getDay();
    const days = new Date(y, mo, 0).getDate();
    const wd = ['일', '월', '화', '수', '목', '금', '토'];
    let html = '<div class="cal-grid">';
    wd.forEach(function (d, i) { html += '<div class="cal-wd' + (i === 0 ? ' sun' : '') + '">' + d + '</div>'; });
    for (let i = 0; i < first; i++) html += '<div></div>';
    for (let d = 1; d <= days; d++) {
      const iso = viewYM + '-' + pad2(d);
      html += '<div class="cal-day' + (selected[iso] ? ' picked' : '') + '" data-iso="' + iso + '">' + d + '</div>';
    }
    html += '</div>';
    gridWrap.innerHTML = html;
    gridWrap.querySelectorAll('.cal-day[data-iso]').forEach(function (c) {
      c.onclick = function () {
        const iso = c.dataset.iso;
        if (selected[iso]) delete selected[iso]; else selected[iso] = true;
        renderGrid();
      };
    });
    const list = Object.keys(selected).sort();
    pickedLine.textContent = list.length ? '선택한 날짜(' + list.length + '): ' + list.join(', ') : '선택된 날짜 없음';
  }
  prevBtn.onclick = function () { viewYM = shiftYM(viewYM, -1); renderGrid(); };
  nextBtn.onclick = function () { viewYM = shiftYM(viewYM, 1); renderGrid(); };
  renderGrid();

  const locField = document.createElement('div');
  locField.className = 'field';
  locField.innerHTML = '<span>장소</span>';
  const locInput = document.createElement('input');
  locInput.type = 'text'; locInput.placeholder = '예: 더클라임 강남'; locInput.autocomplete = 'off';
  locField.appendChild(locInput);
  card.appendChild(locField);

  const noteField = document.createElement('div');
  noteField.className = 'field';
  noteField.innerHTML = '<span>설명 (선택)</span>';
  const noteInput = document.createElement('input');
  noteInput.type = 'text'; noteInput.placeholder = '예: 초보 환영'; noteInput.autocomplete = 'off';
  noteField.appendChild(noteInput);
  card.appendChild(noteField);

  const status = document.createElement('div');
  status.className = 'status err';
  card.appendChild(status);

  const btnRow = document.createElement('div');
  btnRow.className = 'modal-btns';
  const cancelBtn = document.createElement('button');
  cancelBtn.className = 'btn2'; cancelBtn.textContent = '취소';
  cancelBtn.onclick = function () { root.innerHTML = ''; };
  const okBtn = document.createElement('button');
  okBtn.className = 'btn'; okBtn.textContent = '등록';
  okBtn.onclick = async function () {
    const dates = Object.keys(selected).sort();
    const loc = locInput.value.trim();
    if (!dates.length) { status.textContent = '날짜를 하나 이상 선택하세요.'; return; }
    if (!loc) { status.textContent = '장소를 입력하세요.'; return; }
    okBtn.disabled = true;
    status.className = 'status';
    status.textContent = '등록 중…';
    try {
      const res = await run('addOpenSession', dates, loc, noteInput.value.trim(), getMe(), ME.token);
      DATA.openSessions = res.items;
      root.innerHTML = '';
      renderVotes();
      toast('🧭 오픈 세션 ' + dates.length + '개를 등록했어요.', true);
    } catch (e) {
      okBtn.disabled = false;
      status.className = 'status err';
      status.textContent = e.message || e;
    }
  };
  btnRow.appendChild(cancelBtn); btnRow.appendChild(okBtn);
  card.appendChild(btnRow);

  ov.appendChild(card);
  root.appendChild(ov);
  ov.onclick = function (e) { if (e.target === ov) root.innerHTML = ''; };
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
// prefIso('yyyy-MM-dd', 선택): 캘린더에서 빈 날짜를 탭했을 때 그 날짜로 미리 채운다.
function openFlashPrompt(prefIso) {
  const today = new Date();
  modal({
    title: '⚡ 번개 열기',
    fields: [
      { key: 'date', label: '날짜', type: 'date',
        value: prefIso || (today.getFullYear() + '-' + pad2(today.getMonth() + 1) + '-' + pad2(today.getDate())) },
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
        (e.voters.length ? ' · 🔥 ' + koSort(e.voters).map(esc).join(', ') : '') + '</span>';
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
  // 업로더가 휴면 회원이면 인증 내역에서 투명도를 낮춰 시각적으로 구분
  const dormant = !!(DATA.dormant && DATA.dormant[it.by]);
  cell.className = 'grid-cell' + (dormant ? ' dormant-entry' : '');
  const img = document.createElement('img');
  img.loading = 'lazy';
  img.src = 'https://drive.google.com/thumbnail?id=' + it.fileId + '&sz=w400';
  img.onerror = function() { img.style.opacity = '.2'; };
  cell.appendChild(img);

  const info = document.createElement('div');
  info.className = 'cell-info';
  info.innerHTML =
    '<div class="ci-loc">📍 ' + esc(it.loc) + '</div>' +
    '<div>🧗 ' + esc(koSortStr(it.people)) + '</div>' +
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

// 정기공격 완료 처리: 관리자 전용. cancelled=true 면 "모임 없음"으로 종료.
// 완료(종료) 후 목록에서 사라지고 '완료기록' 시트에 남는다.
async function doCompleteRaid(month, cancelled) {
  const msg = cancelled
    ? month + ' 정기공격을 "모임 없음"으로 종료할까요?\n종료 후 목록에서 사라지고 시트에 기록돼요.'
    : month + ' 정기공격을 완료 처리할까요?\n완료 후 목록에서 사라지고 시트에 기록돼요(참여자=참석 확정 명단).';
  if (!(await modalConfirm(msg,
    { title: cancelled ? '🚫 모임 없음으로 종료' : '✅ 완료 처리', confirmText: cancelled ? '종료' : '완료 처리' }))) return;
  try {
    DATA.raidSchedule = await run('completeRaid', month, getMe(), ME.token, !!cancelled);
    renderVotes();
    renderHome();
    toast(cancelled ? '🚫 이번 달을 종료했어요.' : '✅ 완료 처리했어요.', true);
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

function voteFlash(dateText) {
  const me = getMe();
  const row = (DATA.disaster || []).find(function (x) { return x.date === dateText; });
  if (!row) return;
  const before = row.voters.slice();
  toggleVoterLocal_(row, me);
  renderVotes(); renderHome();
  run('toggleVote', dateText, me, ME.token)
    .then(function (r) { row.voters = r.voters; renderVotes(); renderHome(); })
    .catch(function (e) { row.voters = before; renderVotes(); renderHome(); toast(e.message || e); });
}

/* ---------- 참여 날짜 선택 ---------- */
function buildDateSelect(kind) {
  const sel = document.getElementById(kind + 'Date');
  const custom = document.getElementById(kind + 'DateCustom');
  sel.innerHTML = '<option value="">날짜 선택</option>';
  (DATA.raidSchedule || []).forEach(function(g) { addOpt(sel, g.date, '⚔️ ' + fmtVoteDate(g)); }); // 표기는 표준화
  (DATA.disaster || []).forEach(function(r) { addOpt(sel, r.date, '🌋 ' + fmtVoteDate(r)); });
  addOpt(sel, '__custom', '📅 직접 선택');
  sel.onchange = function() { // onchange 속성 = 재호출(당겨 새로고침)해도 리스너 누적 없음
    custom.style.display = sel.value === '__custom' ? 'block' : 'none';
  };
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
    c.className = 'notice-card' + (n.pinned ? ' pinned' : '');
    c.innerHTML = '<div class="nc-text">' + (n.pinned ? '📌 ' : '') + esc(n.text).replace(/\n/g, '<br>') + '</div>' +
      '<div class="nc-meta">' + esc(n.by) + ' · ' + esc(n.when) + '</div>';
    if (ME.isAdmin) {
      const edit = document.createElement('button');
      edit.className = 'mini-btn';
      edit.style.marginRight = '6px';
      edit.textContent = '✏️ 수정';
      edit.onclick = function () { editNoticePrompt(n); };
      c.appendChild(edit);
      const pin = document.createElement('button');
      pin.className = 'mini-btn';
      pin.style.marginRight = '6px';
      pin.textContent = n.pinned ? '📌 고정 해제' : '📌 고정';
      pin.onclick = async function () {
        try {
          applyNoticesResult(await run('pinNotice', n.row, n.when, !n.pinned, getMe(), ME.token));
          toast(n.pinned ? '고정을 해제했어요.' : '✓ 공지를 고정했어요.', !n.pinned);
        } catch (e) { toast(e.message || e); }
      };
      const del = document.createElement('button');
      del.className = 'mini-btn';
      del.textContent = '🗑️ 삭제';
      del.onclick = async function () {
        if (!(await modalConfirm('이 공지를 삭제할까요?'))) return;
        try {
          applyNoticesResult(await run('deleteNotice', n.row, n.when, getMe(), ME.token));
        } catch (e) { toast(e.message || e); }
      };
      c.appendChild(pin);
      c.appendChild(del);
    }
    box.appendChild(c);
  });
}

// 공지 등록/삭제/고정/수정 결과 { items(전체), home(고정+최신) } 를 목록과 홈에 반영
function applyNoticesResult(res) {
  if (!res) return;
  if (res.items) renderNotices(res.items);
  DATA.notices = res.home || [];
  renderHomeNotices();
  updateNoticeBadge();
}

// 공지 수정 (관리자, #4)
function editNoticePrompt(n) {
  modal({
    title: '✏️ 공지 수정',
    fields: [{ key: 'text', label: '내용', type: 'textarea', rows: 4, value: n.text }],
    confirmText: '저장',
    busyText: '저장 중…',
    validate: function (v) { return String(v.text || '').trim() ? null : '공지 내용을 입력하세요.'; },
    onConfirm: async function (v) {
      applyNoticesResult(await run('editNotice', n.row, n.when, String(v.text).trim(), getMe(), ME.token));
      toast('✓ 공지를 수정했어요.', true);
    }
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
    applyNoticesResult(res);
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
    html += '</tbody></table></div><div class="dim" style="font-size:11.5px;margin-top:6px">📸 사진 인증 · 🗳️ 참석 확정(RSVP) (최근 6개월)</div>';
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
        (it.people ? ' · 🧗 ' + esc(koSortStr(it.people)) : '') + '</div>';
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

/* ---------- 부족원 관리 (관리자): 추가 / 이름 수정 / 삭제 ----------
 * 백엔드가 최신 명단 스냅샷({members, support, settlers})을 돌려주면 DATA 를 갱신하고
 * 이름에 의존하는 UI(로그인·인증 참여자·필터·관리 칩·명단 목록)를 모두 다시 그린다.
 */
function applyMemberData(res) {
  if (!res) return;
  if (res.members) DATA.members = res.members;
  if (res.support) DATA.support = res.support;
  if (res.dormant) DATA.dormant = res.dormant; // 휴면 맵 (K열, 만료는 서버가 자동 제외)
  if (res.roles) DATA.roles = res.roles;       // 직책 맵 (L열)
  if (res.roleList) DATA.roleList = res.roleList;
  if (res.settlers) DATA.settlers = res.settlers;
  fillNameSelects();
  buildChips('photoChips');   // 인증 참여자 선택
  buildGalleryFilters();      // 벽화 인물 필터
  if (ME.isAdmin) {
    buildSupportChips();
    buildSettlerChips();
    buildResetPinSelect();
    renderMemberAdmin();
  }
}

function renderMemberAdmin() {
  const box = document.getElementById('memberAdminList');
  if (!box) return;
  box.innerHTML = '';
  const admins = DATA.admins || [];
  const dormant = DATA.dormant || {};
  DATA.members.forEach(function (m) {
    const isAdm = admins.indexOf(m) > -1;
    const until = dormant[m] || ''; // 휴면 종료일 (없으면 활동 중)
    const row = document.createElement('div');
    row.className = 'member-row' + (until ? ' dormant' : '');

    const nm = document.createElement('span');
    nm.className = 'member-name';
    nm.innerHTML = esc(m) + (isAdm ? ' 👑' : '') + roleBadge_(m) +
      (until ? ' <span class="dormant-tag">😴 휴면 ~' + esc(until) + '</span>' : '');
    row.appendChild(nm);

    // 직책 변경 (관리자)
    const rb = document.createElement('button');
    rb.className = 'mini-btn';
    rb.textContent = '직책';
    rb.onclick = function () { rolePrompt(m); };
    row.appendChild(rb);

    if (isAdm) {
      const tag = document.createElement('span');
      tag.className = 'dim'; tag.style.fontSize = '12px';
      tag.textContent = '시트에서 관리';
      row.appendChild(tag);
    } else {
      const edit = document.createElement('button');
      edit.className = 'mini-btn'; edit.textContent = '수정';
      edit.onclick = function () { editMemberPrompt(m); };
      const del = document.createElement('button');
      del.className = 'mini-btn danger'; del.textContent = '삭제';
      del.onclick = function () { deleteMemberClick(m); };
      row.appendChild(edit);
      row.appendChild(del);
    }
    // 휴면 설정/해제 (관리자 본인 포함 누구나 대상 가능 — 권한엔 영향 없고 정산만 빠짐)
    const dz = document.createElement('button');
    dz.className = 'mini-btn';
    dz.textContent = until ? '😴 해제' : '😴 휴면';
    dz.onclick = function () { until ? clearDormantClick(m, until) : dormantPrompt(m); };
    row.appendChild(dz);

    box.appendChild(row);
  });
}

/* ---------- 직책 (관리자) ----------
 * 부족심사중 → 조약돌 → 간석기 → 고인돌 → 팀장 (낮은→높은). 부족원 시트 L열.
 * 팀장은 기본적으로 정기 오픈 세션을 열 수 있는 직책(관리 탭에서 변경 가능).
 */
const ROLE_ICON = { '부족심사중': '🌱', '조약돌': '🪨', '간석기': '🔨', '고인돌': '🗿', '팀장': '🧭' };

function roleOf_(name) {
  const roles = DATA.roles || {};
  const list = DATA.roleList || ['부족심사중', '조약돌', '간석기', '고인돌', '팀장'];
  const r = roles[name];
  return (list.indexOf(r) > -1) ? r : list[0];
}
// 이름 옆에 붙일 직책 배지 HTML
function roleBadge_(name) {
  const r = roleOf_(name);
  return ' <span class="role-tag">' + (ROLE_ICON[r] || '') + ' ' + esc(r) + '</span>';
}

function rolePrompt(name) {
  const list = DATA.roleList || ['부족심사중', '조약돌', '간석기', '고인돌', '팀장'];
  const cur = roleOf_(name);
  modal({
    title: '🏷️ 직책 변경 — ' + name,
    message: '현재: ' + (ROLE_ICON[cur] || '') + ' ' + cur,
    fields: [{ key: 'role', label: '새 직책', type: 'select', value: cur,
               options: list.map(function (r) { return { value: r, label: (ROLE_ICON[r] || '') + ' ' + r }; }) }],
    confirmText: '변경',
    busyText: '변경 중…',
    onConfirm: async function (v) {
      const r = String(v.role || '').trim();
      if (r === cur) return; // 변화 없음
      applyMemberData(await run('setRole', name, r, getMe(), ME.token));
      toast('✓ ' + name + ' 님 직책을 ' + r + '(으)로 바꿨어요.', true);
    }
  });
}

/* ---------- 휴면 회원 (관리자) ----------
 * 최대 3개월. 종료일이 지나면 자동 복귀(별도 해제 불필요).
 * 휴면 중에는 정산 대상에서 빠지고 인증현황에 '휴면'으로 표시된다.
 */
function dormantPrompt(name) {
  const today = new Date();
  const iso = function (d) { return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); };
  const plusMonths = function (n) { const d = new Date(); d.setMonth(d.getMonth() + n); return iso(d); };
  const maxISO = plusMonths(3);
  modal({
    title: '😴 휴면 설정 — ' + name,
    message: '휴면 기간에는 정산 대상에서 빠지고, 인증현황에 "휴면"으로 표시돼요.\n' +
             '종료일이 지나면 자동으로 복귀합니다. (최대 3개월 · ' + maxISO + ' 이내)',
    fields: [{ key: 'until', label: '휴면 종료일', type: 'date', value: plusMonths(1) }],
    confirmText: '휴면 설정',
    busyText: '설정 중…',
    validate: function (v) {
      const u = String(v.until || '').trim();
      if (!u) return '종료일을 선택하세요.';
      if (u < iso(today)) return '오늘 이후 날짜로 선택하세요.';
      if (u > maxISO) return '휴면은 최대 3개월까지예요. (' + maxISO + ' 이내)';
      return null;
    },
    onConfirm: async function (v) {
      applyMemberData(await run('setDormant', name, String(v.until).trim(), getMe(), ME.token));
      toast('😴 ' + name + ' 님을 휴면 처리했어요.', true);
    }
  });
}

async function clearDormantClick(name, until) {
  if (!(await modalConfirm(name + ' 님의 휴면(~' + until + ')을 지금 해제할까요?\n다음 정산부터 다시 대상에 포함돼요.',
    { title: '😴 휴면 해제', confirmText: '해제' }))) return;
  busyShow('휴면 해제 중…');
  try {
    applyMemberData(await run('setDormant', name, '', getMe(), ME.token));
    busyHide();
    toast('✓ ' + name + ' 님 휴면을 해제했어요.', true);
  } catch (e) {
    busyHide(false);
    toast(e.message || e);
  }
}

function addMemberPrompt() {
  modal({
    title: '➕ 부족원 추가',
    message: '새 부족원의 이름을 입력하세요.\nPIN은 본인이 첫 로그인 때 직접 정합니다.',
    fields: [{ key: 'name', label: '이름', placeholder: '예: 홍길동' }],
    confirmText: '추가',
    busyText: '추가 중…',
    validate: function (v) {
      const n = String(v.name || '').trim();
      if (!n) return '이름을 입력하세요.';
      if (n.indexOf(',') > -1) return '이름에 쉼표(,)는 쓸 수 없어요.';
      if (DATA.members.indexOf(n) > -1) return '이미 명단에 있는 이름이에요.';
      return null;
    },
    onConfirm: async function (v) {
      const n = String(v.name).trim();
      applyMemberData(await run('addMember', n, getMe(), ME.token));
      toast('✓ ' + n + ' 님을 추가했어요.', true);
    }
  });
}

function editMemberPrompt(oldName) {
  modal({
    title: '✏️ 이름 수정',
    message: '"' + oldName + '" 님의 새 이름을 입력하세요.\n※ 지난 투표·인증 기록은 이전 이름으로 남아요.',
    fields: [{ key: 'name', label: '새 이름', value: oldName }],
    confirmText: '저장',
    busyText: '저장 중…',
    validate: function (v) {
      const n = String(v.name || '').trim();
      if (!n) return '이름을 입력하세요.';
      if (n.indexOf(',') > -1) return '이름에 쉼표(,)는 쓸 수 없어요.';
      if (n !== oldName && DATA.members.indexOf(n) > -1) return '이미 명단에 있는 이름이에요.';
      return null;
    },
    onConfirm: async function (v) {
      const n = String(v.name).trim();
      if (n === oldName) return; // 변화 없음 — 그냥 닫기
      applyMemberData(await run('renameMember', oldName, n, getMe(), ME.token));
      toast('✓ ' + oldName + ' → ' + n + ' 으로 바꿨어요.', true);
    }
  });
}

async function deleteMemberClick(name) {
  const ok = await modalConfirm(
    '"' + name + '" 님을 명단에서 삭제할까요?\n' +
    'PIN·지원여부도 함께 지워지고, 되돌리려면 다시 추가해야 해요.\n' +
    '(지난 투표·인증 기록은 이전 이름으로 남아요.)',
    { title: '부족원 삭제', confirmText: '삭제' });
  if (!ok) return;
  busyShow(name + ' 삭제 중…');
  try {
    applyMemberData(await run('deleteMember', name, getMe(), ME.token));
    busyHide();
    toast('✓ ' + name + ' 님을 삭제했어요.', true);
  } catch (e) {
    busyHide(false);
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
  loadBudget(); // 부족 예산 (정산 담당자/관리자만 접근 가능한 탭이라 별도 가드 불필요)
  if (ME.isAdmin) {
    buildSupportChips();
    buildSettlerChips();
    buildAdminChips();
    buildOpenSessionRoleChips();
    buildResetPinSelect();
    renderMemberAdmin();
    raidLocDraft = (DATA.raidLocations || []).slice();
    renderRaidLocConfig();
  }
}

/* ---------- 정기공격 위치 로테이션 순서 편집 (관리자) ----------
 * 저장 시 즉시 반영은 안 되고(다음 요청부터, setAdmins와 동일 패턴) getInitData를 다시 받아 갱신한다.
 */
let raidLocDraft = [];

function renderRaidLocConfig() {
  const box = document.getElementById('raidLocConfig');
  if (!box) return;
  box.innerHTML = '';
  if (!raidLocDraft.length) {
    box.innerHTML = '<div class="dim" style="font-size:12.5px">위치가 없어요. 아래에서 추가하세요.</div>';
    return;
  }
  raidLocDraft.forEach(function (loc, i) {
    const row = document.createElement('div');
    row.className = 'loc-cfg-row';
    row.innerHTML = '<span class="loc-cfg-idx">' + (i + 1) + '</span><span class="loc-cfg-name">' + esc(loc) + '</span>';
    const up = document.createElement('button');
    up.className = 'mini-btn'; up.textContent = '▲'; up.disabled = i === 0;
    up.onclick = function () { moveRaidLocDraft(i, -1); };
    const dn = document.createElement('button');
    dn.className = 'mini-btn'; dn.textContent = '▼'; dn.disabled = i === raidLocDraft.length - 1;
    dn.onclick = function () { moveRaidLocDraft(i, 1); };
    const rm = document.createElement('button');
    rm.className = 'mini-btn danger'; rm.textContent = '삭제';
    rm.onclick = function () { raidLocDraft.splice(i, 1); renderRaidLocConfig(); };
    row.appendChild(up); row.appendChild(dn); row.appendChild(rm);
    box.appendChild(row);
  });
}

function moveRaidLocDraft(i, dir) {
  const j = i + dir;
  if (j < 0 || j >= raidLocDraft.length) return;
  const tmp = raidLocDraft[i]; raidLocDraft[i] = raidLocDraft[j]; raidLocDraft[j] = tmp;
  renderRaidLocConfig();
}

function addRaidLocDraft() {
  const inp = document.getElementById('newRaidLocInput');
  const v = inp.value.trim();
  if (!v) return;
  if (v.length > 20) return toast('위치 이름은 20자 이내로.');
  if (raidLocDraft.indexOf(v) > -1) return toast('이미 있는 위치예요.');
  raidLocDraft.push(v);
  inp.value = '';
  renderRaidLocConfig();
}

async function saveRaidLocations() {
  const st = document.getElementById('raidLocStatus');
  if (!raidLocDraft.length) { st.className = 'status err'; st.textContent = '최소 1개 위치가 필요해요.'; return; }
  busyShow('저장 중…');
  try {
    const res = await run('setRaidLocations', raidLocDraft, getMe(), ME.token);
    DATA.raidLocations = res.locations;
    raidLocDraft = res.locations.slice();
    // 이번 요청엔 미반영(다음 요청부터) — 최신 일정을 바로 보여주려면 초기 데이터를 다시 받는다.
    const fresh = await run('getInitData');
    DATA.raidSchedule = fresh.raidSchedule;
    busyHide();
    st.className = 'status ok';
    st.textContent = '✓ 저장됨: ' + res.locations.join(' → ');
    renderRaidLocConfig();
    renderVotes();
    renderHome();
  } catch (e) {
    busyHide(false);
    st.className = 'status err';
    st.textContent = e.message || e;
  }
}

/* ==================== 부족 예산 (정산 담당자/관리자) ====================
 * 정산 실행 시 인당 적립액이 자동 적립되고, 사용 이력은 담당자가 직접 등록한다.
 */
function won_(n) { return (Number(n) || 0).toLocaleString('ko-KR') + '원'; }

async function loadBudget() {
  const box = document.getElementById('budgetSummary');
  if (!box) return;
  box.className = 'loading'; box.textContent = '예산을 불러오는 중…';
  try {
    renderBudget(await run('getBudget', getMe(), ME.token));
  } catch (e) {
    box.className = 'status err';
    box.textContent = '예산 로딩 실패: ' + (e.message || e);
  }
}

function renderBudget(b) {
  const box = document.getElementById('budgetSummary');
  const list = document.getElementById('budgetList');
  if (!box || !b) return;
  box.className = '';
  box.innerHTML = '<div class="budget-card">' +
    '<div class="bd-balance">잔액 <b>' + won_(b.balance) + '</b></div>' +
    '<div class="bd-sub">적립 ' + won_(b.credit) + ' · 사용 ' + won_(b.spent) +
    (b.perPerson ? ' <span class="dim">· 정산 인당 ' + won_(b.perPerson) + '</span>' : '') + '</div></div>';

  if (!list) return;
  list.innerHTML = '';
  if (!b.items || !b.items.length) {
    list.innerHTML = '<div class="dim" style="font-size:12.5px; margin-top:8px">아직 예산 기록이 없어요.</div>';
    return;
  }
  b.items.forEach(function (it) {
    const row = document.createElement('div');
    row.className = 'budget-row ' + (it.kind === '적립' ? 'credit' : 'spend');
    const txt = document.createElement('span');
    txt.className = 'bd-txt';
    txt.innerHTML = '<b>' + (it.kind === '적립' ? '+' : '−') + won_(it.amount) + '</b> ' + esc(it.note || '') +
      '<span class="bd-meta">' + esc(it.when || '') + (it.by ? ' · ' + esc(it.by) : '') + '</span>';
    row.appendChild(txt);
    const del = document.createElement('button');
    del.className = 'mini-btn danger';
    del.textContent = '삭제';
    del.onclick = function () { deleteBudgetClick(it); };
    row.appendChild(del);
    list.appendChild(row);
  });
}

async function addExpenseClick() {
  const amtEl = document.getElementById('expenseAmount');
  const noteEl = document.getElementById('expenseNote');
  const st = document.getElementById('budgetStatus');
  const amount = parseInt(String(amtEl.value || '').replace(/[^\d]/g, ''), 10);
  const note = String(noteEl.value || '').trim();
  if (!amount || amount <= 0) { st.className = 'status err'; st.textContent = '금액을 입력하세요.'; return; }
  if (!note) { st.className = 'status err'; st.textContent = '사용 내용을 입력하세요.'; return; }
  busyShow('사용 등록 중…');
  try {
    renderBudget(await run('addExpense', amount, note, getMe(), ME.token));
    amtEl.value = ''; noteEl.value = '';
    busyHide();
    st.className = 'status ok';
    st.textContent = '✓ ' + won_(amount) + ' 사용을 등록했어요.';
  } catch (e) {
    busyHide(false);
    st.className = 'status err';
    st.textContent = e.message || e;
  }
}

async function deleteBudgetClick(it) {
  if (!(await modalConfirm('이 기록을 삭제할까요?\n' + (it.kind === '적립' ? '+' : '−') + won_(it.amount) + ' · ' + (it.note || ''),
    { title: '💰 예산 기록 삭제', confirmText: '삭제' }))) return;
  busyShow('삭제 중…');
  try {
    renderBudget(await run('deleteBudgetItem', it.row, it.when, getMe(), ME.token));
    busyHide();
    toast('🗑️ 삭제했어요.', true);
  } catch (e) {
    busyHide(false);
    toast(e.message || e);
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
      '인증(지원 대상): <b>' + r.done + '</b> / ' + r.total + '명 · 지원 제외: ' + r.independent + '명' +
      (r.dormant ? ' · 😴 휴면: ' + r.dormant + '명' : '') + '<br>' +
      '추출 사진: ' + r.copied + '장' +
      (r.credited ? '<br>💰 예산 적립: <b>' + won_(r.credited) + '</b>' : '') +
      (r.uncovered && r.uncovered.length ? '<br>⚠ 사진 누락: ' + r.uncovered.map(esc).join(', ') : '');
    loadSettle(); // 정산 현황 새로고침
    loadBudget(); // 적립 반영된 예산 새로고침
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

/* ---------- 관리자(부관리자) 설정 (관리자) — #부관리자 ---------- */
function buildAdminChips() {
  const box = document.getElementById('adminChips');
  if (!box) return;
  box.innerHTML = '';
  const cur = DATA.admins || [];
  DATA.members.forEach(function (m) {
    const c = document.createElement('span');
    c.className = 'chip' + (cur.indexOf(m) > -1 ? ' on' : '');
    c.dataset.name = m;
    c.textContent = m;
    c.onclick = function () { c.classList.toggle('on'); };
    box.appendChild(c);
  });
}

async function saveAdmins() {
  const names = Array.prototype.slice.call(document.querySelectorAll('#adminChips .chip.on'))
    .map(function (c) { return c.dataset.name; });
  const st = document.getElementById('adminStatus');
  if (!names.length) { st.className = 'status err'; st.textContent = '관리자는 최소 1명이어야 해요.'; return; }
  if (names.indexOf(getMe()) < 0 &&
      !(await modalConfirm('본인을 관리자에서 제외합니다. 저장하면 다음 로그인부터 관리 권한이 사라져요. 계속할까요?'))) return;
  busyShow('관리자 저장 중…');
  try {
    const res = await run('setAdmins', names, getMe(), ME.token);
    DATA.admins = res.admins;
    busyHide();
    st.className = 'status ok';
    st.textContent = '✓ 저장됨: ' + res.admins.join(', ') + ' (반영은 각자 다음 로그인부터)';
  } catch (e) {
    busyHide(false);
    st.className = 'status err';
    st.textContent = e.message || e;
  }
}

/* ---------- 정기 오픈 세션 개설 가능 직책 (관리자) ---------- */
function buildOpenSessionRoleChips() {
  const box = document.getElementById('openSessionRoleChips');
  if (!box) return;
  box.innerHTML = '';
  const cur = DATA.openSessionRoles || ['팀장'];
  const list = DATA.roleList || ['부족심사중', '조약돌', '간석기', '고인돌', '팀장'];
  list.forEach(function (r) {
    const c = document.createElement('span');
    c.className = 'chip' + (cur.indexOf(r) > -1 ? ' on' : '');
    c.dataset.role = r;
    c.textContent = (ROLE_ICON[r] || '') + ' ' + r;
    c.onclick = function () { c.classList.toggle('on'); };
    box.appendChild(c);
  });
}

async function saveOpenSessionRoles() {
  const roles = Array.prototype.slice.call(document.querySelectorAll('#openSessionRoleChips .chip.on'))
    .map(function (c) { return c.dataset.role; });
  const st = document.getElementById('openSessionRoleStatus');
  if (!roles.length) { st.className = 'status err'; st.textContent = '최소 1개 직책을 선택하세요.'; return; }
  busyShow('저장 중…');
  try {
    const res = await run('setOpenSessionRoles', roles, getMe(), ME.token);
    DATA.openSessionRoles = res.roles;
    busyHide();
    st.className = 'status ok';
    st.textContent = '✓ 저장됨: ' + res.roles.join(', ');
  } catch (e) {
    busyHide(false);
    st.className = 'status err';
    st.textContent = e.message || e;
  }
}
