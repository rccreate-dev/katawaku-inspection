'use strict';
/**
 * docshim.js — Google Apps Script の DocumentApp の代役(SPEC 版1.10.1 §11.4 /__mock/docShim)。
 * ReportDoc.gs が使う範囲だけを、実GASと同じメソッド名で実装する。検証できるのは「値(用紙・余白・画像の数と大きさ・
 * 改ページ数・列幅・背景色)と処理の流れ」だけ。見た目(文字化け・折り返し・4枚が1ページに収まるか)は実GASでしか分からない。
 *
 * 実GASに寄せた振る舞い:
 *  - 壊れた画像(JPEG として読めない)の appendInlineImage は例外。
 *  - 存在しないセル・行・列への操作は例外。
 *  - saveAndClose 後の文書への変更は例外。
 */

/** JPEG の SOF から実寸を読む。読めなければ null */
function jpegSize(buf) {
  if (!buf || buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return null;
  let i = 2;
  while (i + 9 < buf.length) {
    if (buf[i] !== 0xff) { i++; continue; }
    const m = buf[i + 1];
    if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7)) { i += 2; continue; }
    if (m === 0xff) { i++; continue; }
    if ((m >= 0xc0 && m <= 0xcf) && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) {
      return { h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7) };
    }
    i += 2 + buf.readUInt16BE(i + 2);
  }
  return null;
}

function createDocShim(state, hooks) {
  // hooks: { createDocFile(title, model) -> file, advanceMs(ms) }
  const ds = {
    failMode: 'none',
    counts: { created: 0, converted: 0, trashed: 0 },
    last: null,       // 直近に変換まで進んだ文書のモデル
    slowDone: false,
    reset() { ds.counts = { created: 0, converted: 0, trashed: 0 }; ds.last = null; },
  };
  const need = (cond, msg) => { if (!cond) throw new Error(msg); };

  /* ---------- 要素 ---------- */
  class Styled {
    constructor() { this.styles = []; }
    _rec(attr, val, s, e) { this.styles.push({ attr, val, s: s === undefined ? 0 : s, e }); }
  }
  /** editAsText() の返り値(範囲指定つき)。書式は元の要素に記録する */
  function textView(owner) {
    const tv = {};
    ['Bold', 'FontSize', 'ForegroundColor', 'FontFamily'].forEach((n) => {
      const attr = n[0].toLowerCase() + n.slice(1);
      tv['set' + n] = (a, b, c) => {
        owner._ck && owner._ck();
        if (c === undefined && b === undefined) owner._styleAll(attr, a); // 全体
        else owner._styleRange(attr, c, a, b);
        return tv;
      };
    });
    return tv;
  }

  class Paragraph extends Styled {
    constructor(parent, doc) { super(); this.kind = 'p'; this.parent = parent; this.doc = doc; this.text = ''; this.images = []; this.align = null; this.spacing = {}; this.lineSpacing = null; }
    _ck() { this.doc._ck(); }
    asParagraph() { return this; }
    getText() { return this.text; }
    setText(t) { this._ck(); this.text = String(t); this.styles = []; return this; }
    appendText(t) { this._ck(); this.text += String(t); return { setBold() {}, setFontSize() {}, setForegroundColor() {} }; }
    _styleAll(attr, val) { this._rec(attr, val, 0, Math.max(this.text.length - 1, 0)); }
    _styleRange(attr, val, s, e) { this._rec(attr, val, s, e); }
    editAsText() { return textView(this); }
    setFontSize(v) { this._ck(); this._styleAll('fontSize', v); return this; }
    setBold(v) { this._ck(); this._styleAll('bold', v); return this; }
    setForegroundColor(v) { this._ck(); this._styleAll('foregroundColor', v); return this; }
    setFontFamily(v) { this._ck(); this._styleAll('fontFamily', v); return this; }
    setAlignment(a) { this._ck(); this.align = a; return this; }
    setSpacingBefore(v) { this._ck(); this.spacing.before = v; return this; }
    setSpacingAfter(v) { this._ck(); this.spacing.after = v; return this; }
    setLineSpacing(v) { this._ck(); this.lineSpacing = v; return this; }
    appendInlineImage(blob) {
      this._ck();
      if (ds.failMode === 'image') throw new Error('Service error: Document (注入された画像挿入の失敗)');
      const sz = jpegSize(Buffer.from(blob.getBytes().map((b) => b & 255)));
      if (!sz) throw new Error('Invalid image data');
      const img = new InlineImage(this, this.doc, sz.w, sz.h);
      this.images.push(img);
      return img;
    }
    /** この段落が属する表(本文直下の表)のインデックス。表の外なら -1 */
    tableIndex() {
      let n = this.parent;
      while (n) { if (n.kind === 't') return this.doc.bodyTables().indexOf(n); n = n.parent; }
      return -1;
    }
  }
  class InlineImage {
    constructor(par, doc, w, h) { this.par = par; this.doc = doc; this.w = w; this.h = h; }
    getWidth() { return this.w; }
    getHeight() { return this.h; }
    setWidth(v) { this.doc._ck(); this.w = v; return this; }
    setHeight(v) { this.doc._ck(); this.h = v; return this; }
    removeFromParent() { this.par.images = this.par.images.filter((x) => x !== this); return this; }
  }
  class TableCell {
    constructor(row, doc) {
      this.kind = 'c'; this.parent = row; this.doc = doc; this.paras = [new Paragraph(this, doc)];
      this.bg = null; this.pad = {}; this.valign = null; this.styles = [];
    }
    getChild(i) { need(this.paras[i], 'セルに子要素がありません: ' + i); return this.paras[i]; }
    appendParagraph(t) { this.doc._ck(); const p = new Paragraph(this, this.doc); p.text = String(t || ''); this.paras.push(p); return p; }
    setBackgroundColor(c) { this.doc._ck(); this.bg = c; return this; }
    setPaddingTop(v) { this.doc._ck(); this.pad.top = v; return this; }
    setPaddingBottom(v) { this.doc._ck(); this.pad.bottom = v; return this; }
    setPaddingLeft(v) { this.doc._ck(); this.pad.left = v; return this; }
    setPaddingRight(v) { this.doc._ck(); this.pad.right = v; return this; }
    setVerticalAlignment(a) { this.doc._ck(); this.valign = a; return this; }
    editAsText() { return textView(this); }
    _styleAll(attr, val) { this.paras.forEach((p) => p._styleAll(attr, val)); }
    _styleRange(attr, val) { this._styleAll(attr, val); }
    getText() { return this.paras.map((p) => p.text).join('\n'); }
  }
  class TableRow {
    constructor(table, nCols, doc) { this.kind = 'r'; this.parent = table; this.doc = doc; this.cells = []; this.minHeight = 0; for (let i = 0; i < nCols; i++) this.cells.push(new TableCell(this, doc)); }
    getNumCells() { return this.cells.length; }
    getCell(i) { need(this.cells[i], 'セルがありません: ' + i); return this.cells[i]; }
    setMinimumHeight(v) { this.doc._ck(); this.minHeight = v; return this; }
    editAsText() { return textView(this); }
    _styleAll(attr, val) { this.cells.forEach((c) => c._styleAll(attr, val)); }
    _styleRange(attr, val) { this._styleAll(attr, val); }
  }
  class Table {
    constructor(body, grid, doc) {
      this.kind = 't'; this.parent = body; this.doc = doc; this.rows = []; this.colWidths = []; this.borderWidth = null; this.borderColor = null;
      grid.forEach((r) => { const row = new TableRow(this, r.length, doc); r.forEach((v, i) => { row.cells[i].paras[0].text = String(v); }); this.rows.push(row); });
    }
    getNumRows() { return this.rows.length; }
    getRow(i) { need(this.rows[i], '行がありません: ' + i); return this.rows[i]; }
    getCell(r, c) { return this.getRow(r).getCell(c); }
    setColumnWidth(i, w) { this.doc._ck(); need(this.rows[0] && i < this.rows[0].cells.length, '列がありません: ' + i); this.colWidths[i] = w; return this; }
    setBorderWidth(w) { this.doc._ck(); this.borderWidth = w; return this; }
    setBorderColor(c) { this.doc._ck(); this.borderColor = c; return this; }
    editAsText() { return textView(this); }
    _styleAll(attr, val) { this.rows.forEach((r) => r._styleAll(attr, val)); }
    _styleRange(attr, val) { this._styleAll(attr, val); }
  }
  class Body {
    constructor(doc) {
      this.doc = doc; this.kind = 'b'; this.children = [new Paragraph(this, doc)];
      this.pageWidth = null; this.pageHeight = null; this.margins = {}; this.fontFamily = null; this.pageBreaks = 0;
    }
    getParagraphs() { return this.children.filter((c) => c.kind === 'p'); }
    appendParagraph(t) { this.doc._ck(); const p = new Paragraph(this, this.doc); p.text = String(t || ''); this.children.push(p); return p; }
    appendTable(grid) {
      this.doc._ck();
      need(Array.isArray(grid) && grid.length && grid.every((r) => Array.isArray(r) && r.length === grid[0].length), '表のセルが不正です');
      // slow: 文書の組み立て中に仮想時計を90秒進める(時間上限のフォールバックの再現)。最初の表の追加で1回だけ
      if (ds.failMode === 'slow' && !ds.slowDone) { ds.slowDone = true; hooks.advanceMs(90000); }
      const t = new Table(this, grid, this.doc); this.children.push(t); return t;
    }
    appendPageBreak() { this.doc._ck(); this.pageBreaks++; this.children.push({ kind: 'pb', parent: this }); return this; }
    setPageWidth(v) { this.doc._ck(); this.pageWidth = v; return this; }
    setPageHeight(v) { this.doc._ck(); this.pageHeight = v; return this; }
    setMarginTop(v) { this.doc._ck(); this.margins.top = v; return this; }
    setMarginBottom(v) { this.doc._ck(); this.margins.bottom = v; return this; }
    setMarginLeft(v) { this.doc._ck(); this.margins.left = v; return this; }
    setMarginRight(v) { this.doc._ck(); this.margins.right = v; return this; }
    editAsText() { return textView(this); }
    _styleAll(attr, val) { if (attr === 'fontFamily') this.fontFamily = val; this.children.forEach((c) => c._styleAll && c._styleAll(attr, val)); }
    _styleRange(attr, val) { this._styleAll(attr, val); }
    _ck() { this.doc._ck(); }
  }
  class Footer {
    constructor(doc) { this.doc = doc; this.kind = 'f'; this.paras = [new Paragraph(this, doc)]; this.fontFamily = null; }
    getParagraphs() { return this.paras; }
    appendParagraph(t) { this.doc._ck(); const p = new Paragraph(this, this.doc); p.text = String(t || ''); this.paras.push(p); return p; }
    editAsText() { return textView(this); }
    _styleAll(attr, val) { if (attr === 'fontFamily') this.fontFamily = val; this.paras.forEach((p) => p._styleAll(attr, val)); }
    _styleRange(attr, val) { this._styleAll(attr, val); }
    getText() { return this.paras.map((p) => p.text).join('\n'); }
  }
  class Document {
    constructor(title) { this.title = title; this.closed = false; this.body = new Body(this); this.footer = null; this.file = null; this.id = null; }
    _ck() { need(!this.closed, '文書は saveAndClose 済みです(変更できません)'); }
    getId() { return this.id; }
    getName() { return this.title; }
    getBody() { this._ck(); return this.body; }
    getFooter() { this._ck(); return this.footer; }
    addFooter() { this._ck(); need(!this.footer, 'フッタは追加済みです'); this.footer = new Footer(this); return this.footer; }
    saveAndClose() { this.closed = true; }
    bodyTables() { return this.body.children.filter((c) => c.kind === 't'); }
    /** 本文の全文(段落とセルを文書順に連結) */
    fullText() {
      const out = [];
      this.body.children.forEach((c) => {
        if (c.kind === 'p') out.push(c.text);
        else if (c.kind === 't') c.rows.forEach((r) => r.cells.forEach((cell) => cell.paras.forEach((p) => out.push(p.text))));
      });
      return out.join('\n');
    }
    /** /__mock/docShim の lastDoc(SPEC §11.4) */
    snapshot() {
      const b = this.body;
      const tables = this.bodyTables();
      const images = [];
      const walk = (p) => p.images.forEach((im) => images.push({ w: im.w, h: im.h, inTableIndex: p.tableIndex() }));
      b.children.forEach((c) => {
        if (c.kind === 'p') walk(c);
        else if (c.kind === 't') c.rows.forEach((r) => r.cells.forEach((cell) => cell.paras.forEach(walk)));
      });
      return {
        title: this.title, pageWidth: b.pageWidth, pageHeight: b.pageHeight, margins: Object.assign({}, b.margins),
        fontFamily: b.fontFamily, text: this.fullText(), pageBreaks: b.pageBreaks, images,
        // SPEC §11.4(版1.10.2): 本文直下の段落ごとの観測(表のセル内は含めない)
        paragraphs: b.children.filter((c) => c.kind === 'p').map((c) => ({ text: c.text })),
        tables: tables.map((t) => ({
          rows: t.rows.length, cols: t.rows[0].cells.length, colWidths: t.colWidths.slice(),
          minRowHeights: t.rows.map((r) => r.minHeight), borderWidth: t.borderWidth,
          cellBackgrounds: t.rows.map((r) => r.cells.map((cell) => cell.bg)),
          // SPEC §11.4(版1.11.0): 行×列のセル文字列(複数段落は \n 連結。空セルは "")
          cellTexts: t.rows.map((r) => r.cells.map((cell) => cell.getText())),
        })),
        // SPEC §11.4(版1.11.0): 文字色ごとの文字列 / 太字にした文字列(本文・表のセル内)
        coloredTexts: this.coloredTextsByColor(), boldTexts: this.boldTexts(),
        footerText: this.footer ? this.footer.getText() : '', trashed: !!(this.file && this.file.trashed),
      };
    }
    /** 段落の中身(本文直下の段落・表のセル内の段落を文書順に。フッタは含めない) */
    allParagraphs() {
      const out = [];
      this.body.children.forEach((c) => {
        if (c.kind === 'p') out.push(c);
        else if (c.kind === 't') c.rows.forEach((r) => r.cells.forEach((cell) => cell.paras.forEach((p) => out.push(p))));
      });
      return out;
    }
    /**
     * attr が pred を満たす連続した文字列の一覧(段落の境界をまたがない)。書式は記録順に上書きして
     * 1文字ごとに最終値を決める(実GASと同じく、後から付けた書式が勝つ。例: 表全体を太字なしにしてから範囲を太字に)。
     */
    styledTexts(attr, pred) {
      const out = [];
      this.allParagraphs().forEach((p) => {
        const n = p.text.length;
        const val = new Array(n).fill(undefined);
        p.styles.forEach((s) => {
          if (s.attr !== attr) return;
          for (let i = Math.max(0, s.s); i <= Math.min(n - 1, s.e === undefined ? n - 1 : s.e); i++) val[i] = s.val;
        });
        let cur = '';
        for (let i = 0; i < n; i++) {
          if (pred(val[i])) cur += p.text[i];
          else { if (cur) out.push(cur); cur = ''; }
        }
        if (cur) out.push(cur);
      });
      return out;
    }
    /** テスト用(プロセス内): 指定色にした文字列の一覧 */
    coloredTexts(color) { return this.styledTexts('foregroundColor', (v) => v === color); }
    /** 文字色ごとの文字列(SPEC §11.4 lastDoc.coloredTexts)。色が付いた範囲だけ(本文・表のセル内) */
    coloredTextsByColor() {
      const colors = new Set();
      this.allParagraphs().forEach((p) => p.styles.forEach((s) => { if (s.attr === 'foregroundColor' && s.val) colors.add(s.val); }));
      const o = {};
      colors.forEach((c) => { o[c] = this.coloredTexts(c); });
      return o;
    }
    /** 太字にした文字列(SPEC §11.4 lastDoc.boldTexts)。段落全体を太字にしたものは段落の文字列全体 */
    boldTexts() { return this.styledTexts('bold', (v) => v === true); }
    cellTexts(tableIndex) { return this.bodyTables()[tableIndex].rows.map((r) => r.cells.map((cell) => cell.getText())); }
  }

  const DocumentApp = {
    HorizontalAlignment: { LEFT: 'LEFT', CENTER: 'CENTER', RIGHT: 'RIGHT', JUSTIFY: 'JUSTIFY' },
    VerticalAlignment: { TOP: 'TOP', CENTER: 'CENTER', BOTTOM: 'BOTTOM' },
    create(title) {
      if (ds.failMode === 'create') throw new Error('Service error: Document (注入された作成の失敗)');
      const doc = new Document(String(title));
      doc.file = hooks.createDocFile(doc.title, doc);
      doc.id = doc.file.getId();
      ds.counts.created++;
      return doc;
    },
  };

  /** Drive 経由の PDF 変換(File.getAs)。文書の設定が使われる */
  ds.convert = (doc) => {
    if (ds.failMode === 'convert') throw new Error('Service error: Drive (注入された PDF 変換の失敗)');
    ds.counts.converted++;
    ds.last = doc;
    const line = ('MOCK DOC REPORT ' + doc.title).replace(/[^\x20-\x7e]/g, '?');
    const t = `%PDF-1.4\n% ${line}\n% page ${doc.body.pageWidth}x${doc.body.pageHeight}\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n`;
    return Buffer.from(t, 'ascii');
  };
  ds.onTrashed = () => { ds.counts.trashed++; };
  ds.observe = () => ({ counts: Object.assign({}, ds.counts), lastDoc: ds.last ? ds.last.snapshot() : null });
  ds.DocumentApp = DocumentApp;
  return ds;
}

module.exports = { createDocShim, jpegSize };
