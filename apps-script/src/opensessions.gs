/**
 * 석기시대 부족 웹앱 — opensessions.gs
 * 정기 오픈 세션 — 요일 + 장소로 매주 반복되는 자유 참가 세션. 투표/참석확정 없이 정보 게시용.
 *
 * 저장: Script Property 'open_sessions' = [{ id, weekday(0=일~6=토), loc, note, createdBy, createdAt }]
 *      Script Property 'open_session_roles' = 개설 가능 직책 배열(기본 ['팀장'])
 *
 * 권한: 개설(add)은 관리자 또는 open_session_roles 에 포함된 직책만(canOpenSession_).
 *      수정/삭제는 개설자 또는 관리자만(자연재해 번개와 동일한 소유권 패턴).
 *      개설 가능 직책 설정(setOpenSessionRoles)은 관리자 전용.
 * 개설 시 번개(addFlash)와 동일하게 sendPush_ 로 전체 푸시를 보낸다.
 */

function getOpenSessionRoles_() {
  const v = PropertiesService.getScriptProperties().getProperty('open_session_roles');
  if (v) {
    try {
      const arr = JSON.parse(v);
      if (Array.isArray(arr) && arr.length) return arr;
    } catch (e) {}
  }
  return ['팀장'];
}
function setOpenSessionRoles_(arr) {
  PropertiesService.getScriptProperties().setProperty('open_session_roles', JSON.stringify(arr));
}

function canOpenSession_(name) {
  if (isAdmin_(name)) return true;
  const m = splitBySupport_(ss_()).all.find(function (x) { return x.name === name; });
  const role = m ? m.role : ROLES[0];
  return getOpenSessionRoles_().indexOf(role) > -1;
}

function getOpenSessionsRaw_() {
  const v = PropertiesService.getScriptProperties().getProperty('open_sessions');
  try {
    const arr = v ? JSON.parse(v) : [];
    return Array.isArray(arr) ? arr : [];
  } catch (e) { return []; }
}
function setOpenSessionsRaw_(arr) {
  PropertiesService.getScriptProperties().setProperty('open_sessions', JSON.stringify(arr));
}

// 공개 조회 — 목록 + 개설 가능 직책(권한 판단용)
function getOpenSessions() {
  return { items: getOpenSessionsRaw_(), roles: getOpenSessionRoles_() };
}

function assertValidWeekday_(weekday) {
  const w = Number(weekday);
  if (isNaN(w) || w < 0 || w > 6) throw new Error('요일 형식 오류(0=일~6=토).');
  return w;
}

function addOpenSession(weekday, loc, note, requester, authToken) {
  requester = verify_(requester, authToken);
  if (!canOpenSession_(requester)) throw new Error('정기 오픈 세션을 열 수 있는 직책이 아닙니다.');
  weekday = assertValidWeekday_(weekday);
  loc = String(loc || '').trim();
  if (!loc) throw new Error('장소를 입력하세요.');
  note = String(note || '').trim();
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const list = getOpenSessionsRaw_();
    list.push({
      id: Utilities.getUuid(), weekday: weekday, loc: loc, note: note,
      createdBy: requester, createdAt: new Date().toISOString()
    });
    setOpenSessionsRaw_(list);
    sendPush_('🧭 정기 오픈 세션 개설!', '매주 ' + WEEKDAY_KO_[weekday] + '요일 @ ' + loc +
      (note ? '\n' + note : '') + '\n' + requester + ' 님이 열었어요', {}); // 전체 푸시 (번개와 동일)
    return getOpenSessions();
  } finally {
    lock.releaseLock();
  }
}

// 수정/삭제는 개설자 또는 관리자만 (canOpenSession_ 재검증 없음 — 개설 후 직책이 바뀌어도 본인 것은 계속 관리 가능)
function editOpenSession(id, weekday, loc, note, requester, authToken) {
  requester = verify_(requester, authToken);
  id = String(id || '').trim();
  weekday = assertValidWeekday_(weekday);
  loc = String(loc || '').trim();
  if (!loc) throw new Error('장소를 입력하세요.');
  note = String(note || '').trim();
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const list = getOpenSessionsRaw_();
    const item = list.find(function (x) { return x.id === id; });
    if (!item) throw new Error('해당 오픈 세션을 찾을 수 없습니다.');
    if (item.createdBy !== requester && !isAdmin_(requester)) {
      throw new Error('본인이 연 오픈 세션만 수정할 수 있습니다.');
    }
    item.weekday = weekday; item.loc = loc; item.note = note;
    setOpenSessionsRaw_(list);
    return getOpenSessions();
  } finally {
    lock.releaseLock();
  }
}

function deleteOpenSession(id, requester, authToken) {
  requester = verify_(requester, authToken);
  id = String(id || '').trim();
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const list = getOpenSessionsRaw_();
    const item = list.find(function (x) { return x.id === id; });
    if (!item) throw new Error('해당 오픈 세션을 찾을 수 없습니다.');
    if (item.createdBy !== requester && !isAdmin_(requester)) {
      throw new Error('본인이 연 오픈 세션만 삭제할 수 있습니다.');
    }
    setOpenSessionsRaw_(list.filter(function (x) { return x.id !== id; }));
    return getOpenSessions();
  } finally {
    lock.releaseLock();
  }
}

// 관리자 전용: 오픈 세션 개설 가능 직책 목록 설정
function setOpenSessionRoles(roles, requester, authToken) {
  requester = verify_(requester, authToken);
  if (!isAdmin_(requester)) throw new Error('관리자만 개설 가능 직책을 설정할 수 있습니다.');
  if (!Array.isArray(roles)) throw new Error('직책 배열이 필요합니다.');
  const clean = roles.filter(function (r) { return ROLES.indexOf(r) > -1; });
  if (!clean.length) throw new Error('최소 1개 직책을 선택하세요.');
  setOpenSessionRoles_(clean);
  return getOpenSessions();
}
