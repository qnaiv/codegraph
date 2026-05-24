# CodeGraph — Salesforce Apex/SObject Visualizer

Salesforce の Apex クラス・トリガー・SObject 間の依存関係をマインドマップ形式で可視化する VS Code 拡張。

- クラス継承・インターフェース実装・SOQL参照・DML操作・Lookup関係を自動でグラフ化
- ノードをクリックすると参照箇所をハイライト、ダブルクリックでソースへジャンプ
- テストクラス・マネージドパッケージの表示/非表示をトグル

---

## 必要なもの

| ツール | バージョン | 用途 |
|---|---|---|
| Node.js | 20 以上 | ビルド |
| VS Code | 1.85 以上 | 拡張実行環境 |
| [Salesforce Extensions for VS Code](https://marketplace.visualstudio.com/items?itemName=salesforce.salesforcedx-vscode) | 最新 | Apex LSP（クラス解析に必要） |

> **Note**: Salesforce Extensions がインストールされていない場合、SObject ノード（`.object-meta.xml` 由来）は表示されますが、Apex クラスノードは表示されません。

---

## クイックスタート

```bash
# 1. 依存関係をインストール
npm install

# 2. ビルド（拡張ホスト + Webview）
npm run build

# 3. VS Code でこのフォルダを開く
code .
```

VS Code で **F5** を押すと Extension Development Host が起動します。  
新しく開いた VS Code ウィンドウで Salesforce プロジェクトを開き、コマンドパレット（`Cmd+Shift+P`）から **CodeGraph: Open** を実行します。

---

## サンプルプロジェクトで動作確認する

`sample-project/` にテスト用の Apex/SObject コードが入っています。

```bash
# Extension Development Host の VS Code で以下を開く
File > Open Folder > sample-project/
```

開いたら **CodeGraph: Open** を実行すると、以下の構成がグラフで表示されます：

```
IService (interface)
  └─ implements ── BaseService (abstract)
                      ├─ extends ── AccountService  ──SOQL/DML──► Account
                      ├─ extends ── ContactService  ──SOQL/DML──► Contact
                      └─ extends ── OrderService    ──DML──────► Order__c
                                                                     └─ Lookup ── Account

AccountTrigger  ──trigger-on──► Account
OrderTrigger    ──trigger-on──► Order__c
OrderItem__c    ──MasterDetail──► Order__c
AccountServiceTest (@isTest, デフォルトで非表示)
```

---

## 開発ワークフロー

### Webview（React）を変更しながら開発する（HMR対応）

```bash
# ターミナル 1: Vite dev server を起動
npm run watch:webview

# ターミナル 2: 拡張ホストの TypeScript を watch ビルド
npm run watch:extension

# その後 VS Code で F5 → Extension Development Host が起動
```

Webview のコードを変更すると、パネルをリロード（`Cmd+R`）するだけで反映されます。

### CI と同じチェックをローカルで実行

```bash
npm run check   # lint + typecheck + build を一括実行
```

**push 前に必ず `npm run check` がグリーンになることを確認すること。**

---

## プロジェクト構成

```
codegraph/
├── src/
│   ├── extension/              # 拡張ホスト（Node.js / VS Code API）
│   │   ├── extension.ts        # エントリポイント
│   │   ├── WebviewPanelManager.ts  # パネル管理・MessageBus
│   │   ├── FileWatcher.ts      # ファイル変更監視
│   │   ├── graph/
│   │   │   ├── GraphBuilder.ts # ノード・エッジ構築
│   │   │   └── GraphStore.ts   # インメモリグラフ状態
│   │   ├── lsp/
│   │   │   ├── LspClient.ts    # VS Code Public API ラッパー
│   │   │   ├── SymbolIndexer.ts
│   │   │   └── ReferenceResolver.ts
│   │   └── parser/
│   │       ├── SOQLExtractor.ts    # SOQL/DML 抽出（regex）
│   │       └── SObjectMetaParser.ts # .object-meta.xml 解析
│   ├── webview/                # React アプリ（Chromium）
│   │   ├── main.tsx
│   │   ├── MessageHandler.ts
│   │   ├── store/graphStore.ts # Zustand ストア
│   │   ├── layout/DagreLayout.ts
│   │   └── components/
│   │       ├── canvas/CodeGraphCanvas.tsx  # メインキャンバス
│   │       ├── nodes/          # カスタムノードコンポーネント
│   │       └── edges/          # カスタムエッジコンポーネント
│   └── shared/
│       └── types.ts            # 拡張ホスト・Webview 共有の型定義
├── sample-project/             # 動作確認用 Salesforce プロジェクト
├── dist/webview/               # Vite ビルド出力（gitignore済み）
├── out/                        # tsc ビルド出力（gitignore済み）
└── docs/design.md              # 設計ドキュメント
```

---

## 主要スクリプト

| コマンド | 内容 |
|---|---|
| `npm run check` | lint + typecheck + build（CI相当） |
| `npm run build` | 拡張ホスト + Webview をビルド |
| `npm run watch:extension` | 拡張ホストを watch ビルド |
| `npm run watch:webview` | Vite dev server 起動（HMR） |
| `npm run lint` | ESLint |
| `npm run typecheck` | TypeScript strict チェック |

---

## アーキテクチャ概要

```
VS Code 拡張ホスト
  ├─ LspClient          ← Apex Language Server（executeCommand 経由）
  ├─ SymbolIndexer      ← .cls/.trigger をシンボル化
  ├─ SObjectMetaParser  ← .object-meta.xml を解析
  ├─ GraphBuilder       ← ノード・エッジを構築
  └─ WebviewPanelManager ── postMessage ──► React アプリ（Webview）
                                                ├─ CodeGraphCanvas（React Flow）
                                                ├─ Zustand Store
                                                └─ カスタムノード/エッジ
```

詳細は [`docs/design.md`](docs/design.md) を参照。
