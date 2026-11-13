/**
 * Report.gs — 元請向けPDF生成(SPEC §10)。
 * 既定は HtmlService でHTML→PDF変換(ただし用紙はレターになる)。Config reportEngine=doc のときは
 * ReportDoc.gs の Google ドキュメント方式(A4)で作り、失敗したら html に自動で切り替える(SPEC §10.5。P-17/P-48)。
 */

function esc_(s) {
  return String(s === null || s === undefined ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** 段階名(日本語のみ。SPEC §10.2 の1。版1.9: 使う段階は pre_pour=打設前 と post_demold=出来形) */
var STAGE_LABEL_ = { pre_pour: '打設前', during_pour: '打設中巡回', demold: '脱型承認', post_demold: '出来形', cleanup: '解体後片付け' };
var STATUS_LABEL_ = { draft: '入力中', submitted: '確認待ち', fix: '是正中', qa_ok: '元請待ち', approved: '打設可' };

/** ステータスの表示名。approved は段階で決まる: 打設前=打設可、出来形=出来形確認済(SPEC §6.8・§10.2 の2) */
function statusLabel_(rec) {
  if (rec.status === 'approved' && rec.stage === 'post_demold') return '出来形確認済';
  return STATUS_LABEL_[rec.status] || rec.status;
}
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

/* ---------- 実測の表示規則(SPEC §10.2d。版1.11.0)。HTML方式・doc方式が同じ関数を呼ぶ ---------- */

/** 実測の値の書式(§10.2d-2): 正は先頭に +、負は -、0 は 0 */
function measureFmt_(v) { return v === 0 ? '0' : (v > 0 ? '+' : '') + String(v); }

/** 許容。有限で 0 より大きい数のときだけ「許容あり」(その数を返す)。それ以外は null(§10.2d-1) */
function measureTol_(tol) {
  if (typeof tol !== 'number' && typeof tol !== 'string') return null;
  var t = Number(tol);
  return Number.isFinite(t) && t > 0 ? t : null;
}

/**
 * 実測の単一の値。有効値(null・空文字・数値にできない・有限でない を除く。数字の文字列は数値にする)なら
 * { v:Number, text:String(▲なし), over:Boolean } を返し、無効なら null(§10.2d-4)。
 * over は |値| > 許容(厳密に大きい。境界は許容内)。許容なしなら常に false。純関数(Math/Number/String 以外に依存しない)
 */
function measureCell_(raw, tol) {
  if (typeof raw !== 'number' && typeof raw !== 'string') return null;
  if (typeof raw === 'string' && raw.trim() === '') return null;
  var v = Number(raw);
  if (!Number.isFinite(v)) return null;
  if (v === 0) v = 0;   // -0 を 0 にする
  var t = measureTol_(tol);
  return { v: v, text: measureFmt_(v), over: t !== null && Math.abs(v) > t };
}

/**
 * PDF の欄名(SPEC §10.2e。版1.12.0)。1次検査者が管理者・責任者の記録だけ「1次検査/承認」の語にする。
 * 職長の記録(ownerRole が空・foreman)は従来の語のまま(版1.11.2 と同じ文字列)。
 * buildReportHtml_・docBuild_ の先頭で reportLabelsFor_(rec) を呼んで RPT_L_ を差し替える(1回の生成の中だけで使う)。
 */
var RPT_L_FOREMAN_ = {
  self: '職長', qa: '管理者', selfRes: '職長結果', qaRes: '管理者結果', selfNote: '職長コメント', qaNote: '管理者コメント',
  signSelf: '職長', signQa: '品質管理者', company: '職長の会社名', owner: '職長', judgeSuffix: false
};
var RPT_L_ = RPT_L_FOREMAN_;
var RPT_ROLE_JA_ = { foreman: '職長', qa: '管理者', lead: '責任者' };
function reportLabelsFor_(rec) {
  var role = (rec && rec.ownerRole) || 'foreman';
  if (role === 'foreman') { RPT_L_ = RPT_L_FOREMAN_; return RPT_L_; }
  RPT_L_ = {
    self: '1次検査', qa: '承認', selfRes: '1次検査結果', qaRes: '承認結果', selfNote: '1次検査コメント', qaNote: '承認者コメント',
    signSelf: '1次検査(' + (RPT_ROLE_JA_[role] || role) + ')', signQa: '承認(責任者)', company: '1次検査者の会社名', owner: '1次検査者',
    judgeSuffix: true
  };
  return RPT_L_;
}
/** NG・是正の経過の判定者名。管理者・責任者の記録では役割を後ろに付ける(§10.2e) */
function reportJudgeName_(userId) {
  var name = userName_(userId);
  if (!RPT_L_.judgeSuffix) return name;
  var u = Repo.get('Users', userId);
  return name + '(' + (u ? (RPT_ROLE_JA_[u.role] || u.role) : '') + ')';
}

/**
 * 1項目・1側(side='self'|'qa')の実測の見せ方(§10.2d-4)。有効値が0個なら null。
 * 職長と管理者は別の系列で、混ぜない。row を変更しない純関数(Math/Number/String 以外に依存しない)
 */
function measureView_(row, side) {
  var isSelf = side === 'self';
  var raw = row ? (isSelf ? row.selfValues : row.qaValues) : null;
  if (!raw || typeof raw === 'string' || typeof raw.length !== 'number') return null;
  var snap = (row && row.snapshot) || {};
  var tol = measureTol_(snap.tol);
  var unit = (snap.unit === null || snap.unit === undefined || snap.unit === '') ? 'mm' : String(snap.unit);
  var values = [], overCount = 0, min = 0, max = 0;
  for (var i = 0; i < raw.length; i++) {
    var c = measureCell_(raw[i], tol);
    if (!c) continue;
    values.push(c);
    if (c.over) overCount++;
    if (values.length === 1 || c.v < min) min = c.v;
    if (values.length === 1 || c.v > max) max = c.v;
  }
  if (!values.length) return null;
  var n = values.length, minText = measureFmt_(min), maxText = measureFmt_(max);
  var parts = [];
  if (n >= 2) parts.push('最小' + minText + '/最大' + maxText);
  if (tol !== null) parts.push('許容±' + String(tol) + unit);
  var summary = 'n=' + n + (parts.length ? ' ' + parts.join('/') : '');
  if (overCount > 0) summary += ' ▲許容超' + overCount + '件';
  return {
    side: isSelf ? 'self' : 'qa', label: isSelf ? '職長' : '管理者', n: n, values: values, min: min, max: max, minText: minText, maxText: maxText,
    tol: tol, unit: unit, overCount: overCount,
    valuesText: values.map(function (x) { return (x.over ? '▲' : '') + x.text; }).join('、 '),
    summaryText: summary
  };
}

/** 要約を「通常部分」と「末尾の ▲許容超n件(装飾する部分)」に分ける。▲許容超が無ければ over は '' */
function measureSummaryParts_(view) {
  var s = view.summaryText, i = s.indexOf(' ▲許容超');
  return i < 0 ? { base: s, over: '' } : { base: s.slice(0, i + 1), over: s.slice(i + 1) };
}

/** §10.2d-8 の注記(項目表の直後。許容ありの実測が1つでもあるときだけ出す。HTML 8px / doc 6pt) */
var REPORT_MEASURE_NOTE_ = '実測の ▲ は許容(±)を超えた値の目安です。合否は職長・管理者が判定した結果(合/NG)で、▲ だけでは決まりません。許容ちょうどは許容内として扱います。';
function reportHasTolMeasure_(rows) {
  return rows.some(function (r) {
    return ['self', 'qa'].some(function (s) { var v = measureView_(r, s); return !!v && v.tol !== null; });
  });
}

/** 実測の色(§10.2d-6)。HTML のインライン style と doc の setForegroundColor で同じ値 */
var MEASURE_COLOR_ = { over: '#cc0000', label: '#555555', summary: '#444444' };

/** HTML: 許容超を囲む span(class と同じ内容のインライン style の両方。GAS変換はクラスを無視することがあるため) */
function measureOverSpan_(t) { return '<span class="over" style="font-weight:bold;color:#cc0000">' + esc_(t) + '</span>'; }

/** HTML: 値の並び(許容超の値だけ over の span。区切りの「、 」(読点+半角スペース)は span の外) */
function measureValuesHtml_(view) {
  return view.values.map(function (x) { return x.over ? measureOverSpan_('▲' + x.text) : esc_(x.text); }).join('、 ');
}

/** HTML: 要約(末尾の ▲許容超n件 だけ over の span) */
function measureSummaryHtml_(view) {
  var p = measureSummaryParts_(view);
  return esc_(p.base) + (p.over ? measureOverSpan_(p.over) : '');
}

/**
 * HTML: 1項目の実測(有効値のある側ごとに2つの <div>。職長→管理者の順)。prefix は '' / '実測'(ラベルは 職長: / 実測(職長): )。
 * 両側とも実測なしなら ''
 */
function measureBlockHtml_(row, withKeyword) {
  var o = [];
  ['self', 'qa'].forEach(function (side) {
    var v = measureView_(row, side);
    if (!v) return;
    var vl = side === 'self' ? RPT_L_.self : RPT_L_.qa;   // 版1.12.0: 欄名(§10.2e)。measureView_ は純関数のまま
    var lab = (withKeyword ? '実測(' + vl + '): ' : vl + ': ');
    o.push('<div><span style="color:' + MEASURE_COLOR_.label + '">' + esc_(lab) + '</span>' + measureValuesHtml_(v) + '</div>');
    o.push('<div style="color:' + MEASURE_COLOR_.summary + '">' + measureSummaryHtml_(v) + '</div>');
  });
  return o.join('\n');
}

/**
 * 確認箇所(図面)の凡例の行モデル(SPEC §10.2c-3。HTML方式・doc方式で共通)。項目ごとにグループ化する。
 * 返り値: [{ type:'head'|'mark'|'single', no, itemNo, title, summary, value, over, row }]
 *   head   = 項目の見出し行(N-k の印がある項目)。no='No.{N}'、title=★+項目文、summary=系列S全体の measureView_(無ければ null)
 *   mark   = 番号行(印1個)。no=label、value=系列Sの k 番目(符号付き+単位。無効なら '')、over=許容超
 *   single = N だけの項目の1行形式。no=label、title='No.{N} ★項目文'
 * 系列S: 図面を書いた側(ph.side。qa=管理者、それ以外=職長)に有効値があればその側、無ければもう一方(要素ごとの補完はしない)
 */
function drawingLegendModel_(ph, rows, seq) {
  var markers = Array.isArray(ph.markers) ? ph.markers : [];
  var seen = {}, ents = [];
  markers.forEach(function (m) {
    if (!seq[m.itemId]) return;
    var key = m.itemId + '|' + m.label;
    if (seen[key]) return;
    seen[key] = true;
    var km = /-(\d+)$/.exec(String(m.label));
    ents.push({ itemId: m.itemId, label: String(m.label), k: km ? Number(km[1]) : 0 });
  });
  ents.sort(function (a, b) { return (seq[a.itemId] - seq[b.itemId]) || (a.k - b.k); });
  var out = [], i = 0;
  while (i < ents.length) {
    var itemId = ents[i].itemId, grp = [];
    while (i < ents.length && ents[i].itemId === itemId) { grp.push(ents[i]); i++; }
    var row = rows[seq[itemId] - 1], snap = row.snapshot;
    var title = (snap.key ? '★' : '') + String(snap.textJa === null || snap.textJa === undefined ? '' : snap.textJa);
    var unit = (snap.unit === null || snap.unit === undefined || snap.unit === '') ? 'mm' : String(snap.unit);
    var branch = grp.some(function (e) { return e.k > 0; });
    if (!branch) {
      grp.forEach(function (e) { out.push({ type: 'single', no: e.label, itemNo: seq[itemId], title: 'No.' + seq[itemId] + ' ' + title, summary: null, value: '', over: false, row: row }); });
      continue;
    }
    var pref = ph.side === 'qa' ? 'qa' : 'self', other = pref === 'qa' ? 'self' : 'qa';
    var sv = measureView_(row, pref), sideS = pref;
    if (!sv) { sv = measureView_(row, other); sideS = other; }
    var seriesRaw = sv ? (sideS === 'self' ? row.selfValues : row.qaValues) : null;
    out.push({ type: 'head', no: 'No.' + seq[itemId], itemNo: seq[itemId], title: title, summary: sv, value: '', over: false, row: row });
    grp.forEach(function (e) {
      var c = (e.k > 0 && seriesRaw) ? measureCell_(seriesRaw[e.k - 1], snap.tol) : null;
      out.push({ type: 'mark', no: e.label, itemNo: seq[itemId], title: '', summary: null, value: c ? c.text + unit : '', over: !!(c && c.over), row: row });
    });
  }
  return out;
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


/* ---------- 写真ページ(SPEC §10.2b-B・§10.5.5。版1.14.0。HTML方式・doc 方式で共通) ---------- */
var REPORT_PHOTOS_PER_PAGE = 3;                // 1ページの写真の枚数(旧4)
var REPORT_PHOTOS_MAX = 60;                    // 写真ページに出す上限
var REPORT_PHOTO_MAIN_MAX_BYTES = 20000000;    // 1つのPDFで読む本体の合計の上限。超えた分はサムネ(P-52 ①)
var REPORT_PHOTO_COLS_MM = [110, 76];          // 写真ブロックの列幅(名目。左=写真 / 右=情報欄)
var REPORT_HTML_PHOTO_ROW_MM = 80;             // HTML方式のブロックの高さ(レター用紙のため。doc 方式は 81mm)
var REPORT_HTML_PHOTO_BOX_MM = { w: 109, h: 79 };   // HTML方式の写真の枠(セル余白0.5mm の内側)

/**
 * 写真の並びと選び方(純関数)。対象は呼び出し側で kind=photo に絞った配列。
 * 並び: 項目の番号(rows の並び=seq の1始まり)→ 側(self→qa→その他)→ takenAt → photoId。項目に紐づかない写真は最後。
 * 上限を超えるときは NG 項目の写真を先に選び、残りを並び順に足して max 枚。選んだ写真は並び順のまま返す。
 * 返り値: { shown:[写真], rest:出さない枚数, seq:{itemId:N}, rowOf:{itemId:row} }
 */
function reportPhotoOrder_(rows, photos, max) {
  var seq = {}, rowOf = {}, ng = {};
  (rows || []).forEach(function (r, i) {
    seq[r.itemId] = i + 1; rowOf[r.itemId] = r;
    if (r.selfResult === 'ng' || r.qaResult === 'ng') ng[r.itemId] = true;
  });
  var big = 1e9;
  var sideNo = function (s) { return s === 'self' ? 0 : (s === 'qa' ? 1 : 2); };
  var key = function (ph) { return ph.itemId && seq[ph.itemId] ? seq[ph.itemId] : big; };
  var str = function (x) { return x === null || x === undefined ? '' : String(x); };
  var cmp = function (a, b) {
    var d = key(a) - key(b);
    if (d) return d;
    if (key(a) !== big) {   // 項目に紐づく写真だけ 側(self→qa)で分ける。項目なしは takenAt の順(§10.2b-B)
      d = sideNo(a.side) - sideNo(b.side);
      if (d) return d;
    }
    var ta = str(a.takenAt), tb = str(b.takenAt);
    if (ta !== tb) return ta < tb ? -1 : 1;
    var pa = str(a.photoId), pb = str(b.photoId);
    return pa < pb ? -1 : (pa > pb ? 1 : 0);
  };
  var all = (photos || []).slice().sort(cmp);
  var lim = max === undefined ? REPORT_PHOTOS_MAX : max;
  var shown = all;
  if (all.length > lim) {
    var isNg = function (ph) { return !!(ph.itemId && ng[ph.itemId]); };
    var pick = all.filter(isNg).concat(all.filter(function (ph) { return !isNg(ph); })).slice(0, lim);
    shown = pick.sort(cmp);
  }
  return { shown: shown, rest: all.length - shown.length, seq: seq, rowOf: rowOf };
}

/** 写真を枠(boxW×boxH)の中で最大に(縦横比を保つ。純関数)。幅・高さが正でなければ 4:3 の横長として扱う。返り値 {w,h}(枠と同じ単位) */
function reportPhotoFit_(w, h, boxW, boxH) {
  var rw = Number(w), rh = Number(h);
  if (!(rw > 0 && rh > 0)) { rw = 4; rh = 3; }
  var s = Math.min(boxW / rw, boxH / rh);
  return { w: rw * s, h: rh * s };
}

/** 本体を使うか(純関数)。これまでに読んだ本体の合計 used に size を足して max 以下なら true */
function reportPhotoUseMain_(used, size, max) {
  return used + size <= (max === undefined ? REPORT_PHOTO_MAIN_MAX_BYTES : max);
}

/**
 * 写真の画像を読む関数を作る(1回の PDF 生成の中で、読んだ本体の合計を数える)。
 * 本体(driveFileId)を読み、読めない・合計上限を超えるときはサムネ(thumbFileId)。どちらも読めなければ null。
 * 返り値の関数: ph → Blob|null
 */
function reportPhotoLoader_() {
  var used = 0;
  var read = function (id) {
    if (!id) return null;
    try { return DriveApp.getFileById(id).getBlob(); } catch (e) { return null; }
  };
  return function (ph) {
    var main = used < REPORT_PHOTO_MAIN_MAX_BYTES ? read(ph.driveFileId) : null;   // 上限に達したら本体を読まない(時間の節約)
    if (main) {
      var size = 0;
      try { size = main.getBytes().length; } catch (e) { main = null; }
      if (main && reportPhotoUseMain_(used, size)) { used += size; return main; }
    }
    return read(ph.thumbFileId);
  };
}

/** 写真の情報欄の結果の行の部品(SPEC §10.2b-B の情報欄2)。その側の許容超の件数(無ければ 0) */
function reportOverCount_(row, side) {
  var v = measureView_(row, side);
  return v ? v.overCount : 0;
}

/** 確認箇所(図面)の1ページ分(SPEC §10.2c)。table と mm 固定のみ。印は画像に焼き込み済みなので描き足さない */
function buildDrawingPageHtml_(ph, rows, seq, resChip) {
  var b64 = '';
  try { b64 = photoBytesB64_(ph.driveFileId); } catch (e) { b64 = ''; }
  var w = Number(ph.width), hh = Number(ph.height);
  var style;
  if (!(w > 0 && hh > 0) || w >= hh) {
    // 横長: 幅186mm。ただし高さが170mmを超えるなら高さ170mm
    style = (w > 0 && hh > 0 && 186 * hh / w > 170) ? 'height:170mm' : 'width:186mm';
  } else {
    style = 'height:170mm';
  }
  var who = (ph.side === 'qa' ? RPT_L_.qa : RPT_L_.self) + ': ' + userName_(ph.takenBy);
  var o = [];
  o.push('<div style="page-break-before:always"><h2>確認箇所(図面)</h2>');
  o.push('<p>' + esc_(who) + ' / ' + esc_(dtShort_(ph.takenAt)) + '</p>');
  o.push('<table style="table-layout:fixed;width:186mm;border:0"><tr><td style="border:0;text-align:center;padding:0">' +
    (b64 ? '<img style="' + style + '" src="data:image/jpeg;base64,' + b64 + '">' : '画像を読み込めませんでした') + '</td></tr></table>');
  var markers = Array.isArray(ph.markers) ? ph.markers : [];
  if (!markers.length) {
    o.push('<p>印の書き込みなし</p></div>');
    return o.join('\n');
  }
  // 凡例(版1.11.0 §10.2c-3): 項目ごとのグループ(見出し行+番号行)。6列 24/76/28/24/17/17mm・折り返しあり・最低高6mm
  var cell = 'white-space:normal;word-break:break-all;overflow:visible;height:6mm;line-height:12px;padding:2px 3px;vertical-align:top';
  var shade = ';background:#eeeeee';
  var td = function (inner, extra) { return '<td style="' + cell + (extra || '') + '">' + inner + '</td>'; };
  o.push('<table style="table-layout:fixed;width:186mm;margin-top:3mm"><colgroup><col style="width:24mm"><col style="width:76mm"><col style="width:28mm"><col style="width:24mm"><col style="width:17mm"><col style="width:17mm"></colgroup>');
  var th = '<th style="' + cell + ';background:#eeeeee;font-weight:bold">';
  o.push('<tr>' + th + '番号</th>' + th + '項目</th>' + th + '実測値</th>' + th + '許容超</th>' + th + esc_(RPT_L_.self) + '</th>' + th + esc_(RPT_L_.qa) + '</th></tr>');
  drawingLegendModel_(ph, rows, seq).forEach(function (e) {
    var row = e.row;
    if (e.type === 'mark') {
      o.push('<tr>' + td(esc_(e.no)) + td('') + td(e.over ? measureOverSpan_(e.value) : esc_(e.value)) + td(e.over ? measureOverSpan_('▲') : '') + td('') + td('') + '</tr>');
      return;
    }
    var itemCell = e.type === 'head'
      ? '<div><b>' + esc_(e.title) + '</b></div>' + (e.summary ? '\n<div style="color:' + MEASURE_COLOR_.summary + '">' + measureSummaryHtml_(e.summary) + '</div>' : '')
      : esc_(e.title);
    var x = e.type === 'head' ? shade : '';
    o.push('<tr>' + td(esc_(e.no), x) + td(itemCell, x) + td('', x) + td('', x) +
      td(resChip(row.selfResult, row.selfSeverity), x) + td(resChip(row.qaResult, row.qaSeverity), x) + '</tr>');
  });
  o.push('</table></div>');
  return o.join('\n');
}

function buildReportHtml_(rec, site, rows, allPhotos, notes, events, version, nowDt) {
  var L = reportLabelsFor_(rec);   // 版1.12.0: 欄名(§10.2e)
  // 版1.6: 写真ページ(60枚上限・並び)には図面を含めない。図面は §10.2c で別に載せる
  var photos = allPhotos.filter(function (x) { return photoKindOf_(x) !== 'drawing'; });
  var drawings = allPhotos.filter(function (x) { return photoKindOf_(x) === 'drawing'; })
    .sort(function (a, b) { return a.takenAt < b.takenAt ? -1 : (a.takenAt > b.takenAt ? 1 : 0); });
  var hash = reportSnapshotHash_(rec, rows, events.filter(function (e) { return /^verdict_/.test(e.kind); }));
  var stage = STAGE_LABEL_[rec.stage] || rec.stage;
  var h = [];
  h.push('<!DOCTYPE html><html><head><meta charset="utf-8"><title>' + esc_(reportSubject_(rec, site)) + '</title><style>');
  h.push('@page{size:A4;margin:12mm}body{font-family:"Noto Sans JP","Hiragino Kaku Gothic ProN",sans-serif;font-size:10px;color:#111}');
  h.push('h1{font-size:16px;margin:0 0 6px}h2{font-size:12px;margin:12px 0 4px;border-bottom:1px solid #444}');
  h.push('table{border-collapse:collapse;width:100%}th,td{border:1px solid #666;padding:2px 4px;vertical-align:top}th{background:#eee}');
  // 項目表(SPEC §10.2b-A 版1.11.0): 固定レイアウト・全列折り返し(nowrap/overflow:hidden は使わない)・行の高さは最低6mm。実測列だけ word-break:normal
  h.push('table.items{table-layout:fixed;width:186mm}table.items th,table.items td{white-space:normal;overflow:visible;word-break:break-all;height:6mm;line-height:12px;padding:2px;vertical-align:top}');
  h.push('table.items th.meas,table.items td.meas{word-break:normal}');
  h.push('.ng td{background:#fde8e8}.sign td{height:36px}');
  // 写真ブロック(SPEC §10.2b-B 版1.14.0): 1枚1table・高さ80mm(HTML方式はレター用紙のため)・列 110/76mm・3枚ごとに改ページ
  var prow = REPORT_HTML_PHOTO_ROW_MM;
  h.push('table.pb{table-layout:fixed;width:186mm;height:' + prow + 'mm;margin:0 0 2mm 0;page-break-inside:avoid}table.pb td{overflow:hidden;height:' + prow + 'mm;vertical-align:top;padding:3px 5px}');
  h.push('table.pb td.pic{width:' + REPORT_PHOTO_COLS_MM[0] + 'mm;text-align:center;vertical-align:middle;padding:0.5mm}table.pb td.inf{width:' + REPORT_PHOTO_COLS_MM[1] + 'mm}');
  h.push('table.pb .ngc{color:#c00;font-weight:bold}table.pb .lb{color:#555}');
  h.push('.foot{margin-top:10px;font-size:8px;color:#444;word-break:break-all}');
  h.push('</style></head><body>');
  h.push('<!--REPORT ' + esc_(rec.recordId) + ' v' + version + ' ' + esc_(rec.status) + ' stage=' + esc_(rec.stage) + '-->');
  h.push('<h1>' + esc_(reportSubject_(rec, site)) + '</h1>');
  h.push('<p>型枠工事 ' + esc_(stage) + '検査記録</p>');
  h.push('<table><tr><th>現場名</th><td>' + esc_(site.name) + '</td><th>元請会社</th><td>' + esc_(site.primeContractor) + '</td></tr>');
  var ownerCompany = rec.ownerCompany || userCompany_(rec.ownerUserId);
  if (ownerCompany) h.push('<tr><th>' + esc_(L.company) + '</th><td>' + esc_(ownerCompany) + '</td><th>' + esc_(L.owner) + '</th><td>' + esc_(userName_(rec.ownerUserId)) + '</td></tr>');
  h.push('<tr><th>階・工区・打設箇所</th><td>' + esc_(rec.floor + (rec.zone ? '・' + rec.zone : '') + ' / ' + rec.lot) + '</td><th>段階</th><td>' + esc_(stage) + '</td></tr>');
  // 版1.14.2(§10.2 の2): 記録ID・提出ラウンド・版は出さない(記録IDは末尾のフッタにある)
  if (rec.stage === 'post_demold') {
    // 出来形は打設予定日時を使わない(行ごと出さない。SPEC §6.8・§10.2 の2)
    h.push('<tr><th>ステータス</th><td>' + esc_(statusLabel_(rec)) + '</td><th>生成日時</th><td>' + esc_(dtShort_(nowDt)) + '</td></tr></table>');
  } else {
    h.push('<tr><th>打設予定日時</th><td>' + esc_(dtShort_(rec.pourPlannedAt)) + '</td><th>ステータス</th><td>' + esc_(statusLabel_(rec)) + '</td></tr>');
    h.push('<tr><th>生成日時</th><td colspan="3">' + esc_(dtShort_(nowDt)) + '</td></tr></table>');
  }

  // 3者サイン
  h.push('<h2>サイン欄(3者)</h2><table class="sign"><tr><th>' + esc_(L.signSelf) + '</th><th>' + esc_(L.signQa) + '</th><th>元請</th></tr><tr>');
  h.push('<td>' + (rec.submittedAt ? esc_(userName_(rec.submittedBy)) + (rec.submittedBy === rec.ownerUserId && ownerCompany ? '<br>' + esc_(ownerCompany) : companyLine_(rec.submittedBy)) + '<br>' + esc_(dtShort_(rec.submittedAt)) + '<br>PIN認証による電子サイン' : '未') + '</td>');
  h.push('<td>' + (rec.qaVerdict === 'ok' ? esc_(userName_(rec.qaVerdictBy)) + companyLine_(rec.qaVerdictBy) + '<br>' + esc_(dtShort_(rec.qaVerdictAt)) + '<br>判定: 合格' : '未') + '</td>');
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
  h.push('<tr><th>' + esc_(L.self) + '</th><td>' + cs.ok + '</td><td>' + cs.ng + '</td><td>' + cs.na + '</td></tr>');
  h.push('<tr><th>' + esc_(L.qa) + '</th><td>' + cq.ok + '</td><td>' + cq.ng + '</td><td>' + cq.na + '</td></tr></table>');

  // 項目表(SPEC §10.2b-A・§10.2d。版1.11.0)
  h.push('<h2>項目表</h2><table class="items"><colgroup><col style="width:8mm"><col style="width:40mm"><col style="width:14mm"><col style="width:18mm"><col style="width:46mm"><col style="width:30mm"><col style="width:30mm"></colgroup>');
  h.push('<tr><th>No.</th><th>項目</th><th>' + esc_(L.selfRes) + '</th><th>' + esc_(L.qaRes) + '</th><th class="meas">実測(設計値との差)</th><th>' + esc_(L.selfNote) + '</th><th>' + esc_(L.qaNote) + '</th></tr>');
  rows.forEach(function (r, i) {
    var snap = r.snapshot;
    var ng = r.selfResult === 'ng' || r.qaResult === 'ng';   // 許容超(▲)は行の色に影響しない(判定は人。§10.2d-9)
    h.push('<tr' + (ng ? ' class="ng" style="background:#fde8e8"' : '') + '><td>' + (i + 1) + '</td><td>' + (snap.key ? '★' : '') + esc_(snap.textJa) + '</td>' +
      '<td>' + esc_(RESULT_LABEL_[r.selfResult] || '') + '</td><td>' + esc_(RESULT_LABEL_[r.qaResult] || '') + (r.qaSeverity ? '(' + esc_(r.qaSeverity === 'major' ? '重大' : '軽微') + ')' : '') + '</td>' +
      '<td class="meas">' + measureBlockHtml_(r, false) + '</td><td>' + esc_(r.foremanNote) + '</td><td>' + esc_(r.qaNote) + '</td></tr>');
  });
  h.push('</table>');
  // §10.2d-8: 許容ありの実測が1つでもあるときだけ。旧注記「管理者コメントの全文は…」は廃止
  if (reportHasTolMeasure_(rows)) h.push('<p style="font-size:8px;color:#444444">' + esc_(REPORT_MEASURE_NOTE_) + '</p>');

  // 確認箇所(図面)(SPEC §10.2c): 項目表の直後・NG・是正の経過の前。0枚なら見出しごと出さない
  if (drawings.length) {
    var dseq = {};
    rows.forEach(function (r, i) { dseq[r.itemId] = i + 1; });
    var chip = function (res, sev) {
      var t = (RESULT_LABEL_[res] || '-') + (res === 'ng' && sev ? '(' + (sev === 'major' ? '重大' : '軽微') + ')' : '');
      return res === 'ng' ? '<span style="color:#c00;font-weight:bold">' + esc_(t) + '</span>' : esc_(t);
    };
    drawings.slice(0, 6).forEach(function (d) { h.push(buildDrawingPageHtml_(d, rows, dseq, chip)); });
    if (drawings.length > 6) h.push('<p>他' + (drawings.length - 6) + '枚は電子記録で閲覧可</p>');
  }

  // NG・是正の経過
  h.push('<h2>NG・是正の経過</h2>');
  var verdicts = events.filter(function (e) { return /^verdict_/.test(e.kind); });
  if (!verdicts.length) h.push('<p>判定履歴なし</p>');
  verdicts.forEach(function (e) {
    var d = e.detail || {};
    var ngs = (d.items || []).filter(function (x) { return x.result === 'ng'; }).map(function (x) { return x.itemId; });
    h.push('<p>' + esc_(dtShort_(e.at)) + ' ' + esc_(reportJudgeName_(e.actorUserId)) + ' 判定: ' + esc_(VERDICT_LABEL_[d.verdict] || d.verdict) +
      (d.comment ? ' / ' + esc_(d.comment) : '') + (ngs.length ? ' / NG項目: ' + esc_(ngs.join(',')) : '') + '</p>');
  });
  h.push('<p>提出回数: ' + events.filter(function (e) { return e.kind === 'submitted' || e.kind === 'resubmitted'; }).length + '</p>');

  // 写真(SPEC §10.2b-B 版1.14.0): 項目の番号順・最大60枚(選ぶときだけNG優先)・1ページ3枚・左=写真(本体)・右=情報欄
  // 版1.14.3: 「写真」の見出しは出さない(doc 方式と同じ)。写真があるときだけ新しいページから始める
  var order = reportPhotoOrder_(rows, photos, REPORT_PHOTOS_MAX);
  var shown = order.shown, rowOf = order.rowOf, seq = order.seq;
  if (shown.length) h.push('<div style="page-break-before:always"></div>');
  var loadPhoto = reportPhotoLoader_();
  function resChip_(res, sev, over) {
    var t = (RESULT_LABEL_[res] || '-') + (res === 'ng' && sev ? '(' + (sev === 'major' ? '重大' : '軽微') + ')' : '');
    var o = res === 'ng' ? '<span class="ngc">' + esc_(t) + '</span>' : esc_(t);
    return o + (over > 0 ? ' ' + measureOverSpan_('▲許容超' + over + '件') : '');   // §10.2b-B の情報欄2: 許容超の件数(側ごと)
  }
  shown.forEach(function (ph, idx) {
    var b64 = '';
    try { var blob = loadPhoto(ph); b64 = blob ? Util.b64encode(blob.getBytes()) : ''; } catch (e) { b64 = ''; }
    var who = ph.side === 'self' ? RPT_L_.self : (ph.side === 'qa' ? RPT_L_.qa : '元請サイン証跡');
    var row = ph.itemId ? rowOf[ph.itemId] : null;
    var info = '';
    if (row) {
      var snap = row.snapshot;
      info += '<div><b>No.' + (seq[ph.itemId] || '') + ' ' + (snap.key ? '★' : '') + esc_(snap.textJa) + '</b></div>';
      info += '<div><span class="lb">' + esc_(RPT_L_.self) + ':</span> ' + resChip_(row.selfResult, row.selfSeverity, reportOverCount_(row, 'self')) +
        ' / <span class="lb">' + esc_(RPT_L_.qa) + ':</span> ' + resChip_(row.qaResult, row.qaSeverity, reportOverCount_(row, 'qa')) + '</div>';
      info += '<div><span class="lb">' + esc_(RPT_L_.selfNote) + ':</span> ' + esc_(row.foremanNote) + '</div>';
      info += '<div><span class="lb">' + esc_(RPT_L_.qaNote) + ':</span> ' + esc_(row.qaNote) + '</div>';
    }
    info += '<div style="margin-top:4px"><span class="lb">撮影:</span> ' + esc_(who) + '</div><div style="font-size:8px;color:#444">' + esc_(ph.stampText) + '</div>';
    info = info.replace(/<\/div><div/g, '</div>\n<div');   // 段落ごとに改行(HTMLの見た目は変わらない。タグを除いたテキストを行で読めるように)
    var brk = ((idx + 1) % REPORT_PHOTOS_PER_PAGE === 0 && idx < shown.length - 1) ? ' style="page-break-after:always"' : '';
    // 写真は枠の中で最大(縦横比を保つ)。width と height を mm で両方指定(object-fit は使わない)
    var fit = reportPhotoFit_(ph.width, ph.height, REPORT_HTML_PHOTO_BOX_MM.w, REPORT_HTML_PHOTO_BOX_MM.h);
    var imgStyle = 'width:' + fit.w.toFixed(2) + 'mm;height:' + fit.h.toFixed(2) + 'mm';
    h.push('<table class="pb"' + brk + '><colgroup><col style="width:' + REPORT_PHOTO_COLS_MM[0] + 'mm"><col style="width:' + REPORT_PHOTO_COLS_MM[1] + 'mm"></colgroup>' +
      '<tr><td class="pic">' + (b64 ? '<img style="' + imgStyle + '" src="data:image/jpeg;base64,' + b64 + '">' : '') + '</td><td class="inf">' + info + '</td></tr></table>');
  });
  if (order.rest > 0) h.push('<p>他' + order.rest + '枚は電子記録で閲覧可</p>');
  h.push('<div class="foot">記録ID: ' + esc_(rec.recordId) + ' / 電子記録ハッシュ(SHA-256): ' + hash + '</div>');
  h.push('</body></html>');
  return h.join('\n');
}

/** 元請PDFの生成方式(SPEC §10.5.1)。'doc' 以外(空・欠落・不正値・html)は全て 'html' */
function reportEngine_() {
  return String(Cfg.get('reportEngine') || '').trim().toLowerCase() === 'doc' ? 'doc' : 'html';
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
  // 版1.9(§10.2a): {subject}_{段階名}_v{version}_{YYYYMMDD-HHmm}.pdf。段階名=打設前/出来形(subject の次)
  var name = Util.sanitizeName(reportSubject_(rec, site)) + '_' + (STAGE_LABEL_[rec.stage] || rec.stage) + '_v' + version + '_' + stamp + '.pdf';
  var file, bytes;
  // 生成方式(SPEC §10.5.1): Config reportEngine を trim・小文字化して 'doc' のときだけ doc 方式。それ以外は html
  var engine = reportEngine_(), used = 'html', fallbackReason = '';
  try {
    var blob = null;
    if (engine === 'doc') {
      try {
        blob = buildReportPdfBlobDoc_(rec, site, rows, photos, notes, events, version, nowIso, stamp);
        used = 'doc';
      } catch (e) {
        if (e instanceof ApiError) throw e;   // 権限・状態のエラーはフォールバックしない(SPEC §10.5.8)
        fallbackReason = String((e && e.message) || e || 'unknown error').slice(0, 200) || 'unknown error';
        Logger.log('generateReport: reportEngine=doc に失敗したため html で生成します: ' + fallbackReason);
        blob = null;
      }
    }
    if (!blob) {
      var html = buildReportHtml_(rec, site, rows, photos, notes, events, version, nowIso);
      blob = HtmlService.createHtmlOutput(html).getBlob().getAs('application/pdf');
    }
    blob.setName(name);
    bytes = blob.getBytes();
    var folder = subFolder_(subFolder_(driveRoot_(), 'reports'), Util.sanitizeName(site.siteId + '_' + site.name));
    file = folder.createFile(blob);
    if (Cfg.get('pdfShareMode') === 'anyone_with_link') {
      try { file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW); } catch (e) { /* 組織ポリシーで不可なら非共有のまま(P-32) */ }
    }
    // Drive の「詳細」で方式を確認できるよう説明に残す(失敗しても生成は成功させる。SPEC §10.5.8)
    try {
      file.setDescription(fallbackReason ? 'engine=html (fallback from doc: ' + fallbackReason.slice(0, 100) + ')' : 'engine=' + used);
    } catch (e) { Logger.log('generateReport: ファイルの説明を設定できませんでした: ' + (e && e.message)); }
  } catch (e) {
    if (e instanceof ApiError) throw e;
    throw new ApiError('DRIVE_ERROR', 'PDFの生成・保存に失敗しました');
  }
  var r = Repo.append('Reports', {
    reportId: Util.newId('f'), recordId: rec.recordId, version: version, recordStatus: rec.status, driveFileId: file.getId(),
    url: file.getUrl(), sha256: Util.sha256Hex(bytes), generatedBy: actor.userId, generatedAt: nowIso
  });
  var detail = { reportId: r.reportId, version: version, engine: used };
  if (fallbackReason) { detail.fallbackFrom = 'doc'; detail.fallbackReason = fallbackReason; }
  Ev.add(ctx, 'report_generated', { siteId: rec.siteId, recordId: rec.recordId, round: rec.round, detail: detail });
  return { report: reportView_(r) };
}

function act_listReports(ctx) {
  var rec = loadRecord_(ctx.params.recordId);
  requireAuth_(ctx.actor, 'listReports', { record: rec, params: ctx.params });
  var rows = Repo.where('Reports', 'recordId', rec.recordId).slice().sort(function (a, b) { return b.version - a.version; });
  return { reports: rows.map(reportView_) };
}

/** サイン欄の氏名の下に会社名を出す(空なら何も出さない) */
function companyLine_(userId) {
  var c = userCompany_(userId);
  return c ? '<br>' + esc_(c) : '';
}
