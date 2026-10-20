/**
 * ReportDoc.gs — 元請向けPDFの Google ドキュメント方式(reportEngine=doc。SPEC §10.5。版1.10.1)。
 *
 * HTML方式(Report.gs)は @page を無視してレターサイズになるため、DocumentApp で用紙 A4 縦・余白12mm を
 * 明示した文書を組み立て、Drive 経由で PDF に変換する。HTML方式と共通の部品(reportSubject_ / STAGE_LABEL_ /
 * statusLabel_ / measureView_(版1.11.0。旧 measureText_ の置き換え) / drawingLegendModel_ / reportSnapshotHash_ / dtShort_ / RESULT_LABEL_ ほか)は Report.gs のものを呼ぶ。
 *
 * 失敗時のフォールバック(html に切り替えて PDF を必ず作る)は呼び出し側 act_generateReport(Report.gs)が行う。
 * ここでは「例外をそのまま投げる」「一時文書は finally で必ずゴミ箱へ」だけを守る。
 *
 * 見た目(文字化け・4枚/ページの収まり・白紙ページ)は実GASでしか確認できない(SPEC §12.7)。
 */

/* ---------- 定数(SPEC §10.5.2。値を変えるときは SPEC を先に直す) ---------- */
var REPORT_DOC_PAGE_W_PT = 595.28;   // A4 幅(縦)
var REPORT_DOC_PAGE_H_PT = 841.89;   // A4 高さ
var REPORT_DOC_MARGIN_PT = 34.02;    // 余白 12mm
/** 文字化けしたら 'Noto Serif JP' → 'M PLUS 1p' → 'Sawarabi Gothic' の順に試す(設計担当が決める。SPEC §10.5.2) */
var REPORT_DOC_FONT = 'Noto Sans JP';
var REPORT_DOC_SIZE = { body: 7.5, table: 7.5, note: 6, foot: 6, h1: 12, h2: 9 };
var REPORT_DOC_COLOR = { text: '#111111', label: '#555555', ng: '#CC0000', note: '#444444', border: '#666666', head: '#EEEEEE', ngRow: '#FDE8E8' };
var REPORT_DOC_BORDER_PT = 0.75;
var REPORT_DOC_H2 = { size: REPORT_DOC_SIZE.h2, bold: true, before: 9, after: 3 };   // 見出し(h2)の共通書式
var REPORT_DOC_PAD = { v: 2, h: 3, photoV: 3 };   // セル余白(上下・左右・写真ブロックの上下)
var REPORT_DOC_ROW_MIN_PT = 17.0;                  // 項目表・凡例表の最低行高(6mm)
var REPORT_DOC_SIGN_MIN_PT = 36;                   // サイン欄本文行の最低高
var REPORT_DOC_TIMEOUT_MS = 80000;                 // 組み立て開始からの上限(SPEC §10.5.8)
var REPORT_DOC_BODY_W_MM = 186;                    // 本文領域の幅(SPEC §10.5.2 の名目値。表の列幅の「設計上の合計」)
/**
 * 表の実効幅(mm)。実機のPDF(2026-10-19)で、列幅の合計を本文幅186mmにした表が右端で約9px@110dpi(≒6pt≒2mm)
 * 本文右余白へはみ出した(Googleドキュメントは列幅に罫線・セル余白ぶんが外付けになる)。
 * 全ての表の列幅を REPORT_DOC_TABLE_W_MM / REPORT_DOC_BODY_W_MM 倍して合計をこの値にする(docMm_ の手前の docColMm_)。
 * 2mm 縮めた根拠: はみ出し約2mm(実測)。値は実機確認で調整する(定数1か所)。
 */
var REPORT_DOC_TABLE_W_MM = 184;
var REPORT_DOC_TABLE_SCALE = REPORT_DOC_TABLE_W_MM / REPORT_DOC_BODY_W_MM;
var REPORT_DOC_PHOTO_ROW_MM = 62;                  // 写真ブロックの最低高
var REPORT_DOC_PHOTO_COLS_MM = [83, 103];          // 写真ブロックの列幅(左=写真 / 右=情報欄)
// 写真の枠・図面の枠は SPEC の名目値(80×58 / 186×170)を表と同じ倍率で縮める(縦横比は維持)。
// 写真: 左列 83mm×倍率 − 左右余白(3pt×2)≒80.0mm の中に 79.1mm が収まる。図面: 画像セルの余白を0にして 184mm が列幅に収まる。
var REPORT_DOC_PHOTO_BOX_MM = { w: 80 * REPORT_DOC_TABLE_SCALE, h: 58 * REPORT_DOC_TABLE_SCALE };
var REPORT_DOC_DRAWING_BOX_MM = { w: 186 * REPORT_DOC_TABLE_SCALE, h: 170 * REPORT_DOC_TABLE_SCALE };
var REPORT_DOC_PHOTOS_PER_PAGE = 4;
var REPORT_DOC_PHOTOS_MAX = 60;
var REPORT_DOC_DRAWINGS_MAX = 6;
var REPORT_DOC_CHECK_OK = 'OK: doc 方式の変換に成功しました(A4 595.28×841.89pt)';

/** mm → pt(1mm = 72/25.4 pt) */
function docMm_(mm) { return mm * 72 / 25.4; }
/** SPEC 名目の列幅(mm。合計186)を実効幅に縮めた値(mm) */
function docColMm_(mm) { return mm * REPORT_DOC_TABLE_SCALE; }

/** 経過時間の確認。80秒を超えたら内部の例外を投げる(フォールバックの合図。API のエラーコードではない) */
function docCheckTime_(t0) {
  if (Util.now().getTime() - t0 > REPORT_DOC_TIMEOUT_MS) throw new Error('REPORT_DOC_TIMEOUT');
}

function docStr_(x) { return x === null || x === undefined ? '' : String(x); }

/* ---------- 文字・段落の部品 ---------- */

/**
 * 1行ぶんの内容(runs)を段落に入れる。runs は文字列、{t, bold, color, size} 1つ、またはその配列。
 * 文字列全体を setText してから、装飾が要る範囲だけ editAsText の範囲指定で付ける
 * (appendText の連結だと同じ書式の隣接 Text が1つに結合されて範囲がずれるため)。
 * 返り値: 範囲装飾の関数の配列(表では基準書式をかけた「後」に実行するため、呼び出し側が実行を選べる)。
 */
function docRuns_(p, runs) {
  if (typeof runs === 'string') runs = [{ t: runs }];
  else if (!Array.isArray(runs)) runs = [runs];   // 単一の run オブジェクト
  var full = '', marks = [];
  runs.forEach(function (r) {
    var t = docStr_(r.t);
    if (t && (r.bold || r.color || r.size)) marks.push({ s: full.length, e: full.length + t.length - 1, r: r });
    full += t;
  });
  if (full === '') return [];
  p.setText(full);
  return marks.map(function (m) {
    return function () {
      var tx = p.editAsText();
      if (m.r.bold) tx.setBold(m.s, m.e, true);
      if (m.r.color) tx.setForegroundColor(m.s, m.e, m.r.color);
      if (m.r.size) tx.setFontSize(m.s, m.e, m.r.size);
    };
  });
}

/** 本文の段落を1つ作る(見出し・注記・通常文)。opts: size / bold / color / before / after / first(最初の空段落を再利用) */
function docBodyPara_(body, runs, opts) {
  opts = opts || {};
  var p = opts.first ? body.getParagraphs()[0] : body.appendParagraph('');
  var marks = docRuns_(p, runs);
  // 直前の段落の書式を引き継がないよう、毎回すべて明示する
  p.setFontSize(opts.size || REPORT_DOC_SIZE.body);
  p.setBold(!!opts.bold);
  p.setForegroundColor(opts.color || REPORT_DOC_COLOR.text);
  p.setSpacingBefore(opts.before || 0);
  p.setSpacingAfter(opts.after || 0);
  marks.forEach(function (f) { f(); });
  return p;
}

/* ---------- 表の部品 ---------- */

/**
 * 空の表を作って共通の見た目(罫線・列幅)を付ける。widthsMm は SPEC 名目の mm の配列(合計186)。実際の列幅は docColMm_ で縮めた値(REPORT_DOC_TABLE_W_MM)。
 * 文字サイズ・色は内容を入れた後に docTableBase_ で付ける。
 */
function docNewTable_(body, nRows, widthsMm, o) {
  o = o || {};
  var cells = [];
  for (var i = 0; i < nRows; i++) {
    var row = [];
    for (var j = 0; j < widthsMm.length; j++) row.push('');
    cells.push(row);
  }
  var t = body.appendTable(cells);
  t.setBorderWidth(o.noBorder ? 0 : REPORT_DOC_BORDER_PT);
  if (!o.noBorder) t.setBorderColor(REPORT_DOC_COLOR.border);
  widthsMm.forEach(function (w, c) { t.setColumnWidth(c, docMm_(docColMm_(w))); });
  return t;
}

/** セルの余白(SPEC §10.5.2。写真ブロックだけ上下 3pt) */
function docCellPad_(cell, vertical) {
  cell.setPaddingTop(vertical === undefined ? REPORT_DOC_PAD.v : vertical);
  cell.setPaddingBottom(vertical === undefined ? REPORT_DOC_PAD.v : vertical);
  cell.setPaddingLeft(REPORT_DOC_PAD.h);
  cell.setPaddingRight(REPORT_DOC_PAD.h);
}

/**
 * セルに行(lines)を入れる。最初の行は最初の空段落を再利用し、2行目以降だけ appendParagraph する(空段落を余らせない)。
 * lines の各要素は docRuns_ の runs。範囲装飾の関数の配列を返す。
 */
function docCellLines_(cell, lines) {
  var marks = [];
  lines.forEach(function (runs, i) {
    var p = i === 0 ? cell.getChild(0).asParagraph() : cell.appendParagraph('');
    marks = marks.concat(docRuns_(p, runs));
  });
  return marks;
}

/** 表全体の基準書式(文字サイズ・色・太字なし)。内容を入れた後、範囲装飾の前に呼ぶ */
function docTableBase_(table) {
  var fmt = function (tx) {
    tx.setFontSize(REPORT_DOC_SIZE.table);
    tx.setForegroundColor(REPORT_DOC_COLOR.text);
    tx.setBold(false);
  };
  try { fmt(table.editAsText()); } catch (e) {   // Table.editAsText が使えない場合はセルごと(要確認の保険)
    for (var r = 0; r < table.getNumRows(); r++) {
      var row = table.getRow(r);
      for (var c = 0; c < row.getNumCells(); c++) fmt(row.getCell(c).editAsText());
    }
  }
}

/** 見出し行(背景・太字) */
function docHeadRow_(table, rowIdx) {
  var row = table.getRow(rowIdx);
  for (var c = 0; c < row.getNumCells(); c++) row.getCell(c).setBackgroundColor(REPORT_DOC_COLOR.head);
  try { row.editAsText().setBold(true); } catch (e) {   // TableRow.editAsText が使えない場合はセルごと(要確認の保険)
    for (var k = 0; k < row.getNumCells(); k++) row.getCell(k).editAsText().setBold(true);
  }
}

/**
 * 文字だけの表(基本情報・結果サマリ・項目表・凡例・サイン欄)を作る。
 * rows: 行ごとのセル内容の配列。セル内容は lines(= runs の配列)。runs が文字列1つのときは [文字列] として扱う。
 * o: widths(mm) / headRows([行番号]。背景+太字) / shadeRows({行番号:true}。背景のみ=図面の凡例の項目見出し行) / labelCols([列番号]) / minHeight(pt) / ngRows({行番号:true}) / rowMin({行番号:pt})
 */
function docTextTable_(body, rows, o, t0) {
  var t = docNewTable_(body, rows.length, o.widths, o);
  var marks = [];
  rows.forEach(function (cellsOfRow, r) {
    var row = t.getRow(r);
    var min = (o.rowMin && o.rowMin[r]) || o.minHeight;
    if (min) row.setMinimumHeight(Math.round(min));   // 実GASの引数は Integer
    cellsOfRow.forEach(function (lines, c) {
      var cell = row.getCell(c);
      docCellPad_(cell);
      if (typeof lines === 'string') lines = [lines];
      marks = marks.concat(docCellLines_(cell, lines));
      if (o.ngRows && o.ngRows[r]) cell.setBackgroundColor(REPORT_DOC_COLOR.ngRow);
      if (o.shadeRows && o.shadeRows[r]) cell.setBackgroundColor(REPORT_DOC_COLOR.head);
    });
    if (t0 && r % 20 === 19) docCheckTime_(t0);
  });
  docTableBase_(t);
  (o.headRows || []).forEach(function (r) { docHeadRow_(t, r); });
  (o.labelCols || []).forEach(function (c) {
    rows.forEach(function (cellsOfRow, r) {
      var v = cellsOfRow[c];
      if (v === '' || (Array.isArray(v) && v.length === 1 && v[0] === '')) return;   // 空のラベルセルは塗らない
      t.getCell(r, c).setBackgroundColor(REPORT_DOC_COLOR.head);
      t.getCell(r, c).editAsText().setBold(true);
    });
  });
  marks.forEach(function (f) { f(); });
  if (t0) docCheckTime_(t0);
  return t;
}

/* ---------- 画像の部品 ---------- */

/**
 * 画像を「枠に収める」(縦横比を保つ。SPEC §10.5.4/10.5.5)。比率は Photos.width/height が正ならそれ、
 * 無ければ挿入した画像の実寸。比率が取れなければ false(呼び出し側が画像を外して代替文にする)。
 */
function docFitImage_(img, ph, boxWmm, boxHmm) {
  var rw = Number(ph && ph.width), rh = Number(ph && ph.height);
  if (!(rw > 0 && rh > 0)) { rw = Number(img.getWidth()); rh = Number(img.getHeight()); }
  if (!(rw > 0 && rh > 0)) return false;
  var s = Math.min(docMm_(boxWmm) / rw, docMm_(boxHmm) / rh);
  img.setWidth(Math.round(rw * s));   // 実GASの引数は Integer
  img.setHeight(Math.round(rh * s));
  return true;
}

/** Drive の画像ファイルの blob。読めなければ null(個々の画像の読み込み失敗はフォールバックしない。SPEC §10.5.8) */
function docImageBlob_(fileId) {
  try { return fileId ? DriveApp.getFileById(fileId).getBlob() : null; } catch (e) { return null; }
}

/* ---------- 文書の組み立て ---------- */

function docSetupPage_(body) {
  body.setPageWidth(REPORT_DOC_PAGE_W_PT);
  body.setPageHeight(REPORT_DOC_PAGE_H_PT);
  body.setMarginTop(REPORT_DOC_MARGIN_PT);
  body.setMarginBottom(REPORT_DOC_MARGIN_PT);
  body.setMarginLeft(REPORT_DOC_MARGIN_PT);
  body.setMarginRight(REPORT_DOC_MARGIN_PT);
}

/** 結果の表記(NGは赤・太字、NGの重さは括弧)。runs を返す */
function docResRun_(res, sev) {
  var t = (RESULT_LABEL_[res] || '-') + (res === 'ng' && sev ? '(' + (sev === 'major' ? '重大' : '軽微') + ')' : '');
  return res === 'ng' ? { t: t, bold: true, color: REPORT_DOC_COLOR.ng } : { t: t };
}

/**
 * 実測の runs(SPEC §10.2d-6。HTML方式の measureBlockHtml_ と同じ内容)。有効値のある側ごとに2行(値の並び→要約)。
 * 許容超の値(▲を含む)と要約末尾の ▲許容超n件 だけ太字・赤。ラベルは #555555、要約は #444444。
 * withKeyword=true なら『実測(職長): 』、false なら『職長: 』。返り値は lines(= runs の配列の配列)。実測なしなら []
 */
function docMeasureLines_(row, withKeyword) {
  var lines = [];
  ['self', 'qa'].forEach(function (side) {
    var v = measureView_(row, side);
    if (!v) return;
    var runs = [{ t: (withKeyword ? '実測(' + v.label + '): ' : v.label + ': '), color: REPORT_DOC_COLOR.label }];
    v.values.forEach(function (x, i) {
      if (i > 0) runs.push({ t: '、 ' });   // 読点+半角スペース(「、」直後の「-」で折り返せずセルからはみ出したため)
      runs.push(x.over ? { t: '▲' + x.text, bold: true, color: REPORT_DOC_COLOR.ng } : { t: x.text });
    });
    lines.push(runs);
    var sp = measureSummaryParts_(v);
    var sruns = [{ t: sp.base, color: REPORT_DOC_COLOR.note }];
    if (sp.over) sruns.push({ t: sp.over, bold: true, color: REPORT_DOC_COLOR.ng });
    lines.push(sruns);
  });
  return lines;
}

/** 結果サマリの集計(HTML方式の cnt と同じ規則) */
function docCount_(rows, side) {
  var c = { ok: 0, ng: 0, na: 0 };
  rows.forEach(function (r) {
    var aud = r.snapshot.audience;
    var res = side === 'self' ? (aud !== 'qa' ? r.selfResult : '') : (aud !== 'foreman' ? r.qaResult : '');
    if (res) c[res]++;
  });
  return c;
}

/** 確認箇所(図面)の1ページ(SPEC §10.5.4) */
function docDrawingPage_(body, ph, rows, seq, t0) {
  body.appendPageBreak();
  docBodyPara_(body, '確認箇所(図面)', REPORT_DOC_H2);
  docBodyPara_(body, (ph.side === 'qa' ? '管理者' : '職長') + ': ' + userName_(ph.takenBy) + ' / ' + dtShort_(ph.takenAt));

  // 画像(1行1列の罫線なしの表。中央寄せ)
  var t = docNewTable_(body, 1, [REPORT_DOC_BODY_W_MM], { noBorder: true });
  var cell = t.getCell(0, 0);
  cell.setPaddingTop(0); cell.setPaddingBottom(0); cell.setPaddingLeft(0); cell.setPaddingRight(0);   // 枠いっぱい(184mm)の画像を列幅に収める
  var p = cell.getChild(0).asParagraph();
  p.setAlignment(DocumentApp.HorizontalAlignment.CENTER);
  var blob = docImageBlob_(ph.driveFileId);
  var ok = false;
  if (blob) {
    var img = p.appendInlineImage(blob);   // 挿入の例外はフォールバックさせる(表・画像の挿入エラー。SPEC §10.5.8)
    ok = docFitImage_(img, ph, REPORT_DOC_DRAWING_BOX_MM.w, REPORT_DOC_DRAWING_BOX_MM.h);
    if (!ok) img.removeFromParent();
  }
  if (!ok) p.setText('画像を読み込めませんでした');
  docCheckTime_(t0);

  var markers = Array.isArray(ph.markers) ? ph.markers : [];
  if (!markers.length) {
    docBodyPara_(body, '印の書き込みなし', { before: 3 });
    return;
  }
  // 凡例(SPEC §10.5.4・§10.2c-3 版1.11.0): 項目ごとのグループ。6列 24/76/28/24/17/17mm。セル結合は使わず通常の6セルで作る
  var trs = [['番号', '項目', '実測値', '許容超', '職長', '管理者']], shadeRows = {};
  drawingLegendModel_(ph, rows, seq).forEach(function (e) {
    var row = e.row;
    if (e.type === 'mark') {
      trs.push([e.no, '', e.over ? [[{ t: e.value, bold: true, color: REPORT_DOC_COLOR.ng }]] : e.value,
        e.over ? [[{ t: '▲', bold: true, color: REPORT_DOC_COLOR.ng }]] : '', '', '']);
      return;
    }
    var itemCell;
    if (e.type === 'head') {
      itemCell = [[{ t: e.title, bold: true }]];
      if (e.summary) {
        var sp = measureSummaryParts_(e.summary), sruns = [{ t: sp.base, color: REPORT_DOC_COLOR.note }];
        if (sp.over) sruns.push({ t: sp.over, bold: true, color: REPORT_DOC_COLOR.ng });
        itemCell.push(sruns);
      }
      shadeRows[trs.length] = true;
    } else {
      itemCell = e.title;
    }
    trs.push([e.no, itemCell, '', '', [docResRun_(row.selfResult, row.selfSeverity)], [docResRun_(row.qaResult, row.qaSeverity)]]);
  });
  docBodyPara_(body, '', { size: 3 });
  docTextTable_(body, trs, { widths: [24, 76, 28, 24, 17, 17], headRows: [0], shadeRows: shadeRows, minHeight: REPORT_DOC_ROW_MIN_PT }, t0);
}

/** 写真ページの1ブロック(SPEC §10.5.5)。2列×1行の表 */
function docPhotoBlock_(body, ph, rowOf, seq) {
  var t = docNewTable_(body, 1, REPORT_DOC_PHOTO_COLS_MM, {});
  t.getRow(0).setMinimumHeight(Math.round(docMm_(REPORT_DOC_PHOTO_ROW_MM)));   // 実GASの引数は Integer
  var left = t.getCell(0, 0), right = t.getCell(0, 1);
  docCellPad_(left, REPORT_DOC_PAD.photoV);
  docCellPad_(right, REPORT_DOC_PAD.photoV);
  left.setVerticalAlignment(DocumentApp.VerticalAlignment.CENTER);
  right.setVerticalAlignment(DocumentApp.VerticalAlignment.TOP);

  // 左: サムネ。枠(80mm×58mm)に収める。読めないときは空のセル
  var lp = left.getChild(0).asParagraph();
  lp.setAlignment(DocumentApp.HorizontalAlignment.CENTER);
  lp.setSpacingBefore(0);
  lp.setSpacingAfter(0);
  lp.setLineSpacing(1.0);
  var blob = docImageBlob_(ph.thumbFileId);
  if (blob) {
    var img = lp.appendInlineImage(blob);
    if (!docFitImage_(img, ph, REPORT_DOC_PHOTO_BOX_MM.w, REPORT_DOC_PHOTO_BOX_MM.h)) img.removeFromParent();
  }

  // 右: 情報欄(HTML方式 §10.2b-B の1〜7と同じ内容・同じ順)
  var lb = function (s) { return { t: s, color: REPORT_DOC_COLOR.label }; };
  var who = ph.side === 'self' ? '職長' : (ph.side === 'qa' ? '管理者' : '元請サイン証跡');
  var row = ph.itemId ? rowOf[ph.itemId] : null;
  var lines = [];
  if (row) {
    var snap = row.snapshot;
    lines.push([{ t: 'No.' + (seq[ph.itemId] || '') + ' ' + (snap.key ? '★' : '') + docStr_(snap.textJa), bold: true }]);
    lines.push([lb('職長:'), { t: ' ' }, docResRun_(row.selfResult, row.selfSeverity), { t: ' / ' }, lb('管理者:'), { t: ' ' }, docResRun_(row.qaResult, row.qaSeverity)]);
    docMeasureLines_(row, true).forEach(function (l) { lines.push(l); });   // 実測(職長): 値 / 要約 / 実測(管理者): … (§10.2d。なければ行なし)
    lines.push([lb('職長コメント:'), { t: ' ' + docStr_(row.foremanNote) }]);
    lines.push([lb('管理者コメント:'), { t: ' ' + docStr_(row.qaNote) }]);
  }
  lines.push([lb('撮影:'), { t: ' ' + who }]);
  lines.push([{ t: docStr_(ph.stampText), size: REPORT_DOC_SIZE.note, color: REPORT_DOC_COLOR.note }]);
  var marks = docCellLines_(right, lines);
  docTableBase_(t);
  marks.forEach(function (f) { f(); });
}

/** 文書本体を組み立てる(SPEC §10.5.3〜10.5.6)。例外はそのまま投げる */
function docBuild_(doc, rec, site, rows, allPhotos, events, version, nowIso, t0) {
  var body = doc.getBody();
  docSetupPage_(body);
  var photos = allPhotos.filter(function (x) { return photoKindOf_(x) !== 'drawing'; });
  var drawings = allPhotos.filter(function (x) { return photoKindOf_(x) === 'drawing'; })
    .sort(function (a, b) { return a.takenAt < b.takenAt ? -1 : (a.takenAt > b.takenAt ? 1 : 0); });
  var verdicts = events.filter(function (e) { return /^verdict_/.test(e.kind); });
  var hash = reportSnapshotHash_(rec, rows, verdicts);
  var stage = STAGE_LABEL_[rec.stage] || rec.stage;
  var ownerCompany = rec.ownerCompany || userCompany_(rec.ownerUserId);
  var h2 = REPORT_DOC_H2;

  // 1・2. 件名(最初の空段落を再利用)とタイトル
  docBodyPara_(body, reportSubject_(rec, site), { first: true, size: REPORT_DOC_SIZE.h1, bold: true, after: 3 });
  docBodyPara_(body, '型枠工事 ' + stage + '検査記録', { after: 3 });

  // 3. 基本情報表(4列 30/63/30/63)
  var info = [['現場名', docStr_(site.name), '元請会社', docStr_(site.primeContractor)]];
  if (ownerCompany) info.push(['職長の会社名', ownerCompany, '職長', docStr_(userName_(rec.ownerUserId))]);
  info.push(['階・工区・打設箇所', rec.floor + (rec.zone ? '・' + rec.zone : '') + ' / ' + rec.lot, '段階', stage]);
  if (rec.stage === 'post_demold') info.push(['記録ID', rec.recordId, '', '']);   // 出来形は打設予定日時を出さない(セル結合はしない)
  else info.push(['打設予定日時', dtShort_(rec.pourPlannedAt), '記録ID', rec.recordId]);
  info.push(['ステータス', statusLabel_(rec), '提出ラウンド', String(rec.round)]);
  info.push(['生成日時', dtShort_(nowIso), '版', 'v' + version]);
  docTextTable_(body, info, { widths: [30, 63, 30, 63], labelCols: [0, 2] }, t0);

  // 4. サイン欄(3者)
  docBodyPara_(body, 'サイン欄(3者)', h2);
  var foreman = ['未'];
  if (rec.submittedAt) {
    var fc = rec.submittedBy === rec.ownerUserId && ownerCompany ? ownerCompany : userCompany_(rec.submittedBy);
    foreman = [docStr_(userName_(rec.submittedBy))].concat(fc ? [fc] : [], [dtShort_(rec.submittedAt), 'PIN認証による電子サイン']);
  }
  var qa = ['未'];
  if (rec.qaVerdict === 'ok') {
    var qc = userCompany_(rec.qaVerdictBy);
    qa = [docStr_(userName_(rec.qaVerdictBy))].concat(qc ? [qc] : [], [dtShort_(rec.qaVerdictAt), '判定: 合格']);
  }
  var prime = ['氏名 ______________ 日付 ______________', '署名・押印'];
  if (rec.primeSignedAt) {
    prime = [docStr_(rec.primeSignerName), METHOD_LABEL_[rec.primeSignMethod] || docStr_(rec.primeSignMethod),
      '記録者: ' + docStr_(userName_(rec.primeSignedBy)), dtShort_(rec.primeSignedAt)];
  }
  docTextTable_(body, [['職長', '品質管理者', '元請'], [foreman, qa, prime]],
    { widths: [62, 62, 62], headRows: [0], rowMin: { 1: REPORT_DOC_SIGN_MIN_PT } }, t0);

  // 5. 打設停止履歴
  var stops = events.filter(function (e) { return e.kind === 'stopped'; });
  if (stops.length) {
    docBodyPara_(body, '打設停止履歴: ' + stops.map(function (e) { return dtShort_(e.at) + ' ' + ((e.detail && e.detail.reason) || ''); }).join(' / '), { before: 4 });
  }

  // 6. 結果サマリ(4列 30/52/52/52)
  docBodyPara_(body, '結果サマリ', h2);
  var cs = docCount_(rows, 'self'), cq = docCount_(rows, 'qa');
  docTextTable_(body, [['', '合', 'NG', '該当なし'], ['職長', String(cs.ok), String(cs.ng), String(cs.na)], ['管理者', String(cq.ok), String(cq.ng), String(cq.na)]],
    { widths: [30, 52, 52, 52], headRows: [0], labelCols: [0] }, t0);

  // 7. 項目表(7列 8/40/14/18/46/30/30。全列で折り返しうる。文字は切り詰めない。実測は §10.2d の書式)
  docBodyPara_(body, '項目表', h2);
  var items = [['No.', '項目', '職長結果', '管理者結果', '実測(設計値との差)', '職長コメント', '管理者コメント']], ngRows = {};
  rows.forEach(function (r, i) {
    var snap = r.snapshot;
    var ml = docMeasureLines_(r, false);
    if (r.selfResult === 'ng' || r.qaResult === 'ng') ngRows[i + 1] = true;   // 許容超(▲)は行の背景に影響しない(判定は人。§10.2d-9)
    items.push([String(i + 1), (snap.key ? '★' : '') + docStr_(snap.textJa), RESULT_LABEL_[r.selfResult] || '',
      (RESULT_LABEL_[r.qaResult] || '') + (r.qaSeverity ? '(' + (r.qaSeverity === 'major' ? '重大' : '軽微') + ')' : ''),
      ml.length ? ml : '', docStr_(r.foremanNote), docStr_(r.qaNote)]);
  });
  docTextTable_(body, items, { widths: [8, 40, 14, 18, 46, 30, 30], headRows: [0], minHeight: REPORT_DOC_ROW_MIN_PT, ngRows: ngRows }, t0);

  // 8. 注記(§10.2d-8。許容ありの実測が1つでもあるときだけ。旧注記「管理者コメントの全文は…」は廃止)
  if (reportHasTolMeasure_(rows)) docBodyPara_(body, REPORT_MEASURE_NOTE_, { size: REPORT_DOC_SIZE.note, color: REPORT_DOC_COLOR.note, before: 2 });

  // 9. 確認箇所(図面)。0枚なら出さない。図面ごとに改ページ
  if (drawings.length) {
    var dseq = {};
    rows.forEach(function (r, i) { dseq[r.itemId] = i + 1; });
    drawings.slice(0, REPORT_DOC_DRAWINGS_MAX).forEach(function (d) { docDrawingPage_(body, d, rows, dseq, t0); });
    if (drawings.length > REPORT_DOC_DRAWINGS_MAX) docBodyPara_(body, '他' + (drawings.length - REPORT_DOC_DRAWINGS_MAX) + '枚は電子記録で閲覧可');
  }

  // 10. NG・是正の経過
  docBodyPara_(body, 'NG・是正の経過', h2);
  if (!verdicts.length) docBodyPara_(body, '判定履歴なし');
  verdicts.forEach(function (e) {
    var d = e.detail || {};
    var ngs = (d.items || []).filter(function (x) { return x.result === 'ng'; }).map(function (x) { return x.itemId; });
    docBodyPara_(body, dtShort_(e.at) + ' ' + docStr_(userName_(e.actorUserId)) + ' 判定: ' + (VERDICT_LABEL_[d.verdict] || docStr_(d.verdict)) +
      (d.comment ? ' / ' + d.comment : '') + (ngs.length ? ' / NG項目: ' + ngs.join(',') : ''));
  });
  docBodyPara_(body, '提出回数: ' + events.filter(function (e) { return e.kind === 'submitted' || e.kind === 'resubmitted'; }).length);

  // 11. 写真(最大60枚。NG項目の写真を優先。1ページ最大4枚)
  body.appendPageBreak();
  docBodyPara_(body, '写真', h2);
  var ngItems = {}, rowOf = {}, pseq = {};
  rows.forEach(function (r, i) {
    if (r.selfResult === 'ng' || r.qaResult === 'ng') ngItems[r.itemId] = true;
    pseq[r.itemId] = i + 1;
    rowOf[r.itemId] = r;
  });
  var sorted = photos.slice().sort(function (a, b) { return (ngItems[b.itemId] ? 1 : 0) - (ngItems[a.itemId] ? 1 : 0); });
  var shown = sorted.slice(0, REPORT_DOC_PHOTOS_MAX);
  shown.forEach(function (ph, idx) {
    docPhotoBlock_(body, ph, rowOf, pseq);
    if ((idx + 1) % REPORT_DOC_PHOTOS_PER_PAGE === 0 && idx < shown.length - 1) {
      body.appendPageBreak();   // 4の倍数枚目の後。最後の写真の後には入れない
    } else {
      docBodyPara_(body, '', { size: 3 });   // 表が連続して結合されるのを避ける空段落
    }
    docCheckTime_(t0);
  });
  if (photos.length > shown.length) docBodyPara_(body, '他' + (photos.length - shown.length) + '枚は電子記録で閲覧可');

  // 12. フッタ(全ページ。記録IDとハッシュ。ページ番号は出さない)と全体のフォント
  var footer = doc.getFooter() || doc.addFooter();   // 新規文書は通常フッタ無し。既にあれば再利用(addFooter は二重追加で例外)
  var fp = footer.getParagraphs()[0] || footer.appendParagraph('');
  fp.setText('記録ID: ' + rec.recordId + ' / 電子記録ハッシュ(SHA-256): ' + hash);
  fp.setFontSize(REPORT_DOC_SIZE.foot);
  fp.setForegroundColor(REPORT_DOC_COLOR.note);
  footer.editAsText().setFontFamily(REPORT_DOC_FONT);
  body.editAsText().setFontFamily(REPORT_DOC_FONT);
}

/**
 * 一時文書を作って PDF に変換し、一時文書は成功・失敗を問わずゴミ箱へ入れる(SPEC §10.5.8)。
 * build(doc) で文書を組み立てる。返り値は PDF の blob(名前は呼び出し側が setName する)。
 */
function docToPdfBlob_(title, build) {
  var docId = null;
  try {
    var doc = DocumentApp.create(title);
    docId = doc.getId();
    build(doc);
    doc.saveAndClose();
    return DriveApp.getFileById(docId).getAs('application/pdf');
  } finally {
    if (docId) {
      try { DriveApp.getFileById(docId).setTrashed(true); } catch (e) { Logger.log('一時文書をゴミ箱へ移せませんでした: ' + (e && e.message)); }
    }
  }
}

/**
 * doc 方式で PDF の blob を作る(SPEC §10.5)。失敗は例外のまま投げる(フォールバックは呼び出し側)。
 * stamp = ファイル名と同じ YYYYMMDD-HHmm。
 */
function buildReportPdfBlobDoc_(rec, site, rows, allPhotos, notes, events, version, nowIso, stamp) {
  var t0 = Util.now().getTime();
  return docToPdfBlob_('_tmp_report_' + rec.recordId + '_' + stamp, function (doc) {
    docBuild_(doc, rec, site, rows, allPhotos, events, version, nowIso, t0);
    docCheckTime_(t0);
  });
}

/**
 * GASエディタ専用(action ではない。ACTIONS に登録しない)。doc 方式が使えるかの試験(SPEC §10.5.9)。
 * 1ページの試験文書(見出し1行・2×2の表・日本語の文)を同じ用紙設定で作り、PDF 変換と後始末まで行う。
 * 失敗したら例外をそのまま投げる(握りつぶさない)。シート・Config・Events・Reports・Properties には書かない。
 */
function checkReportEngine() {
  var stamp = Util.nowIso().replace(/[-:]/g, '').slice(0, 13).replace('T', '-');
  var blob = docToPdfBlob_('_tmp_checkReportEngine_' + stamp, function (doc) {
    var body = doc.getBody();
    docSetupPage_(body);
    docBodyPara_(body, '元請PDF 試験文書', { first: true, size: REPORT_DOC_SIZE.h1, bold: true, after: 3 });
    var t = body.appendTable([['項目', '内容'], ['用紙', 'A4 縦 余白12mm']]);
    t.setBorderWidth(REPORT_DOC_BORDER_PT);
    t.setBorderColor(REPORT_DOC_COLOR.border);
    docBodyPara_(body, '日本語の表示確認: 型枠工事 打設前検査記録 ★ ± 〜 ① ≦', { before: 6 });
    body.editAsText().setFontFamily(REPORT_DOC_FONT);
  });
  if (!blob || !blob.getBytes().length) throw new Error('PDF が空でした');
  Logger.log(REPORT_DOC_CHECK_OK);
  return REPORT_DOC_CHECK_OK;
}
