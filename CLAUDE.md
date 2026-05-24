# CodeGraph — Claude 作業ルール

## 必須ルール

### 1. 実装完了後は必ず PR を作成する

タスク（issue）の実装が完了してコミット・push した後は、**必ず PR を作成すること**。
PR を作成せずに完了報告してはならない。

### 2. push 前に必ず CI チェックを通す

コミット・push の前に以下を実行し、全ステップがグリーンになることを確認すること：

```bash
npm run check   # lint + typecheck + build を一括実行
```

ローカルで `npm run check` が通れば CI も通る。lint エラー・型エラーが残ったまま push しない。

## 開発フロー

```
実装 → npm run check（グリーン確認） → commit → push → PR作成
```

## ブランチ

- 開発ブランチ: `claude/salesforce-apex-visualizer-design-JlKt7`
- マージ先: `main`

## PR 作成時の注意

- タイトル: 70文字以内
- 本文: Summary（変更内容）・Test plan（確認項目）を記載
- 対応 issue 番号を本文に含める（例: `Closes #2 #3 #4`）
