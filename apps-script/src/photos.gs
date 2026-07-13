/**
 * 석기시대 부족 웹앱 — photos.gs
 * Drive 업로드(청크) · Photos 업로드 · 벽화 갤러리 · 사진 삭제 · 앨범 관리.
 * (로직은 원본 v3.0.2/Code.gs에서 그대로 이전. GAS는 전역 스코프 공유.)
 */

/* ---------- 파일 업로드 (Drive resumable, 청크 방식 → 대용량 영상 지원) ---------- */

function startUpload(fileName, mimeType, fileSize, ym) {
  // ym: '2026-07' → 루트폴더/2026/07/ 아래에 저장 (폴더 없으면 자동 생성)
  const folderId = resolveMonthFolder_(ym);
  const res = UrlFetchApp.fetch(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&supportsAllDrives=true', {
      method: 'post',
      contentType: 'application/json',
      headers: {
        Authorization: 'Bearer ' + ScriptApp.getOAuthToken(),
        'X-Upload-Content-Type': mimeType,
        'X-Upload-Content-Length': String(fileSize)
      },
      payload: JSON.stringify({ name: fileName, parents: [folderId] })
    });
  return res.getHeaders()['Location'];
}

function resolveMonthFolder_(ym) {
  if (!ym || !/^\d{4}-\d{2}$/.test(ym)) return CONFIG.DRIVE_FOLDER_ID;
  const parts = ym.split('-');
  const root = DriveApp.getFolderById(CONFIG.DRIVE_FOLDER_ID);
  const yearFolder = getOrCreateFolder_(root, parts[0]);
  const monthFolder = getOrCreateFolder_(yearFolder, parts[1]);
  return monthFolder.getId();
}

function getOrCreateFolder_(parent, name) {
  const it = parent.getFoldersByName(name);
  return it.hasNext() ? it.next() : parent.createFolder(name);
}

function uploadChunk(uploadUrl, b64, start, end, total) {
  const bytes = Utilities.base64Decode(b64);
  const res = UrlFetchApp.fetch(uploadUrl, {
    method: 'put',
    headers: { 'Content-Range': 'bytes ' + start + '-' + end + '/' + total },
    payload: bytes,
    muteHttpExceptions: true
  });
  const code = res.getResponseCode();
  if (code === 308) return { done: false };
  if (code === 200 || code === 201) {
    return { done: true, fileId: JSON.parse(res.getContentText()).id };
  }
  throw new Error('업로드 실패 (' + code + '): ' + res.getContentText());
}

// 직접 업로드 후 세션 완료 여부 조회 (CORS로 클라가 응답 못 읽은 경우 중복 방지용)
function checkUploadStatus(uploadUrl, total) {
  const res = UrlFetchApp.fetch(uploadUrl, {
    method: 'put',
    headers: { 'Content-Range': 'bytes */' + total },
    muteHttpExceptions: true
  });
  const code = res.getResponseCode();
  if (code === 200 || code === 201) {
    return { done: true, fileId: JSON.parse(res.getContentText()).id };
  }
  return { done: false, code: code };
}

/* ---------- 인증 완료 처리: Photos 업로드 + 벽화 기록 ---------- */

function finalizeProof(fileId, meta, authToken) {
  // meta: { kind: '사진'|'영상', mimeType, fileSize, participants: [], location, uploader, activityLabel }
  meta.uploader = verify_(meta.uploader, authToken);
  const token = ScriptApp.getOAuthToken();
  const info = JSON.parse(UrlFetchApp.fetch(
    'https://www.googleapis.com/drive/v3/files/' + fileId +
    '?fields=webViewLink,name&supportsAllDrives=true',
    { headers: { Authorization: 'Bearer ' + token } }).getContentText());

  // 갤러리 썸네일 표시를 위해 링크 공개(보기) 권한 부여
  UrlFetchApp.fetch(
    'https://www.googleapis.com/drive/v3/files/' + fileId + '/permissions?supportsAllDrives=true', {
      method: 'post',
      contentType: 'application/json',
      headers: { Authorization: 'Bearer ' + token },
      payload: JSON.stringify({ role: 'reader', type: 'anyone' }),
      muteHttpExceptions: true
    });

  let photosStatus = 'Photos 미설정';
  if (CONFIG.PHOTOS_ALBUM_ID) {
    photosStatus = meta.fileSize <= CONFIG.PHOTOS_MAX_BYTES
      ? uploadToPhotos_(fileId, info.name, meta.mimeType, token)
      : '용량 초과 (Drive만 저장)';
  }

  const sh = ss_().getSheetByName(CONFIG.SHEETS.mural);
  if (sh.getLastRow() === 0) {
    sh.appendRow(['인증일시', '활동일자', '종류', '장소', '참여자', '업로더', 'Drive 링크', 'Photos']);
  }
  sh.appendRow([
    new Date(), meta.activityLabel || '', meta.kind, meta.location,
    meta.participants.join(', '), meta.uploader,
    info.webViewLink, photosStatus
  ]);
  return { link: info.webViewLink, photos: photosStatus };
}

function uploadToPhotos_(fileId, name, mimeType, token) {
  try {
    const blob = UrlFetchApp.fetch(
      'https://www.googleapis.com/drive/v3/files/' + fileId + '?alt=media&supportsAllDrives=true',
      { headers: { Authorization: 'Bearer ' + token } }).getBlob();

    const up = UrlFetchApp.fetch('https://photoslibrary.googleapis.com/v1/uploads', {
      method: 'post',
      contentType: 'application/octet-stream',
      headers: {
        Authorization: 'Bearer ' + token,
        'X-Goog-Upload-Content-Type': mimeType,
        'X-Goog-Upload-Protocol': 'raw'
      },
      payload: blob.getBytes(),
      muteHttpExceptions: true
    });
    // 업로드 토큰 대신 에러 JSON 이 오면(API 미활성/권한) 조용히 미연동 처리
    if (up.getResponseCode() >= 300) { Logger.log('Photos upload err: ' + up.getContentText()); return '미연동'; }
    const uploadToken = up.getContentText();

    const create = UrlFetchApp.fetch('https://photoslibrary.googleapis.com/v1/mediaItems:batchCreate', {
      method: 'post',
      contentType: 'application/json',
      headers: { Authorization: 'Bearer ' + token },
      payload: JSON.stringify({
        albumId: CONFIG.PHOTOS_ALBUM_ID,
        newMediaItems: [{ description: name, simpleMediaItem: { uploadToken: uploadToken, fileName: name } }]
      }),
      muteHttpExceptions: true
    });
    const r = JSON.parse(create.getContentText());
    const st = r.newMediaItemResults && r.newMediaItemResults[0] && r.newMediaItemResults[0].status;
    if (st && st.message === 'Success') return '완료';
    Logger.log('Photos create err: ' + create.getContentText());
    return '미연동'; // 앨범 불일치/권한 등 — 상세는 로그, 사용자에겐 깔끔하게
  } catch (e) {
    Logger.log('Photos exception: ' + e.message);
    return '미연동';
  }
}

/* ---------- 벽화 갤러리 ----------
 * month('2026-07') / person(이름) 선택 필터 (#22). 필터 후 페이징.
 */

function getGallery(limit, offset, month, person) {
  limit = limit || 12;
  offset = offset || 0;
  month = String(month || '').trim();
  person = String(person || '').trim();
  const sh = ss_().getSheetByName(CONFIG.SHEETS.mural);
  if (!sh || sh.getLastRow() < 2) return { items: [], hasMore: false };
  const vals = sh.getDataRange().getDisplayValues();
  const photos = [];
  for (let i = vals.length - 1; i >= 1; i--) {
    const r = vals[i]; // [인증일시, 활동일자, 종류, 장소, 참여자, 업로더, 링크, Photos]
    if (r[2] !== '사진') continue;
    if (month) {
      const ym = parseYM_(r[1]) || parseYM_(r[0]); // 활동일자 우선, 없으면 인증일시
      if (ym !== month) continue;
    }
    if (person) {
      const people = String(r[4]).split(',').map(function (n) { return n.trim(); });
      if (people.indexOf(person) < 0) continue;
    }
    photos.push(r);
  }
  const slice = photos.slice(offset, offset + limit);
  const items = slice.map(function(r) {
    const m = String(r[6]).match(/\/d\/([-\w]+)/);
    return {
      when: r[0], actDate: r[1], loc: r[3],
      people: r[4], by: r[5],
      fileId: m ? m[1] : '', link: r[6]
    };
  });
  return { items: items, hasMore: offset + limit < photos.length };
}

function trashDriveFile_(link) {
  const m = String(link).match(/\/d\/([-\w]+)/);
  if (!m) return;
  try {
    UrlFetchApp.fetch(
      'https://www.googleapis.com/drive/v3/files/' + m[1] + '?supportsAllDrives=true', {
        method: 'delete',
        headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
        muteHttpExceptions: true
      });
  } catch (e) { /* 이미 없는 파일 등은 무시 */ }
}

// 벽화(사진) 삭제: fileId로 행 찾아 업로더 확인 → Drive 파일 + 시트 행 삭제
function deleteProof(fileId, requester, authToken) {
  requester = verify_(requester, authToken);
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const sh = ss_().getSheetByName(CONFIG.SHEETS.mural);
    const vals = sh.getDataRange().getDisplayValues();
    for (let i = 1; i < vals.length; i++) {
      const m = String(vals[i][6]).match(/\/d\/([-\w]+)/); // G열 = Drive 링크
      if (!m || m[1] !== fileId) continue;
      const uploader = String(vals[i][5]).trim(); // F열 = 업로더
      if (uploader !== requester && !isAdmin_(requester)) {
        throw new Error('본인이 올린 사진만 삭제할 수 있습니다.');
      }
      trashDriveFile_(vals[i][6]);
      sh.deleteRow(i + 1);
      return { ok: true };
    }
    throw new Error('해당 사진을 찾을 수 없습니다.');
  } finally {
    lock.releaseLock();
  }
}

/* ---------- 1회 실행: Photos 앨범 생성 ----------
 * Photos API는 "앱이 생성한 앨범"에만 업로드 가능.
 * 앨범 공유 API는 2025.3 폐지됨 → 앨범 생성 후 구글 포토 앱/웹에서 수동으로 공유하면 됨.
 */
function setupPhotosAlbum() {
  const token = ScriptApp.getOAuthToken();
  const album = JSON.parse(UrlFetchApp.fetch('https://photoslibrary.googleapis.com/v1/albums', {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + token },
    payload: JSON.stringify({ album: { title: '석기시대🔥' } })
  }).getContentText());
  Logger.log('ALBUM_ID: ' + album.id);
  Logger.log('→ 이 값을 CONFIG.PHOTOS_ALBUM_ID에 넣고 재배포.');
  Logger.log('→ 공유는 구글 포토에서 "석기시대 벽화" 앨범을 열어 수동으로 링크 공유.');
}

/* 앱이 만든 앨범 목록 확인용 */
function listAlbums() {
  const res = UrlFetchApp.fetch('https://photoslibrary.googleapis.com/v1/albums?pageSize=50', {
    headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
    muteHttpExceptions: true
  });
  Logger.log(res.getContentText());
}
