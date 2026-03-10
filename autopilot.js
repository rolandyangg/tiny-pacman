import {world_to_tile, is_wall} from './pacman-player.js';
import {get_tile_center_world, MAZE_COLS, MAZE_ROWS} from './pacman-map.js';

/* Tuning Constants */
// Pacman's behavior changes depending on the following conditions
// Turn down danger radius and decision tick and power pellet grab radius for faster/more risky decisions
// Turn up flee lookahead for better escape routing
// Turn down ghost hunt give up for more aggressive pursuit
const CONFIG = {
    // How close a normal ghost must be to trigger fleeing
    DANGER_RADIUS: 3,

    // How many seconds between BFS recalculations
    DECISION_TICK: 0.1,

    // How many tiles to scan ahead when feeling
    FLEE_LOOKAHEAD: 15,

    // Maximum distance of closest ghost before going back to pellet hunting
    GHOST_HUNT_GIVE_UP: 20,

    // Radius of nearest ghost where pacman will choose a power pellet instead
    POWER_PELLET_GRAB_RADIUS: 10,
};


// BFS from start_tile toward goal_tile.
function bfs_toward(start_col, start_row, goal_col, goal_row) {
    if (start_col === goal_col && start_row === goal_row) return null;

    const visited = new Set();
    const key = (c, r) => c * 100 + r;

    // [col, row, first_dx, first_dz]
    const queue = [];
    const dirs = [[1,0],[-1,0],[0,1],[0,-1]];

    for (const [dx, dz] of dirs) {
        const nc = start_col + dx;
        const nr = start_row + dz;
        if (!is_wall(nc, nr)) {
            queue.push([nc, nr, dx, dz]);
            visited.add(key(nc, nr));
        }
    }

    let head = 0;
    while (head < queue.length) {
        const [col, row, first_dx, first_dz] = queue[head++];
        if (col === goal_col && row === goal_row) return [first_dx, first_dz];

        for (const [dx, dz] of dirs) {
            const nc = col + dx;
            const nr = row + dz;
            const k  = key(nc, nr);
            if (!is_wall(nc, nr) && !visited.has(k)) {
                visited.add(k);
                queue.push([nc, nr, first_dx, first_dz]);
            }
        }
    }
    return null; // only if unreachable
}

/* BFS flee: among the four immediate walkable neighbors of start_tile,
   pick the one whose FLEE_LOOKAHEAD-radius subtree has the greatest minimum
   distance to any threat tile.
*/
function bfs_flee(start_col, start_row, threat_tiles) {
    const dirs = [[1,0],[-1,0],[0,1],[0,-1]];

    // pre-compute tile distances
    function min_threat_dist(col, row) {
        let min_d = Infinity;
        for (const [tc, tr] of threat_tiles) {
            // approximate manhattan distance
            const d = Math.abs(col - tc) + Math.abs(row - tr);
            if (d < min_d) min_d = d;
        }
        return min_d;
    }

    let best_dir  = null;
    let best_score = -Infinity;

    for (const [dx, dz] of dirs) {
        const nc = start_col + dx;
        const nr = start_row + dz;
        if (is_wall(nc, nr)) continue;

        // BFS up to FLEE_LOOKAHEAD steps from this neighbor
        // accumulate the worst-case distance across reachable tiles
        const visited = new Set();
        visited.add(nc * 100 + nr);
        let frontier = [[nc, nr, 0]];
        let subtree_score = min_threat_dist(nc, nr);

        while (frontier.length > 0) {
            const next = [];
            for (const [c, r, depth] of frontier) {
                if (depth >= CONFIG.FLEE_LOOKAHEAD) continue;
                for (const [ddx, ddz] of dirs) {
                    const c2 = c + ddx;
                    const r2 = r + ddz;
                    const k  = c2 * 100 + r2;
                    if (!is_wall(c2, r2) && !visited.has(k)) {
                        visited.add(k);
                        subtree_score = Math.min(subtree_score, min_threat_dist(c2, r2));
                        next.push([c2, r2, depth + 1]);
                    }
                }
            }
            frontier = next;
        }

        if (subtree_score > best_score) {
            best_score = subtree_score;
            best_dir   = [dx, dz];
        }
    }

    return best_dir ?? [0, 0];
}

// BFS distance between two tiles helper
function bfs_distance(start_col, start_row, goal_col, goal_row) {
    if (start_col === goal_col && start_row === goal_row) return 0;
    const visited = new Set();
    const key = (c, r) => c * 100 + r;
    const dirs = [[1,0],[-1,0],[0,1],[0,-1]];
    let frontier = [[start_col, start_row, 0]];
    visited.add(key(start_col, start_row));

    while (frontier.length > 0) {
        const next = [];
        for (const [c, r, d] of frontier) {
            for (const [dx, dz] of dirs) {
                const nc = c + dx;
                const nr = r + dz;
                const k  = key(nc, nr);
                if (is_wall(nc, nr) || visited.has(k)) continue;
                if (nc === goal_col && nr === goal_row) return d + 1;
                visited.add(k);
                next.push([nc, nr, d + 1]);
            }
        }
        frontier = next;
    }
    return Infinity;
}

// Autopilot class
export class Autopilot {
    constructor() {
        this._tick_timer  = 0;
        this._queued_dx   = 0;
        this._queued_dz   = 0;
    }

    update(dt, player, ghosts, pellets, power_pellets, frightened_timer) {
        this._tick_timer -= dt;
        if (this._tick_timer > 0) {
            // if within current tick re-apply queued direction
            player.set_direction(this._queued_dx, this._queued_dz);
            return;
        }
        this._tick_timer = CONFIG.DECISION_TICK;

        const [pc, pr]   = world_to_tile(player.x, player.z);
        const is_frightened = frightened_timer > 0;

        const active_ghosts = ghosts.filter(g => !g.in_house);
        const ghost_tiles   = active_ghosts.map(g => world_to_tile(g.x, g.z));

        //  Priority 1, flee non-frightened ghosts in range
        if (!is_frightened) {
            const threats = ghost_tiles.filter(([gc, gr]) => {
                const d = Math.abs(gc - pc) + Math.abs(gr - pr);
                return d <= CONFIG.DANGER_RADIUS;
            });

            // check if a power pellet is close enough to grab
            if (threats.length > 0) {
                const nearby_power = power_pellets.find(pp => {
                    if (pp.eaten) return false;
                    const [tc, tr] = world_to_tile(pp.x, pp.z);
                    const d = Math.abs(tc - pc) + Math.abs(tr - pr);
                    return d <= CONFIG.POWER_PELLET_GRAB_RADIUS;
                });

                if (nearby_power) {
                    const [tc, tr] = world_to_tile(nearby_power.x, nearby_power.z);
                    const dir = bfs_toward(pc, pr, tc, tr);
                    if (dir) return this._set(player, dir);
                }

                // Flee
                const dir = bfs_flee(pc, pr, threats);
                return this._set(player, dir);
            }
        }

        // Priority 2, hunt frightened ghosts
        if (is_frightened) {
            let best_ghost = null;
            let best_dist  = Infinity;
            for (let i = 0; i < active_ghosts.length; i++) {
                if (active_ghosts[i].eaten) continue; // skip already eaten ghosts
                const [gc, gr] = ghost_tiles[i];
                const d = bfs_distance(pc, pr, gc, gr);
                if (d < best_dist) { best_dist = d; best_ghost = [gc, gr]; }
            }
            if (best_ghost && best_dist <= CONFIG.GHOST_HUNT_GIVE_UP) {
                const dir = bfs_toward(pc, pr, best_ghost[0], best_ghost[1]);
                if (dir) return this._set(player, dir);
            }
        }

        // Priority 3, grab nearest uneaten pellet
        // Prefer power pellets if frightened mode is not active
        const candidates = [...pellets, ...power_pellets].filter(p => !p.eaten);
        if (candidates.length === 0) return;

        let best_pellet = null;
        let best_dist   = Infinity;
        for (const p of candidates) {
            const [tc, tr] = world_to_tile(p.x, p.z);
            const d = bfs_distance(pc, pr, tc, tr);
            if (d < best_dist) { best_dist = d; best_pellet = [tc, tr]; }
        }

        if (best_pellet) {
            const dir = bfs_toward(pc, pr, best_pellet[0], best_pellet[1]);
            if (dir) return this._set(player, dir);
        }
    }

    // set direction of BFS decision
    _set(player, [dx, dz]) {
        this._queued_dx = dx;
        this._queued_dz = dz;
        player.set_direction(dx, dz);
    }
}