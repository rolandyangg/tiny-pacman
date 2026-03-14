import {tiny} from './examples/common.js';
import {is_wall, world_to_tile} from './pacman-player.js';
import {MAZE_COLS, MAZE_ROWS, get_tile_center_world} from './pacman-map.js';
import {CatmullRomSpline} from './spline.js';

const { vec3 } = tiny;

// Director config
const DCFG = {
    // Timing parameters
    MIN_HOLD:           3.5,
    MAX_HOLD:           7.0,

    // Ghost action parameters
    DRAMA_GHOST_RADIUS: 4,
    DRAMA_HOLD:         2.5,

    // Scoring parameters
    REPEAT_PENALTY:     30,
    TIEBREAK_SCALE:     10,

    // Camera offset parameters
    POSITIONAL_HEIGHT:        8.0,
    POSITIONAL_DIST:          6.0,
    POSITIONAL_SIDE_OFFSET:   4.0,

    // Reaction event parameters 1
    REACTION_HEIGHT:          3.0,
    REACTION_DIST:            1.5,

    // Reaction event parameters 2
    STRATEGIC_HEIGHT:         12.0,
    STRATEGIC_DIST:           5.0,

    // First person camera parameters
    FP_EYE_HEIGHT:            0.55,
    FP_LOOK_DIST:             1.0,

    // Third person camera parameters
    TP_HEIGHT:                5.0,
    TP_FOLLOW_DIST:           3.5,

    // Ghost chase camera parameters
    GHOST_CHASE_HEIGHT:       3.5,
    GHOST_CHASE_FOLLOW_DIST:  2.5,
    GHOST_CHASE_RADIUS:       3,

    // Turning smoothing
    DIR_SMOOTHING:      5.0,

    // Spline arc parameters
    DRAMATIC_SWING:           2.5,
    DRAMATIC_LIFT:            1.8,

    // Overhead camera parameters
    OVERHEAD_ENTRY_THRESHOLD: 15.0,

    // Min camera parameters
    MIN_EYE_HEIGHT:     4.5,
    MIN_SWEEP_HEIGHT:   4.0,

    // Spline wall validation
    SPLINE_VALIDATE_STEPS: 10,
    SPLINE_MAX_RETRIES:    3,

    // Shot cutoffs
    MIN_CUT_DISTANCE:   5.0,
    PROXIMITY_PENALTY:  60,

    // Line of sight parameters
    LOS_STEPS:          12,
    LOS_PENALTY:        45,
};

// Junction cache
// (get junctions from maze, to act as first camera position)
let _junction_cache = null;
function get_junctions() {
    if (_junction_cache) return _junction_cache;
    _junction_cache = [];
    const dirs = [[1,0],[-1,0],[0,1],[0,-1]];
    for (let row = 1; row < MAZE_ROWS - 1; row++) {
        for (let col = 1; col < MAZE_COLS - 1; col++) {
            if (is_wall(col, row)) continue;
            const open = dirs.filter(([dx,dz]) => !is_wall(col+dx, row+dz)).length;
            if (open >= 3) _junction_cache.push([col, row]);
        }
    }
    return _junction_cache;
}

// Shot type identifiers
// (If anyone wants you can define more shots here that the director can use based on scores)
const SHOT = {
    POSITIONAL_BEHIND: 'positional_behind',
    POSITIONAL_SIDE:   'positional_side',
    REACTION:          'reaction',
    STRATEGIC:         'strategic',
    FIRST_PERSON:      'first_person',
    THIRD_PERSON:      'third_person',
    GHOST_CHASE:       'ghost_chase',
};

const CR_SHOTS = new Set([SHOT.GHOST_CHASE, SHOT.REACTION]);

// Normal vector helper
function norm2(dx, dz) {
    const len = Math.sqrt(dx*dx + dz*dz) || 1;
    return [dx/len, dz/len];
}

// Perpendicular vector helper
function perp(dx, dz) { return [-dz, dx]; }

// Y clamp helper (so it doesnt clip through the floor)
function clamp_y(v, min_y) {
    return v[1] < min_y ? vec3(v[0], min_y, v[2]) : v;
}

// Function to determine if the camera can see pacman
// penalizes shot scores if pacman is obfuscated
function has_line_of_sight(eye_x, eye_z, player_x, player_z) {
    for (let i = 1; i <= DCFG.LOS_STEPS; i++) {
        const t  = i / DCFG.LOS_STEPS;
        const wx = eye_x + (player_x - eye_x) * t;
        const wz = eye_z + (player_z - eye_z) * t;
        const [col, row] = world_to_tile(wx, wz);
        if (is_wall(col, row)) return false;
    }
    return true;
}

// Validates if the spline passes through a legal path
// (If not in a wall or through the floor)
function spline_is_clear(spline) {
    for (let i = 0; i <= DCFG.SPLINE_VALIDATE_STEPS; i++) {
        const pos = spline.compute_position(i / DCFG.SPLINE_VALIDATE_STEPS);
        const [col, row] = world_to_tile(pos[0], pos[2]);
        if (is_wall(col, row)) return false;
    }
    return true;
}

// Lift shot spline builder
function build_straight_lift_spline(P1, P2, lift) {
    const spline = new CatmullRomSpline();
    spline.add_point(clamp_y(P1.plus(vec3(0, lift, 0)),       DCFG.MIN_SWEEP_HEIGHT));
    spline.add_point(P1);
    spline.add_point(P2);
    spline.add_point(clamp_y(P2.plus(vec3(0, lift * 0.5, 0)), DCFG.MIN_SWEEP_HEIGHT));
    return spline;
}

// Director class
export class Director {
    constructor() {
        this.reset();
        get_junctions();
    }

    reset() {
        this._hold_timer    = 0;
        this._hold_duration = 0;
        this._last_type     = null;
        this._spline        = null;
        this._ride_t        = 0;
        this._fixed_eye     = null;
        this._current_at    = null;
        this._prev_lives    = null;
        this._drama_hold    = 0;
        this._last_eye      = vec3(0, 50, 0);

        this._smooth_dx     = 0;
        this._smooth_dz     = -1;
    }

    update(dt, game_state) {
        // Update time of this shot
        this._hold_timer -= dt;
        this._drama_hold -= dt;

        // Smooth the facing direction
        const fdx = game_state.player_dx || 0;
        const fdz = game_state.player_dz || -1;
        const k   = DCFG.DIR_SMOOTHING * dt;
        this._smooth_dx += (fdx - this._smooth_dx) * k;
        this._smooth_dz += (fdz - this._smooth_dz) * k;

        // Check for points of interest (drama)
        const drama      = this._check_drama(game_state);
        const should_cut =
            drama !== null        ||
            this._hold_timer <= 0 ||
            (this._spline === null && this._fixed_eye === null);

        if (should_cut) {
            // Cut if there's a more interesting shot occuring
            this._cut(game_state, drama?.preferred_type ?? null, drama?.hold_override ?? null);
        }

        // Resolve eye
        let eye;
        if (this._spline) {
            if (this._hold_duration > 0) {
                this._ride_t = Math.min(1, 1 - (this._hold_timer / this._hold_duration));
            }
            eye = this._spline.compute_position(this._ride_t);
        } else {
            // Recompute eye when pacman turns
            eye = this._compute_fixed_eye(game_state);
        }

        if (eye[1] < DCFG.MIN_EYE_HEIGHT) eye = vec3(eye[0], DCFG.MIN_EYE_HEIGHT, eye[2]);
        this._last_eye = eye;

        // First person camera shot
        if (this._last_type === SHOT.FIRST_PERSON) {
            this._current_at = vec3(
                game_state.player_x + this._smooth_dx * DCFG.FP_LOOK_DIST,
                DCFG.FP_EYE_HEIGHT,
                game_state.player_z + this._smooth_dz * DCFG.FP_LOOK_DIST
            );
        } else {
            this._current_at = vec3(game_state.player_x, 0.35, game_state.player_z);
        }

        return { eye, at: this._current_at };
    }

    // Fixed eye compute helper
    _compute_fixed_eye(gs) {
        if (this._last_type === null) return this._last_eye;

        const px  = gs.player_x;
        const pz  = gs.player_z;
        const fdx = this._smooth_dx;
        const fdz = this._smooth_dz;
        const [sx, sz] = perp(fdx, fdz);

        switch (this._last_type) {
            case SHOT.POSITIONAL_BEHIND:
                return clamp_y(
                    vec3(px - fdx * DCFG.POSITIONAL_DIST, DCFG.POSITIONAL_HEIGHT, pz - fdz * DCFG.POSITIONAL_DIST),
                    DCFG.MIN_EYE_HEIGHT
                );

            case SHOT.POSITIONAL_SIDE:
                // Preserve which side was originally chosen
                return clamp_y(
                    vec3(px + sx * this._fixed_side_sign * DCFG.POSITIONAL_SIDE_OFFSET, DCFG.POSITIONAL_HEIGHT, pz + sz * this._fixed_side_sign * DCFG.POSITIONAL_SIDE_OFFSET),
                    DCFG.MIN_EYE_HEIGHT
                );

            case SHOT.FIRST_PERSON:
                return vec3(px, DCFG.FP_EYE_HEIGHT, pz);

            case SHOT.THIRD_PERSON:
                return clamp_y(
                    vec3(px - fdx * DCFG.TP_FOLLOW_DIST, DCFG.TP_HEIGHT, pz - fdz * DCFG.TP_FOLLOW_DIST),
                    DCFG.MIN_EYE_HEIGHT
                );

            case SHOT.STRATEGIC:
                // Strategic shots are fixed
                return this._fixed_eye ?? this._last_eye;

            default:
                return this._fixed_eye ?? this._last_eye;
        }
    }

    // Drama helpers
    // Score each potential candidate shot base on what's happening in the scene
    _check_drama(gs) {
        const [pc, pr] = world_to_tile(gs.player_x, gs.player_z);
        for (const g of gs.ghosts) {
            if (g.in_house || g.eaten || gs.frightened_timer > 0) continue;
            const [gc, gr] = world_to_tile(g.x, g.z);
            const d = Math.abs(gc - pc) + Math.abs(gr - pr);
            if (d <= DCFG.GHOST_CHASE_RADIUS && this._drama_hold <= 0)
                // If a ghost is nearby and likely to be chased, switch to ghost_chase cam
                return { preferred_type: SHOT.GHOST_CHASE, hold_override: DCFG.DRAMA_HOLD };
            if (d <= DCFG.DRAMA_GHOST_RADIUS && this._drama_hold <= 0)
                // Otherwise use reaction cam
                return { preferred_type: SHOT.REACTION,    hold_override: DCFG.DRAMA_HOLD };
        }
        if (this._prev_lives !== null && gs.lives < this._prev_lives) {
            this._prev_lives = gs.lives;
            // Switch to strategic shot if pacman just died
            return { preferred_type: SHOT.STRATEGIC, hold_override: DCFG.DRAMA_HOLD * 2 };
        }
        this._prev_lives = gs.lives;
        return null;
    }

    // Cut the shot if a candidate shot is more interesting
    _cut(gs, preferred_type, hold_override) {
        const candidates = this._build_candidates(gs);
        if (candidates.length === 0) return;

        const scored = candidates
            .map(c => ({ ...c, score: this._score(c, gs, preferred_type) }))
            .sort((a, b) => b.score - a.score);

        const chosen    = scored[0];
        this._last_type = chosen.type;

        // Remember which side was picked for POSITIONAL_SIDE so _compute_fixed_eye
        // can reconstruct the correct position each frame.
        if (chosen.type === SHOT.POSITIONAL_SIDE) {
            this._fixed_side_sign = chosen._side_sign ?? 1;
        }

        const departing_from_overhead = this._last_eye[1] >= DCFG.OVERHEAD_ENTRY_THRESHOLD;

        if (CR_SHOTS.has(chosen.type) || departing_from_overhead) {
            this._spline    = this._build_spline_validated(chosen, gs, departing_from_overhead);
            this._ride_t    = 0;
            this._fixed_eye = null;
        } else {
            // Store the snapped position for strategic / fallback use
            this._fixed_eye = clamp_y(chosen.eye, DCFG.MIN_EYE_HEIGHT);
            this._spline    = null;
        }

        const base_hold     = DCFG.MIN_HOLD + Math.random() * (DCFG.MAX_HOLD - DCFG.MIN_HOLD);
        this._hold_duration = hold_override ?? base_hold;
        this._hold_timer    = this._hold_duration;
        if (hold_override) this._drama_hold = hold_override;

        if (chosen.at) this._current_at = chosen.at;
    }

    // Validate CR spline helper
    _build_spline_validated(shot, gs, force_dramatic = false) {
        let swing = DCFG.DRAMATIC_SWING;
        let lift  = DCFG.DRAMATIC_LIFT;
        if (force_dramatic) { swing *= 1.5; lift *= 1.2; }

        for (let attempt = 0; attempt < DCFG.SPLINE_MAX_RETRIES; attempt++) {
            const spline = this._build_spline(shot, gs, swing, lift);
            if (spline_is_clear(spline)) return spline;
            swing *= 0.5;
            lift  *= 0.5;
        }
        return build_straight_lift_spline(this._last_eye, shot.eye, lift);
    }

    // Generate CR spline
    _build_spline(shot, gs, swing, lift) {
        const spline = new CatmullRomSpline();
        const P1 = this._last_eye;
        const P2 = shot.eye;
        const px = gs.player_x;
        const pz = gs.player_z;

        let P0, P3;
        const g = shot.ghost;
        if (g) {
            // Spline version 1 (if ghost shot)
            const [ndx, ndz] = norm2(px - g.x, pz - g.z);
            P0 = P1.plus(vec3(-ndx * swing,        lift * 0.5, -ndz * swing));
            P3 = P2.plus(vec3( ndx * swing * 0.4,  0,           ndz * swing * 0.4));
        } else {
            // Spline version 2 otherwise
            const [sx, sz] = perp(this._smooth_dx, this._smooth_dz);
            P0 = P1.plus(vec3( sx * swing,         lift,         sz * swing));
            P3 = P2.plus(vec3(-sx * swing * 0.5,   lift * 0.3,  -sz * swing * 0.5));
        }

        // Clamp points so they don't pass through min height
        P0 = clamp_y(P0, DCFG.MIN_SWEEP_HEIGHT);
        P3 = clamp_y(P3, DCFG.MIN_SWEEP_HEIGHT);

        spline.add_point(P0);
        spline.add_point(P1);
        spline.add_point(P2);
        spline.add_point(P3);
        return spline;
    }

    // Aggregate shot candidates
    _build_candidates(gs) {
        const candidates = [];
        const px  = gs.player_x;
        const pz  = gs.player_z;
        // Use smoothed direction for candidate generation so scoring and
        // eye positions are consistent with what _compute_fixed_eye will produce
        const fdx = this._smooth_dx;
        const fdz = this._smooth_dz;
        const [sx, sz] = perp(fdx, fdz);

        candidates.push({
            type: SHOT.POSITIONAL_BEHIND,
            eye:  vec3(px - fdx * DCFG.POSITIONAL_DIST, DCFG.POSITIONAL_HEIGHT, pz - fdz * DCFG.POSITIONAL_DIST),
        });

        for (const sign of [1, -1]) {
            candidates.push({
                type:       SHOT.POSITIONAL_SIDE,
                eye:        vec3(px + sx*sign*DCFG.POSITIONAL_SIDE_OFFSET, DCFG.POSITIONAL_HEIGHT, pz + sz*sign*DCFG.POSITIONAL_SIDE_OFFSET),
                _side_sign: sign,
            });
        }

        candidates.push({
            type: SHOT.FIRST_PERSON,
            eye:  vec3(px, DCFG.FP_EYE_HEIGHT, pz),
            at:   vec3(px + fdx * DCFG.FP_LOOK_DIST, DCFG.FP_EYE_HEIGHT, pz + fdz * DCFG.FP_LOOK_DIST),
        });

        candidates.push({
            type: SHOT.THIRD_PERSON,
            eye:  vec3(px - fdx * DCFG.TP_FOLLOW_DIST, DCFG.TP_HEIGHT, pz - fdz * DCFG.TP_FOLLOW_DIST),
        });

        for (const g of gs.ghosts) {
            if (g.in_house || g.eaten) continue;
            const [ndx, ndz] = norm2(px - g.x, pz - g.z);
            candidates.push({
                type:  SHOT.REACTION,
                eye:   vec3(g.x - ndx * DCFG.REACTION_DIST, DCFG.REACTION_HEIGHT, g.z - ndz * DCFG.REACTION_DIST),
                ghost: g,
            });
            candidates.push({
                type:  SHOT.GHOST_CHASE,
                eye:   vec3(g.x - ndx * DCFG.GHOST_CHASE_FOLLOW_DIST, DCFG.GHOST_CHASE_HEIGHT, g.z - ndz * DCFG.GHOST_CHASE_FOLLOW_DIST),
                ghost: g,
            });
        }

        const [pc, pr] = world_to_tile(px, pz);
        get_junctions()
            .map(([jc, jr]) => ({ jc, jr, dist: Math.abs(jc-pc) + Math.abs(jr-pr) }))
            .sort((a, b) => a.dist - b.dist)
            .slice(0, 4)
            .forEach(({jc, jr}) => {
                const [jx, jz] = get_tile_center_world(jc, jr);
                candidates.push({
                    type: SHOT.STRATEGIC,
                    eye:  vec3(jx + DCFG.STRATEGIC_DIST, DCFG.STRATEGIC_HEIGHT, jz + DCFG.STRATEGIC_DIST),
                });
            });

        return candidates;
    }

    // Compute score for each shot
    _score(candidate, gs, preferred_type) {
        let score = 0;

        if (preferred_type && candidate.type === preferred_type) score += 50;
        if (candidate.type === this._last_type) score -= DCFG.REPEAT_PENALTY;

        if (candidate.type === SHOT.REACTION || candidate.type === SHOT.GHOST_CHASE) {
            const g = candidate.ghost;
            if (g) {
                const [gc, gr] = world_to_tile(g.x, g.z);
                const [pc, pr] = world_to_tile(gs.player_x, gs.player_z);
                score += Math.max(0, 20 - (Math.abs(gc-pc) + Math.abs(gr-pr))) * 2;
            }
        }

        if (candidate.type === SHOT.GHOST_CHASE && gs.frightened_timer <= 0) score += 15;

        if (gs.frightened_timer <= 0) {
            if (candidate.type === SHOT.FIRST_PERSON) score += 12;
            if (candidate.type === SHOT.THIRD_PERSON) score += 10;
        }
        if (gs.frightened_timer > 0) {
            if (candidate.type === SHOT.STRATEGIC)         score += 20;
            if (candidate.type === SHOT.POSITIONAL_BEHIND) score += 8;
        }

        const dx   = candidate.eye[0] - gs.player_x;
        const dz   = candidate.eye[2] - gs.player_z;
        const dist = Math.sqrt(dx*dx + dz*dz);
        if (dist >= 2 && dist <= 14) score += 15;

        const cur = this._last_eye;
        const cdx = candidate.eye[0] - cur[0];
        const cdz = candidate.eye[2] - cur[2];
        const cdy = candidate.eye[1] - cur[1];
        if (Math.sqrt(cdx*cdx + cdz*cdz + cdy*cdy) < DCFG.MIN_CUT_DISTANCE) {
            score -= DCFG.PROXIMITY_PENALTY;
        }

        if (!has_line_of_sight(candidate.eye[0], candidate.eye[2], gs.player_x, gs.player_z)) {
            score -= DCFG.LOS_PENALTY;
        }

        score += Math.random() * DCFG.TIEBREAK_SCALE;
        return score;
    }
}