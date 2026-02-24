/**
 * 1 = wall, 0 = path
 * 28 cols × 31 rows
 * symmetric; tunnels at left/right center; ghost house in middle (as open space region)
 */
const MAZE_GRID = [
  "1111111111111111111111111111",
  "1            11            1",
  "1 1111 11111 11 11111 1111 1",
  "1 1111 11111 11 11111 1111 1",
  "1 1111 11111 11 11111 1111 1",
  "1                          1",
  "1 1111 11 11111111 11 1111 1",
  "1 1111 11 11111111 11 1111 1",
  "1      11    11    11      1",
  "111111 11111 11 11111 111111",
  "     1 11111 11 11111 1     ",
  "     1 111        111 1     ",
  "     1 111 11  11 111 1     ",
  "111111 111 1    1 111 111111",
  "           1    1           ",
  "111111 111 1    1 111 111111",
  "     1 111 111111 111 1     ",
  "     1 111        111 1     ",
  "     1 111 111111 111 1     ",
  "111111 111 111111 111 111111",
  "1            11            1",
  "1 1111 11111 11 11111 1111 1",
  "1 1111 11111 11 11111 1111 1",
  "1   11                11   1",
  "111 11 11 11111111 11 11 111",
  "111 11 11 11111111 11 11 111",
  "1      11    11    11      1",
  "1 1111111111 11 1111111111 1",
  "1 1111111111 11 1111111111 1",
  "1                          1",
  "1111111111111111111111111111",
];

export const MAZE_COLS = 28;
export const MAZE_ROWS = 31;
export const CELL_SIZE = 2;
export const WALL_HEIGHT = 3;

/**
 * Returns list of [x, z] world positions for each wall cell (center of cell).
 * Interprets MAZE_GRID as strings of '1' (wall) and '0' (path).
 * Maze is centered at origin:
 *  - For 28 cols: x centers are -13.5 ... +13.5
 *  - For 31 rows: z centers are -15.0 ... +15.0
 */
export function get_wall_positions() {
  const positions = [];

  for (let row = 0; row < MAZE_ROWS; row++) {
    // Pad/truncate to MAZE_COLS; default missing cells to wall ('1') for safety
    const raw = MAZE_GRID[row] ?? "";
    const line = raw.slice(0, MAZE_COLS).padEnd(MAZE_COLS, "1");

    for (let col = 0; col < MAZE_COLS; col++) {
      const ch = line[col];
      if (ch === "1") {
        const x = col - (MAZE_COLS / 2) + 0.5;
        const z = row - (MAZE_ROWS / 2) + 0.5;
        positions.push([x, z]);
      }
    }
  }

  return positions;
}

/** Floor size (half-extents): floor extends from (-MAZE_COLS/2 - margin, -MAZE_ROWS/2 - margin) to (MAZE_COLS/2 + margin, MAZE_ROWS/2 + margin) in x/z. */
export const FLOOR_MARGIN = 2;
