/**
 * mock.js — 개발/미리보기용 목데이터 (?mock=1 로 열었을 때만 활성화)
 * 운영에서는 아무 것도 하지 않는다. 백엔드 응답 형태는 docs/architecture.md 와 동일.
 */
(function () {
  if (new URLSearchParams(location.search).get('mock') !== '1') return;

  const MEMBERS = ['김광훈', '이희주', '박도윤', '최서연', '정민재'];
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
    raidMonths: [{
      month: ym, deadline: ym + '-10', closed: false, confirmed: { date: '7/16(수) 20:00', loc: '더클라임 강남' },
      options: [
        { date: '7/16(수) 20:00', dateInfo: DI(d1, '20:00'), voters: ['김광훈', '이희주'] },
        { date: '7/23(수) 20:00', dateInfo: DI(d2, '20:00'), voters: ['박도윤'] }
      ]
    }],
    disaster: [
      { date: '7/19 14:00 @ 클라이밍파크', loc: '클라이밍파크', dateInfo: DI(ym + '-19', '14:00'), voters: ['최서연'] }
    ],
    certified: { '김광훈': true, '이희주': true },
    month: ym,
    shareUrl: '', notionUrl: '',
    confirmed: { disaster: null },
    admins: ['김광훈'],
    settlers: ['이희주'],
    support: { '김광훈': true, '이희주': true, '박도윤': true, '최서연': true, '정민재': false },
    flashOwners: { '7/19 14:00 @ 클라이밍파크': '최서연' }
  };

  const HALL = {
    ym: ym, winnerMonth: '2026-06',
    winner: { title: '보라 완등', by: '이희주', voters: ['김광훈', '박도윤'], fileId: 'x', link: '#', ym: '2026-06' },
    entries: [{ title: '오버행 돌파', by: '김광훈', voters: ['이희주'], fileId: 'y', link: '#', ym: ym, when: '' }]
  };

  window.API_MOCK = {
    handle: function (fn, args) {
      const T = {
        getInitData: DATA,
        getHallData: HALL,
        getHallArchive: { winners: [{ ym: '2026-06', title: '보라 완등', by: '이희주', voters: ['김광훈', '박도윤'], link: '#', fileId: 'x', when: '' }] },
        getGallery: { items: [], hasMore: false },
        getNotices: { items: [{ when: '2026. 7. 1', by: '김광훈', text: '7월 회비는 15일까지!', row: 2 }] },
        getStats: {
          months: ['2026-06', ym],
          members: MEMBERS.map(function (m, i) { return { name: m, supported: i !== 4 }; }),
          cert: (function () { const o = {}; o['2026-06'] = { '김광훈': true }; o[ym] = { '김광훈': true, '이희주': true }; return o; })(),
          votes: (function () { const o = {}; o[ym] = { '김광훈': true, '이희주': true, '박도윤': true }; return o; })()
        },
        getSettleStatus: { ym: '2026-06', rows: [{ name: '김광훈', ym: '2026-06', status: 'O', actDate: '6/18', loc: '더클라임', link: '' }] },
        loginWithPin: { name: args[0], token: 'mock-token', isAdmin: args[0] === '김광훈', driveApiKey: '' },
        changePin: { name: args[0], token: 'mock-token', isAdmin: args[0] === '김광훈', driveApiKey: '' },
        toggleVote: { date: args[1], voters: [args[2]] },
        addFlash: DATA.disaster, deleteFlash: DATA.disaster,
        confirmDate: DATA.raidMonths,
        postNotice: { items: [{ when: 'now', by: args[1], text: args[0], row: 3 }] },
        deleteNotice: { items: [] },
        resetPin: { name: args[0], reset: true },
        runSettle: { ym: args[0], done: 2, total: 4, independent: 1, copied: 1, uncovered: ['박도윤'] },
        setSettlers: { settlers: args[0] },
        setSupports: (function () { const s = {}; MEMBERS.forEach(function (m) { s[m] = (args[0] || []).indexOf(m) > -1; }); return { support: s }; })(),
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
