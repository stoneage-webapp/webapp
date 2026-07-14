/**
 * api.js — GAS 백엔드 호출의 유일한 창구
 *
 * 화면 코드(app.js)는 기존 GAS 시절과 동일하게 run('액션', 인자...) 만 호출한다.
 * 여기서 positional 인자 → named 파라미터로 변환해 fetch 로 보낸다.
 *
 * ⚠️ 규약 (docs/architecture.md):
 *  - GET  : GAS_URL?action=...&param=...
 *  - POST : body = JSON, Content-Type 은 반드시 text/plain (CORS 프리플라이트 회피)
 *  - 응답 : { ok:true, data } | { ok:false, error }  → run() 은 data 를 돌려주거나 throw
 */

// ★ exec URL — 백엔드 재배포 시 반드시 기존 배포를 덮어써서(redeploy) 이 URL 을 유지할 것 (docs/deploy.md)
const GAS_URL = 'https://script.google.com/macros/s/AKfycbxcMDmO6R6NHxHTBKrKbVoTcMUJaaFc7YileVOBErPDBfol3VD4Jsx_4VOOfZTRtx1J/exec';

/* 액션별 positional 파라미터 이름 (백엔드 레지스트리와 1:1) */
const API_GET = {
  getInitData:     [],
  getVotes:        ['month'],
  getGallery:      ['limit', 'offset', 'month', 'person'],
  getHallData:     [],
  getHallArchive:  [],
  getSettleStatus: ['ym'],
  getVenueStats:   []
};
const API_POST = {
  loginWithPin:      ['name', 'pin'],
  changePin:         ['name', 'oldPin', 'newPin', 'token'],
  getStats:          ['name', 'token'],
  getNotices:        ['limit', 'name', 'token'],
  toggleVote:        ['category', 'dateText', 'voter', 'token', 'month'],
  addFlash:          ['dateText', 'loc', 'creator', 'token'],
  deleteFlash:       ['dateText', 'requester', 'token'],
  confirmDate:       ['month', 'dateText', 'loc', 'name', 'pin', 'note'],
  startUpload:       ['fileName', 'mimeType', 'fileSize', 'ym'],
  startHallUpload:   ['fileName', 'mimeType', 'fileSize'],
  uploadChunk:       ['uploadUrl', 'b64', 'start', 'end', 'total'],
  checkUploadStatus: ['uploadUrl', 'total'],
  finalizeProof:     ['fileId', 'meta', 'token'],
  finalizeHallEntry: ['fileId', 'title', 'uploader', 'token'],
  deleteProof:       ['fileId', 'requester', 'token'],
  deleteHallEntry:   ['fileId', 'requester', 'token'],
  voteHall:          ['fileId', 'voter', 'token'],
  resetPin:          ['targetName', 'requester', 'token'],
  postNotice:        ['text', 'name', 'token'],
  deleteNotice:      ['row', 'when', 'name', 'token'],
  runSettle:         ['ym', 'requester', 'token'],
  setSettlers:       ['names', 'requester', 'token'],
  setSupports:       ['names', 'requester', 'token'],
  cancelSettle:      ['ym', 'targetName', 'requester', 'token'],
  resetSettle:       ['ym', 'requester', 'token']
};
// 업로드 계열은 파라미터에 토큰이 없으므로 세션의 name/token 을 자동 주입 (백엔드가 검증)
const API_NEEDS_SESSION = { startUpload: 1, startHallUpload: 1, uploadChunk: 1, checkUploadStatus: 1 };

let API_SESSION = { name: '', token: '' };
function apiSetSession(s) {
  API_SESSION = { name: (s && s.name) || '', token: (s && s.token) || '' };
}

function apiUnwrap_(env) {
  if (env && env.ok) return env.data;
  throw new Error((env && env.error) || '서버 응답 오류');
}

async function run(fn) {
  const args = Array.prototype.slice.call(arguments, 1);

  // 개발용 목데이터 (?mock=1 로 열었을 때만 js/mock.js 가 window.API_MOCK 정의)
  if (window.API_MOCK) return window.API_MOCK.handle(fn, args);

  if (API_GET[fn]) {
    let qs = '?action=' + encodeURIComponent(fn);
    API_GET[fn].forEach(function (k, i) {
      if (args[i] !== undefined && args[i] !== null && args[i] !== '') {
        qs += '&' + k + '=' + encodeURIComponent(args[i]);
      }
    });
    const res = await fetch(GAS_URL + qs);
    return apiUnwrap_(await res.json());
  }

  if (API_POST[fn]) {
    const body = { action: fn };
    API_POST[fn].forEach(function (k, i) {
      if (args[i] !== undefined) body[k] = args[i];
    });
    if (API_NEEDS_SESSION[fn]) {
      body.name = API_SESSION.name;
      body.token = API_SESSION.token;
    }
    const res = await fetch(GAS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' }, // ★ application/json 금지 (CORS)
      body: JSON.stringify(body)
    });
    return apiUnwrap_(await res.json());
  }

  throw new Error('알 수 없는 API 액션: ' + fn);
}
