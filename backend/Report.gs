/**
 * Report.gs — 元請向けPDF生成(SPEC §10)。
 * HtmlService でHTML→PDF変換。日本語描画に問題がある場合は Google ドキュメントのテンプレート書き出しへ切替(P-17)。
 */

function esc_(s) {
  return String(s === null || s === undefined ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

var STAGE_LABEL_ = { pre_pour: '打設前', during_pour: '打設中巡回', demold: '脱型承認', post_demold: '脱型後出来形', cleanup: '解体後片付け' };
var STATUS_LABEL_ = { draft: '入力中', submitted: '確認待ち', fix: '是正中', qa_ok: '元請待ち', approved: '打設可' };
var RESULT_LABEL_ = { ok: '合', ng: 'NG', na: '該当なし' };
var VERDICT_LABEL_ = { ok: '合格', minor: '軽微な不適合', major: '重大な不適合' };
var METHOD_LABEL_ = { paper: '紙に署名', pdf: 'PDFへ署名・押印', onsite: '現地で対面確認' };

function dtShort_(s) { return s ? String(s).slice(0, 16).replace('T', ' ') : ''; }

function reportView_(r) {
  return {
    reportId: r.reportId, recordId: r.recordId, version: r.version, recordStatus: r.recordStatus, url: r.url, sha256: r.sha256,
    generatedBy: r.generatedBy, generatedByName: userName_(r.generatedBy), generatedAt: r.generatedAt
  };
}

function measureText_(row, side) {
  var vals = side === 'self' ? row.selfValues : row.qaValues;
  if (!vals || !vals.length) return '';
  var snap = row.snapshot;
  return vals.join(', ') + (snap.tol !== null && snap.tol !== undefined ? ' / 許容±' + snap.tol : '');
}

/** 記録スナップショットのハッシュ(§10.2-8) */
function reportSnapshotHash_(rec, rows, verdictEvents) {
  var snap = {
    recordId: rec.recordId, round: rec.round,
    items: rows.map(function (r) {
      return {
        itemId: r.itemId,
        self: { result: r.selfResult, severity: r.selfSeverity, values: r.selfValues || [], note: r.foremanNote },
        qa: { result: r.qaResult, severity: r.qaSeverity, values: r.qaValues || [], note: r.qaNote }
      };
    }),
    signatures: {
      foreman: { name: userName_(rec.submittedBy), at: rec.submittedAt },
      qa: { name: userName_(rec.qaVerdictBy), at: rec.qaVerdictAt },
      prime: { name: rec.primeSignerName, at: rec.primeSignedAt, method: rec.primeSignMethod }
    },
    verdicts: verdictEvents.map(function (e) { return { at: e.at, kind: e.kind, actor: e.actorUserId, detail: e.detail }; })
  };
  return Util.sha256Hex(Util.canonicalJSON(snap));
}

/** 元請提出PDFの件名: 現場名 階 [工区] 打設箇所(SPEC §10.2a)。半角スペース区切り */
function reportSubject_(rec, site) {
  var parts = [site.name, rec.floor, rec.zone, rec.lot].map(function (x) { return String(x === null || x === undefined ? '' : x).trim(); });
  return parts.filter(function (x) { return x; }).join(' ');
}

function buildReportHtml_(rec, site, rows, photos, notes, events, version, nowDt) {
  var hash = reportSnapshotHash_(rec, rows, events.filter(function (e) { return /^verdict_/.test(e.kind); }));
  var stage = STAGE_LABEL_[rec.stage] || rec.stage;
  var h = [];
  h.push('<!DOCTYPE html><html><head><meta charset="utf-8"><title>' + esc_(reportSubject_(rec, site)) + '</title><style>');
  h.push('@page{size:A4;margin:12mm}body{font-family:"Noto Sans JP","Hiragino Kaku Gothic ProN",sans-serif;font-size:10px;color:#111}');
  h.push('h1{font-size:16px;margin:0 0 6px}h2{font-size:12px;margin:12px 0 4px;border-bottom:1px solid #444}');
  h.push('table{border-collapse:collapse;width:100%}th,td{border:1px solid #666;padding:2px 4px;vertical-align:top}th{background:#eee}');
  // 項目表(SPEC §10.2b-A): 固定レイアウト・折り返しなし・行高固定。職長コメント列だけ折り返し
  h.push('table.items{table-layout:fixed;width:186mm}table.items th,table.items td{white-space:nowrap;overflow:hidden;height:6mm;line-height:6mm;padding:0 2px;vertical-align:middle}');
  h.push('table.items td.wrap{white-space:normal;word-break:break-all;overflow:visible;line-height:12px;vertical-align:top;padding:2px}');
  h.push('.ng td{background:#fde8e8}.sign td{height:36px}');
  // 写真ブロック(SPEC §10.2b-B): 1枚1table・高さ固定・4枚ごとに改ページ
  h.push('table.pb{table-layout:fixed;width:186mm;height:62mm;margin:0 0 3mm 0;page-break-inside:avoid}table.pb td{overflow:hidden;height:62mm;vertical-align:top;padding:3px 5px}');
  h.push('table.pb td.pic{width:83mm;text-align:center;vertical-align:middle}');
  h.push('table.pb .ngc{color:#c00;font-weight:bold}table.pb .lb{color:#555}');
  h.push('.foot{margin-top:10px;font-size:8px;color:#444;word-break:break-all}');
  h.push('</style></head><body>');
  h.push('<!--REPORT ' + esc_(rec.recordId) + ' v' + version + ' ' + esc_(rec.status) + '-->');
  h.push('<h1>' + esc_(reportSubject_(rec, site)) + '</h1>');
  h.push('<p>型枠工事 ' + esc_(stage) + '検査記録</p>');
  h.push('<table><tr><th>現場名</th><td>' + esc_(site.name) + '</td><th>元請会社</th><td>' + esc_(site.primeContractor) + '</td></tr>');
  h.push('<tr><th>階・工区・打設箇所</th><td>' + esc_(rec.floor + (rec.zone ? '・' + rec.zone : '') + ' / ' + rec.lot) + '</td><th>段階</th><td>' + esc_(stage) + '</td></tr>');
  h.push('<tr><th>打設予定日時</th><td>' + esc_(dtShort_(rec.pourPlannedAt)) + '</td><th>記録ID</th><td>' + esc_(rec.recordId) + '</td></tr>');
  h.push('<tr><th>ステータス</th><td>' + esc_(STATUS_LABEL_[rec.status] || rec.status) + '</td><th>提出ラウンド</th><td>' + rec.round + '</td></tr>');
  h.push('<tr><th>生成日時</th><td>' + esc_(dtShort_(nowDt)) + '</td><th>版</th><td>v' + version + '</td></tr></table>');

  // 3者サイン
  h.push('<h2>サイン欄(3者)</h2><table class="sign"><tr><th>職長</th><th>品質管理者</th><th>元請</th></tr><tr>');
  h.push('<td>' + (rec.submittedAt ? esc_(userName_(rec.submittedBy)) + '<br>' + esc_(dtShort_(rec.submittedAt)) + '<br>PIN認証による電子サイン' : '未') + '</td>');
  h.push('<td>' + (rec.qaVerdict === 'ok' ? esc_(userName_(rec.qaVerdictBy)) + '<br>' + esc_(dtShort_(rec.qaVerdictAt)) + '<br>判定: 合格' : '未') + '</td>');
  if (rec.primeSignedAt) {
    h.push('<td>' + esc_(rec.primeSignerName) + '<br>' + esc_(METHOD_LABEL_[rec.primeSignMethod] || rec.primeSignMethod) +
      '<br>記録者: ' + esc_(userName_(rec.primeSignedBy)) + '<br>' + esc_(dtShort_(rec.primeSignedAt)) + '</td>');
  } else {
    h.push('<td>氏名 ______________ 日付 ______________<br>署名・押印</td>');
  }
  h.push('</tr></table>');
  var stops = events.filter(function (e) { return e.kind === 'stopped'; });
  if (stops.length) {
    h.push('<p>打設停止履歴: ' + stops.map(function (e) { return esc_(dtShort_(e.at) + ' ' + ((e.detail && e.detail.reason) || '')); }).join(' / ') + '</p>');
  }

  // 結果サマリ
  function cnt(side) {
    var c = { ok: 0, ng: 0, na: 0 };
    rows.forEach(function (r) {
      var aud = r.snapshot.audience;
      var res = side === 'self' ? (aud !== 'qa' ? r.selfResult : '') : (aud !== 'foreman' ? r.qaResult : '');
      if (res) c[res]++;
    });
    return c;
  }
  var cs = cnt('self'), cq = cnt('qa');
  h.push('<h2>結果サマリ</h2><table><tr><th></th><th>合</th><th>NG</th><th>該当なし</th></tr>');
  h.push('<tr><th>職長</th><td>' + cs.ok + '</td><td>' + cs.ng + '</td><td>' + cs.na + '</td></tr>');
  h.push('<tr><th>管理者</th><td>' + cq.ok + '</td><td>' + cq.ng + '</td><td>' + cq.na + '</td></tr></table>');

  // 項目表(SPEC §10.2b-A)
  h.push('<h2>項目表</h2><table class="items"><colgroup><col style="width:8mm"><col style="width:62mm"><col style="width:14mm"><col style="width:18mm"><col style="width:24mm"><col style="width:30mm"><col style="width:30mm"></colgroup>');
  h.push('<tr><th>No.</th><th>項目</th><th>職長結果</th><th>管理者結果</th><th>実測</th><th>職長コメント</th><th>管理者コメント</th></tr>');
  rows.forEach(function (r, i) {
    var snap = r.snapshot;
    var ng = r.selfResult === 'ng' || r.qaResult === 'ng';
    var m = [measureText_(r, 'self'), measureText_(r, 'qa')].filter(function (x) { return x; }).join(' | ');
    h.push('<tr' + (ng ? ' class="ng" style="background:#fde8e8"' : '') + '><td>' + (i + 1) + '</td><td>' + (snap.key ? '★' : '') + esc_(snap.textJa) + '</td>' +
      '<td>' + esc_(RESULT_LABEL_[r.selfResult] || '') + '</td><td>' + esc_(RESULT_LABEL_[r.qaResult] || '') + (r.qaSeverity ? '(' + esc_(r.qaSeverity === 'major' ? '重大' : '軽微') + ')' : '') + '</td>' +
      '<td>' + esc_(m) + '</td><td class="wrap">' + esc_(r.foremanNote) + '</td><td>' + esc_(r.qaNote) + '</td></tr>');
  });
  h.push('</table>');
  h.push('<p style="font-size:8px;color:#444">管理者コメントの全文は写真ページおよび電子記録で確認できます。</p>');

  // NG・是正の経過
  h.push('<h2>NG・是正の経過</h2>');
  var verdicts = events.filter(function (e) { return /^verdict_/.test(e.kind); });
  if (!verdicts.length) h.push('<p>判定履歴なし</p>');
  verdicts.forEach(function (e) {
    var d = e.detail || {};
    var ngs = (d.items || []).filter(function (x) { return x.result === 'ng'; }).map(function (x) { return x.itemId; });
    h.push('<p>' + esc_(dtShort_(e.at)) + ' ' + esc_(userName_(e.actorUserId)) + ' 判定: ' + esc_(VERDICT_LABEL_[d.verdict] || d.verdict) +
      (d.comment ? ' / ' + esc_(d.comment) : '') + (ngs.length ? ' / NG項目: ' + esc_(ngs.join(',')) : '') + '</p>');
  });
  h.push('<p>提出回数: ' + events.filter(function (e) { return e.kind === 'submitted' || e.kind === 'resubmitted'; }).length + '</p>');

  // 写真(最大60枚。NG項目の写真を優先)。SPEC §10.2b-B: 1ページ最大4枚、左=写真・右=項目内容とコメント
  h.push('<h2 style="page-break-before:always">写真</h2>');
  var ngItems = {};
  rows.forEach(function (r) { if (r.selfResult === 'ng' || r.qaResult === 'ng') ngItems[r.itemId] = true; });
  var rowOf = {}, seq = {};
  rows.forEach(function (r, i) { seq[r.itemId] = i + 1; rowOf[r.itemId] = r; });
  var sorted = photos.slice().sort(function (a, b) { return (ngItems[b.itemId] ? 1 : 0) - (ngItems[a.itemId] ? 1 : 0); });
  var shown = sorted.slice(0, 60);
  function resChip_(res, sev) {
    var t = (RESULT_LABEL_[res] || '-') + (res === 'ng' && sev ? '(' + (sev === 'major' ? '重大' : '軽微') + ')' : '');
    return res === 'ng' ? '<span class="ngc">' + esc_(t) + '</span>' : esc_(t);
  }
  shown.forEach(function (ph, idx) {
    var b64 = '';
    try { b64 = photoBytesB64_(ph.thumbFileId); } catch (e) { b64 = ''; }
    var who = ph.side === 'self' ? '職長' : (ph.side === 'qa' ? '管理者' : '元請サイン証跡');
    var row = ph.itemId ? rowOf[ph.itemId] : null;
    var info = '';
    if (row) {
      var snap = row.snapshot;
      info += '<div><b>No.' + (seq[ph.itemId] || '') + ' ' + (snap.key ? '★' : '') + esc_(snap.textJa) + '</b></div>';
      info += '<div><span class="lb">職長:</span> ' + resChip_(row.selfResult, row.selfSeverity) + ' / <span class="lb">管理者:</span> ' + resChip_(row.qaResult, row.qaSeverity) + '</div>';
      var mt = [measureText_(row, 'self'), measureText_(row, 'qa')].filter(function (x) { return x; }).join(' | ');
      if (mt) info += '<div><span class="lb">実測:</span> ' + esc_(mt) + '</div>';
      info += '<div><span class="lb">職長コメント:</span> ' + esc_(row.foremanNote) + '</div>';
      info += '<div><span class="lb">管理者コメント:</span> ' + esc_(row.qaNote) + '</div>';
    }
    info += '<div style="margin-top:4px"><span class="lb">撮影:</span> ' + who + '</div><div style="font-size:8px;color:#444">' + esc_(ph.stampText) + '</div>';
    var brk = ((idx + 1) % 4 === 0 && idx < shown.length - 1) ? ' style="page-break-after:always"' : '';
    // 写真は引き伸ばさない: 縦横比を保つため、横長は幅、縦長は高さだけを指定する(width/height は元画像の寸法)
    var portrait = ph.width && ph.height && Number(ph.height) > Number(ph.width);
    var imgStyle = portrait ? 'height:58mm' : 'width:80mm';
    h.push('<table class="pb"' + brk + '><tr><td class="pic">' + (b64 ? '<img style="' + imgStyle + '" src="data:image/jpeg;base64,' + b64 + '">' : '') + '</td><td>' + info + '</td></tr></table>');
  });
  if (photos.length > shown.length) h.push('<p>他' + (photos.length - shown.length) + '枚は電子記録で閲覧可</p>');
  h.push('<div class="foot">記録ID: ' + esc_(rec.recordId) + ' / 電子記録ハッシュ(SHA-256): ' + hash + '</div>');
  h.push('</body></html>');
  return h.join('\n');
}

function act_generateReport(ctx) {
  var actor = ctx.actor;
  var rec = loadRecord_(ctx.params.recordId);
  requireAuth_(actor, 'generateReport', { record: rec, params: ctx.params });
  var site = Repo.get('Sites', rec.siteId);
  var rows = itemsOf_(rec.recordId);
  var photos = activePhotos_(rec.recordId);
  var notes = Repo.where('Notes', 'recordId', rec.recordId);
  var events = Repo.where('Events', 'recordId', rec.recordId);
  var prev = Repo.where('Reports', 'recordId', rec.recordId);
  var version = prev.reduce(function (m, r) { return Math.max(m, r.version); }, 0) + 1;
  var now = Util.now(), nowIso = Util.fmtDt(now);
  var stamp = nowIso.slice(0, 10).replace(/-/g, '') + '-' + nowIso.slice(11, 13) + nowIso.slice(14, 16);
  var name = Util.sanitizeName(reportSubject_(rec, site)) + '_v' + version + '_' + stamp + '.pdf';
  var file, bytes;
  try {
    var html = buildReportHtml_(rec, site, rows, photos, notes, events, version, nowIso);
    var blob = HtmlService.createHtmlOutput(html).getBlob().getAs('application/pdf').setName(name);
    bytes = blob.getBytes();
    var folder = subFolder_(subFolder_(driveRoot_(), 'reports'), Util.sanitizeName(site.siteId + '_' + site.name));
    file = folder.createFile(blob);
    if (Cfg.get('pdfShareMode') === 'anyone_with_link') {
      try { file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW); } catch (e) { /* 組織ポリシーで不可なら非共有のまま(P-32) */ }
    }
  } catch (e) {
    if (e instanceof ApiError) throw e;
    throw new ApiError('DRIVE_ERROR', 'PDFの生成・保存に失敗しました');
  }
  var r = Repo.append('Reports', {
    reportId: Util.newId('f'), recordId: rec.recordId, version: version, recordStatus: rec.status, driveFileId: file.getId(),
    url: file.getUrl(), sha256: Util.sha256Hex(bytes), generatedBy: actor.userId, generatedAt: nowIso
  });
  Ev.add(ctx, 'report_generated', { siteId: rec.siteId, recordId: rec.recordId, round: rec.round, detail: { reportId: r.reportId, version: version } });
  return { report: reportView_(r) };
}

function act_listReports(ctx) {
  var rec = loadRecord_(ctx.params.recordId);
  requireAuth_(ctx.actor, 'listReports', { record: rec, params: ctx.params });
  var rows = Repo.where('Reports', 'recordId', rec.recordId).slice().sort(function (a, b) { return b.version - a.version; });
  return { reports: rows.map(reportView_) };
}
