# 引継ぎ資料 — 型枠 検査記録アプリ(2026-11-04 時点)

Claude Code(デスクトップアプリ)で作業を引き継ぐための資料です。
作業の前に、CLAUDE.md・REQUIREMENTS.md・SPEC.md も読んでください(正本はそちら)。報告は日本語で行います。

## 1. 作業場所と約束事

- 作業場所は `C:\Claude\apps\kensa`(このリポジトリ)。2026-10-24 から、作業はここで行う。
- Dropbox の旧フォルダ(`C:\Users\k-hos\RCCREATE Dropbox\細野功介\※検査アプリ`)は、社長(細野さん)が許可するまで、変更も読み取りもしない。
- 社長はターミナル(黒い画面)の操作を好まない。コマンドは Claude が実行し、結果を日本語で説明する。
- 進め方の決まりは CLAUDE.md のとおり(要件 → SPEC(設計担当のみ変更)→ 実装・テスト → レビュー。報告は「作ったもの / SPEC準拠 / テスト / 要望」)。

## 2. アプリの概要

- 内容: 型枠工事の検査記録PWA(打設前・出来形)。職長が記録して提出し、品質管理者(QA)が判定し、元請向けPDFを出す。
- 言語: 日本語 / インドネシア語。
- 公開先(フロント): GitHub Pages `https://kensa.rccreate.net`(リポジトリ `rccreate-dev/katawaku-inspection`。**公開リポジトリ**)。
- バックエンド: Google Apps Script + スプレッドシート + ドライブ。
- 現在の版: SPEC 1.11.2 / アプリのビルド 32(`frontend/sw.js` の `SW_VERSION` と `APP_BUILD` は必ず同時に上げる)。

## 3. 本番環境(取り違え注意)

| 項目 | 値 |
|---|---|
| 本番の Apps Script プロジェクトID | `16K4qJY7NBSk92rvIBr9Uvq3TXPkzXhvpPoEUrTfe3YLWjTVPZf0IUlRk`(名前は「【本番】型枠検査アプリ(katawaku-inspection)」) |
| 本番のデプロイID | `AKfycbw9CHK3…` で始まるもの(`frontend/config.js` の `API_URL` と一致) |
| 最新の本番バージョン | 17(2026-10-20 12:41 に反映。1.11.2 の内容) |
| スプレッドシート | `1aR5L4NAvzBqc1XNCRNHXTkVTrVQWoLkEXp14P-pHDcE`(「型枠検査アプリ_データ(責任者のみ編集)」) |
| 別プロジェクト(未使用) | `1ay5x4H6hGG6HdhfwZQL01Bj0Kx2e0nNgoRHsuC8OgwEzHUP2HaA_sKzj`。本番ではない。**手引きアプリのプロジェクトの可能性あり(未確認)**。触らない |

- 社長は「施工手引きアプリ」の Apps Script も作っており、一度、検査アプリの作業中に手引きアプリのスクリプトを編集した事故があった。
- 対策は `docs/DEPLOY.md` の 3-2a(プロジェクト名・URLのID・ファイル先頭行の3点確認、デプロイIDが `API_URL` と同じか確認、新しいデプロイを作らない)。

## 4. 本番へ反映する手順(Claude がブラウザで実行してきた方法)

1. バックエンドは Apps Script の1ファイル(`コード.gs`)に連結して貼る。順番は固定:
   `Util Schema Seed RefCache Repo Code Idem Auth Authz RecordResp Records Photos PhotoUpload Membership Admin Report ReportDoc Notify`
   ```sh
   for f in Util Schema Seed RefCache Repo Code Idem Auth Authz RecordResp Records Photos PhotoUpload Membership Admin Report ReportDoc Notify; do printf '\n// ===== %s.gs =====\n' $f; cat backend/$f.gs; done > コード.gs.txt
   ```
2. `appsscript.json` も同じ内容にする(`documents` を含む権限設定。Webアプリは USER_DEPLOYING / ANYONE_ANONYMOUS)。
3. 保存 → デプロイ → デプロイを管理 → 本番のデプロイ(IDが `AKfycbw9CHK3…`)を選び、鉛筆 → バージョン「新バージョン」→ デプロイ。
4. フロントは GitHub に push すれば Pages に反映される。シェルのファイルを変えたら `SW_VERSION` を上げる(上げないと端末が古いままになる)。
5. 反映後に、実機で同じ操作を確認する。OAuth の同意画面は、社長に押してもらう。

## 5. テストと確認(`tests/` で実行。最新の結果: 全て成功)

- 構文確認: `node --check`
- 単体: `cd tests && npm run unit`(216件)
- 契約: モックサーバー(`node mock/server.js`、ポート8787)を起動して `npm run contract`(189件合格・26件はモック対象外でスキップ。`--test-concurrency=1` 付きにした。付けないと共有サーバーで混ざって失敗する)。GAS互換ハーネス(`backend/harness/server.js`、ポート8788)に対しては `API_URL=http://127.0.0.1:8788/api` を付けて実行(215件)
- E2E: `npm run e2e`(Playwright。64件。この環境に入っているブラウザで動く。全体で約10分かかる。2026-11-04 の結果は63件合格・1件不合格で、不合格の E-27(未送信の可視化)は単独で再実行すると合格(色の取得のタイミングによる不安定なテスト。アプリの不具合ではない)
- SPEC と実装・テストの同期: `npm run specsync`
- ハーネス単体のテストは `backend/harness/test/`

## 6. 直近でやったこと(2026-10-19〜24)

- PDFをA4縦で作る doc 方式(`reportEngine=doc`、Config のキー。`doc` 以外は html 方式)。失敗したら html 方式に自動で切り替わる。理由は Events の `report_generated.detail`(`engine` / `fallbackFrom` / `fallbackReason`)に残る。実機の DocumentApp には `setKeepWithNext` が無い(使わない)。
- 実測の表示を改善(許容超えは「▲」赤字・要約行)。値の区切りは「、 」(読点+半角スペース)。SPEC §10.2d。
- 管理者(QA)が許容を超えた実測値に「合」を付けられる。ただし項目ごとのコメントが必須(`QA_OVER_TOL_COMMENT_REQUIRED`)。職長側は従来どおり不可。SPEC 1.11.1 / REQUIREMENTS §18。
- 写真の確認画面と図面画面の崩れの修正(ビルド30・31)。図面の番号が画像の端で欠けないよう内側に寄せる(ビルド31以降で登録した図面が対象)。
- Apps Script の取り違え防止(プロジェクト名変更、DEPLOY.md 3-2a)。
- 10/24: 町田Ⅱ の階に「耐圧」を足す相談(下記の未決事項)。

## 7. 未決事項・次にやること

1. **町田Ⅱに「耐圧」を追加**: 階の追加はアプリの画面からはできない(現場の登録・階の変更APIは無い)。Sites シートの `floors` 列を直接書き換える。現在は「基礎,1階〜12階」。
   - A案: 「耐圧,基礎,1階,…,12階」(おすすめ。既存の「基礎」の記録は残る)
   - B案: 「耐圧,1階,…,12階」(「基礎」の記録がある場合は階が選択肢から消える)
   - **社長が検討中。指示があるまで書き換えない**。反映は最大60秒の遅れ。他の現場の行は変えない。
   - 画面から階を追加できるようにする場合は機能追加になる。設計担当(SPEC)から進める。
2. **doc 方式の実機確認**: 10/20 の PDF(v7)は A4 で出ていたが、Events で `engine:"doc"`・`fallbackReason` の有無を確認していない。▲ の表示、2ページ目がほぼ空白になる件(項目表が数行はみ出したあとで改ページ)も未確認。
3. **古い図面の見切れ**: 修正前(ビルド31より前)に登録した図面は、番号が欠けたまま。管理者側で再登録が必要(PDFを作り直しても直らない)。
4. **協力業者に使わせる前に確認すること**(2026-10-22 に調査。①〜③は未確認):
   - ① ドライブ「RCCREATE 型枠検査」フォルダの共有設定
   - ② PDFの共有: 初期設定は「リンクを知っている全員が閲覧可」(Config `pdfShareMode`)。協力業者にも使わせるなら `private` にするか、リンクの扱いを決める
   - ③ リポジトリの公開・非公開(非公開は GitHub の有料プランが必要になる可能性)
   - アクセス回数の制限は、PIN(5回で本人ロック)と招待コード(全体で失敗10回)だけ。一般的な制限は無い
5. **iPhone のホーム画面から入れない件**(松下さん): Safari とホーム画面のアプリは保存領域が別なので、ホーム画面側は未登録の端末扱いになる。対処は、責任者が追加端末用の招待コードを発行し、ホーム画面のアプリで入力して登録すること。結果の報告は受けていない。
6. **手引きアプリ側の確認**: 社長が手引きアプリのスクリプトを直した。`1ay5x…` のプロジェクトに検査アプリのコードが残っていないか、社長に最終確認してもらう。
7. 手引きアプリ・未使用プロジェクトの名前を、見分けがつく名前にする(社長に依頼済み)。
8. 以前からの未了:
   - リポジトリの初期データ(seed)・SPEC・テストを、本番の40項目マスターに合わせるか
   - `addMissingSeedItems` を**本番で再実行しない**ための保護(再実行すると項目が重複する恐れ)
   - `docs/DEPLOY.md` の古い記述
   - P-45 / P-47 は未承認
   - `installKeepWarmTrigger` を社長が実行したか(効果の確認も未了)
   - スマホの通信診断
   - 職長側の s06.js で、許容0の項目の扱いにずれがある(今は影響なし)
   - 端が切れる図面の印のE2E、360px幅のE2E(提案のみ。未追加)
9. 確認なしで決めたこと(社長に確認する): ページ番号は付けない / 見出しだけ前のページに残ることは許容 / 許容超えのコメント必須は管理者の判定だけ / インドネシア語の文言は仮 / 実測の区切り「、 」。

## 8. 注意すること(過去の失敗から)

- 本番への貼り付けは、先にプロジェクトを確認する(第3節)。
- 権限やスプレッドシートの直接編集は、`Users` `Sites` `Assignments` `Items` `Config` `Absences` の決められた列だけ(SPEC の名簿の暫定運用の節 / docs/OPERATIONS.md 第7節)。`pinHash` など他の列は手で触らない。
- 秘密情報(PIN平文・トークン・固定のAPIキー)は、コード・ログ・Gitに残さない。
- 外部CDN・外部フォント・新しい依存パッケージは使わない(現場は電波が弱い。オフライン動作が前提)。
- 判定は人が行う。▲ などの表示は機械的な目印で、AI が合否を決めない。
- 初期名簿のスクリプトは `.gitignore` に入れてGit管理外。リポジトリには置かない。
- 変更はSPECの条項番号で報告する。SPECとの食い違いは、直さずに報告する(設計担当が直す)。
