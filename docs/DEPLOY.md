# 型枠 検査記録アプリ 公開・初期設定 手順書(社長向け)

対象: 株式会社RCCREATE 代表取締役
根拠: backend/・frontend/ のコードと SPEC.md に書かれている事実のみ。
**コードで確認できなかった点は「要確認」と明記**しています。実機(Google・GitHub)で動かして確かめていない箇所は巻末の「要確認」にまとめています。

---

## 0. 先に知っておくこと(重要)

1. **最初の責任者(社長)は、GASエディタから関数 `setupFirstLead` を実行して作ります**(手順 3-9)。招待コードを発行できるのは「ログイン済みの責任者」だけなので、最初の1人だけはこの関数で作ります。招待コードは、エディタの「実行ログ」に表示されます。
2. GitHub Pages には、`.github/workflows/pages.yml`(同梱)が **`frontend/` フォルダだけ**を公開します。Pages の設定(Source を「GitHub Actions」にする)は手順 5-2。
3. `backend/harness/` フォルダはテスト用です。**Apps Script には貼りません。**

---

## 1. 全体像

| 役目 | 使うもの | 中身 |
|---|---|---|
| アプリ(画面) | GitHub Pages | `frontend/` の静的ファイル。スマホのホーム画面に追加して使う |
| データ(記録・名簿・設定) | Googleスプレッドシート | 1ファイル。シートは `setupSheets` が自動作成 |
| 写真・元請向けPDF | Googleドライブ | フォルダ「RCCREATE 型枠検査」(`setupSheets` が自動作成)の下の `photos/` と `reports/` |
| API(画面とデータの橋渡し) | Google Apps Script(GAS)のWebアプリ | `backend/` の `.gs` ファイル。スプレッドシートに紐づけて作る |

- 画面からGASへは、通信先URL `API_URL`(後で控える「ウェブアプリのURL」)に送ります。
- 実行ユーザーは「自分(デプロイした人=社長)」、アクセスは「全員」。Googleログインには頼らず、アプリ側の「氏名+PIN+端末登録」で本人確認します(SPEC §1.3, §3)。
- 元請はアカウントなし。PDFの共有リンクを渡すだけです(SPEC §10)。

---

## 2. 準備: GitHub リポジトリ

1. GitHub に社長(または会社)のアカウントでログインする。
2. `rccreate-dev` 組織(またはアカウント)で新規リポジトリを作る。
   - 名前: `katawaku-inspection`
   - 公開範囲: **Public(公開)**
3. このプロジェクトの全ファイルをアップロード(push)する。作業はエンジニア/開発担当に依頼してよい。
   - **リポジトリ直下には、プロジェクトのフォルダをそのまま置く**(`backend/` `frontend/` `mock/` `tests/` `docs/` `reference/` `.github/` と `CLAUDE.md` `REQUIREMENTS.md` `SPEC.md`)。
   - **公開されるのは `frontend/` の中身だけ**(`.github/workflows/pages.yml` が `frontend/` だけを Pages に載せます)。`backend/` などは「コードとしてGitHubに置かれるだけ」で、アプリのURLからは開けません。ただし **リポジトリを Public にしているので、GitHub上では誰でもコードと SPEC.md 等を読めます**(下の4)。
   - **ブランチ名は `main`**にする(`main` への push で自動公開されます)。
4. 公開リポジトリには誰でもコードを見られます。**コードにはPINや鍵は入っていません**(PIN_PEPPER は Apps Script の「スクリプトプロパティ」にだけ保存。コード・シートには出ません)。ただし `config.js` に書く GAS のURLは公開されます(下記 4-1 の注意)。

---

## 3. バックエンド(Googleスプレッドシート + Apps Script)

### 3-1. スプレッドシートを作る
1. Googleドライブで新規 Googleスプレッドシートを作る。名前の例: `型枠検査 データ`。
2. このファイルの共有は **責任者(社長)のみ**にする。**QA・職長には共有しない**(SPEC §2.6.2 の運用ルール)。

### 3-2. Apps Script を開く
1. スプレッドシートのメニュー「拡張機能」→「Apps Script」。
2. 必ずこのスプレッドシートの中から開くこと(「紐づいたスクリプト」にするため)。

### 3-3. `.gs` ファイルを貼る
貼るのは `backend/` 直下の次の **14ファイル**(`harness/` は貼らない):

`Code.gs` `Util.gs` `Repo.gs` `Schema.gs` `Seed.gs` `Auth.gs` `Authz.gs` `Idem.gs` `Records.gs` `Photos.gs` `Report.gs` `Membership.gs` `Notify.gs` `Admin.gs`

手順:
1. 最初からある `コード.gs`(`Code.gs`)の中身を全部消し、`backend/Code.gs` の中身を貼る。
2. 左の「ファイル」の「+」→「スクリプト」で新しいファイルを作り、名前を上の各ファイル名(拡張子 `.gs` なし。例 `Util`)にして、中身を貼る。13回繰り返す。
3. ファイルの並び順は問わない見込みです(他ファイルの関数を読み込み時に呼ぶ記述は確認できませんでした)。実機で動かないときは要確認。
4. 保存(Ctrl+S / ディスクのアイコン)。

### 3-4. `appsscript.json`(設定ファイル)の扱い
1. Apps Script の左メニュー「プロジェクトの設定(歯車)」→「『appsscript.json』マニフェスト ファイルをエディタで表示する」にチェックを入れる。
2. エディタに `appsscript.json` が現れる。中身を **`backend/appsscript.json` の内容に全部置き換える**。内容の要点:
   - タイムゾーン `Asia/Tokyo`、ランタイム `V8`
   - Webアプリ: `executeAs: USER_DEPLOYING`(自分として実行)、`access: ANYONE_ANONYMOUS`(全員)
   - 権限(スコープ): スプレッドシート、ドライブ、`script.scriptapp`(トリガー設置)、`script.send_mail`(メール通知)
3. 保存する。(画面の表記は変わることがあります。見つからない場合は要確認)

### 3-5. 初期化(シート自動作成・初期データ投入)
Apps Script エディタ上部の関数選択プルダウンで関数を選び、「実行」を押します。**順番どおりに**:

| 順 | 関数名 | 何をするか |
|---|---|---|
| 1 | `setupSheets` | (中で `setupSecrets` も実行)①秘密鍵 `PIN_PEPPER` を自動生成 ②このスプレッドシートのIDを記録 ③16のシートを作成(1行目=列名) ④Config初期値を投入 ⑤項目マスタ Items を49行投入(有効16行+無効33行。シートが空のときだけ) ⑥Driveに「RCCREATE 型枠検査」フォルダを作成。正常終了で「OK: シートを準備しました」。 |
| 2 | `setupTriggers` | 時間トリガーを設置: `escalationTick`(5分ごと、30分/60分の無応答を通知)、`dailyMaintenance`(毎日3時) |

- この2つのあと、最初の責任者を作ります(3-9)。
- `setupSecrets` を単独で実行する必要はありません(`setupSheets` が呼びます)。
- 既存シートの列がSPECと違うと「列がSPECと一致しません」で止まります。シートの1行目は編集しないでください。
- 何度実行しても、既存のConfig値・Itemsは上書きされません。

**初回の承認画面の対処**(初めて「実行」したとき):
1. 「承認が必要です」→「権限を確認」→ 社長のGoogleアカウントを選ぶ。
2. 「このアプリは Google で確認されていません」と出る → 左下の「詳細」→「(プロジェクト名)(安全でないページ)に移動」。
3. 要求される権限(スプレッドシート・ドライブ・トリガー・メール送信)を「許可」。
4. 承認後、もう一度「実行」を押す(承認で中断した場合は実行されていません)。

### 3-6. 必要なスクリプトプロパティ
コードが読むものは3つだけです。**手で入力する必要はありません**(自動で入ります)。

| プロパティ名 | 入る場所 | 内容 |
|---|---|---|
| `PIN_PEPPER` | `setupSheets`(`setupSecrets`) | PINを保存するときの秘密鍵。**後から変更・削除しない**(変えると全員のPINが照合できなくなる、とコードから読み取れます) |
| `SPREADSHEET_ID` | 同上 | データのスプレッドシートID |
| `DRIVE_ROOT_FOLDER_ID` | `setupSheets` | Driveのルートフォルダ(Configシートの `driveRootFolderId` にも写される) |

確認方法: Apps Script「プロジェクトの設定」→「スクリプト プロパティ」に3つ並んでいればOK。

### 3-7. Webアプリとしてデプロイ
1. 右上「デプロイ」→「新しいデプロイ」→ 種類の歯車 →「ウェブアプリ」。
2. 説明: 例 `v1`。
3. 次のユーザーとして実行: **自分**。アクセスできるユーザー: **全員**。
4. 「デプロイ」。
5. 表示される **「ウェブアプリのURL」(`https://script.google.com/macros/s/…/exec` で終わる)をコピーして控える**。メモ帳等に保存し、他人に見せる必要はありませんが、秘密情報ではありません(誰でも叩ける設計。認証はアプリ側)。
6. 動作確認: そのURLの末尾に `?action=ping` を付けてブラウザで開く。`{"ok":true, ...}` のJSONが出れば成功。(`doGet` が対応するのは `ping` だけです)
7. **コードを更新して再デプロイするとき**: 「デプロイ」→「デプロイを管理」→ 鉛筆(編集)→ バージョン「新バージョン」→「デプロイ」。URLを変えずに更新できます(要確認: 画面表記)。「新しいデプロイ」を押すとURLが変わり、`config.js` の書き換えが必要になります。

### 3-8. 最初にConfigシートで設定するもの
スプレッドシートの `Config` シートで、`appBaseUrl` の行の `value` 列に **アプリの公開URL**(手順5で確定するURL。例 `https://rccreate-dev.github.io/katawaku-inspection`。**末尾の `/` は付けない**)を入れる。
- 空のままだと、参加用QRとメール内リンクのURLが `/#/join?...` だけになり使えません(Admin.gs `joinUrl_` は `appBaseUrl` を先頭に付けます)。
- メールを使わない場合は `mailEnabled` を `FALSE` にしてもよい(既定は `TRUE`。メールは Users の `email` がある人にだけ送られます)。
- そのほかのConfig値(30分/60分、PIN誤り5回、招待コード72時間、写真の大きさ等)は既定のままでよい。`timezone` は変更不可。`enabledStages` は `pre_pour`(打設前)のみ。

### 3-9. 最初の責任者(社長)を作る(`setupFirstLead`)
3-5 の `setupSheets` のあと、**Usersシートに社長の行を手で作らず**、次の手順で作ります(手で責任者の行を作ると、招待コードを出せず先に進めなくなります)。

1. Apps Script の左の「ファイル」の「+」→「スクリプト」で、新しいファイルを作る(名前は例 `tmp`)。
2. 中身を次の3行だけにして保存する(`'細野'` は社長のログイン画面に出る氏名に変える。`'u_hosono'` はID。省略可):
   ```
   function runFirstLead() {
     setupFirstLead('細野', 'u_hosono');
   }
   ```
   - ID(2つ目)は `u_` + 英小文字・数字(例 `u_hosono`)。省略するとIDは自動で付きます。
3. 上部の関数選択で `runFirstLead` を選び「実行」。
4. 画面下の **「実行ログ」** に次のように出ます。
   - `最初の責任者を作成しました: 細野(userId=u_hosono)`
   - `招待コード(6桁): 123456` ← **この6桁を控える**
   - `有効期限: …(72時間)`
5. スマホ(または公開URL)でアプリを開き、「端末の登録」で社長の氏名を選び、**招待コードと、これから使うPIN(4桁)** を入力して登録する。
6. 登録できたら、**手順2で作ったファイル(`tmp`)は削除する**(氏名・IDが残るだけで秘密は入っていませんが、不要です)。実行ログも他人に見せない。

動作のきまり(`setupFirstLead` は SPEC §3.6.1):
- 作られるのは **責任者(`lead`)だけ**。QA・職長はこの関数では作れません(6-1 のシートに行を追加し、責任者がアプリで招待コードを発行します)。
- **同じ関数をもう一度実行しても、二重には作りません。** 停止中(`disabled`)でない責任者が1人でもいれば、何も作らず「中止: 責任者が既に存在します…」とログに出ます。
- 招待コードは72時間で切れます。切れた/ログを見失った場合: まだ他に責任者がいない状態なら、Usersシートでその行の `status` を `disabled` にしてから、**別のID**で `setupFirstLead` をやり直せます(同じIDは使えません)。
- 招待コードは Googleスプレッドシートや履歴には保存されません(ハッシュだけ)。表示されるのはこの実行ログだけです。
- この関数は Webアプリ(スマホ・URL)からは呼べません。エディタを開ける人(スクリプト所有者)だけが実行できます。

---

## 4. フロントエンド設定(`frontend/` の書き換え)

### 4-1. `frontend/config.js`
開くと次のようになっています(開発用):

```
window.KW_CONFIG = {
  API_URL: 'http://localhost:8787/api',
  APP_BASE_URL: '',
  APP_VERSION: '1.0.0',
  ALLOW_FILE_PHOTO: false
};
```

書き換える箇所:
- `API_URL` → 手順3-7で控えた「ウェブアプリのURL」(`…/exec`)に置き換える。
- `APP_BASE_URL` → アプリの公開URL(手順5)。※ 現在の frontend のコードはこの値を読んでいる箇所を確認できませんでした(要確認)。サーバー側の Config `appBaseUrl`(3-8)が実際にQRのURLを決めます。両方同じ値を入れておけば安全です。
- `APP_VERSION` はそのまま(`1.0.0`)。Config の `minClientVersion`(`1.0.0`)より小さくすると全端末が「アプリが古すぎます」で止まります。
- `ALLOW_FILE_PHOTO: false` のまま(本番は現場のアプリ内カメラのみ。SPEC §7.1)。

注意: 公開リポジトリには GASのURLが載ります。URL自体は秘密ではない設計ですが、誰でもAPIを呼べる前提で、認証はアプリ側のPIN・端末登録に依存します。

### 4-2. `frontend/index.html` の CSP(通信制限)を本番用にする
`index.html` の3〜5行目付近に、`Content-Security-Policy` のメタタグがあります。その `connect-src` の末尾にある **次の2つを削除**します(開発用のlocalhost許可):

```
http://localhost:* http://127.0.0.1:*
```

削除後の `connect-src` は `'self' https://script.google.com https://script.googleusercontent.com` になります。直上のコメント(「開発用: …本番配備では…削除すること」)も一緒に消してよい。
- **これを残したままでも動きますが、本番では削除する指示です(index.html のコメントとSPEC §1.2)。**
- `frame-ancestors`(他サイトへの埋め込み禁止)は meta では効かず、ホスティング側のヘッダ設定が必要と書かれています。GitHub Pages ではヘッダを設定できないと思われます(要確認)。

### 4-3. `frontend/sw.js` の `SW_VERSION` を上げる(重要な運用)
- 現在の値: `var SW_VERSION = '1.0.0-2';`
- アプリの画面ファイル(`config.js`、`index.html`、`*.js`、`*.css`、`i18n.js` など)を変えたら、**必ず `SW_VERSION` を変える**(例 `'1.0.0-3'`)。
- 理由(sw.js のコメント): シェルのファイルは `SW_VERSION` が同じ間は再取得されません。上げないと、スマホは古い画面のまま(`API_URL` を書き換えても反映されない)。
- `config.js` と `index.html` は事前キャッシュ対象です。**本番用に書き換えたら、公開前に `SW_VERSION` を上げる**こと。
- 更新されたスマホには「更新があります」バナーが出て、タップで再読み込みされます。
- ここの `SW_VERSION` は、`config.js` の `APP_VERSION`(サーバーとの版チェック用)とは別物です。

---

## 5. GitHub Pages で公開し、スマホに追加する

### 5-1. 何が公開されるか
- アプリ本体(`index.html` 等)は `frontend/` の中にあります。GitHub Pages は一般にリポジトリのルートか `/docs` しか指定できないため、このリポジトリには **`frontend/` フォルダだけを公開する GitHub Actions**(`.github/workflows/pages.yml`)を同梱しています。
- `main` ブランチへ push するたびに、`frontend/` の中身だけが Pages に載ります(`backend/`・`docs/`・`SPEC.md` 等は公開サイトには載りません)。手動で動かしたいときは、GitHub の「Actions」タブ → 「Deploy frontend to GitHub Pages」→「Run workflow」。
- 画面の文言や `frontend/` を直したら、4-3 のとおり `SW_VERSION` を上げてから push します。

### 5-2. Pages を有効にする(最初に1回だけ)
1. リポジトリの「Settings」→「Pages」。
2. 「Build and deployment」の Source を **「GitHub Actions」** にする(「Deploy from a branch」ではない)。
3. `main` ブランチに push する(すでに push 済みなら、Actions タブで上の「Run workflow」)。「Actions」タブで緑のチェックを確認。
   - 初回に「環境 `github-pages` へのデプロイが保護ルールで止まる」と出たら、Settings → Environments → `github-pages` の「Deployment branches」に `main` が許可されているか確認する(要確認)。
4. 公開URL: `https://rccreate-dev.github.io/katawaku-inspection/`(組織名・リポジトリ名から推定。実際のURLは Settings → Pages と、Actions の実行結果に表示されるので確認)。
5. このURL(末尾 `/` なし)を、3-8 の Config `appBaseUrl` と 4-1 の `APP_BASE_URL` に入れる。
6. ブラウザでURLを開き、ログイン画面(端末の登録)が出れば成功。
- HTTPS で配信されます(GitHub Pages の標準)。カメラとService Workerに必要です。
- サブパス(`/katawaku-inspection/`)配下でも動くよう、manifest・sw.js は相対パス(`./`)で書かれています。
- 組織(`rccreate-dev`)のプランやポリシーによっては、Public リポジトリでも Pages/Actions が制限されることがあります(要確認)。

### 5-3. スマホのホーム画面に追加
**iPhone(Safari)**
1. Safari で公開URLを開く(Chrome等ではなく Safari)。
2. 共有ボタン(四角に上矢印)→「ホーム画面に追加」→「追加」。
3. ホーム画面のアイコンから起動する。
- SPEC §8.10: iPhoneは、ホーム画面に追加していないとサイトのデータが約7日で消えることがあります。消えると端末の再登録(氏名+PIN)が必要です。

**Android(Chrome)**
1. Chrome で公開URLを開く。
2. 右上「︙」→「ホーム画面に追加」(または「アプリをインストール」)。
3. ホーム画面のアイコンから起動する。

---

## 6. 名簿・現場・担当表の初期入力

共通ルール(SPEC §2、Schema.gs):
- シートの **1行目(列名)は変更しない**。列の追加・並べ替えもしない。
- 直接編集してよいのは `Users`(行追加と name/role/status/lang/email/qaQualified/note のみ)、`Sites`、`Assignments`、`Items`、`Config`、`Absences`。**`pinSalt`・`pinHash`・`failedCount`・`lockedAt` と、Devices・Memberships・Records など他のシートは手で触らない。**
- ID は `英小文字1字 + _ + 英小文字・数字` の形(32字まで)。**ID中に `_` や大文字や日本語は使えない**(Util.gs の `isId`)。例 `u_hosono`、`s_hachioji1`。IDは後で変えない。
- 真偽値は `TRUE` / `FALSE`、日付は `2026-10-07`、日時は `2026-10-07T09:00:00+09:00`(JST)の形で、文字として入れる。
- 複数の値は半角カンマ区切り。

### 6-1. Users(名簿)
| 列 | 入れ方 |
|---|---|
| userId | `u_` + 英小文字数字。例 `u_hosono` |
| name | ログイン画面に出る氏名。例 `細野` |
| nameKana | 任意。並び順用 |
| role | `foreman`(職長)/ `qa`(品質管理者)/ `lead`(責任者)のどれか1つ。**1人1役割**(兼任不可) |
| status | 新規は必ず `invited` |
| lang | `ja` または `id`(インドネシア語) |
| email | 任意。通知メール用 |
| qaQualified | QA/責任者が主担当・代行者になるなら `TRUE`。職長は `FALSE` |
| pinSalt, pinHash, lockedAt, lastLoginAt | **空のまま** |
| failedCount | `0` |
| note | 任意 |
| createdAt / updatedAt | 例 `2026-10-07T09:00:00+09:00` |

**責任者(社長)の行はここでは作りません**(3-9 の `setupFirstLead` が作ります)。以下は QA・職長のサンプルです(`|` は列の区切り。実際は1セルずつ入力):

| userId | name | role | status | lang | qaQualified | failedCount |
|---|---|---|---|---|---|---|
| u_tanaka | 田中 | qa | invited | ja | TRUE | 0 |
| u_sugiant | スギアント | foreman | invited | id | FALSE | 0 |

退職者は `status` を `disabled` にする(ログイン画面から消え、全操作不可)。

### 6-2. Sites(現場)
| 列 | 入れ方 |
|---|---|
| siteId | `s_` + 英小文字数字。例 `s_hachioji1` |
| name | 現場名 |
| status | `active`(`closed` にすると新規記録・参加申請不可) |
| floors | 階の選択肢。**必須**。カンマ区切り・表示順。各10文字以内。例 `1F,2F,3F` |
| zones | 工区の選択肢(任意)。例 `東,西`。空なら工区なし |
| primeContractor | 元請会社名(PDFに表示) |
| address | 任意 |
| joinKey | 参加QR用の合言葉。**必須**。英小文字・数字16文字を手入力(例 `k3m9x2q7w5p1a8d4`)。のちほど「管理 → 参加用QR」の「合言葉を更新」で自動生成の値に置き換えられる |
| driveFolderId | **空のまま**(写真の保存時に自動記入) |
| startDate / endDate | 任意 |
| createdAt / updatedAt | 日時 |

サンプル: `s_hachioji1 | 八王子A現場 | active | 1F,2F,3F | 東,西 | ○○建設 | | k3m9x2q7w5p1a8d4`

### 6-3. Assignments(担当表)
| 列 | 入れ方 |
|---|---|
| assignId | `a_` + 英小文字数字。例 `a_001` |
| siteId | SitesのsiteId |
| userId | UsersのID |
| assignRole | `qa_main`(主担当QA)/ `qa_sub`(代行者)/ `foreman`(職長)/ `subforeman`(副職長) |
| team | 班名(職長・副職長のみ)。同じ現場で同じ文字列=同じ班。空なら本人の記録だけ見える |
| validFrom | 開始日。**必須**。例 `2026-10-07` |
| validTo | 終了日。空=無期限 |
| active | `TRUE`(無効にするときは行を消さず `FALSE`) |
| createdBy | 入力した責任者のuserId(`system` も可) |
| createdAt / updatedAt | 日時 |

役割の整合(合わない行は無視される。兼任不可):
- `qa_main`: Usersのroleが `qa`、かつ **`qaQualified=TRUE`**
- `qa_sub`: roleが `qa` または `lead`、かつ `qaQualified=TRUE`
- `foreman` / `subforeman`: roleが `foreman`

現場ごとの必須条件: **有効な `qa_main` がちょうど1人、`qa_sub` が1人以上、両者は別人**。

サンプル(QAが1人だけの場合は、責任者が代行者になる):

| assignId | siteId | userId | assignRole | team | validFrom | active | createdBy |
|---|---|---|---|---|---|---|---|
| a_001 | s_hachioji1 | u_tanaka | qa_main | | 2026-10-07 | TRUE | u_hosono |
| a_002 | s_hachioji1 | u_hosono | qa_sub | | 2026-10-07 | TRUE | u_hosono |

**職長の担当は手入力しなくてよい。** 職長が現場のQRから参加申請 → QAが承認すると Assignments に自動で追加されます(SPEC §2.4)。

名簿のチェック: アプリの「管理 → 担当表」(責任者のみ)に、`adminValidateRoster` の結果(エラー・警告)が出る。エラーが0になるまで直す。

### 6-4. 招待コードの発行(責任者がアプリで行う)
1. 責任者が登録済みの端末で、「管理」→「ユーザー管理」を開く。
2. 対象者の「招待コードを発行」を押す(`status=invited` の人)。**6桁の数字が1回だけ表示される**。控えて、本人に口頭・対面で伝える(SPEC §3.6)。
3. 有効時間は72時間(Config `inviteTtlHours`)。再発行すると古いコードは即無効。
4. 本人は、自分のスマホでアプリを開く →「端末の登録」で自分の氏名を選ぶ → 招待コードと、これから使うPIN(4桁)を入力 →「登録する」。以後はPIN不要で使える(提出・合格・打設可の確定のときだけPINを再入力)。
5. PINを忘れたとき: 「ユーザー管理」で「再設定用コードを発行」(登録済みユーザーのみ)→ 本人が「PINを忘れた/再設定」から入力。
6. PINを5回間違えるとロック。責任者が「ロック解除」。
7. スマホ紛失: 「ユーザー管理」の端末の「登録解除」。

### 6-5. 参加用QRの出し方
1. 責任者が「管理」→「参加用QR」を開く。現場ごとにQR・合言葉が表示される(QRはアプリ内で生成。外部サービス不使用)。
2. 「印刷」で印刷して現場に貼る。
3. 職長はスマホで読み取る(標準カメラでURLを開く、またはアプリの「現場に参加」でQR読み取り/URL貼り付け)→「申請する」。
4. 主担当のQA(不在なら代行者)が「ボード」または「管理 → 参加申請」で承認する。承認時に班名(team)を入れる。
5. QRが漏れたら「合言葉を更新」。古いQRは使えなくなる。
- QRのURLの先頭は Config `appBaseUrl`(3-8)です。**未設定だとQRが使えません。**

---

## 7. 項目マスタ(Items)の編集ルール(SPEC §2.6.2)

1. **編集できるのは責任者だけ。** スプレッドシートの共有は責任者のみ。QA・職長には共有しない。
2. **既存IDの意味は変えない。** 項目の内容を変えたいときは、**新しい `itemId`(末尾の次番号。例 `i50`)で行を追加**し、古いIDは `active=FALSE` にする。誤字訂正など意味が変わらない直しだけ、同じ行を直してよい。
3. `active` を `TRUE` / `FALSE` で切り替えて、出す項目・出さない項目を選ぶ。初期状態は i1〜i16 が `TRUE`、i17〜i49 は `FALSE`(責任者が必要に応じて有効化)。`seq`(並び順)は変えてよい。
4. **反映されるのは、以後に新規作成される記録から。** 既存の記録は作成時の内容で固定(影響なし)。
5. **i48・i49(出来形)は `active=TRUE` にしても画面に出ません。** 段階が `post_demold`(脱型後)で、現在は `enabledStages` が `pre_pour` のみのため。脱型後検査を有効にする将来の版で使われます。
6. インドネシア語(`textId`)は暫定訳。追加・変更したら、ネイティブの人に確認してもらう。
7. 編集後に目視で確認する点(自動チェックは未実装): `itemId` と `seq` の重複なし / `tol`(許容値)がある項目は `measure` が `optional` 以上 / `stage`・`audience`・`measure` が決まった値 / 同じ `groupKey` は `groupJa`・`groupId` が同じ。

---

## 8. 動作確認チェックリスト(職長1人・QA1人・責任者で一通り)

準備: 6-1〜6-3 の入力済み(責任者=社長、QA=田中、職長=スギアント の例)。責任者(社長)が 3-9 で作成・登録済みであること。

- [ ] ブラウザで GAS の `…/exec?action=ping` が `"ok":true` を返す
- [ ] 公開URLを開くと「端末の登録」画面が出る。氏名一覧に Users の `invited` / `active` の人が出る
- [ ] 責任者が登録できた。「管理」タブが見える
- [ ] 「管理 → 担当表」でエラーが0件(`qa_main` 1・`qa_sub` 1、別人)
- [ ] 「管理 → ユーザー管理」で田中・スギアントの招待コードを発行できた
- [ ] 田中(QA)が自分のスマホで登録できた(招待コード+PIN)
- [ ] スギアント(職長)が自分のスマホで登録できた
- [ ] 「管理 → 参加用QR」に現場のQRと合言葉が出る。QRのURLが公開URLで始まる
- [ ] 職長がQRを読み取って「申請する」→ 田中のボード(または参加申請)に申請が出る
- [ ] 田中が班名を入れて承認 → 職長の「担当現場」に現場が出る
- [ ] 職長: 新しい記録(階・ロット)を作る → 自主検査の16項目を入力 → NG項目には写真(アプリ内カメラ)とコメント
- [ ] 職長: 「提出する」でPINを入力して提出できた
- [ ] 田中: ボードに提出が出る → 「確認する」→ 判定(OK等)。合格はPIN入力が必要
- [ ] 差し戻し(軽微)の場合: 職長に戻り、「是正して再提出」できる。職長のコメントは上書きされない
- [ ] 田中(または責任者): 合格後に「元請提出用PDF」を作る → PDFのリンクが開き、日本語が文字化けしていない
- [ ] 「元請サインを記録(打設可にする)」でPINを入力 → 状態が「打設可」になる
- [ ] Googleドライブの「RCCREATE 型枠検査」フォルダに `photos/` と `reports/` ができている
- [ ] スプレッドシートの `Records`、`Photos`、`Events` に行が増えている
- [ ] 圏外(機内モード)で項目入力 → 電波が戻ると送信される
- [ ] PINを5回間違えるとロック画面 → 責任者が「ロック解除」で復帰
- [ ] スマホのホーム画面アイコンから起動できる(iPhone/Android)
- [ ] メールを使う場合: Users の `email` に入れた人へ、提出時に `[型枠検査] 提出 …` のメールが届く(届かない場合は要確認)

---

## 9. よくあるトラブル

| 症状 | 原因と対処 |
|---|---|
| 画面に「通信できません」/ ブラウザの開発画面に **CORS** エラー | 通信は `Content-Type: text/plain` で送る作り(api.js)のため通常は起きません。起きる場合は ①`API_URL` が `…/exec` で終わっていない ②デプロイのアクセスが「全員」でない(`appsscript.json` の `webapp.access`)③古いデプロイのURLを使っている。デプロイ設定とURLを確認。 |
| 応答が **302** と表示される | GAS は POST に対し302でリダイレクトする仕様で、api.js は `redirect:'follow'` で追従します。ブラウザ側は正常。手動で `curl` を試すときは `-L` を付ける。自分でURLを開いても `?action=ping` 以外は「未対応」の応答が返るのは正常。 |
| 「承認が必要です」「このアプリは確認されていません」 | 3-5 の承認手順。「詳細」→「安全でないページに移動」→「許可」。 |
| `setupSheets` が「列がSPECと一致しません」で止まる | 該当シートの1行目(列名)が変わっている。SPEC §2 の列名・順序に戻す。 |
| 「シートがありません: …(setupSheets を実行してください)」「PIN_PEPPER が未設定です」 | 3-5 を実行していない/別のスプレッドシートで実行した。`setupSheets` を実行。 |
| 登録できない `INVITE_REQUIRED` / `INVITE_INVALID` / `INVITE_EXPIRED` | 招待コードが必要/違う/72時間切れ。「ユーザー管理」で再発行(古いコードは無効に)。誤りはPINと同じ誤り回数に数えられる。 |
| `USER_LOCKED` | PIN5回誤り。責任者が「ロック解除」。 |
| `DEVICE_REVOKED` / `UNAUTHENTICATED` | 端末の登録解除、またはiPhoneでデータが消えた。もう一度「端末の登録」。 |
| `CLIENT_OUTDATED`(アプリが古すぎます) | `minClientVersion` より端末の `APP_VERSION` が小さい。更新ボタンを押す。 |
| 参加QRを読んでも `JOIN_KEY_INVALID` | 合言葉を更新した後の古いQR。新しいQRを印刷し直す。 |
| 参加QRのURLが `/#/join?…` で始まり開けない | Config の `appBaseUrl` が空。3-8 を設定。 |
| 現場に参加したが何も見えない/操作できない | Assignments の有効行がない(`active`、`validFrom`/`validTo`、役割の整合)。「管理 → 担当表」で確認。 |
| 権限エラー(`FORBIDDEN_ROLE`/`FORBIDDEN_SITE`) | その人の role と担当表の assignRole が合っていない(兼任不可)。6-3 の整合表を確認。 |
| 画面を直したのに **スマホで古いまま**(キャッシュ) | `sw.js` の `SW_VERSION` を上げていない(4-3)。上げて公開し直す。端末は「更新があります」をタップ。それでも古い場合はアプリを完全に閉じて開き直す。GitHub Pages の反映に数分かかることもある。 |
| `API_URL` を直したのに古いURLに送っている | 同上(`config.js` は事前キャッシュ対象)。`SW_VERSION` を上げる。 |
| PDFが作れない `DRIVE_ERROR` / 共有リンクにならない | Drive権限・組織の共有ポリシー。共有できない場合はPDFは非共有のまま保存される(`pdfShareMode` を `private` にすると最初から共有しない)。 |
| 写真が撮れない | カメラ許可、およびHTTPSで開いていること。ファイル選択はオフ(`ALLOW_FILE_PHOTO: false`)。 |

---

## 付録: 要確認・未実装 の一覧(このファイルの根拠が弱い所)
- 3-9: `setupFirstLead` はテスト用の模擬環境(`backend/harness`)でのみ動作確認済み。Apps Script 実機での実行・実行ログの見え方は要確認
- 5-1/5-2: `.github/workflows/pages.yml` は実際の GitHub 上では未実行(Actions のバージョン `@v4`/`@v5`/`@v3` と画面の文言、組織の制限は要確認)
- 3-3: `.gs` ファイルの読み込み順(コード上は問題なし。実機は要確認)
- 3-4, 3-7: Apps Script 画面の文言(Google側の表記は変わる)
- 4-1: `config.js` の `APP_BASE_URL` をフロントが使っているか(使用箇所なし。要確認)
- 4-2: `frame-ancestors` をGitHub Pagesで設定できるか(要確認)
- 8: メール通知の実機確認(Gmail送信上限・迷惑メール判定などは未確認)
