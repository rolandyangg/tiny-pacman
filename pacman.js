import {tiny, defs} from './examples/common.js';
import {get_wall_positions, get_pellet_positions, get_power_pellet_positions,
        MAZE_COLS, MAZE_ROWS, WALL_HEIGHT, FLOOR_MARGIN} from './pacman-map.js';
import {Pellet, PowerPellet, create_pellet_assets} from './pacman-pellets.js';
import {PacmanPlayer} from './pacman-player.js';
import {Ghost} from './pacman-ghosts.js';

const { vec3, vec4, color, Mat4, Shape, Material, Shader, Texture, Component } = tiny;

// Pac-Man's starting world position (tile col 13, row 23 — open path near bottom)
const START_X = 13 - MAZE_COLS / 2 + 0.5;   // ≈ -0.5
const START_Z = 23 - MAZE_ROWS / 2 + 0.5;   // ≈  8.0

const PELLET_POINTS       = 10;
const POWER_PELLET_POINTS = 50;
const GHOST_EAT_POINTS    = 200;
const FRIGHTENED_DURATION = 8;   // seconds after eating power pellet
const COLLECT_RADIUS      = 0.6;   // world-units; pellet eaten when player centre is within this
const GHOST_COLLIDE_RADIUS = 0.55; // player + ghost touch (sum of radii ~0.67, slightly generous)

export class Pacman extends Component
{
    init()
    {
        // ── Shapes ────────────────────────────────────────────────────────────
        this.shapes = {
            wall:   new defs.Cube(),
            floor:  new defs.Cube(),
            player: new defs.Subdivision_Sphere(3),
            ghost:  new defs.Subdivision_Sphere(3),
        };

        // ── Materials ─────────────────────────────────────────────────────────
        const phong = new defs.Phong_Shader();
        this.materials = {
            wall:   { shader: phong, ambient: 0.3, diffusivity: 1, specularity: 0.3,
                      color: color(0.2, 0.3, 1, 1) },
            floor:  { shader: phong, ambient: 0.5, diffusivity: 0.8, specularity: 0,
                      color: color(0, 0, 0, 1) },
            player: { shader: phong, ambient: 0.6, diffusivity: 0.8, specularity: 0.4,
                      color: color(1, 1, 0, 1) },
            ghost:  { shader: phong, ambient: 0.6, diffusivity: 0.8, specularity: 0.3,
                      color: color(1, 0, 0, 1) },
            ghost_frightened: { shader: phong, ambient: 0.6, diffusivity: 0.8, specularity: 0.2,
                      color: color(0.2, 0.2, 1, 1) },
        };

        this._reset();
    }

    // ── Reset helper — used both on init and by the Reset button ──────────────
    _reset()
    {
        this.wall_positions = get_wall_positions();
        this.pellet_assets  = create_pellet_assets();
        this.pellets        = get_pellet_positions().map(([x, z]) => new Pellet(x, z));
        this.power_pellets  = get_power_pellet_positions().map(([x, z]) => new PowerPellet(x, z));

        this.player  = new PacmanPlayer(START_X, START_Z);
        this.ghosts  = [new Ghost(0), new Ghost(1), new Ghost(2), new Ghost(3)];
        this.frightened_timer = 0;
        this.score   = 0;
        this.lives   = 3;
        this.game_won  = false;
        this.game_over = false;
        this.last_t    = undefined;
        this.camera_mode = 'top_down';
        this.cam_look_x = 0;
        this.cam_look_z = -1;
        this.cam_third_x = 0;
        this.cam_third_z = 0;
    }

    // ── Controls / key bindings ───────────────────────────────────────────────
    render_controls()
    {
        this.control_panel.innerHTML += "Pac-Man &nbsp;|&nbsp; WASD to move<br>";

        // Live score / lives readout — updates every frame automatically
        this.live_string(box => {
            box.textContent =
                `Score: ${this.score ?? 0}   |   Lives: ${this.lives ?? 3}`;
        });
        this.new_line();
        this.live_string(box => {
            if (this.game_won)  box.textContent = "🎉 YOU WIN!";
            else if (this.game_over) box.textContent = "💀 GAME OVER";
            else box.textContent = "";
        });
        this.new_line();

        this.key_triggered_button("(Un)pause", ["Alt", "a"], () => this.uniforms.animate ^= 1);
        this.key_triggered_button("Reset",     ["Alt", "r"], () => this._reset());
        this.new_line();

        // Camera control
        this.key_triggered_button("Toggle Camera", ["t"], () => {
            if (this.camera_mode === 'top_down')      this.camera_mode = 'first_person';
            else if (this.camera_mode === 'first_person') this.camera_mode = 'third_person';
            else                                          this.camera_mode = 'top_down';
        });
        this.new_line();

        // WASD movement
        this.key_triggered_button("← / Turn Left",  ["a"], () => {
            if (this.camera_mode === 'first_person') {
                // 90° CCW of current facing: (fz, -fx)
                this.player.set_direction(
                    this.player.last_dir_z,
                    -this.player.last_dir_x
                );
            } else {
                this.player.set_direction(-1, 0);
            }
        });
        this.key_triggered_button("→ / Turn Right", ["d"], () => {
            if (this.camera_mode === 'first_person') {
                // 90° CW of current facing: (-fz, fx)
                this.player.set_direction(
                    -this.player.last_dir_z,
                    this.player.last_dir_x
                );
            } else {
                this.player.set_direction(1, 0);
            }
        });
        this.key_triggered_button("↑ / Forward",    ["w"], () => {
            if (this.camera_mode === 'first_person') {
                this.player.set_direction(
                    this.player.last_dir_x,
                    this.player.last_dir_z
                );
            } else {
                this.player.set_direction(0, -1);
            }
        });
        this.key_triggered_button("↓ / Backward",   ["s"], () => {
            if (this.camera_mode === 'first_person') {
                this.player.set_direction(
                    -this.player.last_dir_x,
                    -this.player.last_dir_z
                );
            } else {
                this.player.set_direction(0, 1);
            }
        });
    }

    // ── Main render / game loop ───────────────────────────────────────────────
    render_animation(caller)
    {
        // ── One-time camera setup ─────────────────────────────────────────────
        // if (!caller.controls)
        // {
        //     this.animated_children.push(
        //         caller.controls = new defs.Movement_Controls({ uniforms: this.uniforms }) // Adds WASD Controls to move around
        //     );
        //     caller.controls.add_mouse_controls(caller.canvas); // Adds camera controls to move around
        //     Shader.assign_camera(
        //         Mat4.look_at(vec3(0, 50, 0), vec3(0, 0, 0), vec3(0, 0, -1)),
        //         this.uniforms
        //     );
        // }

        this.uniforms.lights = [
            defs.Phong_Shader.light_source(vec4(0, 1, 1, 0), color(1, 1, 1, 1), 100000)
        ];

        // ── Delta time ────────────────────────────────────────────────────────
        const t = this.uniforms.animation_time / 1000;
        if (this.last_t === undefined) this.last_t = t;
        const dt = Math.min(t - this.last_t, 0.05);
        this.last_t = t;

        // ── Camera logic ────────────────────────────────────────────────────────
        // First person camera
        if (this.camera_mode === 'first_person') {
            // first person camera constants
            const SMOOTHING = 8.0;
            const EYE_HEIGHT = 0.55;
            const FOV = Math.PI / 6;
            const PULL_BACK = 0.2;

            // LERP the stored look direction toward the players last facing
            this.cam_look_x += (this.player.last_dir_x - this.cam_look_x) * SMOOTHING * dt;
            this.cam_look_z += (this.player.last_dir_z - this.cam_look_z) * SMOOTHING * dt;

            const eye = vec3(
                this.player.x - this.cam_look_x * PULL_BACK,
                EYE_HEIGHT,
                this.player.z - this.cam_look_z * PULL_BACK
            );
            const at = vec3(
                this.player.x + this.cam_look_x,
                EYE_HEIGHT,
                this.player.z + this.cam_look_z
            );

            Shader.assign_camera(Mat4.look_at(eye, at, vec3(0, 1, 0)), this.uniforms);
            this.uniforms.projection_transform =
                Mat4.perspective(FOV, caller.width / caller.height, 0.6, 200);
        } else {
            Shader.assign_camera(
                Mat4.look_at(vec3(0, 50, 0), vec3(0, 0, 0), vec3(0, 0, -1)),
                this.uniforms
            );
            this.uniforms.projection_transform =
                Mat4.perspective(Math.PI / 4, caller.width / caller.height, 1, 200);
        }

        // ── Game logic (skip when paused or game is over) ─────────────────────
        if (this.uniforms.animate && !this.game_won && !this.game_over)
        {
            // Move player
            this.player.update(dt);

            // Pellet collection
            for (const pellet of this.pellets) {
                if (!pellet.eaten) {
                    const dx = this.player.x - pellet.x;
                    const dz = this.player.z - pellet.z;
                    if (Math.sqrt(dx * dx + dz * dz) < COLLECT_RADIUS) {
                        pellet.eat();
                        this.score += PELLET_POINTS;
                    }
                }
            }

            // Power-pellet collection
            for (const pellet of this.power_pellets) {
                if (!pellet.eaten) {
                    const dx = this.player.x - pellet.x;
                    const dz = this.player.z - pellet.z;
                    if (Math.sqrt(dx * dx + dz * dz) < COLLECT_RADIUS) {
                        pellet.eat();
                        this.score += POWER_PELLET_POINTS;
                        this.frightened_timer = FRIGHTENED_DURATION;
                    }
                }
            }

            // Frightened timer (ghosts flee / can be eaten)
            if (this.frightened_timer > 0) {
                this.frightened_timer = Math.max(0, this.frightened_timer - dt);
            }

            // Ghost AI: chase, scatter, or flee
            const is_frightened = this.frightened_timer > 0;
            for (const ghost of this.ghosts) {
                ghost.update(dt, this.player.x, this.player.z, is_frightened, t);
            }

            // Ghost–player collision
            for (const ghost of this.ghosts) {
                const dx = this.player.x - ghost.x;
                const dz = this.player.z - ghost.z;
                if (Math.sqrt(dx * dx + dz * dz) < GHOST_COLLIDE_RADIUS) {
                    if (is_frightened) {
                        ghost.respawn();
                        this.score += GHOST_EAT_POINTS;
                    } else {
                        this.lives--;
                        this.player = new PacmanPlayer(START_X, START_Z);
                        for (const g of this.ghosts) g.respawn();
                        if (this.lives <= 0) this.game_over = true;
                        break;
                    }
                }
            }

            // Win condition — all pellets eaten
            const all_eaten =
                this.pellets.every(p => p.eaten) &&
                this.power_pellets.every(p => p.eaten);
            if (all_eaten) this.game_won = true;
        }

        // ── Draw floor ────────────────────────────────────────────────────────
        const half_x = MAZE_COLS / 2 + FLOOR_MARGIN;
        const half_z = MAZE_ROWS / 2 + FLOOR_MARGIN;
        const floor_transform = Mat4.translation(0, -0.5, 0)
            .times(Mat4.scale(half_x, 0.5, half_z));
        this.shapes.floor.draw(caller, this.uniforms, floor_transform, this.materials.floor);

        // ── Draw walls ────────────────────────────────────────────────────────
        for (const [x, z] of this.wall_positions) {
            const wall_transform = Mat4.translation(x, WALL_HEIGHT / 2, z)
                .times(Mat4.scale(0.5, WALL_HEIGHT / 2, 0.5));
            this.shapes.wall.draw(caller, this.uniforms, wall_transform, this.materials.wall);
        }

        // ── Draw pellets ──────────────────────────────────────────────────────
        for (const pellet of this.pellets)       pellet.draw(caller, this.uniforms, this.pellet_assets);
        for (const pellet of this.power_pellets) pellet.draw(caller, this.uniforms, this.pellet_assets);

        // ── Draw player ───────────────────────────────────────────────────────
        if (this.camera_mode !== 'first_person') {
            this.shapes.player.draw(
                caller, this.uniforms,
                this.player.get_transform(),
                this.materials.player
            );
        }

        // ── Draw ghosts ────────────────────────────────────────────────────────
        const is_frightened = this.frightened_timer > 0;
        for (const ghost of this.ghosts) {
            const mat = ghost.is_frightened(is_frightened)
                ? this.materials.ghost_frightened
                : { ...this.materials.ghost, color: color(...ghost.color) };
            this.shapes.ghost.draw(caller, this.uniforms, ghost.get_transform(), mat);
        }
    }
}