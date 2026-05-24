# CodeGraph — Claude 作業ルール

## 必須ルール

### 1. 実装完了後は必ず PR を作成する

タスク（issue）の実装が完了してコミット・push した後は、**必ず PR を作成すること**。
PR を作成せずに完了報告してはならない。

### 2. push 前に必ず CI チェックを通す

コミット・push の前に以下を実行し、全ステップがグリーンになることを確認すること：

```bash
npm run check   # lint + typecheck + test + build を一括実行
```

ローカルで `npm run check` が通れば CI も通る。lint エラー・型エラーが残ったまま push しない。

### 3. 1 issue 1 ブランチ

- issue 1件につきブランチを1本作成する
- ブランチ名: `claude/issue-{番号}-{短い説明}` （例: `claude/issue-29-focus-search`）
- **PR がマージされたブランチは再利用しない。** 次の issue は必ず新しいブランチで作業する
- 作業開始時に `git checkout -b` でブランチを切ること

## 開発フロー

```
issue確認 → git checkout -b claude/issue-{番号}-{説明} main →
実装 → npm run check（グリーン確認） → commit → push → PR作成
```

## ブランチ

- ベースブランチ: `main`
- 命名規則: `claude/issue-{番号}-{短い説明}`

## PR 作成時の注意

- タイトル: 70文字以内
- 本文: Summary（変更内容）・Test plan（確認項目）を記載
- 対応 issue 番号を本文に含める（例: `Closes #29`）
