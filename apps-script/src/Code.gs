/**
 * 석기시대 부족 웹앱 — Code.gs (JSON API 라우터)
 * Front(Netlify) → Back(Apps Script) → DB(Sheet/Drive/Photos)
 *
 * 이 파일은 웹앱 진입점(doGet/doPost)과 action 라우팅만 담당한다.
 * 실제 로직은 auth.gs / votes.gs / photos.gs / hall.gs / settle.gs / notion.gs 에 있다.
 * (Apps Script는 모든 .gs가 전역 스코프를 공유하므로 파일 분리는 순수 정리 목적이다.)
 *
 * ── 통신 규약 (docs/architecture.md 의 API 명세와 일치) ──
 *  - 조회(GET) :  <execUrl>?action=<name>&<param>=<value>
 *  - 변경(POST):  body = JSON.stringify({ action, ...params })
 *                 Content-Type: text/plain;charset=utf-8   ← CORS 회피용. application/json 금지.
 *                 (GAS 웹앱은 프리플라이트 OPTIONS를 처리하지 못한다.)
 *  - 응답 봉투 :  { ok: true, data: <결과> }   또는   { ok: false, error: <메시지> }
 *                 (기존 함수의 throw 는 라우터가 { ok:false, error } 로 변환)
 */

/* ---------- GET: 조회 전용 (부수효과 없음) ---------- */
function doGet(e) {
  const p = (e && e.parameter) || {};
  const action = p.action || '';
  return _json(function () {
    switch (action) {
      case 'getInitData': return getInitData();
      case 'getGallery':  return getGallery(Number(p.limit) || 12, Number(p.offset) || 0);
      case 'getHallData': return getHallData();
      case '':            return { service: '석기시대 API', ok: true };  // 헬스체크
      default: throw new Error('알 수 없는 action(GET): ' + action);
    }
  });
}

/* ---------- POST: 변경/쓰기 ---------- */
function doPost(e) {
  let d;
  try {
    d = JSON.parse((e && e.postData && e.postData.contents) || '{}');
  } catch (err) {
    return _out({ ok: false, error: '요청 본문 파싱 실패(JSON 아님)' });
  }
  const action = d.action || '';
  return _json(function () {
    switch (action) {
      case 'loginWithPin':      return loginWithPin(d.name, d.pin);
      case 'changePin':         return changePin(d.name, d.oldPin, d.newPin, d.token);
      case 'addFlash':          return addFlash(d.dateText, d.loc, d.creator, d.token);
      case 'deleteFlash':       return deleteFlash(d.dateText, d.requester, d.token);
      case 'confirmDate':       return confirmDate(d.month, d.dateText, d.loc, d.name, d.pin);
      case 'toggleVote':        return toggleVote(d.category, d.dateText, d.voter, d.token, d.month);
      case 'startUpload':       return startUpload(d.fileName, d.mimeType, d.fileSize, d.ym);
      case 'startHallUpload':   return startHallUpload(d.fileName, d.mimeType, d.fileSize);
      case 'uploadChunk':       return uploadChunk(d.uploadUrl, d.b64, d.start, d.end, d.total);
      case 'checkUploadStatus': return checkUploadStatus(d.uploadUrl, d.total);
      case 'finalizeProof':     return finalizeProof(d.fileId, d.meta, d.token);
      case 'finalizeHallEntry': return finalizeHallEntry(d.fileId, d.title, d.uploader, d.token);
      case 'deleteProof':       return deleteProof(d.fileId, d.requester, d.token);
      case 'deleteHallEntry':   return deleteHallEntry(d.fileId, d.requester, d.token);
      case 'voteHall':          return voteHall(d.fileId, d.voter, d.token);
      default: throw new Error('알 수 없는 action(POST): ' + action);
    }
  });
}

/* ---------- 공통 헬퍼 ---------- */
// 콜백 실행 → 성공/실패를 봉투로 감싸 JSON 반환 (기존 함수의 throw 를 error 로 변환)
function _json(fn) {
  try { return _out({ ok: true, data: fn() }); }
  catch (err) { return _out({ ok: false, error: (err && err.message) || String(err) }); }
}
function _out(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function ss_() {
  return SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
}

/* ---------- 초기 데이터 ---------- */

function getInitData() {
  const s = ss_();
  const members = s.getSheetByName(CONFIG.SHEETS.members)
    .getRange('A2:A').getDisplayValues().flat().filter(String);
  const cert = getCertified_(s);
  return {
    members: members,
    raidMonths: readRaidByMonth_(s),   // [{month, confirmed, options:[{date,voters}]}]
    disaster: readVotes_(s, CONFIG.SHEETS.disaster),
    certified: cert.map,   // { 이름: true } — 이번 달 사진 인증 완료자
    month: cert.ym,        // 'yyyy-MM'
    shareUrl: CONFIG.PHOTOS_SHARE_URL,
    notionUrl: CONFIG.NOTION_URL,
    driveApiKey: CONFIG.DRIVE_API_KEY,
    confirmed: getConfirmed_(),  // { disaster: {date,loc}|null }
    admins: CONFIG.ADMINS,
    flashOwners: getFlashOwners_()
  };
}
