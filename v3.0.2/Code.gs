/**
 * 석기시대 부족 웹앱 — Code.gs
 * 기능: 투표(정기공격일자/자연재해), 사진·영상 인증(공유드라이브 + Google Photos), 벽화 시트 기록
 */

// ⚠️ 실제 값은 커밋 금지. 로컬 Code.local.md(gitignore됨) 참고해 웹에디터/로컬에서만 채울 것.
const CONFIG = {
  SPREADSHEET_ID: 'YOUR_SPREADSHEET_ID',
  DRIVE_FOLDER_ID: 'YOUR_DRIVE_FOLDER_ID',
  SETTLE_FOLDER_ID: 'YOUR_SETTLE_FOLDER_ID',  // 정산 사진 저장 폴더 (별도)
  PHOTOS_ALBUM_ID: 'YOUR_PHOTOS_ALBUM_ID',           // setupPhotosAlbum() 실행 후 로그의 ALBUM_ID 입력. 비워두면 Photos 업로드 생략
  PHOTOS_SHARE_URL: 'YOUR_PHOTOS_SHARE_URL',          // 구글 포토에서 앨범 공유 후 받은 링크 (영상 탭 버튼용)
  NOTION_URL: 'YOUR_NOTION_URL',                // 부족 안내문 노션 페이지 링크
  DRIVE_API_KEY: 'YOUR_DRIVE_API_KEY',             // 전당 영상 인앱 재생용 API 키 (GCP → 사용자 인증 정보 → API 키)
  NOTION_TOKEN: 'YOUR_NOTION_TOKEN',              // 노션 Integration 토큰 (ntn_... 또는 secret_...)
  NOTION_DB_ID: 'YOUR_NOTION_DB_ID',  // 정기모임 캘린더 DB ID
  SHEETS: {
    members: '부족원',
    raid: '정기공격일자',
    disaster: '자연재해',
    mural: '벽화',
    hall: '명예의전당'
  },
  PHOTOS_MAX_BYTES: 45 * 1024 * 1024,  // 45MB 초과 파일은 Drive에만 저장 (Apps Script 응답 한도)
  ADMINS: ['김광훈'],            // 일정 확정 권한자 (부족원 시트의 이름과 동일하게)
  ADMIN_PIN: '0102'              // 확정 시 입력할 PIN — 꼭 변경할 것
};




/* ---------- 웹앱 진입점 ---------- */

function doGet() {
  const t = HtmlService.createTemplateFromFile('index');
  t.execUrl = ScriptApp.getService().getUrl();

  return t.evaluate()
    .setTitle('석기시대')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, maximum-scale=1, viewport-fit=cover')
    .addMetaTag('apple-mobile-web-app-capable', 'yes')
    .addMetaTag('mobile-web-app-capable', 'yes')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
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

/* ---------- 번개(자연재해) 등록자 관리 (삭제 권한용) ---------- */
function getFlashOwners_() {
  const v = PropertiesService.getScriptProperties().getProperty('flash_owners');
  return v ? JSON.parse(v) : {};
}
function setFlashOwners_(obj) {
  PropertiesService.getScriptProperties().setProperty('flash_owners', JSON.stringify(obj));
}

// 번개 열기: 자연재해 시트 A열에 새 행 추가 (등록자 기록)
function addFlash(dateText, loc, creator, authToken) {
  creator = verify_(creator, authToken);
  dateText = String(dateText || '').trim();
  loc = String(loc || '').trim();
  if (!dateText) throw new Error('날짜를 입력하세요.');
  if (!loc) throw new Error('위치를 입력하세요.');
  const label = dateText + ' @ ' + loc;
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const sh = ss_().getSheetByName(CONFIG.SHEETS.disaster);
    const vals = sh.getDataRange().getDisplayValues();
    for (let i = 1; i < vals.length; i++) {
      if (String(vals[i][0]).trim() === label) throw new Error('이미 같은 번개가 있습니다.');
    }
    sh.appendRow([label, creator]); // A=라벨, B=등록자(첫 참여자 겸)
    const owners = getFlashOwners_();
    owners[label] = creator;
    setFlashOwners_(owners);
    return readVotes_(ss_(), CONFIG.SHEETS.disaster);
  } finally {
    lock.releaseLock();
  }
}

// 번개 삭제: 등록자 또는 관리자만
function deleteFlash(dateText, requester, authToken) {
  requester = verify_(requester, authToken);
  const owners = getFlashOwners_();
  const owner = owners[dateText];
  if (owner !== requester && CONFIG.ADMINS.indexOf(requester) < 0) {
    throw new Error('본인이 연 번개만 취소할 수 있습니다.');
  }
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const sh = ss_().getSheetByName(CONFIG.SHEETS.disaster);
    const vals = sh.getDataRange().getDisplayValues();
    for (let i = 1; i < vals.length; i++) {
      if (String(vals[i][0]).trim() === dateText) {
        sh.deleteRow(i + 1);
        break;
      }
    }
    delete owners[dateText];
    setFlashOwners_(owners);
    return readVotes_(ss_(), CONFIG.SHEETS.disaster);
  } finally {
    lock.releaseLock();
  }
}

/* ---------- 개인 PIN 로그인 (사칭 방지) ----------
 * 부족원 시트 I열(9번째)에 개인 PIN 입력. 로그인 성공 시 서명 토큰 발급 →
 * 이후 모든 요청에 name+token을 실어 서버가 검증. PIN 자체는 클라에 노출 안 됨.
 */

function loginWithPin(name, pin) {
  name = String(name || '').trim();
  pin = String(pin || '').trim();
  const s = ss_();
  const sheet = s.getSheetByName(CONFIG.SHEETS.members);
  const rows = sheet.getRange('A2:I').getDisplayValues();
  for (let i = 0; i < rows.length; i++) {
    if (String(rows[i][0]).trim() === name) {
      const real = String(rows[i][8]).trim(); // I열 = PIN
      if (!real) {
        // 최초 로그인: 이 사람이 PIN을 처음 설정
        if (pin.length < 4) throw new Error('PIN은 4자리 이상으로 설정하세요.');
        sheet.getRange(i + 2, 9).setValue("'" + pin); // 앞자리 0 보존 위해 텍스트로
        return { name: name, token: makeToken_(name), isAdmin: CONFIG.ADMINS.indexOf(name) > -1, firstSet: true };
      }
      if (pin !== real) throw new Error('PIN이 올바르지 않습니다.');
      return { name: name, token: makeToken_(name), isAdmin: CONFIG.ADMINS.indexOf(name) > -1 };
    }
  }
  throw new Error('명단에 없는 이름입니다.');
}

// 로그인 후 PIN 변경 (기존 PIN 확인)
function changePin(name, oldPin, newPin, authToken) {
  name = verify_(name, authToken);
  newPin = String(newPin || '').trim();
  if (newPin.length < 4) throw new Error('새 PIN은 4자리 이상이어야 합니다.');
  const s = ss_();
  const sheet = s.getSheetByName(CONFIG.SHEETS.members);
  const rows = sheet.getRange('A2:I').getDisplayValues();
  for (let i = 0; i < rows.length; i++) {
    if (String(rows[i][0]).trim() === name) {
      if (String(rows[i][8]).trim() !== String(oldPin).trim()) {
        throw new Error('기존 PIN이 올바르지 않습니다.');
      }
      sheet.getRange(i + 2, 9).setValue("'" + newPin);
      return { name: name, token: makeToken_(name), isAdmin: CONFIG.ADMINS.indexOf(name) > -1 };
    }
  }
  throw new Error('명단에 없는 이름입니다.');
}

// 이름 기반 서명 토큰 (스크립트 비밀키 + 이름 해시). PIN이 바뀌면 기존 토큰 자동 무효.
function makeToken_(name) {
  const secret = getSecret_();
  const s = ss_();
  const rows = s.getSheetByName(CONFIG.SHEETS.members).getRange('A2:I').getDisplayValues();
  let pin = '';
  for (let i = 0; i < rows.length; i++) {
    if (String(rows[i][0]).trim() === name) { pin = String(rows[i][8]).trim(); break; }
  }
  const raw = name + '|' + pin + '|' + secret;
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, raw);
  return Utilities.base64EncodeWebSafe(bytes);
}

function getSecret_() {
  const p = PropertiesService.getScriptProperties();
  let sec = p.getProperty('auth_secret');
  if (!sec) { sec = Utilities.getUuid(); p.setProperty('auth_secret', sec); }
  return sec;
}

// 모든 쓰기 요청 앞단에서 호출: 토큰이 이름과 일치하는지 검증
function verify_(name, token) {
  name = String(name || '').trim();
  if (!name || !token || token !== makeToken_(name)) {
    throw new Error('인증이 만료되었습니다. 다시 로그인해주세요.');
  }
  return name;
}

/* ---------- 월별 인증 현황 ---------- */

// 활동일자에서 'yyyy-MM' 추출
// Date 객체 / 'YYYY-MM-DD' / '6/18','6월 18일'(연도없음→올해) 모두 처리
function parseYM_(label) {
  if (!label) return null;
  // 0) Date 객체인 경우 (셀이 날짜 서식일 때)
  if (label instanceof Date) {
    const tz = Session.getScriptTimeZone();
    return Utilities.formatDate(label, tz, 'yyyy-MM');
  }
  label = String(label).trim();
  // 1) 연도가 명시된 경우 (2026-06-18, 2026.6.18, 2026/6 등)
  let m = label.match(/(\d{4})\s*[.\-\/년]\s*(\d{1,2})/);
  if (m) return m[1] + '-' + ('0' + m[2]).slice(-2);
  // 2) 연도 없는 경우 (6/18, 6월 18일, 6-18) → 앞 숫자를 '월'로 보고 올해 연도 사용
  m = label.match(/(\d{1,2})\s*[.\-\/월]/);
  if (m) {
    const mo = parseInt(m[1], 10);
    if (mo >= 1 && mo <= 12) {
      const y = new Date().getFullYear();
      return y + '-' + ('0' + mo).slice(-2);
    }
  }
  return null;
}

// 이번 달 '사진' 인증에 참여자로 1회 이상 기록된 사람 = 인증 완료
function getCertified_(s) {
  const tz = Session.getScriptTimeZone();
  const nowYM = Utilities.formatDate(new Date(), tz, 'yyyy-MM');
  const map = {};
  const sh = s.getSheetByName(CONFIG.SHEETS.mural);
  if (sh && sh.getLastRow() > 1) {
    const vals = sh.getDataRange().getValues();
    for (let i = 1; i < vals.length; i++) {
      const r = vals[i]; // [인증일시, 활동일자, 종류, 장소, 참여자, 업로더, 링크, Photos]
      if (String(r[2]) !== '사진') continue;
      const ym = parseYM_(r[1]) ||
        (r[0] instanceof Date ? Utilities.formatDate(r[0], tz, 'yyyy-MM') : null);
      if (ym !== nowYM) continue;
      String(r[4]).split(',').forEach(function(n) {
        n = n.trim();
        if (n) map[n] = true;
      });
    }
  }
  return { ym: nowYM, map: map };
}

/* ---------- 월별 인증 정산 (시트 메뉴에서 실행) ----------
 * 시트 상단 메뉴 [🗿 석기시대 → 월별 인증 정산]
 * - 부족원 시트 B열 '독립일'에 날짜가 있으면 지원금 제외 (독립 부족원)
 * - 사람마다 해당 월 첫 사진 1장을 [정산/yyyy-MM] 폴더에 이름으로 복사
 * - 인증현황 시트도 함께 갱신
 */

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('🗿 석기시대')
    .addItem('월별 인증 정산 (사진 수집)', 'settleMonthPrompt')
    .addToUi();
}

function settleMonthPrompt() {
  const ui = SpreadsheetApp.getUi();
  const def = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM');
  const res = ui.prompt('월별 인증 정산',
    '정산할 월 입력 (예: ' + def + ')\n비워두면 이번 달로 진행', ui.ButtonSet.OK_CANCEL);
  if (res.getSelectedButton() !== ui.Button.OK) return;
  const ym = res.getResponseText().trim() || def;
  if (!/^\d{4}-\d{2}$/.test(ym)) { ui.alert('형식 오류: yyyy-MM (예: 2026-07)'); return; }
  const r = settleMonth(ym);
  ui.alert(ym + ' 정산 완료\n\n' +
    '인증 (지원 대상): ' + r.done + ' / ' + r.total + '명\n' +
    '독립 (제외): ' + r.independent + '명\n' +
    '추출 사진: 정산 폴더 / ' + ym + ' 하위에 ' + r.copied + '장 (중복 제거 최소 집합)' +
    (r.uncovered.length ? '\n\n⚠ 사진 누락: ' + r.uncovered.join(', ') : ''));
}

function settleMonth(ym) {
  const tz = Session.getScriptTimeZone();
  const s = ss_();

  // 부족원: A=이름, H=독립일 (공백 아닌 값이 있으면 독립=퇴사자 → 제외)
  const mvals = s.getSheetByName(CONFIG.SHEETS.members).getRange('A2:H').getDisplayValues();
  const members = [], independent = [], indepSet = {};
  mvals.forEach(function(r) {
    const name = String(r[0]).trim();
    if (!name) return;
    if (String(r[7]).trim() !== '') { independent.push(name); indepSet[name] = true; }
    else members.push(name);
  });
  const memberSet = {};
  members.forEach(function(m) { memberSet[m] = true; });

  // 해당 월 '사진' 인증 행 수집 (참여자 목록 + 링크)
  const photos = []; // { people:[정산대상만], allPeople:[전체], link, date, loc }
  const firstCertRow = {}; // 인증여부 판정용: 이름 → 첫 인증 정보
  const sh = s.getSheetByName(CONFIG.SHEETS.mural);
  if (sh && sh.getLastRow() > 1) {
    const vals = sh.getDataRange().getValues();
    for (let i = 1; i < vals.length; i++) {
      const r = vals[i];
      if (String(r[2]) !== '사진') continue;
      const rowYM = parseYM_(r[1]) ||
        (r[0] instanceof Date ? Utilities.formatDate(r[0], tz, 'yyyy-MM') : null);
      if (rowYM !== ym) continue;
      const all = String(r[4]).split(',').map(function(n) { return n.trim(); }).filter(String);
      const targets = all.filter(function(n) { return memberSet[n]; }); // 정산 대상만
      all.forEach(function(n) {
        if (memberSet[n] && !firstCertRow[n]) firstCertRow[n] = { date: r[1], loc: r[3], link: String(r[6]) };
      });
      if (targets.length) {
        photos.push({ targets: targets, link: String(r[6]), date: r[1], loc: r[3] });
      }
    }
  }

  // ── 최소 사진 집합 (greedy set cover): 미커버 대상을 가장 많이 담은 사진부터 선택 ──
  const covered = {};
  const chosen = [];
  const needed = members.filter(function(m) { return firstCertRow[m]; }); // 인증된 대상자 전원
  const neededSet = {};
  needed.forEach(function(m) { neededSet[m] = true; });

  while (true) {
    let best = null, bestGain = 0;
    photos.forEach(function(p) {
      let gain = 0;
      p.targets.forEach(function(n) { if (neededSet[n] && !covered[n]) gain++; });
      if (gain > bestGain) { bestGain = gain; best = p; }
    });
    if (!best || bestGain === 0) break;
    best.targets.forEach(function(n) { if (neededSet[n]) covered[n] = true; });
    chosen.push(best);
  }

  // 인증현황 시트 갱신
  const out = s.getSheetByName('인증현황') || s.insertSheet('인증현황');
  out.clear();
  const rows = [['이름', '대상월', '인증여부', '활동일자', '장소', 'Drive 링크']];
  members.forEach(function(m) {
    const f = firstCertRow[m];
    rows.push(f ? [m, ym, 'O', f.date, f.loc, f.link] : [m, ym, 'X', '', '', '']);
  });
  independent.forEach(function(m) {
    rows.push([m, ym, '독립(제외)', '', '', '']);
  });
  out.getRange(1, 1, rows.length, 6).setValues(rows);

  // 최소 집합 사진을 [정산폴더/ym] 하위에 복사 (파일당 커버 인원을 파일명에)
  const root = DriveApp.getFolderById(CONFIG.SETTLE_FOLDER_ID);
  const folder = getOrCreateFolder_(root, ym);
  let copied = 0, seq = 1;
  chosen.forEach(function(p) {
    const idm = p.link.match(/\/d\/([-\w]+)/);
    if (!idm) return;
    try {
      const src = DriveApp.getFileById(idm[1]);
      const ext = (src.getName().match(/\.\w+$/) || ['.jpg'])[0];
      const who = p.targets.filter(function(n) { return neededSet[n]; }).join('_');
      src.makeCopy(ym + '_' + seq + '_' + who + ext, folder);
      copied++; seq++;
    } catch (e) { /* 삭제된 파일 등은 건너뜀 */ }
  });

  const done = needed.length;
  const uncovered = needed.filter(function(m) { return !covered[m]; });
  return {
    done: done, total: members.length, independent: independent.length,
    copied: copied, uncovered: uncovered
  };
}

function readVotes_(s, sheetName) {
  const sh = s.getSheetByName(sheetName);
  if (!sh) return [];
  const vals = sh.getDataRange().getDisplayValues();
  return vals.slice(1)
    .filter(function(r) { return r[0]; })
    .map(function(r) { return { date: r[0], voters: r.slice(1).filter(String) }; });
}

/* ---------- 정기공격: 월별 투표 읽기 ----------
 * 시트: A=대상월(2026-07), B=날짜후보, C=마감일(2026-07-05), D~=투표자
 * 반환: [{ month, deadline, closed, confirmed, options:[{date,voters}] }, ...]
 */
function readRaidByMonth_(s) {
  const sh = s.getSheetByName(CONFIG.SHEETS.raid);
  if (!sh) return [];
  const vals = sh.getDataRange().getDisplayValues();
  const confAll = getRaidConfirmedAll_();
  const groups = {}; const deadlines = {}; const order = [];
  for (let i = 1; i < vals.length; i++) {
    const month = String(vals[i][0]).trim();
    const date = String(vals[i][1]).trim();
    if (!month || !date) continue;
    if (!groups[month]) { groups[month] = []; order.push(month); }
    if (vals[i][2] && !deadlines[month]) deadlines[month] = String(vals[i][2]).trim();
    groups[month].push({ date: date, voters: vals[i].slice(3).filter(String) });
  }
  order.sort();
  return order.map(function(m) {
    const dl = deadlines[m] || '';
    return {
      month: m, deadline: dl, closed: isPastDeadline_(dl),
      confirmed: confAll[m] || null, options: groups[m]
    };
  });
}

/* ---------- 투표 마감 (번개 시트 B1 셀에만 사용) ---------- */

function getVoteMeta_(sh) {
  const dl = sh ? sh.getRange('B1').getDisplayValue() : '';
  return { deadline: dl, closed: isPastDeadline_(dl) };
}

function isPastDeadline_(txt) {
  if (!txt) return false;
  const m = String(txt).match(/(\d{4})[.\-\/]\s*(\d{1,2})[.\-\/]\s*(\d{1,2})/);
  if (!m) return false;
  const end = new Date(+m[1], +m[2] - 1, +m[3], 23, 59, 59);
  return new Date() > end;
}

/* ---------- 일정 확정 (정기공격은 월별) ---------- */

// 정기공격 월별 확정 저장소: { '2026-07': {date,loc}, ... }
function getRaidConfirmedAll_() {
  const v = PropertiesService.getScriptProperties().getProperty('confirmed_raid_months');
  return v ? JSON.parse(v) : {};
}
function setRaidConfirmedAll_(obj) {
  PropertiesService.getScriptProperties().setProperty('confirmed_raid_months', JSON.stringify(obj));
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

// dateText가 빈 값이면 확정 취소 (투표 재개). loc = 확정 위치. 확정은 정기공격만 가능
// 정기공격 월별 확정. dateText 빈값이면 해당 월 확정 취소. month = '2026-07'
function confirmDate(month, dateText, loc, name, pin) {
  if (CONFIG.ADMINS.indexOf(name) < 0 || String(pin) !== String(CONFIG.ADMIN_PIN)) {
    throw new Error('확정 권한이 없습니다.');
  }
  month = String(month || '').trim();
  if (!month) throw new Error('대상 월이 없습니다.');

  const sh = ss_().getSheetByName(CONFIG.SHEETS.raid);
  const confAll = getRaidConfirmedAll_();
  const vals = sh.getDataRange().getDisplayValues();

  // 해당 월 행들의 배경 초기화 (A=월, B=날짜)
  for (let i = 1; i < vals.length; i++) {
    if (String(vals[i][0]).trim() === month) {
      sh.getRange(i + 1, 1, 1, Math.max(sh.getLastColumn(), 1)).setBackground(null);
    }
  }

  if (!dateText) {
    delete confAll[month];
    setRaidConfirmedAll_(confAll);
  } else {
    let found = -1;
    for (let i = 1; i < vals.length; i++) {
      if (String(vals[i][0]).trim() === month && String(vals[i][1]).trim() === dateText) {
        found = i; break;
      }
    }
    if (found < 0) throw new Error('해당 일자를 찾을 수 없습니다: ' + dateText);
    confAll[month] = { date: dateText, loc: loc || '' };
    setRaidConfirmedAll_(confAll);
    sh.getRange(found + 1, 1, 1, Math.max(sh.getLastColumn(), 1)).setBackground('#3d2e1a');

    // 노션 캘린더 기록 (실패해도 확정은 진행)
    if (CONFIG.NOTION_TOKEN && CONFIG.NOTION_DB_ID) {
      const voters = vals[found].slice(3).filter(String); // D열~ 투표자
      try { addToNotion_(dateText, loc, voters); } catch (e) { Logger.log('Notion 기록 실패: ' + e); }
    }
  }
  return readRaidByMonth_(ss_());
}

/* ---------- 노션 캘린더 기록 ----------
 * 제목 = "⚔️ 정기모임 @위치 (참여 N명)", 날짜 = 확정일, 태그 = 정기모임
 */
function addToNotion_(dateText, loc, voters) {
  const schema = getNotionSchema_();
  const iso = parseNotionDate_(dateText);
  const title = '⚔️ 정기모임' + (loc ? ' @' + loc : '') +
    (voters && voters.length ? ' (참여 ' + voters.length + '명)' : '');

  const props = {};
  if (schema.titleProp) props[schema.titleProp] = { title: [{ text: { content: title } }] };
  if (schema.dateProp && iso) props[schema.dateProp] = { date: { start: iso } };
  if (schema.tagProp) props[schema.tagProp] = { multi_select: [{ name: '정기모임' }] };

  const res = UrlFetchApp.fetch('https://api.notion.com/v1/pages', {
    method: 'post',
    contentType: 'application/json',
    headers: {
      Authorization: 'Bearer ' + CONFIG.NOTION_TOKEN,
      'Notion-Version': '2022-06-28'
    },
    payload: JSON.stringify({
      parent: { database_id: CONFIG.NOTION_DB_ID },
      properties: props
    }),
    muteHttpExceptions: true
  });
  if (res.getResponseCode() >= 300) throw new Error(res.getContentText());
}

// DB 속성 스키마를 읽어 title / date / multi_select 속성명을 자동으로 찾음
function getNotionSchema_() {
  const res = UrlFetchApp.fetch(
    'https://api.notion.com/v1/databases/' + CONFIG.NOTION_DB_ID, {
      headers: {
        Authorization: 'Bearer ' + CONFIG.NOTION_TOKEN,
        'Notion-Version': '2022-06-28'
      },
      muteHttpExceptions: true
    });
  if (res.getResponseCode() >= 300) throw new Error(res.getContentText());
  const props = JSON.parse(res.getContentText()).properties || {};
  const out = { titleProp: null, dateProp: null, tagProp: null };
  Object.keys(props).forEach(function(name) {
    const type = props[name].type;
    if (type === 'title' && !out.titleProp) out.titleProp = name;
    if (type === 'date' && !out.dateProp) out.dateProp = name;
    if (type === 'multi_select' && !out.tagProp) out.tagProp = name;
  });
  return out;
}

/* 노션 연결 테스트: 에디터에서 실행해 스키마 확인 */
function testNotion() {
  Logger.log(JSON.stringify(getNotionSchema_()));
  addToNotion_('7/16(수) 20:00', '테스트 암장', ['김광훈', '이희주']);
  Logger.log('테스트 기록 완료 — 노션 캘린더 7/16 확인');
}

// "7/16(수) 20:00" / "2026-07-16" 등 → ISO(YYYY-MM-DD 또는 +시간)
function parseNotionDate_(label) {
  const tz = Session.getScriptTimeZone();
  let y = new Date().getFullYear();
  const ym = String(label).match(/(\d{4})/);
  if (ym) y = +ym[1];
  const md = String(label).match(/(\d{1,2})\s*[\/월.\-]\s*(\d{1,2})/);
  if (!md) return null;
  const mo = ('0' + md[1]).slice(-2), da = ('0' + md[2]).slice(-2);
  const tm = String(label).match(/(\d{1,2}):(\d{2})/);
  if (tm) {
    // 시간 포함 → 로컬 타임존 오프셋까지 붙여 ISO 생성
    const d = new Date(y, +md[1] - 1, +md[2], +tm[1], +tm[2]);
    return Utilities.formatDate(d, tz, "yyyy-MM-dd'T'HH:mm:ssXXX");
  }
  return y + '-' + mo + '-' + da; // 종일
}

/* ---------- 투표 (토글) ----------
 * 정기공격: toggleVote('raid', dateText, voter, token, month)
 * 자연재해: toggleVote('disaster', dateText, voter, token)
 */
function toggleVote(category, dateText, voter, token, month) {
  voter = verify_(voter, token);
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    if (category === 'raid') {
      // 해당 월이 확정됐으면 그 월만 투표 마감
      const confAll = getRaidConfirmedAll_();
      if (confAll[month]) throw new Error(month + ' 모임이 확정되어 투표가 마감되었습니다.');
      const sh = ss_().getSheetByName(CONFIG.SHEETS.raid);
      const vals = sh.getDataRange().getDisplayValues();
      // 해당 월 마감일 확인 (C열)
      for (let i = 1; i < vals.length; i++) {
        if (String(vals[i][0]).trim() === month && vals[i][2]) {
          if (isPastDeadline_(String(vals[i][2]).trim())) throw new Error('투표가 마감되었습니다.');
          break;
        }
      }
      for (let i = 1; i < vals.length; i++) {
        if (String(vals[i][0]).trim() === month && String(vals[i][1]).trim() === dateText) {
          let voters = vals[i].slice(3).filter(String); // D열~
          voters = voters.indexOf(voter) > -1
            ? voters.filter(function(v) { return v !== voter; })
            : voters.concat(voter);
          const width = Math.max(sh.getLastColumn() - 3, voters.length, 1);
          sh.getRange(i + 1, 4, 1, width)
            .setValues([voters.concat(new Array(width - voters.length).fill(''))]);
          return { date: dateText, voters: voters };
        }
      }
      throw new Error('해당 일자를 찾을 수 없습니다: ' + dateText);
    } else {
      // 자연재해(번개): A=날짜, B~=투표자
      const sh = ss_().getSheetByName(CONFIG.SHEETS.disaster);
      const vals = sh.getDataRange().getDisplayValues();
      for (let i = 1; i < vals.length; i++) {
        if (vals[i][0] === dateText) {
          let voters = vals[i].slice(1).filter(String);
          voters = voters.indexOf(voter) > -1
            ? voters.filter(function(v) { return v !== voter; })
            : voters.concat(voter);
          const width = Math.max(sh.getLastColumn() - 1, voters.length, 1);
          sh.getRange(i + 1, 2, 1, width)
            .setValues([voters.concat(new Array(width - voters.length).fill(''))]);
          return { date: dateText, voters: voters };
        }
      }
      throw new Error('해당 일자를 찾을 수 없습니다: ' + dateText);
    }
  } finally {
    lock.releaseLock();
  }
}

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
      payload: blob.getBytes()
    });
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
    return (st && st.message === 'Success') ? '완료' : '실패: ' + JSON.stringify(st || r);
  } catch (e) {
    return '실패: ' + e.message;
  }
}

/* ---------- 벽화 갤러리 ---------- */

function getGallery(limit, offset) {
  limit = limit || 12;
  offset = offset || 0;
  const sh = ss_().getSheetByName(CONFIG.SHEETS.mural);
  if (!sh || sh.getLastRow() < 2) return { items: [], hasMore: false };
  const vals = sh.getDataRange().getDisplayValues();
  const photos = [];
  for (let i = vals.length - 1; i >= 1; i--) {
    const r = vals[i]; // [인증일시, 활동일자, 종류, 장소, 참여자, 업로더, 링크, Photos]
    if (r[2] !== '사진') continue;
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

/* ---------- 삭제 (본인 업로드분 또는 관리자만) ---------- */

function isAdmin_(name) { return CONFIG.ADMINS.indexOf(name) > -1; }

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