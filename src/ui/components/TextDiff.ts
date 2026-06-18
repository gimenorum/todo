// ui/components/TextDiff.ts — メモ（自由記述）の行単位テキスト差分（ch.10 §10.3）。
// 依存を増やさない自前の LCS（最長共通部分列）実装。a=左（この端末）/ b=右（相手）。
//   common = 両方にある行 / del = 左のみ（相手で消えた）/ add = 右のみ（相手で増えた）。

export type DiffType = 'common' | 'add' | 'del';

export interface DiffLine {
  type: DiffType;
  text: string;
}

// 行単位の LCS 差分。DP で LCS 長を求め、後ろ向きに del/add/common を確定する。
export function diffLines(a: string, b: string): DiffLine[] {
  const la = a.split('\n');
  const lb = b.split('\n');
  const n = la.length;
  const m = lb.length;

  // dp[i][j] = la[i..] と lb[j..] の LCS 長。
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = la[i] === lb[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (la[i] === lb[j]) {
      out.push({ type: 'common', text: la[i] });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      out.push({ type: 'del', text: la[i] });
      i++;
    } else {
      out.push({ type: 'add', text: lb[j] });
      j++;
    }
  }
  while (i < n) out.push({ type: 'del', text: la[i++] });
  while (j < m) out.push({ type: 'add', text: lb[j++] });
  return out;
}

const PREFIX: Record<DiffType, string> = { common: ' ', add: '+ ', del: '- ' };

// 差分を DOM へ。ユーザー由来テキストは textContent（innerHTML 不使用 / ch.14）。
export function renderTextDiff(a: string, b: string): HTMLElement {
  const box = document.createElement('div');
  box.className = 'textdiff';
  for (const ln of diffLines(a, b)) {
    const row = document.createElement('div');
    row.className = `diff-line diff-${ln.type}`;
    row.textContent = PREFIX[ln.type] + ln.text;
    box.append(row);
  }
  return box;
}
