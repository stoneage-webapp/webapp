/**
 * 석기시대 부족 웹앱 — settle.gs
 * 월별 인증 정산(시트 메뉴) · 월 파싱 · 인증현황 집계.
 * (로직은 원본 v3.0.2/Code.gs에서 그대로 이전. GAS는 전역 스코프 공유.)
 */

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

/* ---------- 월별 인증 정산 ----------
 * 웹 관리 탭(runSettle) 또는 시트 메뉴에서 실행.
 * - 부족원 시트 J열 '지원여부'가 FALSE 면 지원(정산) 제외. 빈칸/TRUE = 지원 대상.
 *   (지원여부는 웹 관리자 페이지에서 설정)
 * - 사람마다 해당 월 첫 사진 1장을 [정산/yyyy-MM] 폴더에 이름으로 복사
 * - 인증현황 시트도 함께 갱신
 */

// 부족원 명단을 지원/제외로 분리 (J열 기준).
// 반환: { members:[지원], excluded:[제외], all:[{name,supported}] (시트 순서) }
function splitBySupport_(s) {
  const sh = s.getSheetByName(CONFIG.SHEETS.members);
  const last = sh.getLastRow();
  const members = [], excluded = [], all = [];
  if (last < 2) return { members: members, excluded: excluded, all: all };
  sh.getRange('A2:J' + last).getDisplayValues().forEach(function (r) {
    const name = String(r[0]).trim();
    if (!name) return;
    const supported = String(r[9]).trim().toUpperCase() !== 'FALSE';
    (supported ? members : excluded).push(name);
    all.push({ name: name, supported: supported });
  });
  return { members: members, excluded: excluded, all: all };
}

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
    '지원 제외: ' + r.independent + '명\n' +
    '추출 사진: 정산 폴더 / ' + ym + ' 하위에 ' + r.copied + '장 (중복 제거 최소 집합)' +
    (r.uncovered.length ? '\n\n⚠ 사진 누락: ' + r.uncovered.join(', ') : ''));
}

function settleMonth(ym) {
  const tz = Session.getScriptTimeZone();
  const s = ss_();

  // 부족원: J열 지원여부 기준 분리 (FALSE = 지원 제외)
  const split = splitBySupport_(s);
  const members = split.members, independent = split.excluded;
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
  const out = s.getSheetByName(CONFIG.SHEETS.status) || s.insertSheet(CONFIG.SHEETS.status);
  out.clear();
  const rows = [['이름', '대상월', '인증여부', '활동일자', '장소', 'Drive 링크']];
  members.forEach(function(m) {
    const f = firstCertRow[m];
    rows.push(f ? [m, ym, 'O', f.date, f.loc, f.link] : [m, ym, 'X', '', '', '']);
  });
  independent.forEach(function(m) {
    rows.push([m, ym, '지원 제외', '', '', '']);
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

/* ---------- 월별 출석/인증 통계 (웹 조회용, #20) ----------
 * 반환: {
 *   months : 데이터가 있는 월 목록 (정렬)
 *   members: [{name, supported}]  — supported=false 면 지원(정산) 제외 (J열)
 *   cert   : { ym: { 이름: true } } — 해당 월 사진 인증자
 *   votes  : { ym: { 이름: true } } — 해당 월 정기공격 투표 참여자
 * }
 * 시트 전체 스캔이지만 라우터 캐시(2분) 뒤에 있어 성능 무해.
 */
function getStats() {
  const s = ss_();
  const tz = Session.getScriptTimeZone();

  const members = splitBySupport_(s).all; // [{name, supported}] 시트 순서

  // 벽화: 월별 사진 인증자
  const cert = {};
  const msh = s.getSheetByName(CONFIG.SHEETS.mural);
  if (msh && msh.getLastRow() > 1) {
    const vals = msh.getDataRange().getValues();
    for (let i = 1; i < vals.length; i++) {
      const r = vals[i];
      if (String(r[2]) !== '사진') continue;
      const ym = parseYM_(r[1]) ||
        (r[0] instanceof Date ? Utilities.formatDate(r[0], tz, 'yyyy-MM') : null);
      if (!ym) continue;
      if (!cert[ym]) cert[ym] = {};
      String(r[4]).split(',').forEach(function (n) {
        n = n.trim();
        if (n) cert[ym][n] = true;
      });
    }
  }

  // 정기공격: 월별 투표 참여자 (A=대상월, D~=투표자)
  const votes = {};
  const rsh = s.getSheetByName(CONFIG.SHEETS.raid);
  if (rsh) {
    const rvals = rsh.getDataRange().getDisplayValues();
    for (let i = 1; i < rvals.length; i++) {
      const ym = String(rvals[i][0]).trim();
      if (!ym) continue;
      if (!votes[ym]) votes[ym] = {};
      rvals[i].slice(3).filter(String).forEach(function (n) {
        votes[ym][String(n).trim()] = true;
      });
    }
  }

  const seen = {};
  Object.keys(cert).forEach(function (m) { seen[m] = true; });
  Object.keys(votes).forEach(function (m) { seen[m] = true; });
  return { months: Object.keys(seen).sort(), members: members, cert: cert, votes: votes };
}

/* ---------- 정산 현황 웹 조회 (#21) ----------
 * settleMonth 가 만든 '인증현황' 시트를 읽기 전용으로 반환.
 * 아직 정산한 적 없으면 { ym: null, rows: [] }.
 */
function getSettleStatus() {
  const sh = ss_().getSheetByName(CONFIG.SHEETS.status);
  if (!sh || sh.getLastRow() < 2) return { ym: null, rows: [] };
  const vals = sh.getDataRange().getDisplayValues();
  const rows = vals.slice(1)
    .filter(function (r) { return r[0]; })
    .map(function (r) {
      return { name: r[0], ym: r[1], status: r[2], actDate: r[3], loc: r[4], link: r[5] };
    });
  return { ym: rows.length ? rows[0].ym : null, rows: rows };
}

/* ---------- 웹 정산 실행 + 정산 담당자 관리 ----------
 * 담당자(settlers)는 관리자가 웹 관리자 페이지에서 지정 (Script Properties 'settlers'에 JSON 배열).
 * 정산 실행 권한 = 관리자 또는 담당자.
 */
function getSettlers_() {
  const v = PropertiesService.getScriptProperties().getProperty('settlers');
  try { return v ? JSON.parse(v) : []; } catch (e) { return []; }
}

function setSettlers(names, requester, authToken) {
  requester = verify_(requester, authToken);
  if (!isAdmin_(requester)) throw new Error('관리자만 정산 담당자를 설정할 수 있습니다.');
  if (!Array.isArray(names)) throw new Error('이름 배열이 필요합니다.');
  const clean = names.map(function (s) { return String(s).trim(); }).filter(String);
  PropertiesService.getScriptProperties().setProperty('settlers', JSON.stringify(clean));
  return { settlers: clean };
}

function canSettle_(name) {
  return isAdmin_(name) || getSettlers_().indexOf(name) > -1;
}

// 웹에서 월별 정산 실행 (기존 settleMonth 재사용 — 시트 메뉴 없이도 정산 가능)
function runSettle(ym, requester, authToken) {
  requester = verify_(requester, authToken);
  if (!canSettle_(requester)) throw new Error('정산 권한이 없습니다. (관리자 또는 정산 담당자만)');
  ym = String(ym || '').trim() ||
    Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM');
  if (!/^\d{4}-\d{2}$/.test(ym)) throw new Error('형식 오류: yyyy-MM (예: 2026-07)');
  const r = settleMonth(ym);
  r.ym = ym;
  return r;
}

/* ---------- 지원(정산) 대상 설정 ----------
 * 관리자가 웹 관리 탭에서 지정. 부족원 시트 J열에 TRUE/FALSE 기록.
 * names = 지원 대상 이름 배열 (목록에 없는 부족원은 FALSE = 지원 제외).
 */
function setSupports(names, requester, authToken) {
  requester = verify_(requester, authToken);
  if (!isAdmin_(requester)) throw new Error('관리자만 지원 여부를 설정할 수 있습니다.');
  if (!Array.isArray(names)) throw new Error('이름 배열이 필요합니다.');
  const on = {};
  names.forEach(function (n) { on[String(n).trim()] = true; });
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const sh = ss_().getSheetByName(CONFIG.SHEETS.members);
    const last = sh.getLastRow();
    if (last < 2) throw new Error('부족원 명단이 비어 있습니다.');
    const rows = sh.getRange('A2:A' + last).getDisplayValues();
    const out = [];
    const support = {};
    rows.forEach(function (r) {
      const name = String(r[0]).trim();
      if (!name) { out.push(['']); return; }
      support[name] = !!on[name];
      out.push([on[name] ? 'TRUE' : 'FALSE']);
    });
    sh.getRange(2, 10, out.length, 1).setValues(out); // J열
    return { support: support };
  } finally {
    lock.releaseLock();
  }
}

/* ---------- 암장별 방문 통계 (#1) ----------
 * 벽화 시트의 장소(D열)를 집계. 전체 기간 + 이번 달 방문 횟수.
 * 반환: { total:[{loc,count}], thisMonth:[{loc,count}], month }
 */
function getVenueStats() {
  const s = ss_();
  const tz = Session.getScriptTimeZone();
  const nowYM = Utilities.formatDate(new Date(), tz, 'yyyy-MM');
  const total = {}, month = {};
  const sh = s.getSheetByName(CONFIG.SHEETS.mural);
  if (sh && sh.getLastRow() > 1) {
    const vals = sh.getDataRange().getValues();
    for (let i = 1; i < vals.length; i++) {
      const r = vals[i]; // [인증일시, 활동일자, 종류, 장소, ...]
      const loc = String(r[3]).trim();
      if (!loc) continue;
      total[loc] = (total[loc] || 0) + 1;
      const ym = parseYM_(r[1]) ||
        (r[0] instanceof Date ? Utilities.formatDate(r[0], tz, 'yyyy-MM') : null);
      if (ym === nowYM) month[loc] = (month[loc] || 0) + 1;
    }
  }
  function sorted(o) {
    return Object.keys(o).map(function (k) { return { loc: k, count: o[k] }; })
      .sort(function (a, b) { return b.count - a.count; });
  }
  return { total: sorted(total), thisMonth: sorted(month), month: nowYM };
}
