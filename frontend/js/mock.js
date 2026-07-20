/**
 * mock.js — 개발/미리보기용 목데이터 (?mock=1 로 열었을 때만 활성화)
 * 운영에서는 아무 것도 하지 않는다. 백엔드 응답 형태는 docs/architecture.md 와 동일.
 */
(function () {
  if (new URLSearchParams(location.search).get('mock') !== '1') return;

  // 백엔드는 항상 오름차순으로 정렬해 내려준다 — 미리보기도 그 결과를 흉내낸다.
  const MEMBERS = ['김광훈', '박도윤', '이희주', '정민재', '최서연'];
  const DI = function (iso, time) {
    const d = new Date(iso);
    const w = ['일', '월', '화', '수', '목', '금', '토'][d.getDay()];
    return { iso: iso, ym: iso.slice(0, 7), weekday: w, time: time || null,
      display: iso + ' (' + w + ')' + (time ? ' ' + time : '') };
  };
  const now = new Date();
  const ym = now.getFullYear() + '-' + ('0' + (now.getMonth() + 1)).slice(-2);
  const d1 = ym + '-16', d2 = ym + '-23';

  const DATA = {
    members: MEMBERS,
    months: ['2026-06', ym],
    raidMonths: [
      { month: '2026-06', deadline: '2026-06-05', closed: true, confirmed: { date: '2026-06-18', loc: '클라이밍파크', note: '' },
        options: [{ date: '2026-06-18', dateInfo: DI('2026-06-18', ''), voters: ['김광훈'] }] },
      { month: ym, deadline: ym + '-10', closed: false, confirmed: { date: '7/16(수) 20:00', loc: '더클라임 강남', note: '20시 정각 로비 집합, 회비 1만원' },
        options: [
          { date: '7/16(수) 20:00', dateInfo: DI(d1, '20:00'), voters: ['김광훈', '이희주'] },
          { date: '7/23(수) 20:00', dateInfo: DI(d2, '20:00'), voters: ['박도윤'] }
        ] }
    ],
    disaster: [
      { date: '7/19 14:00 @ 클라이밍파크', loc: '클라이밍파크', dateInfo: DI(ym + '-19', '14:00'), voters: ['최서연'] }
    ],
    certified: { '김광훈': true, '이희주': true },
    month: ym,
    shareUrl: '', notionUrl: '', openchatUrl: 'https://open.kakao.com/o/g5IQRRBi',
    confirmed: { disaster: null },
    admins: ['김광훈'],
    settlers: ['이희주'],
    support: { '김광훈': true, '박도윤': true, '이희주': true, '정민재': false, '최서연': true },
    notices: [
      { when: '2026-07-10', by: '김광훈', text: '7월 회비는 15일까지 계좌로 부탁드려요!', row: 3 },
      { when: '2026-07-02', by: '김광훈', text: '이번 달 정기공격 장소 투표 열렸습니다 — 참여 부탁!', row: 2 }
    ],
    flashOwners: { '7/19 14:00 @ 클라이밍파크': '최서연' }
  };

  const HALL = {
    ym: ym, winnerMonth: '2026-06',
    winner: { title: '보라 완등', by: '이희주', voters: ['김광훈', '박도윤'], fileId: 'x', link: '#', ym: '2026-06' },
    entries: [{ title: '오버행 돌파', by: '김광훈', voters: ['이희주'], fileId: 'y', link: '#', ym: ym, when: '' }]
  };

  // 완료기록 목데이터 — 이번 달 번개 완료 건에 '박도윤'을 넣어 인증 리마인드(certNudge) 시나리오를 흉내낸다.
  const COMPLETION_LOG = [
    { when: '2026-06-20 22:10', kind: '정기공격', month: '2026-06', date: '2026-06-18', loc: '클라이밍파크', people: '김광훈', by: '김광훈' },
    { when: ym + '-19 22:30', kind: '자연재해', month: ym, date: ym + '-19 14:00', loc: '클라이밍파크', people: '최서연, 박도윤', by: '최서연' }
  ];
  function certNudgeFor(name) {
    if (!name || DATA.certified[name]) return false;
    return COMPLETION_LOG.some(function (it) {
      return it.month === ym && it.people.split(',').map(function (s) { return s.trim(); }).indexOf(name) > -1;
    });
  }

  window.API_MOCK = {
    handle: function (fn, args) {
      const T = {
        getInitData: DATA,
        getHallData: HALL,
        getHallArchive: { winners: [{ ym: '2026-06', title: '보라 완등', by: '이희주', voters: ['김광훈', '박도윤'], link: '#', fileId: 'x', when: '' }] },
        getGallery: { items: [
          { when: ym + '-05', actDate: ym + '-05', loc: '더클라임 강남', people: '김광훈, 이희주', by: '김광훈', fileId: 'mk1', link: '#' },
          { when: ym + '-02', actDate: ym + '-02', loc: '클라이밍파크', people: '김광훈', by: '김광훈', fileId: 'mk2', link: '#' }
        ], hasMore: false },
        getNotices: { items: DATA.notices },
        getStats: (function () {
          const requester = args[0];
          const names = requester === '김광훈'
            ? MEMBERS
            : MEMBERS.filter(function (m) { return m === requester; });
          const cert = {}, votes = {};
          cert['2026-06'] = requester === '김광훈' ? { '김광훈': true } : {};
          cert[ym] = requester === '김광훈'
            ? { '김광훈': true, '이희주': true }
            : (requester === '이희주' ? { '이희주': true } : {});
          votes[ym] = requester === '김광훈'
            ? { '김광훈': true, '이희주': true, '박도윤': true }
            : (['이희주', '박도윤'].indexOf(requester) > -1
              ? (function () { const o = {}; o[requester] = true; return o; })()
              : {});
          return {
            months: ['2026-06', ym],
            members: names.map(function (m) { return { name: m, supported: DATA.support[m] !== false }; }),
            cert: cert,
            votes: votes
          };
        })(),
        // getSettleStatus(ym): 열=월 누적 스키마 — 상태만(장소/링크 없음)
        getSettleStatus: { ym: ym, months: ['2026-06', ym], rows: [
          { name: '김광훈', status: 'O' },
          { name: '박도윤', status: '정산 취소' },
          { name: '이희주', status: 'X' },
          { name: '정민재', status: '지원 제외' },
          { name: '최서연', status: 'X' }
        ] },
        cancelSettle: { ym: ym, months: ['2026-06', ym], rows: [
          { name: '김광훈', status: 'O' },
          { name: '박도윤', status: '취소 해제' },
          { name: '이희주', status: 'X' }
        ] },
        resetSettle: { reset: true, ym: ym },
        getVenueStats: { month: ym, total: [{loc:'더클라임 강남',count:8},{loc:'클라이밍파크',count:5},{loc:'볼더링존',count:2}], thisMonth: [{loc:'더클라임 강남',count:3}] },
        getCompletionLog: { items: COMPLETION_LOG.slice().reverse() },
        loginWithPin: { name: args[0], token: 'mock-token', isAdmin: args[0] === '김광훈', driveApiKey: '', certNudge: certNudgeFor(args[0]) },
        changePin: { name: args[0], token: 'mock-token', isAdmin: args[0] === '김광훈', driveApiKey: '', certNudge: certNudgeFor(args[0]) },
        toggleVote: { date: args[1], voters: [args[2]] },
        addFlash: DATA.disaster, deleteFlash: DATA.disaster,
        // T의 모든 필드는 fn 과 무관하게 매 호출마다 즉시 평가되므로(아래 목데이터 조회용 IIFE들과 동일 구조),
        // DATA를 실제로 변형하는 아래 세 액션은 반드시 fn 가드로 감싸 다른 액션 호출 시 오작동을 막는다.
        editFlash: (function () {
          if (fn !== 'editFlash') return DATA.disaster;
          const row = DATA.disaster.find(function (x) { return x.date === args[0]; });
          if (row) {
            const newDate = args[1], loc = args[2];
            row.date = newDate + ' @ ' + loc;
            row.loc = loc;
            const iso = newDate.split(' ')[0], time = newDate.split(' ')[1] || null;
            row.dateInfo = DI(iso, time);
          }
          return DATA.disaster;
        })(),
        completeFlash: (function () {
          if (fn !== 'completeFlash') return DATA.disaster;
          const idx = DATA.disaster.findIndex(function (x) { return x.date === args[0]; });
          if (idx > -1) DATA.disaster.splice(idx, 1);
          return DATA.disaster;
        })(),
        completeRaid: (function () {
          if (fn !== 'completeRaid') return DATA.raidMonths;
          const idx = DATA.raidMonths.findIndex(function (x) { return x.month === args[0]; });
          if (idx > -1) DATA.raidMonths.splice(idx, 1);
          return DATA.raidMonths;
        })(),
        confirmDate: DATA.raidMonths,
        // note 반영은 서버가 하므로 mock은 기존 데이터 반환
        postNotice: { items: [{ when: 'now', by: args[1], text: args[0], row: 4 }].concat(DATA.notices) },
        deleteNotice: { items: DATA.notices.slice(1) },
        resetPin: { name: args[0], reset: true },
        runSettle: { ym: args[0], done: 2, total: 4, independent: 1, canceled: 1, copied: 1, uncovered: ['박도윤'] },
        setSettlers: { settlers: args[0] },
        setSupports: (function () { const on = Array.isArray(args[0]) ? args[0] : []; const s = {}; MEMBERS.forEach(function (m) { s[m] = on.indexOf(m) > -1; }); return { support: s }; })(),
        voteHall: HALL, deleteHallEntry: HALL, finalizeHallEntry: HALL,
        deleteProof: { ok: true },
        startUpload: 'mock://upload', startHallUpload: 'mock://upload',
        uploadChunk: { done: true, fileId: 'mock' }, checkUploadStatus: { done: false },
        finalizeProof: { link: '#', photos: '완료' }
      };
      if (fn in T) return Promise.resolve(T[fn]);
      return Promise.reject(new Error('mock 미구현: ' + fn));
    }
  };
  console.log('[mock] API_MOCK 활성화됨');
})();
