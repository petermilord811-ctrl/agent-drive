"""solve_sudoku.py <grid.json> [fills_out.json]
@tool the standalone solver: grid.json in, fills.json out (no Node needed)
@run  python -I skills/solve-a-sudoku/solve_sudoku.py grid.json fills.json

Solve a 9x9 sudoku and emit the moves needed to fill it in.

  grid.json : a JSON 9x9 array of ints, 0 = empty. e.g. [[0,0,9,5,8,6,0,0,0], ...]
  output    : prints the solution grid and how many cells were empty; writes
              {"solution": [[...]], "fills": [[row,col,digit], ...], "n_fill": N} to fills_out.json
              (rows/cols are 0-indexed). `fills` is what you click+type into the board.

It reports the number of solutions found: exactly 1 is the signal that the board was READ correctly
(a misread almost never yields a unique solution). 0 or >1 means re-read the givens.

  python -I solve_sudoku.py grid.json fills.json
"""
import json, sys

def conflicts(g):
    for i in range(9):
        rows = [g[i][j] for j in range(9) if g[i][j]]
        cols = [g[j][i] for j in range(9) if g[j][i]]
        if len(rows) != len(set(rows)) or len(cols) != len(set(cols)):
            return True
    for br in range(0, 9, 3):
        for bc in range(0, 9, 3):
            b = [g[br + r][bc + c] for r in range(3) for c in range(3) if g[br + r][bc + c]]
            if len(b) != len(set(b)):
                return True
    return False

def ok(g, r, c, v):
    for i in range(9):
        if g[r][i] == v or g[i][c] == v:
            return False
    br, bc = 3 * (r // 3), 3 * (c // 3)
    for i in range(3):
        for j in range(3):
            if g[br + i][bc + j] == v:
                return False
    return True

def main():
    grid = json.load(open(sys.argv[1]))
    out_path = sys.argv[2] if len(sys.argv) > 2 else None
    if conflicts(grid):
        print("GIVENS HAVE A CONFLICT — re-read the board")
        sys.exit(1)

    count = [0]
    sol = [None]
    def solve(g):
        if count[0] > 1:
            return
        for r in range(9):
            for c in range(9):
                if g[r][c] == 0:
                    for v in range(1, 10):
                        if ok(g, r, c, v):
                            g[r][c] = v
                            solve(g)
                            g[r][c] = 0
                    return
        count[0] += 1
        if sol[0] is None:
            sol[0] = [row[:] for row in g]
    solve([row[:] for row in grid])

    print("solutions found:", count[0])
    if sol[0] is None:
        print("NO SOLUTION — re-read the board")
        sys.exit(1)
    for r in range(9):
        print(' '.join(str(sol[0][r][c]) for c in range(9)))
    fills = [[r, c, sol[0][r][c]] for r in range(9) for c in range(9) if grid[r][c] == 0]
    print("empty cells to fill:", len(fills))
    if out_path:
        json.dump({"solution": sol[0], "fills": fills, "n_fill": len(fills)}, open(out_path, 'w'))

main()
