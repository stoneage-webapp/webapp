/**
 * 석기시대 부족 웹앱 — Code.gs (JSON API 라우터)
 * Front(Netlify) → Back(Apps Script) → DB(Sheet/Drive/Photos)
 *
 * 이 파일은 웹앱 진입점(doGet/doPost)과 action 레지스트리만 담당한다.
 * 실제 로직은 auth.gs / votes.gs / photos.gs / hall.gs / settle.gs / notices.gs 에 있다.
 * (Apps Script는 모든 .gs가 전역 스코프를 공유하므로 파일 분리는 순수 정리 목적이다.)
 *
 * ── 통신 규약 (docs/architecture.md 의 API 명세와 일치) ──
 *  - 조회(GET) :  <execUrl>?action=<name>&<param>=<value>
 *  - 인증/변경(POST): body = JSON.stringify({ action, ...params })
 *                 Content-Type: text/plain;charset=utf-8   ← CORS 회피용. application/json 금지.
 *                 (GAS 웹앱은 프리플라이트 OPTIONS를 처리하지 못한다.)
 *  - 응답 봉투 :  { ok: true, data: <결과> }   또는   { ok: false, error: <메시지> }
 *
 * ── action 추가 방법 ──
 *  아래 레지스트리에 한 줄 등록하면 끝.
 *   - fn    : 파라미터 객체를 받아 로직 함수를 호출
 *   - auth  : (POST) 지정 시 해당 필드의 이름 + d.token 을 라우터가 선검증 (verify_)
 *   - bust  : (POST) true 면 성공 시 조회 캐시 무효화
 *   - cache : (GET)  true 면 결과를 CacheService 에 잠시 캐싱 (쓰기 시 자동 무효화)
 */

/* ---------- 조회 (GET) ---------- */
const GET_ACTIONS = {
  getInitData:     { cache: true, fn: function (p) { return getInitData(); } },
  getVotes:        { cache: true, fn: function (p) { return getVotes(p.month || ''); } },
  getGallery:      { cache: true, fn: function (p) { return getGallery(Number(p.limit) || 12, Number(p.offset) || 0, p.month || '', p.person || ''); } },
  getHallData:     { cache: true, fn: function (p) { return getHallData(); } },
  getHallArchive:  { cache: true, fn: function (p) { return getHallArchive(); } },          // #23 역대 우승자
  getSettleStatus: { cache: true, fn: function (p) { return getSettleStatus(p.ym || ''); } }, // #21 정산 현황 (월 지정)
  getVenueStats:   { cache: true, fn: function (p) { return getVenueStats(); } },            // 암장별 방문 통계
  getCompletionLog:{ cache: true, fn: function (p) { return getCompletionLog(Number(p.limit) || 10); } }, // 완료된 모임 최근 기록
  getLevelBoard:   { cache: true, fn: function (p) { return getLevelBoard(); } }                          // 레벨별 완등 순위 (공개)
};

/* ---------- 인증 조회 / 변경 (POST) ---------- */
const POST_ACTIONS = {
  // 인증 (자체가 로그인이므로 auth 없음 — 내부에서 PIN 검증 + 시도 제한)
  loginWithPin:      { fn: function (d) { return loginWithPin(d.name, d.pin); } },
  changePin:         { fn: function (d) { return changePin(d.name, d.oldPin, d.newPin, d.token); } },

  // 민감한 조회는 로그인 토큰을 검증한다.
  // 출석 통계: 관리자는 전체, 일반 회원은 본인 통계만 getStats가 반환.
  getStats:          { auth: 'name', fn: function (d) { return getStats(d.name); } },
  // 홈의 최신 3건은 getInitData로 공개하되, 전체 공지 목록은 관리자만 조회.
  getNotices:        { auth: 'name', fn: function (d) {
    if (!isAdmin_(d.name)) throw new Error('관리자만 공지 목록을 조회할 수 있습니다.');
    return getNotices(Number(d.limit) || 20);
  } },

  // 투표
  toggleVote:        { auth: 'voter',     bust: true, fn: function (d) { return toggleVote(d.category, d.dateText, d.voter, d.token, d.month); } },
  addFlash:          { auth: 'creator',   bust: true, fn: function (d) { return addFlash(d.dateText, d.loc, d.creator, d.token); } },
  deleteFlash:       { auth: 'requester', bust: true, fn: function (d) { return deleteFlash(d.dateText, d.requester, d.token); } },
  editFlash:         { auth: 'requester', bust: true, fn: function (d) { return editFlash(d.dateText, d.newDate, d.newLoc, d.requester, d.token); } },
  completeFlash:     { auth: 'requester', bust: true, fn: function (d) { return completeFlash(d.dateText, d.requester, d.token); } },
  completeRaid:      { auth: 'requester', bust: true, fn: function (d) { return completeRaid(d.month, d.requester, d.token); } },
  confirmDate:       { bust: true, fn: function (d) { return confirmDate(d.month, d.dateText, d.loc, d.name, d.pin, d.note); } }, // 관리자 PIN은 함수 내부 검증
  editRaidOption:    { auth: 'requester', bust: true, fn: function (d) { return editRaidOption(d.month, d.dateText, d.newDate, d.newLoc, d.requester, d.token); } },
  deleteRaidOption:  { auth: 'requester', bust: true, fn: function (d) { return deleteRaidOption(d.month, d.dateText, d.requester, d.token); } },

  // 업로드 (요청자 토큰 필수 — 익명 업로드 차단)
  startUpload:       { auth: 'name', fn: function (d) { return startUpload(d.fileName, d.mimeType, d.fileSize, d.ym); } },
  startHallUpload:   { auth: 'name', fn: function (d) { return startHallUpload(d.fileName, d.mimeType, d.fileSize); } },
  uploadChunk:       { auth: 'name', fn: function (d) { return uploadChunk(d.uploadUrl, d.b64, d.start, d.end, d.total); } },
  checkUploadStatus: { auth: 'name', fn: function (d) { return checkUploadStatus(d.uploadUrl, d.total); } },

  // 인증 완료 / 갤러리 / 전당
  finalizeProof:     { bust: true, fn: function (d) { return finalizeProof(d.fileId, d.meta, d.token); } }, // meta.uploader를 내부에서 verify_
  finalizeHallEntry: { auth: 'uploader',  bust: true, fn: function (d) { return finalizeHallEntry(d.fileId, d.title, d.uploader, d.token); } },
  deleteProof:       { auth: 'requester', bust: true, fn: function (d) { return deleteProof(d.fileId, d.requester, d.token); } },
  deleteHallEntry:   { auth: 'requester', bust: true, fn: function (d) { return deleteHallEntry(d.fileId, d.requester, d.token); } },
  voteHall:          { auth: 'voter',     bust: true, fn: function (d) { return voteHall(d.fileId, d.voter, d.token); } },

  // 관리자 기능
  resetPin:          { auth: 'requester', fn: function (d) { return resetPin(d.targetName, d.requester, d.token); } }, // #18 (관리자 검증은 함수 내부)
  addMember:         { auth: 'requester', bust: true, fn: function (d) { return addMember(d.newName, d.requester, d.token); } },              // 부족원 추가 (관리자)
  renameMember:      { auth: 'requester', bust: true, fn: function (d) { return renameMember(d.oldName, d.newName, d.requester, d.token); } }, // 부족원 이름 수정 (관리자)
  deleteMember:      { auth: 'requester', bust: true, fn: function (d) { return deleteMember(d.targetName, d.requester, d.token); } },        // 부족원 삭제 (관리자)
  setLevels:         { auth: 'requester', bust: true, fn: function (d) { return setLevels(d.levels, d.requester, d.token); } },              // 레벨 목록 설정 (관리자)
  setLevelRecord:    { auth: 'requester', bust: true, fn: function (d) { return setLevelRecord(d.name, d.counts, d.requester, d.token); } }, // 다른 구성원 완등 기록 (관리자)
  setMyLevelRecord:  { auth: 'name',      bust: true, fn: function (d) { return setMyLevelRecord(d.counts, d.name, d.token); } },           // 본인 완등 기록 (누구나)
  postNotice:        { auth: 'name', bust: true, fn: function (d) { return postNotice(d.text, d.name, d.token); } },   // #24
  deleteNotice:      { auth: 'name', bust: true, fn: function (d) { return deleteNotice(d.row, d.when, d.name, d.token); } }, // #24
  pinNotice:         { auth: 'name', bust: true, fn: function (d) { return pinNotice(d.row, d.when, d.pinned, d.name, d.token); } }, // 공지 고정/해제 (관리자)
  runSettle:         { auth: 'requester', bust: true, fn: function (d) { return runSettle(d.ym, d.requester, d.token); } },   // 웹 정산 (관리자/담당자)
  setSettlers:       { auth: 'requester', bust: true, fn: function (d) { return setSettlers(d.names, d.requester, d.token); } }, // 담당자 지정 (관리자)
  setSupports:       { auth: 'requester', bust: true, fn: function (d) { return setSupports(d.names, d.requester, d.token); } }, // 지원 대상 지정 (관리자, J열)
  cancelSettle:      { auth: 'requester', bust: true, fn: function (d) { return cancelSettle(d.ym, d.targetName, d.requester, d.token); } }, // 인원별 이번 달 정산 취소/복구
  resetSettle:       { auth: 'requester', bust: true, fn: function (d) { return resetSettle(d.ym, d.requester, d.token); } }              // 이번 달 정산 초기화
};

/* ---------- 진입점 ---------- */

function doGet(e) {
  const p = (e && e.parameter) || {};
  const action = p.action || '';
  if (!action) return _out({ ok: true, data: { service: '석기시대 API' } }); // 헬스체크
  const entry = GET_ACTIONS[action];
  if (!entry) return _out({ ok: false, error: '알 수 없는 action(GET): ' + action });
  return _json(function () {
    if (!entry.cache) return entry.fn(p);
    const key = cacheKey_(action, p);
    const hit = cacheGet_(key);
    if (hit !== null) return hit;
    const data = entry.fn(p);
    cachePut_(key, data);
    return data;
  });
}

function doPost(e) {
  let d;
  try {
    d = JSON.parse((e && e.postData && e.postData.contents) || '{}');
  } catch (err) {
    return _out({ ok: false, error: '요청 본문 파싱 실패(JSON 아님)' });
  }
  const action = d.action || '';
  const entry = POST_ACTIONS[action];
  if (!entry) return _out({ ok: false, error: '알 수 없는 action(POST): ' + action });
  return _json(function () {
    if (entry.auth) verify_(d[entry.auth], d.token);
    const data = entry.fn(d);
    if (entry.bust) bumpCacheVer_();
    return data;
  });
}

/* ---------- 응답 헬퍼 ---------- */
// 콜백 실행 → 성공/실패를 봉투로 감싸 JSON 반환 (로직 함수의 throw 를 error 로 변환)
function _json(fn) {
  try { return _out({ ok: true, data: fn() }); }
  catch (err) { return _out({ ok: false, error: (err && err.message) || String(err) }); }
}
function _out(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/* ---------- 조회 캐시 (CacheService) ----------
 * 키에 버전을 포함시키고, 쓰기 성공 시 버전을 올려 일괄 무효화.
 * → 본인 투표 직후 재조회에도 항상 최신 데이터. 캐시 오류는 조용히 무시(기능 우선).
 */
const CACHE_TTL_SECONDS = 120;

function cacheVer_() {
  const c = CacheService.getScriptCache();
  let v = c.get('cache_ver');
  if (!v) { v = String(Date.now()); c.put('cache_ver', v, 21600); }
  return v;
}
function bumpCacheVer_() {
  try { CacheService.getScriptCache().put('cache_ver', String(Date.now()), 21600); } catch (e) {}
}
function cacheKey_(action, p) {
  return 'q:' + cacheVer_() + ':' + action + ':' +
    ['month', 'limit', 'offset', 'person', 'ym'].map(function (k) { return p[k] || ''; }).join(':');
}
function cacheGet_(key) {
  try {
    const v = CacheService.getScriptCache().get(key);
    return v ? JSON.parse(v) : null;
  } catch (e) { return null; }
}
function cachePut_(key, data) {
  try {
    const s = JSON.stringify(data);
    if (s.length < 90000) CacheService.getScriptCache().put(key, s, CACHE_TTL_SECONDS); // 100KB 한도 여유
  } catch (e) {}
}

function ss_() {
  return SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
}

/* ---------- 초기 데이터 ----------
 * driveApiKey는 여기서 제거됨(익명 노출 금지) → loginWithPin/changePin 응답으로 이동.
 */
function getInitData() {
  const s = ss_();
  const split = splitBySupport_(s); // 부족원 + 지원여부(J열)
  const members = split.all.map(function (m) { return m.name; });
  const support = {};
  split.all.forEach(function (m) { support[m.name] = m.supported; });
  const cert = getCertified_(s);
  const votes = getVotes('');
  return {
    members: members,
    support: support,              // { 이름: true/false } — 지원(정산) 대상 여부 (J열)
    months: votes.months,          // 존재하는 투표 월 목록 (필터 드롭다운용)
    raidMonths: votes.raidMonths,  // [{month, deadline, closed, confirmed, options:[{date,dateInfo,voters}]}]
    disaster: votes.disaster,      // [{date, loc, dateInfo, voters}]
    certified: cert.map,           // { 이름: true } — 이번 달 사진 인증 완료자
    month: cert.ym,                // 'yyyy-MM'
    shareUrl: CONFIG.PHOTOS_SHARE_URL,
    notionUrl: CONFIG.NOTION_URL,
    openchatUrl: CONFIG.OPENCHAT_URL,
    confirmed: votes.confirmed,    // { disaster: {date,loc}|null }
    admins: CONFIG.ADMINS,
    settlers: getSettlers_(),      // 정산 담당자 (관리자 페이지 노출 판단용)
    notices: getHomeNotices_(),    // 홈 노출: 고정 공지 전부 + 최신 1건
    flashOwners: votes.flashOwners
  };
}
