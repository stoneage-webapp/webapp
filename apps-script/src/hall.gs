/**
 * 석기시대 부족 웹앱 — hall.gs
 * 명예의전당 출품 · 투표(1인1표) · 영상 업로드/삭제.
 * (로직은 원본 v3.0.2/Code.gs에서 그대로 이전. GAS는 전역 스코프 공유.)
 */

/* ---------- 명예의전당 ----------
 * 시트: [등록일시, 대상월, 업로더, 제목, Drive 링크, 투표자→]
 * 월별 출품 + 1인 1표 (같은 영상 다시 누르면 취소, 다른 영상 누르면 갈아타기)
 */

function ymNow_() {
  return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM');
}

function hallSheet_() {
  const s = ss_();
  let sh = s.getSheetByName(CONFIG.SHEETS.hall);
  if (!sh) sh = s.insertSheet(CONFIG.SHEETS.hall);
  if (sh.getLastRow() === 0) {
    sh.appendRow(['등록일시', '대상월', '업로더', '제목', 'Drive 링크']);
  }
  return sh;
}

function readHall_() {
  const sh = hallSheet_();
  if (sh.getLastRow() < 2) return [];
  return sh.getDataRange().getDisplayValues().slice(1)
    .filter(function(r) { return r[4]; })
    .map(function(r) {
      const m = String(r[4]).match(/\/d\/([-\w]+)/);
      return {
        when: r[0], ym: r[1], by: r[2], title: r[3],
        link: r[4], fileId: m ? m[1] : '',
        voters: r.slice(5).filter(String)
      };
    });
}

function getHallData() {
  const tz = Session.getScriptTimeZone();
  const now = new Date();
  const ym = ymNow_();
  const prev = Utilities.formatDate(
    new Date(now.getFullYear(), now.getMonth() - 1, 1), tz, 'yyyy-MM');
  const all = readHall_();
  let winner = null;
  all.filter(function(e) { return e.ym === prev; }).forEach(function(e) {
    if (e.voters.length && (!winner || e.voters.length > winner.voters.length)) winner = e;
  });
  return {
    ym: ym,
    entries: all.filter(function(e) { return e.ym === ym; }),
    winner: winner,
    winnerMonth: prev
  };
}

function startHallUpload(fileName, mimeType, fileSize) {
  const root = DriveApp.getFolderById(CONFIG.DRIVE_FOLDER_ID);
  const folder = getOrCreateFolder_(getOrCreateFolder_(root, '전당'), ymNow_());
  const res = UrlFetchApp.fetch(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&supportsAllDrives=true', {
      method: 'post',
      contentType: 'application/json',
      headers: {
        Authorization: 'Bearer ' + ScriptApp.getOAuthToken(),
        'X-Upload-Content-Type': mimeType,
        'X-Upload-Content-Length': String(fileSize)
      },
      payload: JSON.stringify({ name: fileName, parents: [folder.getId()] })
    });
  return res.getHeaders()['Location'];
}

function finalizeHallEntry(fileId, title, uploader, authToken) {
  uploader = verify_(uploader, authToken);
  const token = ScriptApp.getOAuthToken();
  const info = JSON.parse(UrlFetchApp.fetch(
    'https://www.googleapis.com/drive/v3/files/' + fileId +
    '?fields=webViewLink&supportsAllDrives=true',
    { headers: { Authorization: 'Bearer ' + token } }).getContentText());
  UrlFetchApp.fetch(
    'https://www.googleapis.com/drive/v3/files/' + fileId + '/permissions?supportsAllDrives=true', {
      method: 'post',
      contentType: 'application/json',
      headers: { Authorization: 'Bearer ' + token },
      payload: JSON.stringify({ role: 'reader', type: 'anyone' }),
      muteHttpExceptions: true
    });
  hallSheet_().appendRow([new Date(), ymNow_(), uploader, title || '무제', info.webViewLink]);
  return getHallData();
}

function voteHall(fileId, voter, authToken) {
  voter = verify_(voter, authToken);
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const sh = hallSheet_();
    const ym = ymNow_();
    const vals = sh.getDataRange().getDisplayValues();
    for (let i = 1; i < vals.length; i++) {
      if (vals[i][1] !== ym) continue;
      const m = String(vals[i][4]).match(/\/d\/([-\w]+)/);
      const id = m ? m[1] : '';
      let voters = vals[i].slice(5).filter(String);
      if (id === fileId) {
        voters = voters.indexOf(voter) > -1
          ? voters.filter(function(v) { return v !== voter; })  // 재클릭 = 취소
          : voters.concat(voter);
      } else {
        voters = voters.filter(function(v) { return v !== voter; }); // 1인 1표
      }
      const width = Math.max(sh.getLastColumn() - 5, voters.length, 1);
      sh.getRange(i + 1, 6, 1, width)
        .setValues([voters.concat(new Array(width - voters.length).fill(''))]);
    }
    return getHallData();
  } finally {
    lock.releaseLock();
  }
}

// 전당 영상 삭제
function deleteHallEntry(fileId, requester, authToken) {
  requester = verify_(requester, authToken);
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const sh = hallSheet_();
    const vals = sh.getDataRange().getDisplayValues();
    for (let i = 1; i < vals.length; i++) {
      const m = String(vals[i][4]).match(/\/d\/([-\w]+)/); // E열 = 링크
      if (!m || m[1] !== fileId) continue;
      const uploader = String(vals[i][2]).trim(); // C열 = 업로더
      if (uploader !== requester && !isAdmin_(requester)) {
        throw new Error('본인이 올린 영상만 삭제할 수 있습니다.');
      }
      trashDriveFile_(vals[i][4]);
      sh.deleteRow(i + 1);
      return getHallData();
    }
    throw new Error('해당 영상을 찾을 수 없습니다.');
  } finally {
    lock.releaseLock();
  }
}
