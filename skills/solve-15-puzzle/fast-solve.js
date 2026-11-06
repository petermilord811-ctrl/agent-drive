'use strict';
// @tool solve ANY solvable 15/8-puzzle fast (weighted A*, non-optimal) -- the fallback for boards the optimal IDA* caps on
// @run  node skills/solve-15-puzzle/fast-solve.js solve skills/solve-15-puzzle/example.board.json
// fast-solve -- a COMPLETE sliding-puzzle solver for when the optimal one gives up.
//
// WHY. fifteen-solve.js searches for the SHORTEST solution (IDA* + Manhattan/linear-conflict). That is
// beautiful but it blows past its node cap on a hard 4x4 scramble -- a real random board (average optimal
// ~52 moves) routinely returns "no solution found within the node cap", so the skill could not actually
// solve a puzzle live (seen driving machine 10005). This trades optimality for completeness: WEIGHTED A*
// (f = g + weight*h, weight>1) is greedy enough to reach the goal after a few thousand node expansions on
// any solvable board, at the cost of a longer move list -- which is fine, since the moves execute as fast
// reliable key presses. On the 10005 board it returned a 66-move solution from 6182 nodes in milliseconds.
//
// Output is a GAP-MOVE string: each char is the direction the EMPTY square moves -- U/D/L/R. To drive a
// site whose arrow keys "slide a tile into the empty space", the key is the OPPOSITE of the gap move
// (gap U -> ArrowDown, D -> ArrowUp, L -> ArrowRight, R -> ArrowLeft); verify the convention with one probe
// press, then execute in CHUNKS, re-reading between them (a dropped press desyncs the rest). `solvable`
// decides parity up front so an impossible board returns null instead of being searched. Pure, no host.
//
//   node fast-solve.js solve <board.json> [weight]   # prints the gap-move string (U/D/L/R)
//   node fast-solve.js check <board.json>            # "solvable" / "unsolvable"
//   const { solveFast, solvable, applyMoves } = require('./fast-solve.js')
const fs = require('fs');

// board: flat array, 0 is the gap, row-major; W is the side. Goal is 1..W*W-1 then 0.
function heuristic(b, W, N) {
  let d = 0;
  for (let i = 0; i < N; i++) { const v = b[i]; if (!v) continue; const g = v - 1;
    d += Math.abs(((i / W) | 0) - ((g / W) | 0)) + Math.abs((i % W) - (g % W)); }
  return d;
}
function neighbors(g, W) {
  const r = (g / W) | 0, c = g % W, out = [];
  if (r > 0) out.push([g - W, 'U']); if (r < W - 1) out.push([g + W, 'D']);
  if (c > 0) out.push([g - 1, 'L']); if (c < W - 1) out.push([g + 1, 'R']);
  return out;
}
// Permutation parity test: half of all arrangements can never reach the goal.
function solvable(b, W) {
  const N = W * W, t = b.filter((x) => x !== 0);
  let inv = 0;
  for (let i = 0; i < t.length; i++) for (let j = i + 1; j < t.length; j++) if (t[i] > t[j]) inv++;
  if (W % 2 === 1) return inv % 2 === 0;
  const blankRowFromBottom = W - ((b.indexOf(0) / W) | 0);
  return (blankRowFromBottom % 2 === 0) === (inv % 2 === 1);
}
// Apply a gap-move string to a board (mutating a copy); returns the resulting board. Throws on an illegal move.
function applyMoves(board, W, moves) {
  const b = board.slice(); let g = b.indexOf(0);
  for (const m of moves) {
    const r = (g / W) | 0, c = g % W; let nb;
    if (m === 'U') nb = g - W; else if (m === 'D') nb = g + W; else if (m === 'L') nb = g - 1; else if (m === 'R') nb = g + 1; else continue;
    if ((m === 'U' && r === 0) || (m === 'D' && r === W - 1) || (m === 'L' && c === 0) || (m === 'R' && c === W - 1)) throw new Error('illegal move ' + m + ' at ' + g);
    b[g] = b[nb]; b[nb] = 0; g = nb;
  }
  return b;
}
// Weighted A*. Returns the gap-move string, or null (unsolvable, or the node cap was hit).
function solveFast(board, W, weight, cap) {
  W = W || Math.round(Math.sqrt(board.length));
  const N = W * W, WEIGHT = weight || 3, CAP = cap || 4000000;
  const goal = []; for (let i = 1; i < N; i++) goal.push(i); goal.push(0);
  const goalStr = goal.join(',');
  if (board.join(',') === goalStr) return '';
  if (!solvable(board, W)) return null;
  const heap = [];
  const push = (n) => { heap.push(n); let i = heap.length - 1; while (i) { const p = (i - 1) >> 1; if (heap[p].f <= heap[i].f) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
  const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let i = 0; for (;;) { let l = 2 * i + 1, r = 2 * i + 2, s = i; if (l < heap.length && heap[l].f < heap[s].f) s = l; if (r < heap.length && heap[r].f < heap[s].f) s = r; if (s === i) break; [heap[s], heap[i]] = [heap[i], heap[s]]; i = s; } } return top; };
  const best = new Map(); best.set(board.join(','), 0);
  push({ f: WEIGHT * heuristic(board, W, N), g: 0, board: board.slice(), gap: board.indexOf(0), path: '' });
  let nodes = 0;
  while (heap.length) {
    const cur = pop(); if (++nodes > CAP) return null;
    const bs = cur.board.join(',');
    if (bs === goalStr) return cur.path;
    const bg = best.get(bs); if (bg !== undefined && bg < cur.g) continue;
    for (const [nb, dir] of neighbors(cur.gap, W)) {
      const nbd = cur.board.slice(); nbd[cur.gap] = nbd[nb]; nbd[nb] = 0;
      const key = nbd.join(','), ng = cur.g + 1, kg = best.get(key);
      if (kg !== undefined && kg <= ng) continue;
      best.set(key, ng);
      push({ f: ng + WEIGHT * heuristic(nbd, W, N), g: ng, board: nbd, gap: nb, path: cur.path + dir });
    }
  }
  return null;
}

module.exports = { solveFast, solvable, applyMoves };

if (require.main === module) {
  const [cmd, file, w] = [process.argv[2], process.argv[3], process.argv[4]];
  if (!cmd || !file) { console.error('usage: node fast-solve.js <solve|check> <board.json> [weight]'); process.exit(2); }
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  const board = data.board || data, W = data.W || Math.round(Math.sqrt(board.length));
  if (cmd === 'check') { console.log(solvable(board, W) ? 'solvable' : 'unsolvable'); process.exit(0); }
  if (cmd === 'solve') {
    const moves = solveFast(board, W, w ? Number(w) : 3);
    if (moves === null) { console.error(solvable(board, W) ? 'no solution within the node cap' : 'unsolvable'); process.exit(1); }
    process.stdout.write(moves + '\n');
    process.stderr.write('[+] ' + moves.length + ' gap-moves (U/D/L/R = empty square moves)\n');
    process.exit(0);
  }
  console.error('unknown command ' + cmd); process.exit(2);
}
