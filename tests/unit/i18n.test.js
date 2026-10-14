// U-I18N-01: i18n 辞書の不変条件(SPEC §9.4。版1.9 の段階別上書きキー `<基キー>@<stage>` を含む)
//   ja/id のキー集合一致・値が空でない・コードの t('…') 参照キーが存在・err.*/rule.*/ev.*/st.* が網羅・
//   HTML/JS に日本語リテラルが無い(i18n.js・コメントを除く)・ts(key, stage) の挙動
// frontend/・SPEC.md は読むだけ(編集しない)。
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const ROOT = path.join(__dirname, '..', '..');
const FE = path.join(ROOT, 'frontend');
const dict = require(path.join(FE, 'i18n.js'));
const spec = fs.readFileSync(path.join(ROOT, 'SPEC.md'), 'utf8');

const walk = (dir, out = []) => {
  for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
    if (f.name === 'vendor' || f.name === 'node_modules' || f.name === 'icons') continue;
    const p = path.join(dir, f.name);
    if (f.isDirectory()) walk(p, out); else if (/\.(js|html)$/.test(f.name)) out.push(p);
  }
  return out;
};
const files = walk(FE);
const base = (k) => k.split('@')[0];
const stageKeys = (d) => Object.keys(d).filter((k) => k.includes('@'));
const countedKeys = (d) => Object.keys(d).filter((k) => !k.includes('@'));

/** SPEC.md の節を取り出す(見出し行から次の同レベル以上の見出しまで) */
function section(startRe, endRe) {
  const lines = spec.split('\n');
  const a = lines.findIndex((l) => startRe.test(l));
  assert.ok(a >= 0, `SPEC に節が無い: ${startRe}`);
  let b = lines.length;
  for (let i = a + 1; i < lines.length; i++) if (endRe.test(lines[i])) { b = i; break; }
  return lines.slice(a + 1, b);
}
const firstCol = (lines, re) => lines.map((l) => (/^\|\s*([^|]+?)\s*\|/.exec(l) || [])[1]).filter((c) => c && re.test(c));

describe('U-I18N-01 i18n 辞書', () => {
  it('ja/id のキー集合が完全一致・値が空でない', () => {
    assert.deepEqual(Object.keys(dict.ja).sort(), Object.keys(dict.id).sort());
    assert.ok(Object.keys(dict.ja).length > 300);
    for (const lang of ['ja', 'id']) {
      for (const [k, v] of Object.entries(dict[lang])) assert.ok(typeof v === 'string' && v.trim() !== '', `${lang}:${k} が空`);
    }
    assert.equal(dict.ja['meta.idProvisional'], 'true');
  });

  it('err.* は §5.3 の全エラーコード、rule.* は §5.3.1 の全rule、ev.* は §2.11 の全kind、st.* は6値を網羅(@ を含む上書きキーは数え上げから除く)', () => {
    const codes = firstCol(section(/^### 5\.3 /, /^#### 5\.3\.1/), /^[A-Z][A-Z_]+$/);
    const rules = firstCol(section(/^#### 5\.3\.1 /, /^(###|####) /), /^[A-Z][A-Z_]+$/);
    const kindLine = section(/^### 2\.11 /, /^### 2\.12 /).find((l) => l.startsWith('`kind` の値'));
    const kinds = [...kindLine.matchAll(/`([a-z_0-9]+)`/g)].map((m) => m[1]).filter((k) => k !== 'kind');
    assert.ok(codes.length >= 30, 'エラーコードを読み取れた: ' + codes.length);
    assert.ok(rules.length >= 14, 'rule を読み取れた: ' + rules.length);
    assert.equal(kinds.length, 30, 'Events kind は30種: ' + kinds.length);
    for (const lang of ['ja', 'id']) {
      const keys = new Set(countedKeys(dict[lang]));
      for (const c of codes) assert.ok(keys.has(`err.${c}`), `${lang}: err.${c}`);
      for (const k of ['err.network', 'err.camera_denied', 'err.photo_too_large']) assert.ok(keys.has(k), `${lang}: ${k}`);
      for (const r of rules) assert.ok(keys.has(`rule.${r}`), `${lang}: rule.${r}`);
      for (const k of kinds) assert.ok(keys.has(`ev.${k}`), `${lang}: ev.${k}`);
      for (const s of ['none', 'draft', 'submitted', 'fix', 'qa_ok', 'approved']) assert.ok(keys.has(`st.${s}`), `${lang}: st.${s}`);
      // 不要な err.*(SPEC に無いコード)は無い。ただし画面側の補助キーは許す
      for (const k of keys) if (k.startsWith('err.') && !codes.includes(k.slice(4))) assert.ok(/^err\.[a-z_]+$/.test(k), `${lang}: ${k} は err.<CODE> でも補助キー(小文字)でもない`);
      for (const s of ['pre_pour', 'post_demold', 'during_pour', 'demold', 'cleanup']) assert.ok(keys.has(`stage.${s}`), `${lang}: stage.${s}`);
    }
  });

  it('段階別の上書きキー(<基キー>@<stage>): 基キーが存在し、ja/id の両方にある。当面 @post_demold だけ', () => {
    const ja = stageKeys(dict.ja).sort(); const id = stageKeys(dict.id).sort();
    assert.deepEqual(ja, id, 'ja/id の両方に同じ上書きキー');
    assert.ok(ja.length >= 6, '版1.9 の上書きキー(§9.4 の表の6件+)がある: ' + ja.length);
    for (const k of ja) {
      assert.match(k, /^[a-zA-Z0-9_.]+@post_demold$/, `${k}: 当面 @post_demold だけ`);
      assert.ok(base(k) in dict.ja && base(k) in dict.id, `${k}: 基キー ${base(k)} が ja/id にある`);
    }
    // §9.4 の表の6件は必ずある
    for (const k of ['st.approved', 'ev.prime_signed', 'act.prime_sign', 'msg.prime_signed', 'scr.M5.desc', 'scr.S10.confirm_major']) {
      assert.ok(`${k}@post_demold` in dict.ja && `${k}@post_demold` in dict.id, `${k}@post_demold`);
    }
    // 版1.9 で足す通常のキーと stage.post_demold の値変更
    assert.ok('scr.S05.stage_hint_post_demold' in dict.ja && 'scr.S05.stage_hint_post_demold' in dict.id);
    assert.equal(dict.ja['stage.pre_pour'], '打設前'); assert.equal(dict.ja['stage.post_demold'], '出来形');
    assert.equal(dict.id['stage.pre_pour'], 'Sebelum pengecoran'); assert.equal(dict.id['stage.post_demold'], 'Hasil pekerjaan');
    // 出来形の語: 上書きキーに「打設可」「打設を止める」「打設停止」「打設予定日時」を含めない(§6.8)
    for (const lang of ['ja', 'id']) {
      for (const k of ja) for (const w of ['打設可', '打設を止める', '打設停止', '打設予定日時']) assert.ok(!dict[lang][k].includes(w), `${lang}:${k} に「${w}」`);
      assert.ok(!dict[lang]['st.approved@post_demold'].includes('打設'));
    }
    assert.equal(dict.ja['st.approved'], '打設可'); assert.equal(dict.ja['st.approved@post_demold'], '出来形確認済');
    assert.equal(dict.id['st.approved@post_demold'], 'Hasil pekerjaan terkonfirmasi');
    assert.equal(dict.ja['scr.M5.desc@post_demold'], '元請の確認を受けた内容を記録します。PIN確認で出来形確認済になります。');
    assert.equal(dict.ja['scr.S10.confirm_major@post_demold'], '重大な不適合として差し戻します。よろしいですか');
  });

  describe('コード内の t(\'…\') / ts(\'…\', stage) の参照キー', () => {
    // 第1引数の式の文字列を取り出す(括弧・引用符を数える。第1引数の終わり=トップレベルの , または対応する ) )
    const firstArgs = (src) => {
      const out = [];
      const re = /(?<![\w$.])(?:KW\.)?ts?\(/g;
      let m;
      while ((m = re.exec(src))) {
        let i = m.index + m[0].length; let depth = 0; let q = null; const start = i;
        for (; i < src.length; i++) {
          const c = src[i];
          if (q) { if (c === '\\') i++; else if (c === q) q = null; continue; }
          if (c === '"' || c === "'" || c === '`') { q = c; continue; }
          if (c === '(' || c === '[' || c === '{') depth++;
          else if (c === ')' || c === ']' || c === '}') { if (depth === 0) break; depth--; }
          else if (c === ',' && depth === 0) break;
        }
        out.push({ expr: src.slice(start, i), pos: m.index });
      }
      return out;
    };
    const refs = [];
    for (const f of files) {
      if (/i18n\.js$/.test(f)) continue;
      const src = fs.readFileSync(f, 'utf8');
      for (const { expr } of firstArgs(src)) {
        // 'rule.' + x のように文字列連結の前にある literal はプレフィックス参照(末尾が . または _)
        for (const m of expr.matchAll(/(['"])([a-z][A-Za-z0-9_]*(?:\.[A-Za-z0-9_@]+)*[._]?)\1(\s*\+)?/g)) {
          const key = m[2];
          if (!key.includes('.')) continue; // 'ja' など i18n キーでない単語
          refs.push({ file: path.relative(FE, f), key, prefix: !!m[3] });
        }
      }
    }
    it('参照キー(リテラル)が ja/id の両方に存在し、プレフィックス参照(t(\'rule.\' + x))は該当キーが1件以上ある', () => {
      assert.ok(refs.length > 100, '参照を読み取れた: ' + refs.length);
      const missing = [];
      for (const { file, key, prefix } of refs) {
        const hit = prefix ? Object.keys(dict.ja).some((k) => k.startsWith(key)) && Object.keys(dict.id).some((k) => k.startsWith(key))
          : (key in dict.ja && key in dict.id);
        if (!hit) missing.push(`${file}: ${key}`);
      }
      assert.deepEqual(missing, [], '辞書に無い参照キー');
    });
  });

  describe('ts(key, stage)(frontend/js/core.js の KW.ts)', () => {
    const load = (lang) => {
      const sandbox = { I18N: dict, KW_CONFIG: {} };
      sandbox.window = sandbox; sandbox.globalThis = sandbox;
      const ctx = vm.createContext(sandbox);
      vm.runInContext(fs.readFileSync(path.join(FE, 'js', 'core.js'), 'utf8'), ctx, { filename: 'core.js' });
      ctx.KW.state.lang = lang;
      return ctx.KW;
    };
    it('上書きキーがあればそれ、無ければ基キー。stage が空・未知でも基キー。params の置換は両方で働く', () => {
      for (const lang of ['ja', 'id']) {
        const KW = load(lang);
        assert.equal(KW.ts('st.approved', 'post_demold'), dict[lang]['st.approved@post_demold']);
        assert.equal(KW.ts('st.approved', 'pre_pour'), dict[lang]['st.approved'], '上書きキーが無い段階は基キー');
        for (const stage of ['', null, undefined, 'foo', 'during_pour']) assert.equal(KW.ts('st.approved', stage), dict[lang]['st.approved'], `stage=${String(stage)}`);
        assert.equal(KW.ts('st.draft', 'post_demold'), dict[lang]['st.draft'], '上書きキーが無いキーは基キー');
        assert.equal(KW.ts('msg.prime_signed', 'post_demold'), dict[lang]['msg.prime_signed@post_demold']);
        assert.equal(KW.ts('scr.M5.desc', 'post_demold'), dict[lang]['scr.M5.desc@post_demold']);
        assert.equal(KW.ts('no.such.key', 'post_demold'), 'no.such.key', 'どちらも無ければキー文字列');
        assert.equal(KW.t('time.min_ago', { n: 5 }), dict[lang]['time.min_ago'].replace('{n}', '5'));
        assert.equal(KW.ts('time.min_ago', 'post_demold', { n: 5 }), dict[lang]['time.min_ago'].replace('{n}', '5'));
      }
      assert.equal(load('ja').ts('st.approved', 'post_demold'), '出来形確認済');
      assert.equal(load('ja').ts('st.approved', 'pre_pour'), '打設可');
    });
  });

  describe('HTML/JS に日本語リテラルが無い(i18n.js・コメントを除く)', () => {
    // ひらがな・カタカナ・漢字・半角カナ。中黒「・」(U+30FB)と長音「ー」(U+30FC)は記号としても使う(区切り・入力正規化)ので除く
    const JP = /[\u3041-\u3096\u309d-\u309f\u30a1-\u30fa\u30fd-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uff66-\uff9d]/;
    // 文字列を壊さずにコメントを除く簡易スキャナ(JS: // と /* */、HTML: <!-- -->)。正規表現リテラルは文字列として扱わない前提(日本語を含まない)
    const stripJs = (src) => {
      let out = ''; let i = 0; let q = null;
      while (i < src.length) {
        const c = src[i]; const n = src[i + 1];
        if (q) {
          out += c;
          if (c === '\\') { out += n === undefined ? '' : n; i += 2; continue; }
          if (c === q) q = null;
          i++; continue;
        }
        if (c === '"' || c === "'" || c === '`') { q = c; out += c; i++; continue; }
        if (c === '/' && n === '/') { while (i < src.length && src[i] !== '\n') i++; continue; }
        if (c === '/' && n === '*') { i += 2; while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) i++; i += 2; continue; }
        out += c; i++;
      }
      return out;
    };
    it('frontend の *.js(i18n.js を除く)と index.html', () => {
      const bad = [];
      for (const f of files) {
        if (/[\\/]i18n\.js$/.test(f)) continue;
        let src = fs.readFileSync(f, 'utf8');
        src = f.endsWith('.html') ? src.replace(/<!--[\s\S]*?-->/g, '').replace(/\/\*[\s\S]*?\*\//g, '') : stripJs(src);
        src.split('\n').forEach((line, n) => { if (JP.test(line)) bad.push(`${path.relative(FE, f)}:${n + 1}: ${line.trim().slice(0, 80)}`); });
      }
      assert.deepEqual(bad, [], '日本語リテラルは i18n.js 以外に置かない(コメントは可)');
    });
  });
});
