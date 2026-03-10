import {tiny, defs} from './examples/common.js';
import {get_wall_positions, get_pellet_positions, get_power_pellet_positions,
    MAZE_COLS, MAZE_ROWS, WALL_HEIGHT, FLOOR_MARGIN} from './pacman-map.js';
import {Pellet, PowerPellet, create_pellet_assets} from './pacman-pellets.js';
import {PacmanPlayer} from './pacman-player.js';
import {Ghost} from './pacman-ghosts.js';
import {CameraController} from './camera.js';
import {register_key_bindings} from './input.js';
import {Autopilot} from './autopilot.js';

const { vec3, vec4, color, Mat4, Shape, Material, Shader, Texture, Component } = tiny;

// Pac-Man's starting world position (tile col 13, row 23 — open path near bottom)
const START_X = 13 - MAZE_COLS / 2 + 0.5;   // ≈ -0.5
const START_Z = 23 - MAZE_ROWS / 2 + 0.5;   // ≈  8.0

const PELLET_POINTS        = 10;
const POWER_PELLET_POINTS  = 50;
const GHOST_EAT_POINTS     = 200;
const FRIGHTENED_DURATION  = 8;     // seconds after eating power pellet
const COLLECT_RADIUS       = 0.6;   // world-units; pellet eaten when player center is within this
const GHOST_COLLIDE_RADIUS = 0.55;  // player + ghost touch (sum of radii ~0.67, slightly generous)

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

        // ── Camera ────────────────────────────────────────────────────────────
        this.camera = new CameraController();

        // ── HUD state ─────────────────────────────────────────────────────────
        this._hud_initialized = false;
        this._hud_el          = null;
        this._gameover_el     = null;
        this._win_el          = null;

        // ── Autopilot player ─────────────────────────────────────────────────────────
        this.autopilot = new Autopilot();
        this._reset();
    }

    // ── Reset helper — used both on init and by the Reset button ──────────────
    _reset()
    {
        this.wall_positions = get_wall_positions();
        this.pellet_assets  = create_pellet_assets();
        this.pellets        = get_pellet_positions().map(([x, z]) => new Pellet(x, z));
        this.power_pellets  = get_power_pellet_positions().map(([x, z]) => new PowerPellet(x, z));

        this.player           = new PacmanPlayer(START_X, START_Z);
        this.ghosts           = [new Ghost(0), new Ghost(1), new Ghost(2), new Ghost(3)];
        this.frightened_timer = 0;
        this.score            = 0;
        this.lives            = 3;
        this.game_won         = false;
        this.game_over        = false;
        this.last_t           = undefined;

        this.camera.reset();
        this.autopilot_on = false;

        // Hide overlays if they already exist
        if (this._gameover_el) this._gameover_el.classList.remove('visible');
        if (this._win_el)      this._win_el.classList.remove('visible');
    }

    // ── HUD Initialization (called once when canvas is available) ─────────────
    _init_hud(caller) {
        const canvas    = caller.canvas;
        if (!canvas) return;

        // Re-use wrapper if already created (e.g. after _reset)
        let container = document.getElementById('pacman-canvas-wrapper');
        if (!container) {
            // Insert a positioned wrapper around the canvas so our
            // absolute-positioned overlays sit on top of the game view,
            // not below it in the page flow.
            container = document.createElement('div');
            container.id = 'pacman-canvas-wrapper';
            container.style.cssText =
                'position:relative; display:inline-block; line-height:0; width:100%;';
            canvas.parentElement.insertBefore(container, canvas);
            container.appendChild(canvas);
        }

        // ── Google Font ───────────────────────────────────────────────────────
        if (!document.getElementById('pacman-gfont')) {
            const link = document.createElement('link');
            link.id   = 'pacman-gfont';
            link.rel  = 'stylesheet';
            link.href = 'https://fonts.googleapis.com/css2?family=Press+Start+2P&display=swap';
            document.head.appendChild(link);
        }

        // ── Styles ────────────────────────────────────────────────────────────
        if (!document.getElementById('pacman-hud-style')) {
            const style = document.createElement('style');
            style.id    = 'pacman-hud-style';
            style.textContent = `
                /* ── HUD bar (top of canvas) ─────────────────────── */
                .pacman-hud {
                    position: absolute;
                    top: 0; left: 0; right: 0;
                    padding: 10px 18px 18px;
                    display: flex;
                    justify-content: space-between;
                    align-items: flex-start;
                    background: linear-gradient(to bottom, rgba(0,0,0,0.85) 0%, transparent 100%);
                    font-family: 'Press Start 2P', 'Courier New', monospace;
                    pointer-events: none;
                    z-index: 10;
                    box-sizing: border-box;
                }

                /* Score block */
                .hud-score-block {
                    display: flex;
                    flex-direction: column;
                    gap: 0;
                }
                .hud-label {
                    display: block;
                    color: #ffffff;
                    font-family: 'Press Start 2P', monospace;
                    font-size: 8px;
                    letter-spacing: 2px;
                    text-shadow: 1px 1px 0 #000;
                    opacity: 0.75;
                    line-height: 1;
                    margin-bottom: 7px;
                }
                .hud-score-value {
                    display: block;
                    color: #FFE000;
                    font-family: 'Press Start 2P', monospace;
                    font-size: 20px;
                    letter-spacing: 1px;
                    text-shadow: 0 0 10px rgba(255,224,0,0.7), 2px 2px 0 #000;
                    line-height: 1;
                }

                /* Lives block */
                .hud-lives-block {
                    display: flex;
                    flex-direction: column;
                    align-items: flex-end;
                    gap: 0;
                }
                .hud-lives-icons {
                    display: flex;
                    gap: 7px;
                    align-items: center;
                }
                /* Pac-Man life icon via clip-path */
                .life-icon {
                    width: 20px;
                    height: 20px;
                    background: #FFE000;
                    border-radius: 50%;
                    /* open mouth facing right */
                    clip-path: polygon(
                        50% 50%,
                        100% 25%,
                        100% 0%,
                        0%   0%,
                        0%   100%,
                        100% 100%,
                        100% 75%
                    );
                    box-shadow: 0 0 6px rgba(255,224,0,0.8);
                }

                /* ── Frightened timer bar ────────────────────────── */
                .pacman-fright-bar-wrap {
                    position: absolute;
                    bottom: 0; left: 0; right: 0;
                    height: 5px;
                    background: rgba(0,0,0,0.5);
                    pointer-events: none;
                    z-index: 10;
                    display: none;
                }
                .pacman-fright-bar-wrap.visible { display: block; }
                .pacman-fright-bar {
                    height: 100%;
                    background: linear-gradient(90deg, #5555ff, #aaaaff);
                    transition: width 0.1s linear;
                    box-shadow: 0 0 8px #5555ff;
                }

                /* ── Shared overlay backdrop ─────────────────────── */
                .pacman-overlay {
                    position: absolute;
                    top: 0; left: 0; right: 0; bottom: 0;
                    display: none;
                    flex-direction: column;
                    align-items: center;
                    justify-content: center;
                    background: rgba(0, 0, 0, 0.78);
                    font-family: 'Press Start 2P', 'Courier New', monospace;
                    z-index: 20;
                    gap: 0;
                }
                .pacman-overlay.visible { display: flex; }

                /* ── Game Over overlay ───────────────────────────── */
                .overlay-gameover-title {
                    font-size: clamp(22px, 5vw, 40px);
                    color: #FF2222;
                    text-shadow: 0 0 24px #FF0000, 3px 3px 0 #000;
                    margin-bottom: 28px;
                    animation: pacman-blink 1.1s step-start infinite;
                    letter-spacing: 3px;
                }
                /* ── Win overlay ─────────────────────────────────── */
                .overlay-win-title {
                    font-size: clamp(20px, 4.5vw, 36px);
                    color: #00FF88;
                    text-shadow: 0 0 24px #00FF88, 3px 3px 0 #005533;
                    margin-bottom: 28px;
                    letter-spacing: 3px;
                }

                /* Final score display */
                .overlay-final-score-label {
                    display: block;
                    color: #aaaaaa;
                    font-size: 9px;
                    letter-spacing: 3px;
                    margin-bottom: 18px;
                    text-shadow: 1px 1px 0 #000;
                    line-height: 1;
                }
                .overlay-final-score-value {
                    display: block;
                    color: #FFE000;
                    font-size: clamp(24px, 5vw, 42px);
                    text-shadow: 0 0 16px rgba(255,224,0,0.8), 3px 3px 0 #000;
                    margin-bottom: 36px;
                    line-height: 1;
                }

                /* Restart / Play Again button */
                .overlay-btn {
                    padding: 14px 28px;
                    font-family: 'Press Start 2P', monospace;
                    font-size: clamp(10px, 2vw, 14px);
                    color: #000;
                    background: #FFE000;
                    border: none;
                    border-radius: 4px;
                    cursor: pointer;
                    box-shadow: 0 0 16px rgba(255,224,0,0.6), 4px 4px 0 #806000;
                    letter-spacing: 1px;
                    transition: transform 0.1s, box-shadow 0.1s;
                    pointer-events: all;
                }
                .overlay-btn:hover {
                    transform: scale(1.06);
                    box-shadow: 0 0 28px rgba(255,224,0,0.9), 4px 4px 0 #806000;
                }
                .overlay-btn:active {
                    transform: scale(0.96);
                    box-shadow: 0 0 8px rgba(255,224,0,0.5), 2px 2px 0 #806000;
                }

                /* Pac-Man dot row decoration */
                .overlay-dots {
                    display: flex;
                    gap: 10px;
                    margin-bottom: 22px;
                }
                .overlay-dot {
                    width: 10px;
                    height: 10px;
                    background: #FFE000;
                    border-radius: 50%;
                    opacity: 0.7;
                }

                /* Blinking animation */
                @keyframes pacman-blink {
                    0%, 100% { opacity: 1; }
                    50%       { opacity: 0; }
                }
            `;
            document.head.appendChild(style);
        }

        // ── HUD bar ───────────────────────────────────────────────────────────
        this._hud_el = document.createElement('div');
        this._hud_el.className = 'pacman-hud';
        this._hud_el.innerHTML = `
            <div class="hud-score-block">
                <span class="hud-label">SCORE</span>
                <span class="hud-score-value" id="hud-score-val">0</span>
            </div>
            <div class="hud-lives-block">
                <span class="hud-label">LIVES</span>
                <div class="hud-lives-icons" id="hud-lives-icons"></div>
            </div>
        `;
        container.appendChild(this._hud_el);

        // ── Frightened power-up timer bar ─────────────────────────────────────
        this._fright_bar_wrap = document.createElement('div');
        this._fright_bar_wrap.className = 'pacman-fright-bar-wrap';
        this._fright_bar_wrap.innerHTML = `<div class="pacman-fright-bar" id="fright-bar-fill"></div>`;
        container.appendChild(this._fright_bar_wrap);

        // ── Game Over overlay ─────────────────────────────────────────────────
        this._gameover_el = document.createElement('div');
        this._gameover_el.className = 'pacman-overlay';
        this._gameover_el.innerHTML = `
            <div class="overlay-gameover-title">GAME OVER</div>
            <div class="overlay-dots">
                <div class="overlay-dot"></div><div class="overlay-dot"></div>
                <div class="overlay-dot"></div><div class="overlay-dot"></div>
                <div class="overlay-dot"></div>
            </div>
            <div class="overlay-final-score-label">FINAL SCORE</div>
            <div class="overlay-final-score-value" id="gameover-score-val">0</div>
            <button class="overlay-btn" id="gameover-restart-btn">▶ PLAY AGAIN</button>
        `;
        container.appendChild(this._gameover_el);

        // ── Win overlay ───────────────────────────────────────────────────────
        this._win_el = document.createElement('div');
        this._win_el.className = 'pacman-overlay';
        this._win_el.innerHTML = `
            <div class="overlay-win-title">YOU WIN! 🎉</div>
            <div class="overlay-dots">
                <div class="overlay-dot"></div><div class="overlay-dot"></div>
                <div class="overlay-dot"></div><div class="overlay-dot"></div>
                <div class="overlay-dot"></div>
            </div>
            <div class="overlay-final-score-label">FINAL SCORE</div>
            <div class="overlay-final-score-value" id="win-score-val">0</div>
            <button class="overlay-btn" id="win-restart-btn">▶ PLAY AGAIN</button>
        `;
        container.appendChild(this._win_el);

        // ── Button listeners ──────────────────────────────────────────────────
        document.getElementById('gameover-restart-btn').addEventListener('click', () => {
            this._reset();
        });
        document.getElementById('win-restart-btn').addEventListener('click', () => {
            this._reset();
        });

        this._hud_initialized = true;
    }

    // ── HUD per-frame update ──────────────────────────────────────────────────
    _update_hud() {
        if (!this._hud_initialized) return;

        // Score
        const scoreEl = document.getElementById('hud-score-val');
        if (scoreEl) scoreEl.textContent = this.score ?? 0;

        // Lives — rebuild icons only when count changes
        const livesEl = document.getElementById('hud-lives-icons');
        if (livesEl) {
            const count = Math.max(0, this.lives ?? 0);
            if (livesEl.childElementCount !== count) {
                livesEl.innerHTML = '';
                for (let i = 0; i < count; i++) {
                    const icon = document.createElement('div');
                    icon.className = 'life-icon';
                    livesEl.appendChild(icon);
                }
            }
        }

        // Frightened power-up bar
        if (this._fright_bar_wrap) {
            const fill = document.getElementById('fright-bar-fill');
            if (this.frightened_timer > 0) {
                this._fright_bar_wrap.classList.add('visible');
                const pct = (this.frightened_timer / FRIGHTENED_DURATION) * 100;
                if (fill) fill.style.width = pct + '%';
            } else {
                this._fright_bar_wrap.classList.remove('visible');
            }
        }

        // Game Over overlay
        if (this.game_over && this._gameover_el) {
            const el = document.getElementById('gameover-score-val');
            if (el) el.textContent = this.score ?? 0;
            this._gameover_el.classList.add('visible');
        }

        // Win overlay
        if (this.game_won && this._win_el) {
            const el = document.getElementById('win-score-val');
            if (el) el.textContent = this.score ?? 0;
            this._win_el.classList.add('visible');
        }
    }

    // ── Controls / key bindings ───────────────────────────────────────────────
    render_controls()
    {
        this.control_panel.innerHTML += "Pac-Man &nbsp;|&nbsp; WASD to move<br>";

        this.key_triggered_button("(Un)pause", ["Alt", "a"], () => this.uniforms.animate ^= 1);
        this.key_triggered_button("Reset",     ["Alt", "r"], () => this._reset());
        this.new_line();

        // All remaining key bindings live in pacman-input.js
        register_key_bindings(this);
    }

    // ── Main render / game loop ───────────────────────────────────────────────
    render_animation(caller)
    {
        this.uniforms.lights = [
            defs.Phong_Shader.light_source(vec4(0, 1, 1, 0), color(1, 1, 1, 1), 100000)
        ];

        // ── Lazy HUD init (needs caller.canvas to be available) ───────────────
        if (!this._hud_initialized && caller.canvas) {
            this._init_hud(caller);
        }

        // ── Delta time ────────────────────────────────────────────────────────
        const t = this.uniforms.animation_time / 1000;
        if (this.last_t === undefined) this.last_t = t;
        const dt = Math.min(t - this.last_t, 0.05);
        this.last_t = t;

        // ── Camera ────────────────────────────────────────────────────────────
        this.camera.apply(dt, this.player, this.uniforms, caller);

        // ── Game logic (skip when paused or game is over) ─────────────────────
        if (this.uniforms.animate && !this.game_won && !this.game_over)
        {
            // Compute autopilot decision if it's update time
            if (this.autopilot_on) {
                this.autopilot.update(
                    dt, this.player, this.ghosts,
                    this.pellets, this.power_pellets,
                    this.frightened_timer
                );
            }
            // Move player in direction
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

        // ── Draw player ──────────────────────────────
        if (this.camera.mode !== 'first_person') {
            // note - player model hidden in first person
            // or else the whole screen is just yellow lol
            this.shapes.player.draw(
                caller, this.uniforms,
                this.player.get_transform(),
                this.materials.player
            );
        }

        // ── Draw ghosts ───────────────────────────────────────────────────────
        const is_frightened = this.frightened_timer > 0;
        for (const ghost of this.ghosts) {
            const mat = ghost.is_frightened(is_frightened)
                ? this.materials.ghost_frightened
                : { ...this.materials.ghost, color: color(...ghost.color) };
            this.shapes.ghost.draw(caller, this.uniforms, ghost.get_transform(), mat);
        }

        // ── Update HUD overlay ────────────────────────────────────────────────
        this._update_hud();
    }
}