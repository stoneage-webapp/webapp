/**
 * 석기시대 부족 웹앱 — auth.gs
 * 개인 PIN 로그인 · 서명토큰 · 요청 검증 · 관리자 판별.
 * (로직은 원본 v3.0.2/Code.gs에서 그대로 이전. GAS는 전역 스코프 공유.)
 */

/* ---------- 개인 PIN 로그인 (사칭 방지) ----------
 * 부족원 시트 I열(9번째)에 개인 PIN 입력. 로그인 성공 시 서명 토큰 발급 →
 * 이후 모든 요청에 name+token을 실어 서버가 검증. PIN 자체는 클라에 노출 안 됨.
 */

// 로그인 성공 시 내려주는 세션 정보. driveApiKey는 로그인한 부족원에게만 전달 (익명 노출 금지)
function session_(name, extra) {
  const out = {
    name: name,
    token: makeToken_(name),
    isAdmin: CONFIG.ADMINS.indexOf(name) > -1,
    driveApiKey: CONFIG.DRIVE_API_KEY,
    certNudge: needsCertNudge_(name) // 완료된 모임 참여자인데 이번 달 인증 안 했으면 true (본인만)
  };
  if (extra) Object.keys(extra).forEach(function (k) { out[k] = extra[k]; });
  return out;
}

function loginWithPin(name, pin) {
  name = String(name || '').trim();
  pin = String(pin || '').trim();
  assertNotLocked_(name);
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
        return session_(name, { firstSet: true });
      }
      if (pin !== real) { recordPinFail_(name); throw new Error('PIN이 올바르지 않습니다.'); }
      clearPinFail_(name);
      return session_(name);
    }
  }
  recordPinFail_(name); // 존재하지 않는 이름 반복 시도도 카운트
  throw new Error('명단에 없는 이름입니다.');
}

// 로그인 후 PIN 변경 (기존 PIN 확인)
function changePin(name, oldPin, newPin, authToken) {
  name = verify_(name, authToken);
  assertNotLocked_(name);
  newPin = String(newPin || '').trim();
  if (newPin.length < 4) throw new Error('새 PIN은 4자리 이상이어야 합니다.');
  const s = ss_();
  const sheet = s.getSheetByName(CONFIG.SHEETS.members);
  const rows = sheet.getRange('A2:I').getDisplayValues();
  for (let i = 0; i < rows.length; i++) {
    if (String(rows[i][0]).trim() === name) {
      if (String(rows[i][8]).trim() !== String(oldPin).trim()) {
        recordPinFail_(name);
        throw new Error('기존 PIN이 올바르지 않습니다.');
      }
      clearPinFail_(name);
      sheet.getRange(i + 2, 9).setValue("'" + newPin);
      return session_(name);
    }
  }
  throw new Error('명단에 없는 이름입니다.');
}

/* ---------- PIN 무차별 대입 방어 ----------
 * 실패 5회 → 10분 잠금 (CacheService). 공개 exec URL 대비 최소 방어선.
 */
const PIN_MAX_FAILS = 5;
const PIN_LOCK_SECONDS = 600; // 10분

function assertNotLocked_(key) {
  const n = Number(CacheService.getScriptCache().get('pinfail:' + key) || 0);
  if (n >= PIN_MAX_FAILS) {
    throw new Error('시도 횟수를 초과했습니다. 10분 후 다시 시도해주세요.');
  }
}
function recordPinFail_(key) {
  const c = CacheService.getScriptCache();
  const k = 'pinfail:' + key;
  c.put(k, String(Number(c.get(k) || 0) + 1), PIN_LOCK_SECONDS);
}
function clearPinFail_(key) {
  CacheService.getScriptCache().remove('pinfail:' + key);
}

/* ---------- 관리자 확정 PIN ----------
 * 실제 값은 Script Properties의 'admin_pin'에 보관 (코드 하드코딩 대신).
 * 프로퍼티가 없으면 CONFIG.ADMIN_PIN 폴백 — 배포 시 반드시 프로퍼티 설정 권장.
 */
function getAdminPin_() {
  return PropertiesService.getScriptProperties().getProperty('admin_pin') || CONFIG.ADMIN_PIN;
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

// 관리자 여부
function isAdmin_(name) { return CONFIG.ADMINS.indexOf(name) > -1; }

/* ---------- PIN 초기화 (관리자 전용, #18) ----------
 * 대상자 PIN 셀을 비움 → 다음 로그인이 최초 설정(firstSet) 흐름을 탄다.
 * PIN이 지워지면 대상자의 기존 토큰도 자동 무효(makeToken_ 이 PIN을 재료로 쓰므로).
 */
function resetPin(targetName, requester, authToken) {
  requester = verify_(requester, authToken);
  if (!isAdmin_(requester)) throw new Error('관리자만 PIN을 초기화할 수 있습니다.');
  targetName = String(targetName || '').trim();
  if (!targetName) throw new Error('대상 이름이 없습니다.');
  const sheet = ss_().getSheetByName(CONFIG.SHEETS.members);
  const rows = sheet.getRange('A2:I').getDisplayValues();
  for (let i = 0; i < rows.length; i++) {
    if (String(rows[i][0]).trim() === targetName) {
      sheet.getRange(i + 2, 9).setValue('');
      clearPinFail_(targetName); // 실패 잠금도 함께 해제
      return { name: targetName, reset: true };
    }
  }
  throw new Error('명단에 없는 이름입니다: ' + targetName);
}
