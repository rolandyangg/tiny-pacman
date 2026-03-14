import {tiny} from './examples/common.js';
import {MAZE_GRID, MAZE_COLS, MAZE_ROWS} from './pacman-map.js';

const { Mat4 } = tiny;

export const PLAYER_SPEED  = 5.0;   // world-units per second (each tile = 1 unit)
export const PLAYER_RADIUS = 0.35;  // visual size
export const PLAYER_Y      = 0.35;  // height off the floor

// ── Wall-bounce constants ──────────────────────────────────────────────────
// Mirrors the penalty-spring / hard-correction system in part_one_spring.js.
// The tile boundary acts as the collision surface (analogous to the y=0 ground
// plane), and BOUNCE_RESTITUTION matches the role of RESTITUTION in
// Simulator.apply_ground_correction(): fraction of speed kept after impact.
//   0.0 = absorb fully (old stop behaviour, no visible bounce)
//   1.0 = perfectly elastic (bounces forever)
//   0.55 gives a single snappy pop back to centre that dies quickly.
const BOUNCE_RESTITUTION = 0.55;

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

        // last known facing direction (for first person camera)
        this.last_dir_x = 0;
        this.last_dir_z = -1;

        // Buffered next direction — applied the next time the player is
        // close to a tile centre, mimicking classic Pac-Man controls.
        this.next_dir_x = 0;
        this.next_dir_z = 0;

        // ── Wall-bounce state ──────────────────────────────────────────────
        // null  → not bouncing (normal movement)
        // object → player is executing a penalty bounce against a wall face,
        //          analogous to a particle penetrating the ground in
        //          part_one_spring.js.  Fields:
        //   col/row        — origin tile indices (for is_wall checks during bounce)
        //   vel            — signed scalar speed along the bounce axis
        //                    (+ = toward wall, − = returning to centre)
        //   dir_x / dir_z  — unit movement direction at bounce start
        //   tile_cx/cz     — world centre of the origin tile (return target)
        //   wall_face_x/z  — world position of the tile boundary (collision surface)
        this._bounce = null;
    }

    /** Called by WASD key handlers to request a direction change. */
    set_direction(dx, dz) {
        this.next_dir_x = dx;
        this.next_dir_z = dz;
    }

    /**
     * Advance the player by dt seconds.
     *
     * When a wall is detected ahead at tile-centre, the player no longer stops
     * dead — instead _start_bounce() launches a penalty-bounce: the player
     * overshoots the centre, strikes the wall face, and is reflected back with
     * BOUNCE_RESTITUTION, landing cleanly at the tile centre.  This is the 1-D
     * horizontal analogue of the ground-penalty + apply_ground_correction()
     * pipeline in part_one_spring.js.
     */
    update(dt) {
        // ── Delegate to bounce handler while a bounce is in progress ──────
        if (this._bounce) {
            this._update_bounce(dt);
            return;
        }

        const [col, row]         = world_to_tile(this.x, this.z);
        const [tile_cx, tile_cz] = tile_center(col, row);

        // A generous threshold so we don't miss the window at full speed.
        // Only used for turns and wall-stops, NOT for straight-through motion.
        const SNAP = 0.25;
        const near_center =
            Math.abs(this.x - tile_cx) < SNAP &&
            Math.abs(this.z - tile_cz) < SNAP;

        if (near_center) {
            // ── Try to turn if the buffered direction differs from current ─
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

            // ── Wall ahead: launch a penalty bounce instead of stopping ───
            // Previously: zero dir and snap.  Now: the player overshoot the
            // centre, strikes the wall face, and springs back — matching the
            // penalty-surface behaviour from part_one_spring.js.
            if (this.dir_x !== 0 || this.dir_z !== 0) {
                const nc = col + this.dir_x;
                const nr = row + this.dir_z;
                if (is_wall(nc, nr)) {
                    this._start_bounce(col, row, tile_cx, tile_cz);
                    return; // movement this frame is handled inside _start_bounce
                }
            }
        }

        // Track last facing direction so the first-person camera always has a vector
        if (this.dir_x !== 0 || this.dir_z !== 0) {
            this.last_dir_x = this.dir_x;
            this.last_dir_z = this.dir_z;
        }

        // Move — unthrottled when going straight so no oscillation occurs
        this.x += this.dir_x * PLAYER_SPEED * dt;
        this.z += this.dir_z * PLAYER_SPEED * dt;
    }

    // ── Initiate a wall-bounce from the current tile centre ────────────────
    //
    // Analogous to a particle entering ground contact in part_one_spring.js:
    // the tile boundary (half a unit ahead in the movement direction) becomes
    // the penalty collision surface.  The player is snapped to the tile centre
    // to start the bounce cleanly, just as apply_ground_correction() snaps
    // penetrating particles back to y = 0.
    _start_bounce(col, row, tile_cx, tile_cz) {
        this._bounce = {
            col,  row,                               // origin tile (for is_wall checks)
            vel:         PLAYER_SPEED,               // scalar: + toward wall, − returning
            dir_x:       this.dir_x,
            dir_z:       this.dir_z,
            tile_cx,     tile_cz,                    // return-to target
            wall_face_x: tile_cx + this.dir_x * 0.5, // tile boundary = collision surface
            wall_face_z: tile_cz + this.dir_z * 0.5,
        };

        // Preserve facing so the first-person camera doesn't snap
        this.last_dir_x = this.dir_x;
        this.last_dir_z = this.dir_z;

        // Stop normal dir-based movement; bounce drives position directly
        this.dir_x = 0;
        this.dir_z = 0;

        // Start the bounce from a clean tile centre
        this.x = tile_cx;
        this.z = tile_cz;
    }

    // ── Per-frame bounce integration ───────────────────────────────────────
    //
    // Implements the same hard-correction + restitution strategy as
    // Simulator.apply_ground_correction() in part_one_spring.js, collapsed
    // onto a 1-D axis (the movement direction) instead of the Y axis:
    //
    //   Phase 1 — outbound:  player advances toward the wall face at PLAYER_SPEED.
    //   Collision:           on crossing the face, snap to surface and reflect
    //                        velocity with BOUNCE_RESTITUTION (vel = −|vel| × R).
    //   Phase 2 — inbound:   player returns toward tile centre at reduced speed.
    //   Resolution:          once past the centre, snap and clear bounce state.
    //
    // During the inbound phase a valid queued turn is honoured immediately so
    // the player doesn't feel glued to the wall after a last-moment input.
    _update_bounce(dt) {
        const b = this._bounce;

        // ── Advance position along the bounce axis ─────────────────────────
        this.x += b.dir_x * b.vel * dt;
        this.z += b.dir_z * b.vel * dt;

        // ── Hard wall-face correction (mirrors apply_ground_correction) ────
        // Penetration depth along movement axis; positive = inside wall tile.
        const pen =
            (this.x - b.wall_face_x) * b.dir_x +
            (this.z - b.wall_face_z) * b.dir_z;

        if (pen > 0) {
            // 1. Snap position back to the wall surface (no clipping)
            this.x = b.wall_face_x;
            this.z = b.wall_face_z;

            // 2. Reflect velocity with restitution — the exact operation
            //    apply_ground_correction() applies to the Y component:
            //      vel[1] = -vel[1] * RESTITUTION
            //    here applied to the scalar bounce speed on the movement axis.
            b.vel = -Math.abs(b.vel) * BOUNCE_RESTITUTION;
        }

        // ── Inbound phase: check for resolution ───────────────────────────
        if (b.vel < 0) {
            // Allow early turn-exit: if the player queued a valid new direction
            // while bouncing, honour it as soon as we're close enough to centre.
            const SNAP = 0.25;
            const near_origin =
                Math.abs(this.x - b.tile_cx) < SNAP &&
                Math.abs(this.z - b.tile_cz) < SNAP;

            if (near_origin &&
                (this.next_dir_x !== 0 || this.next_dir_z !== 0) &&
                (this.next_dir_x !== b.dir_x || this.next_dir_z !== b.dir_z)) {

                const nc = b.col + this.next_dir_x;
                const nr = b.row + this.next_dir_z;
                if (!is_wall(nc, nr)) {
                    // Commit the queued turn and end bounce immediately
                    this.x = b.tile_cx;
                    this.z = b.tile_cz;
                    this.dir_x      = this.next_dir_x;
                    this.dir_z      = this.next_dir_z;
                    this.last_dir_x = this.dir_x;
                    this.last_dir_z = this.dir_z;
                    this._bounce    = null;
                    return;
                }
            }

            // Normal resolution: once position passes back through tile centre,
            // snap and clear bounce state (player is stationary, ready to move).
            const past_center =
                (this.x - b.tile_cx) * b.dir_x +
                (this.z - b.tile_cz) * b.dir_z;

            if (past_center <= 0) {
                this.x       = b.tile_cx;
                this.z       = b.tile_cz;
                this._bounce = null;
                // dir_x/z remain 0 — player is stopped at centre, awaiting input
            }
        }
    }

    /** Returns the model-matrix used to draw the player sphere. */
    get_transform() {
        return Mat4.translation(this.x, PLAYER_Y, this.z)
            .times(Mat4.scale(PLAYER_RADIUS, PLAYER_RADIUS, PLAYER_RADIUS));
    }
}