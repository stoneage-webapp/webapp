/**
 * 석기시대 부족 웹앱 — auth.gs
 * 개인 PIN 로그인 · 서명토큰 · 요청 검증 · 관리자 판별.
 * (로직은 원본 v3.0.2/Code.gs에서 그대로 이전. GAS는 전역 스코프 공유.)
 */

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

// 관리자 여부
function isAdmin_(name) { return CONFIG.ADMINS.indexOf(name) > -1; }
