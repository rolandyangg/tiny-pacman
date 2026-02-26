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

/** Spawn position for ghost index 0..3 (world x, z). */
export function get_ghost_spawn_world(ghost_index) {
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
  }

  /** Choose next direction: chase (target pacman), scatter (target corner), or frightened (random). */
  _choose_direction(col, row, pacman_x, pacman_z, is_frightened) {
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
      // only option is reverse
      if (!is_wall(col + reverse[0], row + reverse[1])) return reverse;
      return [this.dir_x, this.dir_z]; // stay
    }

    if (is_frightened) {
      // Random move
      const idx = Math.floor(Math.random() * choices.length);
      return choices[idx];
    }

    let target_x, target_z;
    const mode = this._get_mode(); // 'chase' or 'scatter' (alternate by time later; for now chase only or simple timer)
    if (mode === 'scatter') {
      [target_x, target_z] = get_tile_center_world(this.scatter_target[0], this.scatter_target[1]);
    } else {
      target_x = pacman_x;
      target_z = pacman_z;
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

  /** Simple mode: chase for 20s, scatter for 7s, repeat (by animation time). */
  _get_mode() {
    // Use a simple time-based switch; could be driven by game time from caller later
    const t = (typeof this._game_time === 'number') ? this._game_time : 0;
    const cycle = t % 27;
    return cycle < 7 ? 'scatter' : 'chase';
  }

  update(dt, pacman_x, pacman_z, is_frightened, game_time) {
    this._game_time = game_time;
    const speed = is_frightened ? GHOST_FRIGHTENED_SPEED : GHOST_SPEED;
    const [col, row] = world_to_tile(this.x, this.z);
    const [tile_cx, tile_cz] = get_tile_center_world(col, row);

    // When stationary (dir 0,0), use a generous snap so we always pick a direction at spawn
    const at_rest = this.dir_x === 0 && this.dir_z === 0;
    const SNAP = at_rest ? 0.5 : 0.3;
    const near_center =
      Math.abs(this.x - tile_cx) < SNAP &&
      Math.abs(this.z - tile_cz) < SNAP;

    if (near_center) {
      const [dx, dz] = this._choose_direction(col, row, pacman_x, pacman_z, is_frightened);
      const turning = dx !== this.dir_x || dz !== this.dir_z;
      const was_rest = this.dir_x === 0 && this.dir_z === 0;
      this.dir_x = dx;
      this.dir_z = dz;
      // Only snap to tile center when turning or when starting from rest; otherwise we'd
      // snap every frame and the ghost would never leave the tile.
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
  }
}
