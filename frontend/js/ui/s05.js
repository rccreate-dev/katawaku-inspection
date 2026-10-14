/* ui/s05.js: S05 新しい記録(段階の選択を含む。SPEC §9.2 S05) */
(function (root) {
  'use strict';
  var KW = root.KW;
  var h = KW.h, t = KW.t, C = KW.ui;

  /* オフラインで作る仮の記録。項目は getBootstrap.items を「選んだ段階」で絞って作る(SPEC §2.6・§9.2 S05) */
  function localDetail(p, site) {
    var me = KW.state.me;
    var items = C.itemsOfStage(p.stage).filter(function (it) { return it.audience !== 'qa'; })
      .map(function (it) {
        var def = Object.assign({}, it); delete def.itemId;
        return { itemId: it.itemId, def: def, self: { result: null, severity: null, values: [], note: '', updatedAt: null, photos: [] }, qa: null };
      });
    var now = KW.time.toIso(KW.time.nowMs(KW.state.skewMs));
    return {
      recordId: p.recordId, siteId: p.siteId, floor: p.floor, zone: p.zone || '', lot: p.lot, stage: p.stage,
      status: 'draft', round: 1, reinspectOf: p.reinspectOf || null, ownerUserId: me.userId, ownerName: me.name, ownerCompany: me.company || '', team: site && site.myTeam || '',
      pourPlannedAt: p.pourPlannedAt || null, submittedAt: null, claimedBy: null, claimedByName: null, claimedAt: null,
      qaVerdict: null, major: false, stopped: false, escLevel: 0,
      counts: { total: items.length, filled: 0, ok: 0, ng: 0, na: 0 }, qaCounts: { filled: 0, ok: 0, ng: 0, na: 0 },
      hasReport: false, updatedAt: now, version: 0, masked: false,
      actions: ['saveDraft', 'submitRecord', 'addNote', 'uploadPhotoChunk'],
      items: items, primePhotos: [], notes: [], events: [], qaComment: '', stopInfo: null,
      signatures: { foreman: null, qa: null, prime: null }, timing: { selfDeadlineAt: null, qaOpenAt: null, qaDeadlineAt: null, selfLate: false, qaLate: false },
      local: true
    };
  }

  KW.screens.S05 = {
    mount: function (ctx) {
      var siteId = ctx.params[0];
      var site = C.siteOf(siteId);
      ctx.chrome({ back: '#/site/' + siteId, site: site ? site.name : null });
      var el = ctx.el;
      if (!site) { el.appendChild(C.empty('err.FORBIDDEN_SITE')); return; }
      var reinspectOf = ctx.query.re || null;
      var choices = C.creatableStages();
      var stage = choices.indexOf(ctx.query.stage) >= 0 ? ctx.query.stage : (choices.indexOf('pre_pour') >= 0 ? 'pre_pour' : choices[0]);
      var stageFixed = false; // 再検査: 段階は元記録の段階に固定
      var floor = h('select', { class: 'inp', 'aria-label': t('lbl.floor') });
      site.floors.forEach(function (f) { floor.appendChild(h('option', { value: f, selected: f === ctx.query.floor }, f)); });
      var zone = null;
      if (site.zones && site.zones.length) {
        zone = h('select', { class: 'inp', 'aria-label': t('lbl.zone') }, h('option', { value: '' }, t('lbl.none')));
        site.zones.forEach(function (z) { zone.appendChild(h('option', { value: z }, z)); });
      }
      var lot = h('input', { type: 'text', class: 'inp', maxlength: '40', autocomplete: 'off', 'aria-label': t('lbl.lot') });
      var plan = h('input', { type: 'datetime-local', class: 'inp', 'aria-label': t('lbl.pour_planned') });
      var msg = h('div');
      var stageBox = h('div');
      var planBox = h('div');
      var suggestBox = h('div');
      var go = h('button', { type: 'button', class: 'btn big' }, t('scr.S05.go'));

      /* 段階: 選択肢が1つだけ(または再検査)なら選択欄を出さず固定表示 */
      function drawStage() {
        KW.clear(stageBox);
        stageBox.appendChild(h('label', { class: 'lbl' }, t('lbl.stage')));
        if (stageFixed || choices.length <= 1) {
          stageBox.appendChild(h('div', null, t('stage.' + stage)));
        } else {
          var sel = h('select', { class: 'inp', 'aria-label': t('lbl.stage') });
          choices.forEach(function (s) { sel.appendChild(h('option', { value: s, selected: s === stage }, t('stage.' + s))); });
          sel.value = stage;
          sel.addEventListener('change', function () { stage = sel.value; drawStageDependent(); });
          stageBox.appendChild(sel);
        }
      }
      /* 打設予定日時の欄とヒントは打設前のときだけ。出来形では欄も plan_hint も出さず、出来形の説明を出す */
      function drawPlan() {
        KW.clear(planBox);
        if (stage === 'pre_pour') {
          planBox.appendChild(h('label', { class: 'lbl' }, t('lbl.pour_planned')));
          planBox.appendChild(plan);
          planBox.appendChild(h('p', { class: 'sub' }, t('scr.S05.plan_hint')));
        } else if (stage === 'post_demold') {
          planBox.appendChild(h('p', { class: 'sub' }, t('scr.S05.stage_hint_post_demold')));
        }
      }
      /* 出来形のとき、同じ階・工区の打設前の記録の打設箇所(ロット)を候補に出す(入力の手間を減らすだけ。APIと一意制約は変えない) */
      function drawSuggest() {
        KW.clear(suggestBox);
        if (stage !== 'post_demold') return;
        var z = zone ? zone.value : '';
        KW.data.allSummaries().then(function (all) {
          if (!ctx.alive() || stage !== 'post_demold') return;
          var seen = {}, lots = [];
          all.filter(function (r) { return r.siteId === siteId && r.floor === floor.value && (r.zone || '') === z && C.stageOf(r) === 'pre_pour' && r.lot; })
            .forEach(function (r) { if (!seen[r.lot]) { seen[r.lot] = 1; lots.push(r.lot); } });
          lots.sort();
          KW.clear(suggestBox);
          if (!lots.length) return;
          suggestBox.appendChild(h('p', { class: 'sub' }, t('scr.S05.lot_suggest')));
          var row = h('div', { class: 'gap' });
          lots.slice(0, 8).forEach(function (l) {
            row.appendChild(h('button', { type: 'button', class: 'btn small ghost', on: { click: function () { lot.value = l; } } }, l));
          });
          suggestBox.appendChild(row);
        });
      }
      function drawStageDependent() { drawStage(); drawPlan(); drawSuggest(); }
      floor.addEventListener('change', drawSuggest);
      if (zone) zone.addEventListener('change', drawSuggest);

      el.appendChild(h('h2', null, t('scr.S05.title')));
      if (reinspectOf) el.appendChild(C.banner('', t('scr.S05.reinspect')));
      el.appendChild(h('div', { class: 'card' },
        h('label', { class: 'lbl' }, t('lbl.floor')), floor,
        zone ? h('label', { class: 'lbl' }, t('lbl.zone')) : null, zone,
        h('label', { class: 'lbl' }, t('lbl.lot') + ' *'), lot, suggestBox,
        stageBox, planBox, msg));
      el.appendChild(go);
      drawStageDependent();

      // 再検査: 元記録の段階に固定(キャッシュの要約から引く)
      if (reinspectOf) {
        go.disabled = true;
        KW.data.getRow(reinspectOf).then(function (row) {
          if (!ctx.alive()) return;
          if (row && row.summary && row.summary.stage) { stage = row.summary.stage; stageFixed = true; }
          go.disabled = false;
          drawStageDependent();
        }, function () { if (ctx.alive()) go.disabled = false; });
      }

      go.addEventListener('click', C.guard(go, function () {
        KW.clear(msg);
        var lv = lot.value.trim();
        if (!lv) { msg.appendChild(C.msg('', t('scr.S05.lot_required'))); lot.focus(); return Promise.resolve(); }
        var params = { recordId: KW.newRecordId(), siteId: siteId, floor: floor.value, zone: zone ? zone.value : '', lot: lv, stage: stage };
        // 打設予定日時は打設前のときだけ送る(出来形では送らない。SPEC §5.4.3)
        if (stage === 'pre_pour') {
          var pi = KW.time.fromInput(plan.value);
          if (pi) params.pourPlannedAt = pi;
        }
        if (reinspectOf) params.reinspectOf = reinspectOf;
        return KW.data.putDetail(localDetail(params, site)).then(function () {
          return KW.sync.runQueued('createRecord', params, { recordId: params.recordId });
        }).then(function (r) {
          if (r.ok) { KW.app.go('#/record/' + params.recordId + '/edit'); return null; }
          var err = r.error || {};
          return KW.data.removeRecord(params.recordId).then(function () {
            if (err.code === 'ALREADY_EXISTS' && err.data && err.data.mine && err.data.recordId) {
              C.toast(t('scr.S05.exists_mine'));
              return KW.data.loadDetail(err.data.recordId).then(function () { KW.app.go('#/record/' + err.data.recordId + '/edit'); });
            }
            msg.appendChild(C.msg('', err.code === 'ALREADY_EXISTS' ? t('scr.S05.exists_other') : KW.errText(err)));
            return null;
          });
        });
      }));
    }
  };
})(window);
