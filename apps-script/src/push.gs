/**
 * 석기시대 부족 웹앱 — push.gs
 * 푸시 알림 (OneSignal REST API). 순수 Apps Script는 웹푸시 암호화를 못 하므로 OneSignal 경유.
 *
 * 준비 (사람):
 *   1) 스크립트 속성 'onesignal_rest_key' 에 OneSignal REST API Key 추가 (비밀).
 *   2) Apps Script 편집기에서 setupPushTriggers() 를 1회 실행 → D-1/번개 인증 시간 트리거 설치.
 *   3) 각 회원: 앱을 홈 화면에 설치(iOS 16.4+) 후 "🔔 알림 켜기" 로 권한 허용.
 *
 * 발송 시점:
 *   - 새 공지 등록 (notices.gs postNotice) — 전체
 *   - 번개 열림 (votes.gs addFlash) — 전체
 *   - 모임 D-1 (pushDailyReminders_, 매일) — 전체
 *   - 번개 시각 직후 인증 리마인더 (pushFlashCertCheck_, 매시간) — 그 번개 참여자
 */

// 전체 발송이면 opts.externalIds 생략, 개인 지정이면 externalIds=[이름...] (프론트 OneSignal.login(이름) 으로 태깅됨)
function sendPush_(title, message, opts) {
  opts = opts || {};
  const appId = CONFIG.ONESIGNAL_APP_ID, key = CONFIG.ONESIGNAL_REST_KEY;
  if (!appId || !key) return; // 미설정이면 조용히 스킵 (앱 동작에 영향 없음)
  const payload = {
    app_id: appId,
    headings: { en: title, ko: title },
    contents: { en: message, ko: message },
    url: opts.url || CONFIG.SITE_URL || ''
  };
  if (opts.externalIds && opts.externalIds.length) {
    payload.include_external_user_ids = opts.externalIds; // 특정 회원(이름=external_id)
  } else {
    payload.included_segments = ['Subscribed Users'];     // 전체
  }
  try {
    UrlFetchApp.fetch('https://onesignal.com/api/v1/notifications', {
      method: 'post',
      contentType: 'application/json',
      headers: { Authorization: 'Basic ' + key }, // 발송 실패 시 'Key ' + key 로 시도해볼 것
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    });
  } catch (e) {
    logError_('sendPush', (e && e.message) || String(e));
  }
}

/* ---------- 시간 트리거: 모임 D-1 (매일) ---------- */
function pushDailyReminders_() {
  const tz = Session.getScriptTimeZone();
  const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1);
  const tISO = Utilities.formatDate(tomorrow, tz, 'yyyy-MM-dd');
  const votes = getVotes('');
  (votes.raidMonths || []).forEach(function (g) {
    if (!g.confirmed) return;
    const ci = (g.options || []).find(function (o) { return o.date === g.confirmed.date; });
    const iso = ci && ci.dateInfo && ci.dateInfo.iso;
    if (iso === tISO) {
      const disp = (ci.dateInfo && ci.dateInfo.display) || g.confirmed.date;
      sendPush_('🔔 내일 정기공격!', disp + (g.confirmed.loc ? ' @ ' + g.confirmed.loc : ''), {});
    }
  });
}

/* ---------- 시간 트리거: 번개 시각 직후 인증 리마인더 (매시간) ---------- */
function pushFlashCertCheck_() {
  const tz = Session.getScriptTimeZone();
  const now = Date.now();
  const votes = getVotes('');
  (votes.disaster || []).forEach(function (r) {
    const iso = r.dateInfo && r.dateInfo.iso;
    if (!iso) return;
    const time = (r.dateInfo && r.dateInfo.time) || '00:00';
    let dt;
    try { dt = Utilities.parseDate(iso + ' ' + time, tz, 'yyyy-MM-dd HH:mm').getTime(); } catch (e) { return; }
    const mins = (now - dt) / 60000;
    if (mins >= 0 && mins <= 75 && r.voters && r.voters.length) { // 지난 ~75분 내 시작한 번개 (매시간 실행 기준)
      sendPush_('📸 번개 인증!', '오늘 번개 다녀오셨죠? 그날 바로 사진 인증 잊지 마세요!', { externalIds: r.voters });
    }
  });
}

/* ---------- 트리거 설치/제거 (사람이 1회 실행) ---------- */
function setupPushTriggers() {
  removePushTriggers();
  ScriptApp.newTrigger('pushDailyReminders_').timeBased().everyDays(1).atHour(10).create(); // 매일 오전 10시경 D-1
  ScriptApp.newTrigger('pushFlashCertCheck_').timeBased().everyHours(1).create();            // 매시간 번개 인증 체크
  return '푸시 트리거 설치 완료 (D-1 매일 10시, 번개 인증 매시간).';
}
function removePushTriggers() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    const f = t.getHandlerFunction();
    if (f === 'pushDailyReminders_' || f === 'pushFlashCertCheck_') ScriptApp.deleteTrigger(t);
  });
}
