/**
 * 석기시대 부족 웹앱 — votes.gs
 * 정기공격/자연재해 투표 · 번개 · 일정 확정 · 마감 판정.
 * (로직은 원본 v3.0.2/Code.gs에서 그대로 이전. GAS는 전역 스코프 공유.)
 */

/* ---------- 위치 열 자동 마이그레이션 (멱등) ----------
 * 자연재해 시트에 '위치' 전용 열을 1회 추가한다.
 * - 자연재해: A=날짜, [B=위치 삽입], C~=투표자. 기존 A라벨 '날짜 @ 위치'를 A/B로 분리.  마커=B1='위치'
 * 마커가 이미 있으면 잠금 없이 즉시 통과. 각 함수 진입점에서 "자기 잠금을 잡기 전에" 호출한다(중첩 잠금 방지).
 * (정기공격일자 시트는 더 이상 앱이 쓰지 않는다 — 정기공격은 고정 일정으로 전환됨, raidSchedule_ 참고.)
 */
function ensureLocationColumns_() {
  const s = ss_();
  const dis = s.getSheetByName(CONFIG.SHEETS.disaster);
  const disNeeds = dis && String(dis.getRange(1, 2).getDisplayValue()).trim() !== '위치';
  if (!disNeeds) return; // 이미 완료 — 잠금 없이 통과 (평상시 경로)
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    if (dis && String(dis.getRange(1, 2).getDisplayValue()).trim() !== '위치') {
      dis.insertColumnAfter(1);             // A 다음(B) 새 열 → 기존 투표자(B~) C~로 밀림
      const last = dis.getLastRow();
      for (let r = 2; r <= last; r++) {     // 데이터 행: A라벨 '날짜 @ 위치'를 A(날짜)/B(위치)로 분리
        const label = String(dis.getRange(r, 1).getDisplayValue()).trim();
        if (!label) continue;
        const idx = label.indexOf(' @ ');
        if (idx > -1) {
          dis.getRange(r, 1).setValue(label.slice(0, idx));
          dis.getRange(r, 2).setValue(label.slice(idx + 3));
        }
      }
      dis.getRange(1, 2).setValue('위치');  // B1 헤더 겸 마커
    }
  } finally {
    lock.releaseLock();
  }
}

/* ---------- 번개(자연재해) 등록자 관리 (수정/완료/삭제 권한용) ---------- */
function getFlashOwners_() {
  const v = PropertiesService.getScriptProperties().getProperty('flash_owners');
  return v ? JSON.parse(v) : {};
}
function setFlashOwners_(obj) {
  PropertiesService.getScriptProperties().setProperty('flash_owners', JSON.stringify(obj));
}

// 번개 논리 키: '날짜 @ 위치'. 시트엔 날짜(A)/위치(B) 분리 저장하지만, 프론트·flash_owners 키는 이 합성 문자열을 유지.
function flashLabel_(date, loc) {
  date = String(date || '').trim();
  loc = String(loc || '').trim();
  return loc ? date + ' @ ' + loc : date;
}

// 번개 개설자 판정: flash_owners 기록이 있으면 그 값, 없으면(기록 없는 번개) 시트 C열(첫 투표자=개설자)로 폴백.
function flashOwnerOf_(dateText) {
  const owners = getFlashOwners_();
  if (owners[dateText]) return owners[dateText];
  const sh = ss_().getSheetByName(CONFIG.SHEETS.disaster);
  if (!sh) return '';
  const vals = sh.getDataRange().getDisplayValues();
  for (let i = 1; i < vals.length; i++) {
    if (flashLabel_(vals[i][0], vals[i][1]) === dateText) {
      return vals[i][2] ? String(vals[i][2]).trim() : ''; // C열 = 첫 투표자(개설자)
    }
  }
  return '';
}

/* ---------- 번개 개설 가능 직책 (관리자 설정) ----------
 * 기본값은 ROLES 전체(=제한 없음, 기존 동작 유지) — 관리자가 원할 때만 좁힌다.
 * open_session_roles(opensessions.gs)와 동일한 패턴.
 */
function getFlashRoles_() {
  const v = PropertiesService.getScriptProperties().getProperty('flash_roles');
  if (v) {
    try {
      const arr = JSON.parse(v);
      if (Array.isArray(arr) && arr.length) return arr;
    } catch (e) {}
  }
  return ROLES.slice();
}
function setFlashRoles_(arr) {
  PropertiesService.getScriptProperties().setProperty('flash_roles', JSON.stringify(arr));
}
function canOpenFlash_(name) {
  if (isAdmin_(name)) return true;
  const m = splitBySupport_(ss_()).all.find(function (x) { return x.name === name; });
  const role = m ? m.role : ROLES[0];
  return getFlashRoles_().indexOf(role) > -1;
}
// 관리자 전용: 번개 개설 가능 직책 목록 설정
function setFlashRoles(roles, requester, authToken) {
  requester = verify_(requester, authToken);
  if (!isAdmin_(requester)) throw new Error('관리자만 번개 개설 가능 직책을 설정할 수 있습니다.');
  if (!Array.isArray(roles)) throw new Error('직책 배열이 필요합니다.');
  const clean = roles.filter(function (r) { return ROLES.indexOf(r) > -1; });
  if (!clean.length) throw new Error('최소 1개 직책을 선택하세요.');
  setFlashRoles_(clean);
  return { roles: clean };
}

// 번개 열기: 자연재해 시트에 새 행 추가 (A=날짜, B=위치, C=등록자)
function addFlash(dateText, loc, creator, authToken) {
  creator = verify_(creator, authToken);
  if (!canOpenFlash_(creator)) throw new Error('번개를 열 수 있는 직책이 아닙니다.');
  ensureLocationColumns_();
  dateText = String(dateText || '').trim();
  loc = String(loc || '').trim();
  if (!dateText) throw new Error('날짜를 입력하세요.');
  if (!loc) throw new Error('위치를 입력하세요.');
  const label = flashLabel_(dateText, loc);
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const sh = ss_().getSheetByName(CONFIG.SHEETS.disaster);
    const vals = sh.getDataRange().getDisplayValues();
    for (let i = 1; i < vals.length; i++) {
      if (flashLabel_(vals[i][0], vals[i][1]) === label) throw new Error('이미 같은 번개가 있습니다.');
    }
    sh.appendRow([dateText, loc, creator]); // A=날짜, B=위치, C=등록자(첫 참여자 겸)
    const owners = getFlashOwners_();
    owners[label] = creator;
    setFlashOwners_(owners);
    sendPush_('⚡ 번개 소집!', dateText + (loc ? ' @ ' + loc : '') + '\n같이 갈 사람 모여라 🔥', {}); // 전체 푸시
    return readVotes_(ss_(), CONFIG.SHEETS.disaster);
  } finally {
    lock.releaseLock();
  }
}

// 번개 삭제: 개설자 또는 관리자만
function deleteFlash(dateText, requester, authToken) {
  requester = verify_(requester, authToken);
  ensureLocationColumns_();
  const owner = flashOwnerOf_(dateText);
  if (owner !== requester && CONFIG.ADMINS.indexOf(requester) < 0) {
    throw new Error('본인이 연 번개만 취소할 수 있습니다.');
  }
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const sh = ss_().getSheetByName(CONFIG.SHEETS.disaster);
    const vals = sh.getDataRange().getDisplayValues();
    for (let i = 1; i < vals.length; i++) {
      if (flashLabel_(vals[i][0], vals[i][1]) === dateText) {
        sh.deleteRow(i + 1);
        break;
      }
    }
    const owners = getFlashOwners_();
    delete owners[dateText];
    setFlashOwners_(owners);
    return readVotes_(ss_(), CONFIG.SHEETS.disaster);
  } finally {
    lock.releaseLock();
  }
}

// 자연재해 시트 읽기: A=날짜, B=위치, C~=투표자. date는 투표 키로 합성 라벨('날짜 @ 위치') 유지.
function readVotes_(s, sheetName) {
  const sh = s.getSheetByName(sheetName);
  if (!sh) return [];
  const vals = sh.getDataRange().getDisplayValues();
  return vals.slice(1)
    .filter(function(r) { return r[0]; })
    .map(function(r) {
      const date = String(r[0]);
      const loc = r[1] ? String(r[1]) : '';
      return {
        date: flashLabel_(date, loc),
        loc: loc,
        dateInfo: dateInfo_(date, ''),   // 표준 표기 (파싱 실패 시 null → 원본 라벨 표시)
        voters: r.slice(2).filter(String)
      };
    });
}

/* ---------- 날짜 라벨 표준화 ----------
 * '7/16', '7/16(수) 20:00', '2026-07-16', '7월 16일' 등 → YYYY-MM-DD (요일) [HH:mm]
 * monthHint('2026-07'): 연도 없는 라벨의 연도 보정 (정기공격 월 그룹). 없으면 올해로 추정.
 * 반환: { iso, ym, weekday, time|null, display } 또는 파싱 실패 시 null (호출부는 원본 라벨 폴백)
 */
const WEEKDAY_KO_ = ['일', '월', '화', '수', '목', '금', '토'];

function dateInfo_(label, monthHint) {
  if (!label) return null;
  label = String(label).trim();
  let y, mo, da;
  // 1) 연도 포함: 2026-07-16 / 2026.7.16 / 2026년 7월 16일
  let m = label.match(/(\d{4})\s*[.\-\/년]\s*(\d{1,2})\s*[.\-\/월]\s*(\d{1,2})/);
  if (m) { y = +m[1]; mo = +m[2]; da = +m[3]; }
  else {
    // 2) 월/일만: 7/16 · 7월 16일 · 7-16 (콜론(:)은 시각이므로 제외됨)
    m = label.match(/(\d{1,2})\s*[.\-\/월]\s*(\d{1,2})/);
    if (!m) return null;
    mo = +m[1]; da = +m[2];
    y = (monthHint && /^\d{4}-\d{2}$/.test(monthHint)) ? +monthHint.slice(0, 4) : new Date().getFullYear();
  }
  if (mo < 1 || mo > 12 || da < 1 || da > 31) return null;
  const d = new Date(y, mo - 1, da);
  if (d.getMonth() !== mo - 1) return null; // 2/30 같은 무효 날짜
  const iso = y + '-' + ('0' + mo).slice(-2) + '-' + ('0' + da).slice(-2);
  const tm = label.match(/(\d{1,2}):(\d{2})/);
  const time = tm ? ('0' + tm[1]).slice(-2) + ':' + tm[2] : null;
  const weekday = WEEKDAY_KO_[d.getDay()];
  return {
    iso: iso,
    ym: iso.slice(0, 7),
    weekday: weekday,
    time: time,
    display: iso + ' (' + weekday + ')' + (time ? ' ' + time : '')
  };
}

/* ---------- 투표 통합 조회 (월별 필터) ----------
 * month('2026-07', 선택): 정기공격은 월 그룹, 번개는 dateInfo.ym 기준으로 필터.
 * months: 존재하는 모든 월 목록 (프론트 필터 드롭다운용).
 */
function getVotes(month) {
  ensureLocationColumns_();
  const s = ss_();
  let raidSchedule = getRaidSchedule_();
  let disaster = readVotes_(s, CONFIG.SHEETS.disaster);
  const seen = {};
  raidSchedule.forEach(function (r) { seen[r.month] = true; });
  disaster.forEach(function (d) { if (d.dateInfo) seen[d.dateInfo.ym] = true; });
  const months = Object.keys(seen).sort();
  month = String(month || '').trim();
  if (month) {
    raidSchedule = raidSchedule.filter(function (r) { return r.month === month; });
    disaster = disaster.filter(function (d) { return d.dateInfo && d.dateInfo.ym === month; });
  }
  return {
    months: months,
    raidSchedule: raidSchedule,
    disaster: disaster,
    confirmed: getConfirmed_(),
    flashOwners: getFlashOwners_()
  };
}

/* ---------- 정기공격: 고정 일정 (투표 없음, 관리자 지정) ----------
 * 더 이상 후보를 투표로 정하지 않는다. 기본값은 그 달 둘째 주 금요일 20시 + CONFIG.RAID_LOCATIONS 로테이션
 * (월 기준으로 결정적 계산 — 별도 카운터 불필요, 언제 계산해도 같은 월엔 같은 값).
 * 관리자가 다르게 정하고 싶으면 setRaidDate 로 그 달만 override(Script Property raid_overrides) 저장.
 * 참석확정(RSVP)·완료처리는 기존 그대로 유지된다 — 이 일정이 실제 "확정"과 동일한 지위를 갖는다.
 */
const RAID_SCHEDULE_MONTHS = 3; // 이번 달 포함 몇 개월치를 목록에 노출할지

function getRaidOverrides_() {
  const v = PropertiesService.getScriptProperties().getProperty('raid_overrides');
  return v ? JSON.parse(v) : {};
}
function setRaidOverrides_(obj) {
  PropertiesService.getScriptProperties().setProperty('raid_overrides', JSON.stringify(obj));
}

// 그 달의 둘째 주 금요일 라벨 ('M/d 20:00')
function secondFridayLabel_(month) {
  const y = +month.slice(0, 4), mo = +month.slice(5, 7);
  const first = new Date(y, mo - 1, 1);
  const firstFriday = 1 + ((5 - first.getDay() + 7) % 7); // 그 달 첫 금요일(1~7)
  const day = firstFriday + 7;                            // 둘째 주 금요일
  return mo + '/' + day + ' 20:00';
}

// 월 기준 결정적 로테이션 인덱스 (상태 저장 없이 항상 같은 월 → 같은 장소)
function raidLocationFor_(month) {
  const locs = CONFIG.RAID_LOCATIONS;
  const y = +month.slice(0, 4), mo = +month.slice(5, 7);
  const idx = ((y * 12 + (mo - 1)) % locs.length + locs.length) % locs.length;
  return locs[idx];
}

function computeDefaultRaidDate_(month) {
  return { date: secondFridayLabel_(month), loc: raidLocationFor_(month) };
}

// override 유무와 관계없이 그 달의 "현재 유효한" 일정 하나를 계산
function raidEntryFor_(month) {
  const ov = getRaidOverrides_()[month];
  const base = computeDefaultRaidDate_(month);
  const date = (ov && ov.date) ? ov.date : base.date;
  const loc = (ov && ov.loc) ? ov.loc : base.loc;
  return {
    month: month,
    date: date,
    loc: loc,
    note: ov ? String(ov.note || '') : '',
    isOverride: !!ov,
    dateInfo: dateInfo_(date, month)
  };
}

// 노출 대상 월: 이번 달부터 RAID_SCHEDULE_MONTHS개월 + override가 남아있는 월(완료 처리 전이면) 전부
function raidScheduleMonths_() {
  const now = new Date();
  const months = {};
  for (let i = 0; i < RAID_SCHEDULE_MONTHS; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
    months[d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2)] = true;
  }
  Object.keys(getRaidOverrides_()).forEach(function (m) { months[m] = true; });
  return Object.keys(months).sort();
}

function getRaidSchedule_() {
  const done = getCompletedRaidMonths_(); // 완료 처리된 월은 목록에서 제외 (#완료처리, 기존과 동일)
  return raidScheduleMonths_()
    .filter(function (m) { return !done[m]; })
    .map(raidEntryFor_);
}

// 관리자 전용: 그 달 일정을 직접 지정. date가 빈 값이면 override 삭제(기본값 = 둘째 주 금요일+로테이션으로 복귀)
function setRaidDate(month, date, loc, note, requester, authToken) {
  requester = verify_(requester, authToken);
  if (!isAdmin_(requester)) throw new Error('관리자만 정기공격 일정을 지정할 수 있습니다.');
  month = String(month || '').trim();
  if (!/^\d{4}-\d{2}$/.test(month)) throw new Error('대상 월 형식 오류 (yyyy-MM).');
  date = String(date || '').trim();
  loc = String(loc || '').trim();
  note = String(note || '').trim();
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const overrides = getRaidOverrides_();
    if (!date) {
      delete overrides[month];
    } else {
      overrides[month] = { date: date, loc: loc, note: note, setBy: requester, setAt: new Date().toISOString() };
    }
    setRaidOverrides_(overrides);
    return getRaidSchedule_();
  } finally {
    lock.releaseLock();
  }
}

// 관리자 전용: 정기공격 기본 위치 로테이션 순서 자체를 설정 (Script Property raid_locations)
// CONFIG.RAID_LOCATIONS는 실행 시작 시 한 번만 읽으므로(다른 CONFIG 값과 동일), 이번 응답이 아니라
// 다음 요청부터 새 순서가 반영된다 — setAdmins 와 동일한 패턴.
function setRaidLocations(locations, requester, authToken) {
  requester = verify_(requester, authToken);
  if (!isAdmin_(requester)) throw new Error('관리자만 위치 로테이션을 설정할 수 있습니다.');
  if (!Array.isArray(locations)) throw new Error('위치 배열이 필요합니다.');
  const clean = []; const seen = {};
  locations.forEach(function (loc) {
    const n = String(loc).trim();
    if (!n) return;
    if (n.length > 20) throw new Error('위치 이름은 20자 이내로: ' + n);
    if (seen[n]) throw new Error('위치 이름이 중복돼요: ' + n);
    seen[n] = true; clean.push(n);
  });
  if (!clean.length) throw new Error('최소 1개 위치가 필요합니다.');
  PropertiesService.getScriptProperties().setProperty('raid_locations', JSON.stringify(clean));
  return { locations: clean };
}

function getConfirmed_() {
  const p = PropertiesService.getScriptProperties();
  function parse(key) {
    const v = p.getProperty(key);
    if (!v) return null;
    try {
      const o = JSON.parse(v);
      return o && o.date ? o : { date: v, loc: '' };
    } catch (e) {
      return { date: v, loc: '' };
    }
  }
  return { disaster: parse('confirmed_disaster') };
}

/* ---------- 참석 확정 (RSVP) ----------
 * 확정된 정기공격 모임에 대해 회원이 참석(yes)/불참(no) 표시. Script Property 'rsvp' = { 월: { 이름: 'yes'|'no' } }.
 */
function getRsvp_() {
  const v = PropertiesService.getScriptProperties().getProperty('rsvp');
  try { return v ? JSON.parse(v) : {}; } catch (e) { return {}; }
}
function setRsvp(month, status, name, authToken) {
  name = verify_(name, authToken); // 로그인 확인 (본인 것만 — name 은 토큰으로 검증)
  month = String(month || '').trim();
  if (!/^\d{4}-\d{2}$/.test(month)) throw new Error('월 형식 오류.');
  status = String(status || '').trim();
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const all = getRsvp_();
    const m = all[month] || (all[month] = {});
    if (status === 'yes' || status === 'no') m[name] = status;
    else delete m[name]; // 빈 값 = 미정(취소)
    PropertiesService.getScriptProperties().setProperty('rsvp', JSON.stringify(all));
    return { rsvp: all };
  } finally {
    lock.releaseLock();
  }
}

/* ---------- 투표 (토글) ----------
 * 자연재해(번개)만 투표 대상 (정기공격은 더 이상 투표하지 않음 — setRaidDate 참고).
 */
function toggleVote(dateText, voter, token) {
  voter = verify_(voter, token);
  ensureLocationColumns_();
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    // 자연재해(번개): A=날짜, B=위치, C~=투표자
    const sh = ss_().getSheetByName(CONFIG.SHEETS.disaster);
    const vals = sh.getDataRange().getDisplayValues();
    for (let i = 1; i < vals.length; i++) {
      if (flashLabel_(vals[i][0], vals[i][1]) === dateText) {
        let voters = vals[i].slice(2).filter(String);
        voters = voters.indexOf(voter) > -1
          ? voters.filter(function(v) { return v !== voter; })
          : voters.concat(voter);
        const width = Math.max(sh.getLastColumn() - 2, voters.length, 1);
        sh.getRange(i + 1, 3, 1, width)
          .setValues([voters.concat(new Array(width - voters.length).fill(''))]);
        return { date: dateText, voters: voters };
      }
    }
    throw new Error('해당 일자를 찾을 수 없습니다: ' + dateText);
  } finally {
    lock.releaseLock();
  }
}

/* ---------- 자연재해(번개) 수정 ----------
 * 날짜/위치 라벨만 변경 (투표자는 해당 행 그대로 유지). 등록자 또는 관리자만 가능.
 */
function editFlash(dateText, newDate, newLoc, requester, authToken) {
  requester = verify_(requester, authToken);
  ensureLocationColumns_();
  const owner = flashOwnerOf_(dateText);
  if (owner !== requester && !isAdmin_(requester)) {
    throw new Error('본인이 연 번개만 수정할 수 있습니다.');
  }
  newDate = String(newDate || '').trim();
  newLoc = String(newLoc || '').trim();
  if (!newDate) throw new Error('날짜를 입력하세요.');
  if (!newLoc) throw new Error('위치를 입력하세요.');
  const newLabel = flashLabel_(newDate, newLoc);
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const sh = ss_().getSheetByName(CONFIG.SHEETS.disaster);
    const vals = sh.getDataRange().getDisplayValues();
    let found = -1;
    for (let i = 1; i < vals.length; i++) {
      const label = flashLabel_(vals[i][0], vals[i][1]);
      if (label === dateText) found = i;
      else if (label === newLabel) throw new Error('이미 같은 번개가 있습니다.');
    }
    if (found < 0) throw new Error('해당 번개를 찾을 수 없습니다.');
    if (newLabel !== dateText) {
      sh.getRange(found + 1, 1).setValue(newDate); // A=날짜
      sh.getRange(found + 1, 2).setValue(newLoc);  // B=위치
      // 폴백(C열)으로 알아낸 개설자도 이번에 flash_owners에 정식 기록해둔다(다음부터는 폴백 없이 바로 조회).
      if (owner) {
        const owners = getFlashOwners_();
        delete owners[dateText];
        owners[newLabel] = owner;
        setFlashOwners_(owners);
      }
    }
    return readVotes_(ss_(), CONFIG.SHEETS.disaster);
  } finally {
    lock.releaseLock();
  }
}

/* ---------- 완료 처리 (정기공격/자연재해 종료) ----------
 * 완료하면 목록(UI)에서 사라지고 '완료기록' 시트에 남는다.
 * - 정기공격: 확정된 월(완료) 또는 확정 없이 마감된 월(모임 없음)만 가능. 후보 행은 사람이 등록한 것이라 시트는 그대로 두고,
 *   Script Properties(completed_raid_months)에 완료 플래그만 남겨 목록에서 제외한다(getRaidSchedule_).
 * - 자연재해: 시트 전체를 앱이 관리하므로 취소(deleteFlash)와 동일하게 행 자체를 제거한다.
 */
function getCompletedRaidMonths_() {
  const v = PropertiesService.getScriptProperties().getProperty('completed_raid_months');
  return v ? JSON.parse(v) : {};
}
function setCompletedRaidMonths_(obj) {
  PropertiesService.getScriptProperties().setProperty('completed_raid_months', JSON.stringify(obj));
}

function completionLogSheet_() {
  const s = ss_();
  let sh = s.getSheetByName(CONFIG.SHEETS.completion);
  if (!sh) sh = s.insertSheet(CONFIG.SHEETS.completion);
  if (sh.getLastRow() === 0) sh.appendRow(['처리일시', '종류', '월', '날짜', '위치', '참여인원', '처리자']);
  return sh;
}
function logCompletion_(kind, month, dateLabel, loc, voters, requester) {
  completionLogSheet_().appendRow([
    new Date(), kind, month || '', dateLabel || '', loc || '', (voters || []).join(', '), requester
  ]);
}

// 완료기록 최근 목록 (더보기 탭 노출용, 공개 GET — getHallArchive와 동일한 성격의 조회)
function getCompletionLog(limit) {
  limit = limit || 10;
  const sh = ss_().getSheetByName(CONFIG.SHEETS.completion);
  if (!sh || sh.getLastRow() < 2) return { items: [] };
  const vals = sh.getDataRange().getDisplayValues();
  const items = [];
  for (let i = vals.length - 1; i >= 1 && items.length < limit; i--) {
    const r = vals[i]; // [처리일시, 종류, 월, 날짜, 위치, 참여인원, 처리자]
    if (!r[0]) continue;
    items.push({ when: r[0], kind: r[1], month: r[2], date: r[3], loc: r[4], people: r[5], by: r[6] });
  }
  return { items: items };
}

// 정기공격 월 완료 처리 — 관리자 전용.
// cancelled=true 면 "모임 없음"으로 종료(그 달 일정이 실제로 진행되지 않은 경우), 아니면 그 달 고정 일정으로
// "완료"(모임 진행) 처리하고 참여자는 그 달 RSVP 'yes' 명단으로 기록한다.
function completeRaid(month, requester, authToken, cancelled) {
  requester = verify_(requester, authToken);
  if (!isAdmin_(requester)) throw new Error('관리자만 완료 처리할 수 있습니다.');
  month = String(month || '').trim();
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    if (cancelled) {
      logCompletion_('정기공격', month, '(모임 없음)', '', [], requester);
    } else {
      const entry = raidEntryFor_(month);
      const rsvpMap = getRsvp_()[month] || {};
      const going = Object.keys(rsvpMap).filter(function (n) { return rsvpMap[n] === 'yes'; });
      logCompletion_('정기공격', month, entry.date, entry.loc, going, requester);
    }
    const done = getCompletedRaidMonths_();
    done[month] = { at: new Date().toISOString(), by: requester };
    setCompletedRaidMonths_(done);
    return getRaidSchedule_();
  } finally {
    lock.releaseLock();
  }
}

// 이번 달 완료 처리된 모임의 참여자였는데 아직 이번 달 사진 인증을 안 한 사람인지 — 로그인 시 개인화 리마인드용.
// 본인 여부만 반환(다른 사람 인증 현황은 노출하지 않음).
function needsCertNudge_(name) {
  name = String(name || '').trim();
  if (!name) return false;
  const s = ss_();
  const cert = getCertified_(s);
  if (cert.map[name]) return false; // 이미 인증했으면 알림 불필요
  const sh = s.getSheetByName(CONFIG.SHEETS.completion);
  if (!sh || sh.getLastRow() < 2) return false;
  const vals = sh.getDataRange().getDisplayValues();
  for (let i = 1; i < vals.length; i++) {
    if (String(vals[i][2]).trim() !== cert.ym) continue; // C=월
    const people = String(vals[i][5] || '').split(',').map(function (n) { return n.trim(); }); // F=참여인원
    if (people.indexOf(name) > -1) return true;
  }
  return false;
}

// 자연재해(번개) 완료 처리 — 등록자 또는 관리자. 기록 후 행 제거(취소와 동일한 정리).
function completeFlash(dateText, requester, authToken) {
  requester = verify_(requester, authToken);
  ensureLocationColumns_();
  const owner = flashOwnerOf_(dateText);
  if (owner !== requester && !isAdmin_(requester)) {
    throw new Error('본인이 연 번개만 완료 처리할 수 있습니다.');
  }
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const sh = ss_().getSheetByName(CONFIG.SHEETS.disaster);
    const vals = sh.getDataRange().getDisplayValues();
    let found = -1, date = '', loc = '', voters = [];
    for (let i = 1; i < vals.length; i++) {
      if (flashLabel_(vals[i][0], vals[i][1]) === dateText) {
        found = i;
        date = String(vals[i][0]).trim();
        loc = vals[i][1] ? String(vals[i][1]).trim() : '';
        voters = vals[i].slice(2).filter(String);
        break;
      }
    }
    if (found < 0) throw new Error('해당 번개를 찾을 수 없습니다.');
    const info = dateInfo_(date, '');
    logCompletion_('자연재해', info ? info.ym : '', date, loc, voters, requester);
    sh.deleteRow(found + 1);
    const owners = getFlashOwners_();
    delete owners[dateText];
    setFlashOwners_(owners);
    return readVotes_(ss_(), CONFIG.SHEETS.disaster);
  } finally {
    lock.releaseLock();
  }
}
