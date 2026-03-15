import {tiny} from './examples/common.js';
import {world_to_tile} from './pacman-player.js';
import {CatmullRomSpline} from './spline.js';

const { vec3 } = tiny;

// ── Config ────────────────────────────────────────────────────────────────────
const DCFG = {
    // How long each shot is held before the director considers a new one
    MIN_HOLD:           3.5,
    MAX_HOLD:           7.0,

    // How quickly the internal facing direction catches up to Pac-Man's actual direction
    DIR_SMOOTHING:      5.0,

    // How quickly the camera eye position lerps toward its target each frame
    EYE_SMOOTHING:      6.0,

    FOLLOW_HEIGHT:      8.0,
    FOLLOW_DIST:        6.0,
    FOLLOW_SIDE_OFFSET: 4.0,

    FP_EYE_HEIGHT:      0.55,
    FP_LOOK_DIST:       1.0,

    CLOSE_FOLLOW_HEIGHT: 5.0,
    CLOSE_FOLLOW_DIST:   3.5,

    OVERHEAD_HEIGHT:    12.0,

    NEAR_GHOST_HEIGHT:  3.0,
    NEAR_GHOST_DIST:    1.5,

    GHOST_APPROACH_HEIGHT: 3.5,
    GHOST_APPROACH_DIST:   2.5,

    // ── Event detection ───────────────────────────────────────────────

    // Tile distance at which a ghost triggers a GHOST_APPROACH cut
    APPROACH_CUT_RADIUS:  3,

    // Tile distance at which a ghost triggers a NEAR_GHOST cut
    TENSION_CUT_RADIUS:   4,

    // How long to hold a shot after an event-triggered cut
    EVENT_HOLD:           2.5,

    // ── Spline arc ────────────────────────────────────────────────────────────

    // Lateral and vertical offset of the CR phantom endpoints (P0, P3)
    ARC_SWING:          2.5,
    ARC_LIFT:           1.8,
    OVERHEAD_ENTRY_Y:   15.0,

    // min floor for all eye positions
    MIN_EYE_HEIGHT:     4.5,
};

// ── Shot type identifiers ─────────────────────────────────────────────────────
const SHOT = {
    FOLLOW_BEHIND:   'follow_behind',    // elevated trailing behind Pac-Man
    FOLLOW_SIDE:     'follow_side',      // elevated flanking Pac-Man to one side
    FIRST_PERSON:    'first_person',     // at pac man's eye level looking ahead
    CLOSE_FOLLOW:    'close_follow',     // low and close behind shoulder cam
    OVERHEAD:        'overhead',         // directly above pac man looking straight down
    NEAR_GHOST:      'near_ghost',       // camera near a ghost looking at Pac-man
    GHOST_APPROACH:  'ghost_approach',   // behind a ghost as it closes in on Pac-man
};

// Define which shots transition via CR spline
const SPLINE_SHOTS = new Set([SHOT.GHOST_APPROACH, SHOT.NEAR_GHOST]);

// ── Math helpers ──────────────────────────────────────────────────────────────
// normalized direction vector
function norm2(dx, dz) {
    const len = Math.sqrt(dx*dx + dz*dz) || 1;
    return [dx/len, dz/len];
}

// vector perpendicular to (dx, dz)
function perp(dx, dz) { return [-dz, dx]; }

// Clamps a vec3's Y component to a minimum value
function clamp_y(v, min_y) {
    return v[1] < min_y ? vec3(v[0], min_y, v[2]) : v;
}

// ── Director ──────────────────────────────────────────────────────────────────
// Decides which camera shot to show and when to switch.
// Each frame it checks for events (ghost nearby, life lost)
// immediate cut, or CR spline to the new position on change
export class Director {
    constructor() { this.reset(); }

    reset() {
        this._hold_timer  = 0;          // time remaining on the current shot
        this._last_type   = null;       // shot type currently being shown

        // CR spline config
        this._spline      = null;
        this._ride_t      = 0;

        this._fixed_eye   = null;       // eye position for non-spline shots (updated each frame)
        this._at          = null;       // where the camera is looking

        this._event_hold  = 0;          // suppresses re-triggering after an event cut
        this._prev_lives  = null;       // used to detect when a life is lost

        this._last_eye    = vec3(0, 50, 0);     // eye target (used for spline P1)
        this._current_eye = vec3(0, 50, 0);     // actual eye position after lerping

        // (dx,dy) to smooth camera and avoid snapping whenever he turns a corner
        this._smooth_dx   = 0;
        this._smooth_dz   = -1;

        this._side_sign   = 1;
        this._nearest     = null;
    }

    update(dt, game_state) {
        this._hold_timer -= dt;
        this._event_hold -= dt;

        // 1. smooth the facing direction toward player direction.
        const raw_dx = game_state.player_dx || 0;
        const raw_dz = game_state.player_dz || -1;
        const k      = DCFG.DIR_SMOOTHING * dt;
        this._smooth_dx += (raw_dx - this._smooth_dx) * k;
        this._smooth_dz += (raw_dz - this._smooth_dz) * k;

        // cache the nearest active ghost (performance opt, avoid rescanning)
        this._nearest = this._find_nearest_ghost(game_state);

        // 2. update camera dir if fixed eye so it's pointing toward pacman
        this._update_fixed_eye(game_state);

        // 3. Check game events, decide if a cut should occur
        const event = this._check_events(game_state);
        // if theres an event, or the hold timer is finished, or we're not mid shot
        const should_cut =
            event !== null ||
            this._hold_timer <= 0 ||
            (!this._spline && !this._fixed_eye);

        if (should_cut) {
            // DFCG overrides for hold duration, and shot preferences
            const preferred = event?.preferred_type ?? null;
            const hold      = event?.hold_override  ?? null;
            this._cut(game_state, preferred, hold);
        }

        // 4: if on spline, compute raw target eye position
        let target_eye;
        if (this._spline) {
            // spline is paced so we finish mid hold
            const avg_hold = (DCFG.MIN_HOLD + DCFG.MAX_HOLD) * 0.5;
            this._ride_t   = Math.min(1, this._ride_t + dt / avg_hold);
            target_eye     = this._spline.compute_position(this._ride_t);
        } else {
            // update with fixed eye direction (toward pacman)
            target_eye = this._fixed_eye ?? this._last_eye;
        }

        // clamp to min height if we're somehow below it
        if (target_eye[1] < DCFG.MIN_EYE_HEIGHT) {
            target_eye = vec3(target_eye[0], DCFG.MIN_EYE_HEIGHT, target_eye[2]);
        }

        // 5: lerp the camera eye toward the target.
        // (so it softens turns since pacman snaps to 90 deg directions)
        const lerp_k = Math.min(1, DCFG.EYE_SMOOTHING * dt);
        this._current_eye = vec3(
            this._current_eye[0] + (target_eye[0] - this._current_eye[0]) * lerp_k,
            this._current_eye[1] + (target_eye[1] - this._current_eye[1]) * lerp_k,
            this._current_eye[2] + (target_eye[2] - this._current_eye[2]) * lerp_k,
        );

        // _last_eye stores the un-lerped target so spline P1 is always accurate
        this._last_eye = target_eye;

        // 6: compute the look-at point
        if (this._last_type === SHOT.FIRST_PERSON) {
            // use smoothed facing direction for first person
            this._at = vec3(
                game_state.player_x + this._smooth_dx * DCFG.FP_LOOK_DIST,
                DCFG.FP_EYE_HEIGHT,
                game_state.player_z + this._smooth_dz * DCFG.FP_LOOK_DIST
            );
        } else {
            // look to bottom of pacman otherwise
            this._at = vec3(game_state.player_x, 0.35, game_state.player_z);
        }

        return { eye: this._current_eye, at: this._at };
    }

    // ── Fixed eye update ──────────────────────────────────────────────────────
    // For shots that don't ride a spline
    // using the current smoothed facing direction and Pac-Man's position
    _update_fixed_eye(gs) {
        if (!this._fixed_eye || !this._last_type) return;

        const px         = gs.player_x;
        const pz         = gs.player_z;
        const fdx        = this._smooth_dx;
        const fdz        = this._smooth_dz;
        const [sx, sz]   = perp(fdx, fdz);

        switch (this._last_type) {
            case SHOT.FOLLOW_BEHIND:
                this._fixed_eye = vec3(
                    px - fdx * DCFG.FOLLOW_DIST,
                    DCFG.FOLLOW_HEIGHT,
                    pz - fdz * DCFG.FOLLOW_DIST
                );
                break;

            case SHOT.FOLLOW_SIDE:
                // _side_sign is locked at cut time so the camera stays on the
                // same side for the duration of the shot even as Pac-Man turns
                this._fixed_eye = vec3(
                    px + sx * this._side_sign * DCFG.FOLLOW_SIDE_OFFSET,
                    DCFG.FOLLOW_HEIGHT,
                    pz + sz * this._side_sign * DCFG.FOLLOW_SIDE_OFFSET
                );
                break;

            case SHOT.CLOSE_FOLLOW:
                this._fixed_eye = vec3(
                    px - fdx * DCFG.CLOSE_FOLLOW_DIST,
                    DCFG.CLOSE_FOLLOW_HEIGHT,
                    pz - fdz * DCFG.CLOSE_FOLLOW_DIST
                );
                break;

            case SHOT.FIRST_PERSON:
                this._fixed_eye = vec3(px, DCFG.FP_EYE_HEIGHT, pz);
                break;
        }
    }

    // ── Event detection ───────────────────────────────────────────────────────
    // Checks whether anything happening in the game right now warrants a new shot
    _check_events(gs) {
        if (this._event_hold > 0) return null;

        const [pac_col, pac_row] = world_to_tile(gs.player_x, gs.player_z);

        for (const ghost of gs.ghosts) {
            if (ghost.in_house || ghost.eaten || gs.frightened_timer > 0) continue;

            const [ghost_col, ghost_row] = world_to_tile(ghost.x, ghost.z);
            const tile_dist = Math.abs(ghost_col - pac_col) + Math.abs(ghost_row - pac_row);

            if (tile_dist <= DCFG.APPROACH_CUT_RADIUS) {
                //event 1: Ghost is close, cut to a camera trailing behind it
                return { preferred_type: SHOT.GHOST_APPROACH, hold_override: DCFG.EVENT_HOLD };
            }
            if (tile_dist <= DCFG.TENSION_CUT_RADIUS) {
                //event 2: Ghost is nearby, cut to a camera near the ghost looking at Pac-Man
                return { preferred_type: SHOT.NEAR_GHOST, hold_override: DCFG.EVENT_HOLD };
            }
        }

        // event 3: Life just lost, cut to overhead to show the full board
        if (this._prev_lives !== null && gs.lives < this._prev_lives) {
            this._prev_lives = gs.lives;
            return { preferred_type: SHOT.OVERHEAD, hold_override: DCFG.EVENT_HOLD * 2 };
        }

        this._prev_lives = gs.lives;
        return null;
    }

    // ── Cut ───────────────────────────────────────────────────────────────────
    // Switch to new shot
    _cut(gs, preferred_type, hold_override) {
        const type     = preferred_type ?? this._random_shot(gs);
        this._last_type = type;

        const px       = gs.player_x;
        const pz       = gs.player_z;
        const fdx      = this._smooth_dx;
        const fdz      = this._smooth_dz;
        const [sx, sz] = perp(fdx, fdz);
        const ghost    = this._nearest;

        // Compute the target eye for this shot
        let target_eye;
        switch (type) {
            case SHOT.FOLLOW_BEHIND:
                target_eye = vec3(px - fdx * DCFG.FOLLOW_DIST, DCFG.FOLLOW_HEIGHT, pz - fdz * DCFG.FOLLOW_DIST);
                break;

            case SHOT.FOLLOW_SIDE:
                // Pick a side randomly and remember it for _update_fixed_eye
                this._side_sign = Math.random() < 0.5 ? 1 : -1;
                target_eye = vec3(
                    px + sx * this._side_sign * DCFG.FOLLOW_SIDE_OFFSET,
                    DCFG.FOLLOW_HEIGHT,
                    pz + sz * this._side_sign * DCFG.FOLLOW_SIDE_OFFSET
                );
                break;

            case SHOT.FIRST_PERSON:
                target_eye = vec3(px, DCFG.FP_EYE_HEIGHT, pz);
                break;

            case SHOT.CLOSE_FOLLOW:
                target_eye = vec3(px - fdx * DCFG.CLOSE_FOLLOW_DIST, DCFG.CLOSE_FOLLOW_HEIGHT, pz - fdz * DCFG.CLOSE_FOLLOW_DIST);
                break;

            case SHOT.OVERHEAD:
                target_eye = vec3(px, DCFG.OVERHEAD_HEIGHT, pz);
                break;

            case SHOT.NEAR_GHOST: {
                // camera just behind the ghost, pointed toward Pac-Man
                if (!ghost) { target_eye = vec3(px, DCFG.FOLLOW_HEIGHT, pz); break; }
                const [ndx, ndz] = norm2(px - ghost.x, pz - ghost.z);
                target_eye = vec3(
                    ghost.x - ndx * DCFG.NEAR_GHOST_DIST,
                    DCFG.NEAR_GHOST_HEIGHT,
                    ghost.z - ndz * DCFG.NEAR_GHOST_DIST
                );
                break;
            }

            case SHOT.GHOST_APPROACH: {
                // Trail behind the ghost along the vector from ghost toward Pac-Man
                if (!ghost) { target_eye = vec3(px, DCFG.FOLLOW_HEIGHT, pz); break; }
                const [ndx, ndz] = norm2(px - ghost.x, pz - ghost.z);
                target_eye = vec3(
                    ghost.x - ndx * DCFG.GHOST_APPROACH_DIST,
                    DCFG.GHOST_APPROACH_HEIGHT,
                    ghost.z - ndz * DCFG.GHOST_APPROACH_DIST
                );
                break;
            }

            default:
                target_eye = vec3(px, DCFG.FOLLOW_HEIGHT, pz);
        }

        // Decide whether to spline or snap
        const entering_from_overhead = this._last_eye[1] >= DCFG.OVERHEAD_ENTRY_Y;
        if (SPLINE_SHOTS.has(type) || entering_from_overhead) {
            this._spline    = this._build_spline(target_eye, entering_from_overhead);
            this._ride_t    = 0;
            this._fixed_eye = null;
        } else {
            this._fixed_eye = clamp_y(target_eye, DCFG.MIN_EYE_HEIGHT);
            this._spline    = null;
        }

        // Set hold duration
        const random_hold = DCFG.MIN_HOLD + Math.random() * (DCFG.MAX_HOLD - DCFG.MIN_HOLD);
        this._hold_timer  = hold_override ?? random_hold;
        if (hold_override) this._event_hold = hold_override;
    }

    // ── Spline builder ────────────────────────────────────────────────────────
    // Builds CR spline from the current eye position (P1) to the target (P2).
    // P0 and P3 phantom endpoints offset by DFCG
    _build_spline(target_eye, wide_arc = false) {
        // Wide arc used on overhead entries for a more dramatic opening sweep
        const swing = DCFG.ARC_SWING * (wide_arc ? 1.5 : 1.0);
        const lift  = DCFG.ARC_LIFT  * (wide_arc ? 1.2 : 1.0);

        const [sx, sz] = perp(this._smooth_dx, this._smooth_dz);

        const P1 = this._last_eye;
        const P2 = clamp_y(target_eye, DCFG.MIN_EYE_HEIGHT);

        // P0 offset
        const P0 = clamp_y(
            P1.plus(vec3(sx * swing, lift, sz * swing)),
            DCFG.MIN_EYE_HEIGHT
        );

        // P3 offset
        const P3 = clamp_y(
            P2.plus(vec3(-sx * swing * 0.5, lift * 0.3, -sz * swing * 0.5)),
            DCFG.MIN_EYE_HEIGHT
        );

        const spline = new CatmullRomSpline();
        spline.add_point(P0);
        spline.add_point(P1);
        spline.add_point(P2);
        spline.add_point(P3);
        return spline;
    }

    // ── Shot selection ────────────────────────────────────────────────────────
    // Pick a random shot from the available pool, except the curr one
    _random_shot(gs) {
        const has_active_ghosts = gs.ghosts.some(g => !g.in_house && !g.eaten);

        const pool = [
            SHOT.FOLLOW_BEHIND,
            SHOT.FOLLOW_SIDE,
            SHOT.CLOSE_FOLLOW,
            SHOT.FIRST_PERSON,
            SHOT.OVERHEAD,
        ];

        if (has_active_ghosts) {
            pool.push(SHOT.NEAR_GHOST);
            pool.push(SHOT.GHOST_APPROACH);
        }

        const options = pool.filter(type => type !== this._last_type);
        return options[Math.floor(Math.random() * options.length)];
    }

    // Returns the active ghost closest to Pac-Man by Manhattan tile distance
    _find_nearest_ghost(gs) {
        const [pac_col, pac_row] = world_to_tile(gs.player_x, gs.player_z);
        let nearest      = null;
        let nearest_dist = Infinity;

        for (const ghost of gs.ghosts) {
            if (ghost.in_house || ghost.eaten) continue;
            const [gc, gr] = world_to_tile(ghost.x, ghost.z);
            const dist     = Math.abs(gc - pac_col) + Math.abs(gr - pac_row);
            if (dist < nearest_dist) { nearest_dist = dist; nearest = ghost; }
        }

        return nearest;
    }
}