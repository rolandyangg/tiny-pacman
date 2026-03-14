import {tiny} from './examples/common.js';
import {MAZE_COLS, MAZE_ROWS, get_tile_center_world} from './pacman-map.js';
import {world_to_tile, is_wall} from './pacman-player.js';

const { Mat4 } = tiny;

export const GHOST_SPEED       = 4.2;   // slightly slower than Pac-Man in chase
export const GHOST_FRIGHTENED_SPEED = 3.0;
export const GHOST_RADIUS      = 0.32;
export const GHOST_Y           = 0.32;

// Scatter targets (tile col, row) — one corner per ghost
const SCATTER_CORNERS = [
  [1, 1],      // top-left
  [26, 1],     // top-right
  [1, 29],     // bottom-left
  [26, 29],    // bottom-right
];

// Tile just outside ghost house door (Blinky starts here)
const OUTSIDE_HOUSE_TILE = [14, 12];

// Dot count required to release each ghost (Pinky, Inky, Clyde). All release immediately so they chase right away; only Red starts outside.
function get_dot_release_for_level(level) {
  return [0, 0, 0];
}

const BOREDOM_RELEASE_SEC = 4;

/** Spawn position for ghost index 0..3 (world x, z). Blinky (0) starts outside; others inside the house. */
export function get_ghost_spawn_world(ghost_index) {
  if (ghost_index === 0) {
    return get_tile_center_world(OUTSIDE_HOUSE_TILE[0], OUTSIDE_HOUSE_TILE[1]);
  }
  const house_center_col = 14;
  const house_center_row = 14;
  const offsets = [[0, 0], [-1, 0], [1, 0], [0, 1]];
  const [dc, dr] = offsets[ghost_index % 4];
  const [x, z] = get_tile_center_world(house_center_col + dc, house_center_row + dr);
  return [x, z];
}

/**
 * Ghost with rule-based chase / scatter / frightened behavior.
 * At tile centers, chooses next direction by minimizing distance to target
 * (chase: Pac-Man; scatter: corner; frightened: random).
 */
export class Ghost {
  constructor(ghost_index) {
    const [x, z] = get_ghost_spawn_world(ghost_index);
    this.x = x;
    this.z = z;
    this.dir_x = 0;
    this.dir_z = 0;
    this.scatter_target = SCATTER_CORNERS[ghost_index % 4]; // [col, row]
    this.ghost_index = ghost_index;
    // Blinky (0) starts outside; Pinky/Inky/Clyde (1,2,3) start inside and wait for release
    this.is_outside = ghost_index === 0;
    this.released = ghost_index === 0;
    // Colors: red, pink, cyan, orange
    const colors = [
      [1, 0, 0, 1],
      [1, 0.7, 0.8, 1],
      [0, 1, 1, 1],
      [1, 0.6, 0, 1],
    ];
    this.color = colors[ghost_index % 4];
    this.frightened_color = [0.2, 0.2, 1, 1];
    this.eaten = false; // when eaten during frightened, respawn
    this.in_house = true;
  }

  /**
   * Choose next direction: chase (target from ghost AI), scatter (target corner), or frightened (random).
   * target_x, target_z = world position to move toward (used when not frightened).
   */
  _choose_direction(col, row, target_x, target_z, is_frightened) {
    const candidates = [
      [1, 0], [-1, 0], [0, 1], [0, -1],
    ];
    const reverse = [-this.dir_x, -this.dir_z];
    const choices = candidates.filter(([dx, dz]) => {
      if (dx === reverse[0] && dz === reverse[1]) return false; // no 180° unless forced
      const nc = col + dx;
      const nr = row + dz;
      return !is_wall(nc, nr);
    });

    if (choices.length === 0) {
      if (!is_wall(col + reverse[0], row + reverse[1])) return reverse;
      return [this.dir_x, this.dir_z];
    }

    if (is_frightened) {
      const idx = Math.floor(Math.random() * choices.length);
      return choices[idx];
    }

    let best = choices[0];
    let best_dist = Infinity;
    for (const [dx, dz] of choices) {
      const [nx, nz] = get_tile_center_world(col + dx, row + dz);
      const dist = (nx - target_x) ** 2 + (nz - target_z) ** 2;
      if (dist < best_dist) {
        best_dist = dist;
        best = [dx, dz];
      }
    }
    return best;
  }

  /**
   * Compute chase/scatter target (world x, z) for this ghost.
   * ctx: { pacman_x, pacman_z, pacman_col, pacman_row, pacman_dir_x, pacman_dir_z, blinky_col, blinky_row }.
   */
  _get_target_tile(ctx) {
    const mode = this._get_mode();
    if (mode === 'scatter') {
      return get_tile_center_world(this.scatter_target[0], this.scatter_target[1]);
    }
    const { pacman_col, pacman_row, pacman_dir_x, pacman_dir_z, blinky_col, blinky_row } = ctx;
    const idx = this.ghost_index;
    let tc, tr;
    if (idx === 0) {
      tc = pacman_col;
      tr = pacman_row;
    } else if (idx === 1) {
      const ahead = 4;
      tc = pacman_col + (pacman_dir_x !== 0 ? pacman_dir_x * ahead : 0);
      tr = pacman_row + (pacman_dir_z !== 0 ? pacman_dir_z * ahead : 0);
      tc = Math.max(0, Math.min(MAZE_COLS - 1, tc));
      tr = Math.max(0, Math.min(MAZE_ROWS - 1, tr));
    } else if (idx === 2) {
      const two_ahead_c = pacman_col + (pacman_dir_x !== 0 ? pacman_dir_x * 2 : 0);
      const two_ahead_r = pacman_row + (pacman_dir_z !== 0 ? pacman_dir_z * 2 : 0);
      const bc = blinky_col ?? pacman_col;
      const br = blinky_row ?? pacman_row;
      const vec_c = two_ahead_c - bc;
      const vec_r = two_ahead_r - br;
      tc = two_ahead_c + vec_c;
      tr = two_ahead_r + vec_r;
      tc = Math.max(0, Math.min(MAZE_COLS - 1, tc));
      tr = Math.max(0, Math.min(MAZE_ROWS - 1, tr));
    } else {
      const dist = Math.sqrt((ctx.pacman_x - this.x) ** 2 + (ctx.pacman_z - this.z) ** 2);
      const tile_dist = dist / 1; // ~1 world unit per tile
      if (tile_dist < 8) {
        tc = this.scatter_target[0];
        tr = this.scatter_target[1];
      } else {
        tc = pacman_col;
        tr = pacman_row;
      }
    }
    return get_tile_center_world(tc, tr);
  }

  /** Simple mode: chase for 20s, scatter for 7s, repeat (by animation time). */
  _get_mode() {
    // Use a simple time-based switch; could be driven by game time from caller later
    const t = (typeof this._game_time === 'number') ? this._game_time : 0;
    const cycle = t % 27;
    return cycle < 7 ? 'scatter' : 'chase';
  }

  update(dt, pacman_x, pacman_z, is_frightened, game_time, ghost_ctx) {
    this._game_time = game_time;
    const ctx = ghost_ctx || {};
    const level = typeof ctx.level === 'number' ? ctx.level : 1;
    const dots_eaten = typeof ctx.dots_eaten === 'number' ? ctx.dots_eaten : 0;
    const last_dot_time = typeof ctx.last_dot_time === 'number' ? ctx.last_dot_time : 0;
    const boredom_force = !!(ctx.boredom_force_release && ctx.release_ghost_index === this.ghost_index);

    if (!this.released && this.ghost_index > 0) {
      const dot_reqs = get_dot_release_for_level(level);
      const my_req = dot_reqs[this.ghost_index - 1];
      if (dots_eaten >= my_req || boredom_force) this.released = true;
    }

    if (!this.released) return;

    if (this.released && !this.is_outside) {
      const [exit_c, exit_r] = OUTSIDE_HOUSE_TILE;
      const [col, row] = world_to_tile(this.x, this.z);
      if (col === exit_c && row === exit_r) this.is_outside = true;
    }

    const speed = is_frightened ? GHOST_FRIGHTENED_SPEED : GHOST_SPEED;
    const [col, row] = world_to_tile(this.x, this.z);
    const [tile_cx, tile_cz] = get_tile_center_world(col, row);

    // Detect when ghost has left the house for the first time
    if (this.in_house) {
      if (col < 11 || col > 16 || row < 12 || row > 16) {
        this.in_house = false;
      }
    }

    // When stationary (dir 0,0), use a generous snap so we always pick a direction at spawn
    const at_rest = this.dir_x === 0 && this.dir_z === 0;
    const SNAP = at_rest ? 0.5 : 0.3;
    const near_center =
      Math.abs(this.x - tile_cx) < SNAP &&
      Math.abs(this.z - tile_cz) < SNAP;

    if (near_center) {
      let target_x, target_z;
      if (!this.is_outside) {
        if (!this.released) {
          target_x = this.x;
          target_z = this.z;
        } else {
          [target_x, target_z] = get_tile_center_world(OUTSIDE_HOUSE_TILE[0], OUTSIDE_HOUSE_TILE[1]);
        }
      } else if (is_frightened) {
        target_x = this.x;
        target_z = this.z;
      } else {
        [target_x, target_z] = this._get_target_tile({
          pacman_x,
          pacman_z,
          pacman_col: ctx.pacman_col ?? Math.floor(pacman_x + MAZE_COLS / 2),
          pacman_row: ctx.pacman_row ?? Math.floor(pacman_z + MAZE_ROWS / 2),
          pacman_dir_x: ctx.pacman_dir_x ?? 0,
          pacman_dir_z: ctx.pacman_dir_z ?? 0,
          blinky_col: ctx.blinky_col,
          blinky_row: ctx.blinky_row,
        });
      }
      const [dx, dz] = this._choose_direction(col, row, target_x, target_z, is_frightened);
      const turning = dx !== this.dir_x || dz !== this.dir_z;
      const was_rest = this.dir_x === 0 && this.dir_z === 0;
      this.dir_x = dx;
      this.dir_z = dz;
      if (turning || was_rest) {
        this.x = tile_cx;
        this.z = tile_cz;
      }
    }

    this.x += this.dir_x * speed * dt;
    this.z += this.dir_z * speed * dt;
  }


  get_transform() {
    return Mat4.translation(this.x, GHOST_Y, this.z)
      .times(Mat4.scale(GHOST_RADIUS, GHOST_RADIUS, GHOST_RADIUS));
  }

  /** Whether this ghost is in frightened state (for drawing color). */
  is_frightened(is_global_frightened) {
    return is_global_frightened && !this.eaten;
  }

  respawn() {
    const [x, z] = get_ghost_spawn_world(this.ghost_index);
    this.x = x;
    this.z = z;
    this.dir_x = 0;
    this.dir_z = 0;
    this.eaten = false;
    this.in_house = true;
    this.is_outside = this.ghost_index === 0;
    this.released = this.ghost_index === 0;
  }
}
