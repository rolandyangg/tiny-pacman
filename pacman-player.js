import {tiny} from './examples/common.js';
import {MAZE_GRID, MAZE_COLS, MAZE_ROWS} from './pacman-map.js';

const { Mat4 } = tiny;

export const PLAYER_SPEED  = 5.0;   // world-units per second (each tile = 1 unit)
export const PLAYER_RADIUS = 0.35;  // visual size
export const PLAYER_Y      = 0.35;  // height off the floor

// ---------------------------------------------------------------------------
// Coordinate helpers
// ---------------------------------------------------------------------------

/** Convert a world-space (x, z) position to tile (col, row) indices. */
export function world_to_tile(x, z) {
    const col = Math.floor(x + MAZE_COLS / 2);
    const row = Math.floor(z + MAZE_ROWS / 2);
    return [col, row];
}

/** Return the world-space center of a given tile. */
function tile_center(col, row) {
    return [
        col - MAZE_COLS / 2 + 0.5,
        row - MAZE_ROWS / 2 + 0.5,
    ];
}

/** Return true if (col, row) is a wall tile or outside the maze bounds. */
export function is_wall(col, row) {
    if (row < 0 || row >= MAZE_ROWS || col < 0 || col >= MAZE_COLS) return true;
    const line = (MAZE_GRID[row] ?? "").padEnd(MAZE_COLS, "1");
    return line[col] === "1";
}

// ---------------------------------------------------------------------------
// PacmanPlayer
// ---------------------------------------------------------------------------

export class PacmanPlayer {
    /**
     * @param {number} start_x  World-space X starting position
     * @param {number} start_z  World-space Z starting position
     */
    constructor(start_x, start_z) {
        this.x = start_x;
        this.z = start_z;

        // Active movement direction (tile-units: −1, 0, or +1 per axis)
        this.dir_x = 0;
        this.dir_z = 0;

        // Buffered next direction — applied the next time the player is
        // close to a tile centre, mimicking classic Pac-Man controls.
        this.next_dir_x = 0;
        this.next_dir_z = 0;
    }

    /** Called by WASD key handlers to request a direction change. */
    set_direction(dx, dz) {
        this.next_dir_x = dx;
        this.next_dir_z = dz;
    }

    /**
     * Advance the player by dt seconds.
     * Handles:
     *   - direction buffering / turning at tile centres
     *   - stopping cleanly when the next tile is a wall
     *   - continuous movement otherwise
     *
     * Key design: we only snap to the tile centre (and re-evaluate direction)
     * when the player is TURNING or hitting a wall. When continuing straight we
     * let the position run freely so the snap never fights the movement.
     */
    update(dt) {
        const [col, row]         = world_to_tile(this.x, this.z);
        const [tile_cx, tile_cz] = tile_center(col, row);

        // A generous threshold so we don't miss the window at full speed.
        // Only used for turns and wall-stops, NOT for straight-through motion.
        const SNAP = 0.25;
        const near_center =
            Math.abs(this.x - tile_cx) < SNAP &&
            Math.abs(this.z - tile_cz) < SNAP;

        if (near_center) {
            // ── Try to turn if the buffered direction differs from current ────
            const want_turn =
                this.next_dir_x !== this.dir_x ||
                this.next_dir_z !== this.dir_z;

            if (want_turn && (this.next_dir_x !== 0 || this.next_dir_z !== 0)) {
                const nc = col + this.next_dir_x;
                const nr = row + this.next_dir_z;
                if (!is_wall(nc, nr)) {
                    // Commit the turn — snap so the new axis starts clean
                    this.dir_x = this.next_dir_x;
                    this.dir_z = this.next_dir_z;
                    this.x    = tile_cx;
                    this.z    = tile_cz;
                }
            }

            // ── Stop if the tile ahead (in current direction) is a wall ──────
            // Only stop; don't snap when going straight through an open tile.
            if (this.dir_x !== 0 || this.dir_z !== 0) {
                const nc = col + this.dir_x;
                const nr = row + this.dir_z;
                if (is_wall(nc, nr)) {
                    this.dir_x = 0;
                    this.dir_z = 0;
                    this.x    = tile_cx;
                    this.z    = tile_cz;
                }
            }
        }

        // Move — unthrottled when going straight so no oscillation occurs
        this.x += this.dir_x * PLAYER_SPEED * dt;
        this.z += this.dir_z * PLAYER_SPEED * dt;
    }

    /** Returns the model-matrix used to draw the player sphere. */
    get_transform() {
        return Mat4.translation(this.x, PLAYER_Y, this.z)
            .times(Mat4.scale(PLAYER_RADIUS, PLAYER_RADIUS, PLAYER_RADIUS));
    }
}