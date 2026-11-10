/* ui/s22.js: S22 現場の管理(一覧)/ S23 現場の作成・編集(担当・閉鎖・再開)(責任者。SPEC §9.2d・§6.10。版1.13.0)
 * オンライン専用(outbox に積まない)。権限はサーバーが判定する。画面は責任者以外ならホームへ戻すだけ。 */
(function (root) {
  'use strict';
  var KW = root.KW;
  var h = KW.h, t = KW.t, C = KW.ui;
  var ROLE_ORDER = ['qa_main', 'qa_sub', 'foreman', 'subforeman'];
  var COUNT_KEYS = ['draft', 'submitted', 'fix', 'qa_ok', 'approved'];
  /* 違反の path → 欄名のキー */
  var PATH_LABEL = {
    name: 'scr.S23.name', floors: 'scr.S23.floors', zones: 'scr.S23.zones', primeContractor: 'scr.S23.prime', address: 'scr.S23.address',
    startDate: 'scr.S23.start', endDate: 'scr.S23.end', qaMainUserId: 'scr.S23.qa_main', qaSubUserIds: 'scr.S23.qa_sub',
    userId: 'scr.S23.person', team: 'scr.S23.team', assignRole: 'scr.S23.assign_role', assignId: 'scr.S23.assign'
  };

  function isLead() { return KW.state.me && KW.state.me.role === 'lead'; }

  /* 失敗の表示。VALIDATION_FAILED は違反ごとに rule.<RULE>+欄名+値(人なら氏名) */
  function showFail(box, res, userMap) {
    KW.clear(box);
    if (res.network) { box.appendChild(C.msg('', t('err.network'))); return; }
    var e = res.error || {};
    if (e.code === 'VALIDATION_FAILED' && e.data && e.data.violations) {
      e.data.violations.forEach(function (v) {
        var parts = [t('rule.' + v.rule)];
        if (v.rule === 'FIELD_INVALID' && PATH_LABEL[v.path]) parts.push('(' + t(PATH_LABEL[v.path]) + ')');
        if (v.value != null) parts.push('(' + ((userMap && userMap[v.value]) ? userMap[v.value].name : v.value) + ')');
        box.appendChild(C.msg('', parts.join(' ')));
      });
      return;
    }
    box.appendChild(C.msg('', KW.errText(e)));
  }

  /* 書き込みの送信。圏外は送らない。通信失敗のときだけ同じ clientId を使い回す(冪等。SPEC §5.2) */
  function writer() {
    var cid = KW.newClientId();
    return function (action, params) {
      if (!KW.isOnline()) return Promise.resolve({ ok: false, network: true });
      return KW.api.call(action, params, { clientId: cid }).then(function (res) {
        if (!res.network) cid = KW.newClientId();
        return res;
      });
    };
  }

  /* 階・工区の並びの編集(足す・上へ・下へ・外す。使用中は外せない) */
  function listEditor(o) {
    var box = h('div', { class: 'stack' });
    var list = o.values.slice();
    var used = o.used || [];
    function draw() {
      KW.clear(box);
      list.forEach(function (v, i) {
        var inUse = used.indexOf(v) >= 0;
        var up = h('button', { type: 'button', class: 'btn small ghost', disabled: i === 0, 'aria-label': t('scr.S23.up') + ' ' + v, on: { click: function () { list.splice(i - 1, 0, list.splice(i, 1)[0]); draw(); } } }, '↑');
        var down = h('button', { type: 'button', class: 'btn small ghost', disabled: i === list.length - 1, 'aria-label': t('scr.S23.down') + ' ' + v, on: { click: function () { list.splice(i + 1, 0, list.splice(i, 1)[0]); draw(); } } }, '↓');
        var rm = h('button', { type: 'button', class: 'btn small badghost', disabled: inUse, 'aria-label': t('scr.S23.remove') + ' ' + v, on: { click: function () { list.splice(i, 1); draw(); } } }, t('scr.S23.remove'));
        box.appendChild(h('div', { class: 'row wrap', 'data-item': v }, h('b', null, v), inUse ? C.chip('na', t('scr.S23.in_use')) : null, h('span', { class: 'gap' }, up, down, rm)));
      });
      var inp = h('input', { type: 'text', class: 'inp', maxlength: '10', 'aria-label': t(o.addKey) });
      var add = h('button', { type: 'button', class: 'btn small' }, t(o.addKey));
      function doAdd() {
        var v = inp.value.trim();
        if (!v || v.indexOf(',') >= 0 || list.indexOf(v) >= 0) return;
        list.push(v); draw();
      }
      add.addEventListener('click', doAdd);
      inp.addEventListener('keydown', function (ev) { if (ev.key === 'Enter') { ev.preventDefault(); doAdd(); } });
      box.appendChild(h('div', { class: 'row wrap' }, inp, add));
    }
    draw();
    return { el: box, values: function () { return list.slice(); } };
  }

  function field(labelKey, input) { return [h('label', { class: 'lbl' }, t(labelKey)), input]; }
  function textInp(labelKey, value, max, type) {
    return h('input', { type: type || 'text', class: 'inp', maxlength: max ? String(max) : null, value: value || '', 'aria-label': t(labelKey) });
  }

  /* ---- S22 一覧 ---- */
  KW.screens.S22 = {
    mount: function (ctx) {
      if (!isLead()) { KW.app.go('#/', true); return; }
      ctx.chrome({ back: '#/admin' });
      var el = ctx.el;
      el.appendChild(C.skeleton(3));
      function draw() {
        if (!ctx.alive()) return;
        KW.clear(el);
        el.appendChild(h('h2', null, t('scr.S22.title')));
        el.appendChild(h('button', { type: 'button', class: 'btn', on: { click: function () { KW.app.go('#/admin/site/new'); } } }, t('scr.S22.new')));
        var sites = ((KW.state.bootstrap && KW.state.bootstrap.sites) || []).slice();
        if (!sites.length) { el.appendChild(C.empty('scr.S22.empty')); return; }
        [['active', 'scr.S22.active'], ['closed', 'scr.S22.closed']].forEach(function (g) {
          var rows = sites.filter(function (s) { return (s.status || 'active') === g[0]; });
          if (!rows.length) return;
          var sec = h('section', { 'data-group': g[0] }, h('h3', null, t(g[1])));
          rows.forEach(function (s) {
            var main = s.qa && s.qa.main ? s.qa.main.name : '-';
            sec.appendChild(h('button', { type: 'button', class: 'tap', 'data-site': s.siteId, on: { click: function () { KW.app.go('#/admin/site/' + encodeURIComponent(s.siteId)); } } },
              h('span', null, h('b', null, s.name), h('span', { class: 'sub' }, ' ' + t('assign.qa_main') + ': ' + main + ' / ' + t('scr.S22.floor_count', { n: (s.floors || []).length }))),
              h('span', { class: 'chips' }, C.chip(g[0] === 'active' ? 'good' : 'na', t(g[1])), h('span', { 'aria-hidden': 'true' }, '›'))));
          });
          el.appendChild(sec);
        });
      }
      KW.sync.bootstrap(true).then(draw, draw);
    }
  };

  /* ---- S23 作成・編集 ---- */
  KW.screens.S23 = {
    mount: function (ctx) {
      if (!isLead()) { KW.app.go('#/', true); return; }
      ctx.chrome({ back: '#/admin/sites' });
      var el = ctx.el;
      var siteId = ctx.params[0];
      var isNew = siteId === 'new';
      var send = writer();
      el.appendChild(C.skeleton(4));

      function load() {
        var calls = [KW.api.call('adminListUsers', {})];
        if (!isNew) calls.push(KW.api.call('adminGetSite', { siteId: siteId }), KW.api.call('adminValidateRoster', {}));
        return Promise.all(calls).then(function (rs) {
          if (!ctx.alive()) return;
          KW.clear(el);
          el.appendChild(h('h2', null, t(isNew ? 'scr.S23.title_new' : 'scr.S23.title_edit')));
          var bad = rs.filter(function (r) { return !r.ok; })[0];
          if (bad && (bad === rs[1] || bad === rs[0])) { el.appendChild(C.banner('warn', bad.network ? t('err.network') : KW.errText(bad.error))); return; }
          var users = rs[0].data.users;
          var userMap = {};
          users.forEach(function (u) { userMap[u.userId] = u; });
          draw(users, userMap, isNew ? null : rs[1].data, isNew ? null : (rs[2] && rs[2].ok ? rs[2].data.problems : []));
        });
      }

      function draw(users, userMap, g, problems) {
        var s = g ? g.site : { name: '', floors: [], zones: [], primeContractor: '', address: '', startDate: null, endDate: null, status: 'active' };
        if (g) {
          el.appendChild(h('div', { class: 'row wrap' }, h('b', null, s.name), C.chip(s.status === 'active' ? 'good' : 'na', t(s.status === 'active' ? 'scr.S22.active' : 'scr.S22.closed'))));
          var mine = (problems || []).filter(function (p) { return p.siteId === s.siteId && p.level === 'error'; });
          if (mine.length) el.appendChild(C.banner('bad', [h('b', null, t('scr.S23.roster_warn'))].concat(mine.map(function (p) { return h('div', null, p.message); }))));
        }
        /* ① 基本 */
        var name = textInp('scr.S23.name', s.name, 40);
        var prime = textInp('scr.S23.prime', s.primeContractor, 40);
        var addr = textInp('scr.S23.address', s.address, 100);
        var start = textInp('scr.S23.start', s.startDate, null, 'date');
        var end = textInp('scr.S23.end', s.endDate, null, 'date');
        /* ②③ 階・工区 */
        var floors = listEditor({ values: s.floors, used: g ? g.usedFloors : [], addKey: 'scr.S23.add_floor' });
        var zones = listEditor({ values: s.zones, used: g ? g.usedZones : [], addKey: 'scr.S23.add_zone' });
        var form = h('div', { class: 'card' }, field('scr.S23.name', name), field('scr.S23.prime', prime), field('scr.S23.address', addr),
          field('scr.S23.start', start), field('scr.S23.end', end),
          h('h3', null, t('scr.S23.floors')), floors.el, h('h3', null, t('scr.S23.zones')), zones.el);
        /* ④ 新規のみ: 主担当・代行者 */
        var mainSel = null, subBox = null, subPicked = {};
        if (!g) {
          var mains = users.filter(function (u) { return u.role === 'qa' && u.qaQualified && u.status !== 'disabled'; });
          mainSel = h('select', { class: 'inp', 'aria-label': t('scr.S23.qa_main') }, h('option', { value: '' }, '-'));
          mains.forEach(function (u) { mainSel.appendChild(h('option', { value: u.userId }, u.name)); });
          subBox = h('div', { class: 'stack' });
          var drawSubs = function () {
            KW.clear(subBox);
            users.filter(function (u) { return (u.role === 'qa' || u.role === 'lead') && u.qaQualified && u.status !== 'disabled' && u.userId !== mainSel.value; }).forEach(function (u) {
              var cb = h('input', { type: 'checkbox', checked: !!subPicked[u.userId], on: { change: function () { subPicked[u.userId] = cb.checked; } } });
              subBox.appendChild(h('label', { class: 'row' }, cb, h('span', null, u.name + '(' + t('role.' + u.role) + ')')));
            });
          };
          mainSel.addEventListener('change', function () { delete subPicked[mainSel.value]; drawSubs(); });
          drawSubs();
          form.appendChild(h('h3', null, t('scr.S23.qa_main')));
          form.appendChild(mainSel);
          form.appendChild(h('h3', null, t('scr.S23.qa_sub')));
          form.appendChild(subBox);
        }
        var msg = h('div');
        var save = h('button', { type: 'button', class: 'btn' }, t('scr.S23.save'));
        save.addEventListener('click', C.guard(save, function () {
          KW.clear(msg);
          var cur = { name: name.value.trim(), floors: floors.values(), zones: zones.values(), primeContractor: prime.value.trim(), address: addr.value.trim(), startDate: start.value, endDate: end.value };
          if (!g) {
            var p = Object.assign({}, cur, { qaMainUserId: mainSel.value, qaSubUserIds: Object.keys(subPicked).filter(function (k) { return subPicked[k] && k !== mainSel.value; }) });
            return send('adminCreateSite', p).then(function (res) {
              if (!res.ok) { showFail(msg, res, userMap); return null; }
              C.toast(t('scr.S23.created'));
              return KW.sync.bootstrap(true).catch(function () { return null; }).then(function () { KW.app.go('#/admin/site/' + encodeURIComponent(res.data.site.siteId), true); });
            });
          }
          var before = { name: s.name, floors: s.floors, zones: s.zones, primeContractor: s.primeContractor, address: s.address, startDate: s.startDate || '', endDate: s.endDate || '' };
          var diff = { siteId: s.siteId }, n = 0;
          Object.keys(cur).forEach(function (k) { if (JSON.stringify(cur[k]) !== JSON.stringify(before[k])) { diff[k] = cur[k]; n++; } });
          if (!n) { C.toast(t('scr.S23.saved')); return null; }
          return send('adminUpdateSite', diff).then(function (res) {
            if (!res.ok) { showFail(msg, res, userMap); return null; }
            C.toast(t('scr.S23.saved'));
            KW.sync.bootstrap(true).catch(function () { return null; });
            return load();
          });
        }));
        form.appendChild(msg);
        form.appendChild(h('div', { class: 'stack' }, save));
        el.appendChild(form);
        if (!g) return;

        /* ⑤ 担当 */
        el.appendChild(assignCard(s, g, users, userMap));
        /* ⑥ 記録の件数・QR・閉鎖/再開 */
        var counts = h('div', { class: 'chips' });
        COUNT_KEYS.forEach(function (k) { counts.appendChild(h('span', { 'data-count': k }, C.statusChip(k), ' ' + g.recordCounts[k])); });
        el.appendChild(h('div', { class: 'card' }, h('h3', null, t('scr.S23.counts')), counts));
        el.appendChild(h('button', { type: 'button', class: 'btn ghost', on: { click: function () { KW.app.go('#/admin/qr'); } } }, t('scr.S23.qr')));
        el.appendChild(closeCard(s));
      }

      function assignCard(s, g, users, userMap) {
        var card = h('div', { class: 'card' }, h('h3', null, t('scr.S23.assign')));
        var msg = h('div');
        var live = g.assignments.filter(function (a) { return a.active; })
          .sort(function (a, b) { return ROLE_ORDER.indexOf(a.assignRole) - ROLE_ORDER.indexOf(b.assignRole); });
        live.forEach(function (a) {
          var end = h('button', { type: 'button', class: 'btn small badghost' }, t('scr.S23.assign_end'));
          end.addEventListener('click', C.guard(end, function () {
            return KW.modal.confirm({ title: t('scr.S23.assign_end'), body: t('scr.S23.assign_end_confirm', { name: a.userName, role: t('assign.' + a.assignRole) }), okLabel: t('scr.S23.assign_end'), danger: true }).then(function (ok) {
              if (!ok) return null;
              return C.busyWhile(end, send('adminEndAssignment', { assignId: a.assignId })).then(function (res) { if (res.ok) return load(); showFail(msg, res, userMap); return null; });
            });
          }, { quiet: true }));
          card.appendChild(h('div', { class: 'row wrap', 'data-assign': a.assignRole + ':' + a.userId },
            h('b', null, a.userName), C.chip('', t('assign.' + a.assignRole)), a.team ? h('span', { class: 'sub' }, a.team) : null,
            a.effective ? null : C.chip('na', t('userst.disabled')), end));
        });
        if (s.status !== 'active') { card.appendChild(msg); return card; }
        /* 追加フォーム */
        var mainNow = live.filter(function (a) { return a.assignRole === 'qa_main'; })[0];
        var person = h('select', { class: 'inp', 'aria-label': t('scr.S23.person') }, h('option', { value: '' }, '-'));
        users.filter(function (u) { return u.status !== 'disabled'; }).forEach(function (u) {
          person.appendChild(h('option', { value: u.userId }, u.name + '(' + t('role.' + u.role) + ')'));
        });
        var roleSel = h('select', { class: 'inp', 'aria-label': t('scr.S23.assign_role') });
        var team = textInp('scr.S23.team', '', 20);
        var teamBox = h('div', null, field('scr.S23.team', team));
        var swap = h('div');
        function rolesFor(u) {
          if (!u) return [];
          if (u.role === 'foreman') return ['foreman', 'subforeman'];
          if (u.role === 'qa') return u.qaQualified ? ['qa_main', 'qa_sub'] : [];
          return u.qaQualified ? ['qa_sub'] : [];
        }
        function syncRole() {
          var u = userMap[person.value];
          var keep = roleSel.value;
          KW.clear(roleSel);
          rolesFor(u).forEach(function (r) { roleSel.appendChild(h('option', { value: r }, t('assign.' + r))); });
          if (keep && rolesFor(u).indexOf(keep) >= 0) roleSel.value = keep;
          var fm = roleSel.value === 'foreman' || roleSel.value === 'subforeman';
          teamBox.hidden = !fm;
          if (fm && !team.value && u) team.value = t('msg.team_default', { name: u.name });
          KW.clear(swap);
          if (roleSel.value === 'qa_main' && mainNow && mainNow.userId !== person.value) swap.appendChild(C.msg('warn', t('scr.S23.qa_main_swap', { name: mainNow.userName })));
        }
        person.addEventListener('change', function () { team.value = ''; syncRole(); });
        roleSel.addEventListener('change', syncRole);
        syncRole();
        var add = h('button', { type: 'button', class: 'btn' }, t('scr.S23.assign_add'));
        add.addEventListener('click', C.guard(add, function () {
          KW.clear(msg);
          if (!person.value || !roleSel.value) { msg.appendChild(C.msg('', t('rule.ASSIGN_ROLE_MISMATCH'))); return null; }
          var p = { siteId: s.siteId, userId: person.value, assignRole: roleSel.value };
          if (roleSel.value === 'foreman' || roleSel.value === 'subforeman') p.team = team.value.trim();
          return send('adminAddAssignment', p).then(function (res) { if (res.ok) return load(); showFail(msg, res, userMap); return null; });
        }));
        card.appendChild(h('h3', null, t('scr.S23.assign_add')));
        card.appendChild(h('div', null, field('scr.S23.person', person), field('scr.S23.assign_role', roleSel), teamBox, swap, msg, h('div', { class: 'stack' }, add)));
        return card;
      }

      function closeCard(s) {
        var msg = h('div');
        var active = s.status === 'active';
        var btn = h('button', { type: 'button', class: 'btn ' + (active ? 'bad' : '') }, t(active ? 'scr.S23.close' : 'scr.S23.reopen'));
        btn.addEventListener('click', C.guard(btn, function () {
          KW.clear(msg);
          if (!active) {
            return KW.modal.confirm({ title: t('scr.S23.reopen'), body: t('scr.S23.reopen_confirm'), okLabel: t('scr.S23.reopen') }).then(function (ok) {
              if (!ok) return null;
              return C.busyWhile(btn, send('adminReopenSite', { siteId: s.siteId })).then(function (res) {
                if (!res.ok) { showFail(msg, res); return null; }
                C.toast(t('scr.S23.reopened', { n: res.data.restoredAssignments }));
                KW.sync.bootstrap(true).catch(function () { return null; });
                return load();
              });
            });
          }
          function doClose(accept) {
            var p = { siteId: s.siteId };
            if (accept) p.acceptQaOk = true;
            return C.busyWhile(btn, send('adminCloseSite', p)).then(function (res) {
              if (res.ok) {
                C.toast(t('scr.S23.closed_done'));
                KW.sync.bootstrap(true).catch(function () { return null; });
                return load();
              }
              var e = res.error || {};
              if (e.code === 'SITE_HAS_OPEN_RECORDS') { msg.appendChild(C.banner('bad', t('scr.S23.close_blocked', e.data))); return null; }
              if (e.code === 'CLOSE_CONFIRM_REQUIRED' && !accept) {
                return KW.modal.confirm({ title: t('scr.S23.close'), body: t('scr.S23.close_qaok', { n: e.data.qaOk }), okLabel: t('scr.S23.close'), danger: true }).then(function (ok2) {
                  return ok2 ? doClose(true) : null;
                });
              }
              showFail(msg, res);
              return null;
            });
          }
          return KW.modal.confirm({ title: t('scr.S23.close'), body: t('scr.S23.close_confirm'), okLabel: t('scr.S23.close'), danger: true }).then(function (ok) {
            return ok ? doClose(false) : null;
          });
        }, { quiet: true }));
        return h('div', { class: 'card' }, btn, msg);
      }

      load();
    }
  };
})(window);
