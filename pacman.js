import {tiny, defs} from './examples/common.js';
import {get_wall_positions, get_pellet_positions, get_power_pellet_positions,
    MAZE_COLS, MAZE_ROWS, WALL_HEIGHT, FLOOR_MARGIN} from './pacman-map.js';
import {Pellet, PowerPellet, create_pellet_assets} from './pacman-pellets.js';
import {PacmanPlayer, world_to_tile} from './pacman-player.js';
import {Ghost, GHOST_Y} from './pacman-ghosts.js';
import {CameraController} from './camera.js';
import {register_key_bindings} from './input.js';
import {PacmanAutopilot} from './pacman-autopilot.js';
import {ParticleSimulation, Particle, Spring} from './particle-springs.js';
import {SoundManager} from './sound-manager.js';

const { vec3, vec4, color, Mat4, Shape, Material, Shader, Texture, Component } = tiny;

// Pac-Man's starting world position (tile col 13, row 23 — open path near bottom)
const START_X = 13 - MAZE_COLS / 2 + 0.5;   // ≈ -0.5
const START_Z = 23 - MAZE_ROWS / 2 + 0.5;   // ≈  8.0

const PELLET_POINTS        = 10;
const POWER_PELLET_POINTS  = 50;
const GHOST_EAT_POINTS     = 200;
const WIN_CONFETTI_SECONDS = 2.0;  // duration of level-complete confetti burst
const FRIGHTENED_DURATION  = 8;     // seconds after eating power pellet
const COLLECT_RADIUS       = 0.6;   // world-units; pellet eaten when player center is within this
const GHOST_COLLIDE_RADIUS = 0.55;  // player + ghost touch (sum of radii ~0.67, slightly generous)

export class Pacman extends Component
{
    init()
    {
        // ── Shapes ────────────────────────────────────────────────────────────
        this.shapes = {
            wall:         new defs.Cube(),
            floor:        new defs.Cube(),
            player:       new defs.Subdivision_Sphere(3),
            ghost:        new defs.Subdivision_Sphere(3),
            particle:     new defs.Subdivision_Sphere(2),
            aura_segment: new defs.Capped_Cylinder(4, 8),
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
            particle: { shader: phong, ambient: 0.7, diffusivity: 0.6, specularity: 0.2,
                color: color(1, 1, 0, 1) },
            ghost_aura: { shader: phong, ambient: 0.9, diffusivity: 0.3, specularity: 0.2,
                color: color(0.3, 0.6, 1.0, 0.9) },
        };

        // ── Camera ────────────────────────────────────────────────────────────
        this.camera = new CameraController();

        // ── HUD state ─────────────────────────────────────────────────────────
        this._hud_initialized = false;
        this._hud_el          = null;
        this._gameover_el     = null;
        this._win_el          = null;

        // ── PacmanAutopilot player ─────────────────────────────────────────────────────────
        this.autopilot = new PacmanAutopilot();

        // ── Particle simulation (shares dt with game loop) ────────────────────
        this.particle_sim = new ParticleSimulation();
        this.particle_sim.g_acc = vec3(0, -9.8, 0);
        this.particle_sim.integration_method = "verlet";
        this.particle_sim.valid = true;   // safe: no particles yet, update() becomes a no-op

        // ── Sounds ────────────────────────────────────────────────────────────
        // Core gameplay SFX: pellet chomp, ghost eaten, and Pacman death.
        this.sounds = new SoundManager({
            pellet:   './sounds/pellet.mp3',
            ghosteat: './sounds/ghosteat.mp3',
            death:    './sounds/death.mp3',
        });

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
        this.dots_eaten       = 0;
        this.last_dot_time    = 0;
        this.level            = 1;
        this.game_won         = false;
        this.game_over        = false;
        this.last_t           = undefined;

        // Death sequence state
        this.death_in_progress = false;

        // Win-sequence / confetti state
        this.level_complete      = false;
        this.win_sequence_active = false;
        this.win_sequence_time   = 0;

        this.camera.reset();
        this.autopilot_on = false;

        // Initialize ghost aura bookkeeping
        for (const ghost of this.ghosts) {
            ghost._aura_particles = null;
            ghost._last_x = ghost.x;
            ghost._last_z = ghost.z;
        }

        // Clear any existing particle effects
        if (this.particle_sim) {
            this.particle_sim.particles = [];
            this.particle_sim.springs = [];
        }

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

        // ── Styles ─────────────────────────────────────────────────────────────
        if (!document.getElementById('pacman-hud-style')) {
            const link = document.createElement('link');
            link.id   = 'pacman-hud-style';
            link.rel  = 'stylesheet';
            link.href = './overlay.css';
            document.head.appendChild(link);
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

        // ── Cinematic letterbox bars ──────────────────────────────────────────
        this._cine_bar_top    = document.createElement('div');
        this._cine_bar_bottom = document.createElement('div');
        this._cine_bar_top.className    = 'pacman-cinematic-bar top';
        this._cine_bar_bottom.className = 'pacman-cinematic-bar bottom';
        container.appendChild(this._cine_bar_top);
        container.appendChild(this._cine_bar_bottom);

        // ── LIVE CAM badge ────────────────────────────────────────────────────
        this._livecam_el = document.createElement('div');
        this._livecam_el.className = 'pacman-livecam';
        this._livecam_el.innerHTML = `
            <div class="livecam-dot"></div>
            <span class="livecam-text">CINEMATIC CAM</span>
            <span class="livecam-timecode" id="livecam-tc">00:00:00</span>
        `;
        container.appendChild(this._livecam_el);

        // Tracks when cinematic mode started for the timecode counter
        this._cine_start_t = null;

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

        // ── Cinematic mode UI ─────────────────────────────────────────────────
        const cine = this.autopilot_on;

        if (this._cine_bar_top) {
            this._cine_bar_top.classList.toggle('active', cine);
            this._cine_bar_bottom.classList.toggle('active', cine);
        }
        if (this._livecam_el)  this._livecam_el.classList.toggle('visible', cine);
        if (this._vignette_el) this._vignette_el.classList.toggle('visible', cine);

        // Timecode — counts up from 00:00:00, resets when cinematic is toggled off
        if (cine) {
            if (this._cine_start_t === null) this._cine_start_t = performance.now();
            const elapsed = Math.floor((performance.now() - this._cine_start_t) / 1000);
            const hh = String(Math.floor(elapsed / 3600)).padStart(2, '0');
            const mm = String(Math.floor((elapsed % 3600) / 60)).padStart(2, '0');
            const ss = String(elapsed % 60).padStart(2, '0');
            const tc = document.getElementById('livecam-tc');
            if (tc) tc.textContent = `${hh}:${mm}:${ss}`;
        } else {
            this._cine_start_t = null;
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

    // ── Global level-completion confetti burst ─────────────────────────────────
    _spawn_win_confetti() {
        if (!this.particle_sim) return;

        // Dense, high-energy burst across the entire maze
        const count       = 800;
        const center_y    = 0.6;
        const life_secs   = WIN_CONFETTI_SECONDS;
        const half_cols   = MAZE_COLS / 2;
        const half_rows   = MAZE_ROWS / 2;

        for (let i = 0; i < count; i++) {
            const p = new Particle();
            p.mass = 0.4;

            // Scatter across the whole maze footprint
            const x = (Math.random() * MAZE_COLS) - half_cols + 0.5;
            const z = (Math.random() * MAZE_ROWS) - half_rows + 0.5;
            p.pos   = vec3(x, center_y, z);

            // Upward, slightly outward burst
            const angle     = Math.random() * 2 * Math.PI;
            const speed_xy  = 4.0 + Math.random() * 5.0;
            const vx        = Math.cos(angle) * speed_xy;
            const vz        = Math.sin(angle) * speed_xy;
            const vy        = 7.0 + Math.random() * 4.0;
            p.vel           = vec3(vx, vy, vz);

            p.ext_force = vec3(0, 0, 0);
            p.prev_pos  = null;
            p.valid     = true;

            p.life     = 0;
            p.max_life = life_secs;

            // Fully random bright confetti colours and slightly larger size
            const r = 0.2 + Math.random() * 0.8;
            const g = 0.2 + Math.random() * 0.8;
            const b = 0.2 + Math.random() * 0.8;
            p.tint   = color(r, g, b, 1);
            p.size   = 0.15;
            p.tag    = "win_confetti";

            this.particle_sim.particles.push(p);
        }
    }

    _start_win_sequence() {
        if (this.win_sequence_active || this.game_won || this.game_over) return;

        this.level_complete      = true;
        this.win_sequence_active = true;
        this.win_sequence_time   = 0;

        // Ensure animation is running so the sequence can play out
        this.uniforms.animate = 1;

        this._spawn_win_confetti();
    }

    // ── Spawn a short-lived springy yellow particle burst at (x, z) ───────────
    _spawn_pellet_particles(x, z) {
        if (!this.particle_sim) return;

        const count = 5;
        const center_y = 0.4;   // a bit above the floor
        const life_secs = 2.0;

        const particles = [];

        for (let i = 0; i < count; i++) {
            const p = new Particle();
            p.mass = 0.5;
            p.pos = vec3(x, center_y, z);

            // Random small outward + upward velocity
            const angle = Math.random() * 2 * Math.PI;
            const speed_xy = 2.0 + Math.random() * 1.5;
            const vx = Math.cos(angle) * speed_xy;
            const vz = Math.sin(angle) * speed_xy;
            const vy = 3.5 + Math.random() * 1.0;
            p.vel = vec3(vx, vy, vz);

            p.ext_force = vec3(0, 0, 0);
            p.prev_pos = null;
            p.valid = true;

            // Lifetime / fade info
            p.life = 0;
            p.max_life = life_secs;

            this.particle_sim.particles.push(p);
            particles.push(p);
        }

        // Connect them in a ring with springs so they bounce a bit together.
        for (let i = 0; i < count; i++) {
            const p1 = particles[i];
            const p2 = particles[(i + 1) % count];
            const s = new Spring();
            s.particle_1 = p1;
            s.particle_2 = p2;
            s.ks = 30;      // stiffness
            s.kd = 2;       // damping
            s.rest_length = 0.4;
            s.valid = true;
            this.particle_sim.springs.push(s);
        }
    }

    // ── Larger, brighter burst for power pellets at (x, z) ───────────────────
    _spawn_power_pellet_particles(x, z) {
        if (!this.particle_sim) return;

        const count = 15;
        const center_y = 0.45;
        const life_secs = 3.0;

        const particles = [];

        for (let i = 0; i < count; i++) {
            const p = new Particle();
            p.mass = 0.7;
            p.pos = vec3(x, center_y, z);

            // Stronger outward + upward burst than regular pellets
            const angle = Math.random() * 2 * Math.PI;
            const speed_xy = 4.0 + Math.random() * 2.5;
            const vx = Math.cos(angle) * speed_xy;
            const vz = Math.sin(angle) * speed_xy;
            const vy = 5.0 + Math.random() * 2.0;
            p.vel = vec3(vx, vy, vz);

            p.ext_force = vec3(0, 0, 0);
            p.prev_pos = null;
            p.valid = true;

            p.life = 0;
            p.max_life = life_secs;

            // Make power pellet burst visually distinct: large, bright white
            p.tint = color(1, 1, 1, 1);
            p.size = 0.13;

            this.particle_sim.particles.push(p);
            particles.push(p);
        }

        // Connect in a looser ring for a big elastic bloom
        for (let i = 0; i < count; i++) {
            const p1 = particles[i];
            const p2 = particles[(i + 1) % count];
            const s = new Spring();
            s.particle_1 = p1;
            s.particle_2 = p2;
            s.ks = 25;
            s.kd = 2.5;
            s.rest_length = 0.6;
            s.valid = true;
            this.particle_sim.springs.push(s);
        }
    }

    // ── Pacman death disintegration at current player position ───────────────
    _start_pacman_death_sequence() {
        if (!this.particle_sim) return;
        if (this.death_in_progress) return;

        this.death_in_progress = true;

        const x = this.player.x;
        const z = this.player.z;
        const center_y = 0.6;
        const life_secs = 2.5;
        const count = 40;

        const particles = [];

        for (let i = 0; i < count; i++) {
            const p = new Particle();
            p.mass = 0.4;
            p.pos = vec3(x, center_y, z);

            // Outward spiral-ish velocity with upward bias
            const angle = Math.random() * 2 * Math.PI;
            const radius_speed = 2.5 + Math.random() * 2.0;
            const tangential = 1.0 + Math.random() * 1.0;
            const vx = Math.cos(angle) * radius_speed - Math.sin(angle) * tangential;
            const vz = Math.sin(angle) * radius_speed + Math.cos(angle) * tangential;
            const vy = 4.0 + Math.random() * 1.5;
            p.vel = vec3(vx, vy, vz);

            p.ext_force = vec3(0, 0, 0);
            p.prev_pos = null;
            p.valid = true;

            p.life = 0;
            p.max_life = life_secs;

            // Yellow like Pacman, slightly larger pieces
            p.tint = color(1, 1, 0, 1);
            p.size = 0.12;
            p.tag  = "pacman_death";

            this.particle_sim.particles.push(p);
            particles.push(p);
        }
    }

    // ── Ghost frightened aura helpers ────────────────────────────────────────
    _spawn_ghost_aura(ghost) {
        if (!this.particle_sim) return;
        if (ghost._aura_particles) return;

        const count = 12;
        const radius = 0.5;
        const height_offset = 0.3;

        const aura_particles = [];

        for (let i = 0; i < count; i++) {
            const angle = (2 * Math.PI * i) / count;
            const px = ghost.x + radius * Math.cos(angle);
            const pz = ghost.z + radius * Math.sin(angle);
            const py = GHOST_Y + height_offset;

            const p = new Particle();
            p.mass = 0.3;
            p.pos = vec3(px, py, pz);

            // Small initial tangential velocity to give the ring some motion.
            const tangential_speed = 1.0;
            const vx = -Math.sin(angle) * tangential_speed;
            const vz =  Math.cos(angle) * tangential_speed;
            p.vel = vec3(vx, 0, vz);

            p.ext_force = vec3(0, 0, 0);
            p.prev_pos = null;
            p.valid = true;

            p.life = 0;
            p.max_life = 0; // persistent while frightened

            p.tint = color(0.3, 0.6, 1.0, 1.0);
            p.size = 0.06;
            p.tag  = "ghost_aura";

            this.particle_sim.particles.push(p);
            aura_particles.push(p);
        }

        // Connect into a ring with springs for a smooth elastic band.
        for (let i = 0; i < count; i++) {
            const p1 = aura_particles[i];
            const p2 = aura_particles[(i + 1) % count];
            const s = new Spring();
            s.particle_1 = p1;
            s.particle_2 = p2;
            s.ks = 40;
            s.kd = 4;
            s.rest_length = 2 * Math.PI * radius / count;
            s.valid = true;
            this.particle_sim.springs.push(s);
        }

        ghost._aura_particles = aura_particles;
    }

    _clear_ghost_aura(ghost) {
        if (!ghost._aura_particles) return;
        for (const p of ghost._aura_particles) {
            p.valid = false;
        }
        ghost._aura_particles = null;
    }

    _update_ghost_aura_for_frame(ghost, is_frightened) {
        const had_aura = !!ghost._aura_particles;

        // Translate existing aura with ghost's movement and lock its height.
        if (ghost._aura_particles) {
            const dx = ghost.x - ghost._last_x;
            const dz = ghost.z - ghost._last_z;
            const offset = vec3(dx, 0, dz);
            const target_y = GHOST_Y + 0.6;

            for (const p of ghost._aura_particles) {
                if (!p.valid) continue;
                p.pos = p.pos.plus(offset);
                if (p.prev_pos) {
                    p.prev_pos = p.prev_pos.plus(offset);
                }
                // Lock vertical position around the ghost so the ring floats.
                p.pos = vec3(p.pos[0], target_y, p.pos[2]);
                if (p.prev_pos) {
                    p.prev_pos = vec3(p.prev_pos[0], target_y, p.prev_pos[2]);
                }
            }
        }

        if (is_frightened) {
            if (!had_aura) {
                this._spawn_ghost_aura(ghost);
            }
        } else if (had_aura) {
            this._clear_ghost_aura(ghost);
        }

        ghost._last_x = ghost.x;
        ghost._last_z = ghost.z;
    }

    // ── Ghost eaten explosion at (x, z), tinted by ghost color ───────────────
    _spawn_ghost_eaten_particles(x, z, ghost_rgb) {
        if (!this.particle_sim) return;

        const count = 14;
        const center_y = 0.5;
        const life_secs = 1.5;

        const particles = [];

        for (let i = 0; i < count; i++) {
            const p = new Particle();
            p.mass = 0.4;
            p.pos = vec3(x, center_y, z);

            // Stronger radial explosion with a bit of upward bias
            const angle = Math.random() * 2 * Math.PI;
            const speed_xy = 3.0 + Math.random() * 2.0;
            const vx = Math.cos(angle) * speed_xy;
            const vz = Math.sin(angle) * speed_xy;
            const vy = 4.0 + Math.random() * 1.5;
            p.vel = vec3(vx, vy, vz);

            p.ext_force = vec3(0, 0, 0);
            p.prev_pos = null;
            p.valid = true;

            // Short lifetime for snappy explosion
            p.life = 0;
            p.max_life = life_secs;

            // Tint to match ghost body color if provided
            if (Array.isArray(ghost_rgb) && ghost_rgb.length >= 3) {
                p.tint = color(ghost_rgb[0], ghost_rgb[1], ghost_rgb[2], 1);
            }

            this.particle_sim.particles.push(p);
            particles.push(p);
        }

        // Loose spring links to give a gooey, cohesive look as they fly apart
        for (let i = 0; i < count; i++) {
            const p1 = particles[i];
            const p2 = particles[(i + 1) % count];
            const s = new Spring();
            s.particle_1 = p1;
            s.particle_2 = p2;
            s.ks = 20;
            s.kd = 1.5;
            s.rest_length = 0.6;
            s.valid = true;
            this.particle_sim.springs.push(s);
        }
    }

    // ── Controls / key bindings ───────────────────────────────────────────────
    render_controls()
    {
        this.control_panel.innerHTML += "Pac-Man &nbsp;|&nbsp; WASD to move<br>";

        this.key_triggered_button("(Un)pause", ["Alt", "a"], () => this.uniforms.animate ^= 1);
        this.key_triggered_button("Reset",     ["Alt", "r"], () => this._reset());
        // this.key_triggered_button("Test Win + Confetti", ["Alt", "w"], () => this._start_win_sequence());
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
        this.camera.apply(dt, this.player, this.uniforms, caller, {
            player_x:          this.player.x,
            player_z:          this.player.z,
            player_dx:         this.player.last_dir_x,
            player_dz:         this.player.last_dir_z,
            ghosts:            this.ghosts,
            frightened_timer:  this.frightened_timer,
            lives:             this.lives,
            pellets_remaining: this.pellets.filter(p => !p.eaten).length,
        });

        // ── Game logic (skip when paused or game is over) ─────────────────────
        // Note: we continue running after level completion so the win
        // confetti sequence can play out before the win overlay appears.
        if (this.uniforms.animate && !this.game_over)
        {
            // If Pacman is in a death sequence, freeze all normal game logic
            // and only step the particle system until the death effect ends.
            if (!this.death_in_progress && !this.win_sequence_active && !this.game_won) {
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
                            this.dots_eaten++;
                            this.last_dot_time = t;

                            // Spawn a small spring-connected particle burst at this pellet
                            this._spawn_pellet_particles(pellet.x, pellet.z);

                            // Play pellet-eaten sound (regular pellets only)
                            if (this.sounds) {
                                this.sounds.play('pellet', { volume: 0.4 });
                            }
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
                        this.dots_eaten++;
                        this.last_dot_time = t;

                        // Larger, more dramatic burst for power pellets
                        this._spawn_power_pellet_particles(pellet.x, pellet.z);
                    }
                }
            }

                // Frightened timer (ghosts flee / can be eaten)
                if (this.frightened_timer > 0) {
                    this.frightened_timer = Math.max(0, this.frightened_timer - dt);
                }

                // Ghost AI: chase, scatter, or flee
                const is_frightened = this.frightened_timer > 0;
                const [pacman_col, pacman_row] = world_to_tile(this.player.x, this.player.z);
                const blinky = this.ghosts[0];
                const [blinky_col, blinky_row] = blinky ? world_to_tile(blinky.x, blinky.z) : [pacman_col, pacman_row];
                let release_ghost_index = 0;
                for (let i = 1; i <= 3; i++) {
                    if (!this.ghosts[i].released) { release_ghost_index = i; break; }
                }
                const ghost_ctx = {
                    dots_eaten: this.dots_eaten,
                    last_dot_time: this.last_dot_time,
                    level: this.level,
                    boredom_force_release: (t - this.last_dot_time) > 4,
                    release_ghost_index,
                    pacman_col,
                    pacman_row,
                    pacman_dir_x: this.player.last_dir_x,
                    pacman_dir_z: this.player.last_dir_z,
                    blinky_col,
                    blinky_row,
                };
                for (const ghost of this.ghosts) {
                    ghost.update(dt, this.player.x, this.player.z, is_frightened, t, ghost_ctx);
                }

                // Ghost–player collision
                for (const ghost of this.ghosts) {
                    const dx = this.player.x - ghost.x;
                    const dz = this.player.z - ghost.z;
                    if (Math.sqrt(dx * dx + dz * dz) < GHOST_COLLIDE_RADIUS) {
                        if (is_frightened) {
                            // Ghost eaten: trigger ghost-specific particle burst + sound
                            this._spawn_ghost_eaten_particles(ghost.x, ghost.z, ghost.color);
                            if (this.sounds) {
                                this.sounds.play('ghosteat', { volume: 0.7 });
                            }
                            ghost.respawn();
                            this.score += GHOST_EAT_POINTS;
                        } else if (!this.death_in_progress) {
                            // Start Pacman death sequence; game logic will freeze
                            // until the death particles finish.
                            if (this.sounds) {
                                this.sounds.play('death', { volume: 0.8 });
                            }
                            this._start_pacman_death_sequence();
                        }
                    }
                }

                // Update / manage ghost auras around frightened ghosts
                for (const ghost of this.ghosts) {
                    this._update_ghost_aura_for_frame(ghost, is_frightened);
                }

                // Win condition — all pellets eaten
                const all_eaten =
                    this.pellets.every(p => p.eaten) &&
                    this.power_pellets.every(p => p.eaten);
                if (all_eaten && !this.level_complete) {
                    this._start_win_sequence();
                }
            }

            // ── Win confetti sequence timer ─────────────────────────────────
            if (this.win_sequence_active) {
                this.win_sequence_time += dt;
                if (this.win_sequence_time >= WIN_CONFETTI_SECONDS) {
                    this.win_sequence_active = false;
                    this.game_won           = true;
                }
            }

            // ── Particle simulation step (shares same dt) ────────────────────
            if (this.particle_sim) {
                this.particle_sim.update(dt);

                // Update lifetimes and cull expired particles.
                // Also track whether any Pacman-death particles remain.
                let any_pacman_death_alive = false;
                for (const p of this.particle_sim.particles) {
                    if (!p.valid || p.max_life <= 0) continue;
                    p.life += dt;
                    if (p.life >= p.max_life) {
                        p.valid = false;
                    } else if (p.tag === "pacman_death") {
                        any_pacman_death_alive = true;
                    }
                }
                // If Pacman death sequence is active and all its particles are gone,
                // now actually apply the life loss and respawn logic.
                if (this.death_in_progress && !any_pacman_death_alive) {
                    this.death_in_progress = false;
                    this.lives--;
                    this.player = new PacmanPlayer(START_X, START_Z);
                    for (const g of this.ghosts) g.respawn();
                    this.dots_eaten = 0;
                    this.last_dot_time = t;
                    if (this.lives <= 0) this.game_over = true;
                }
                // Optionally prune dead particles to keep arrays small
                this.particle_sim.particles =
                    this.particle_sim.particles.filter(p => p.valid);
                this.particle_sim.springs =
                    this.particle_sim.springs.filter(s => s.valid &&
                        s.particle_1 && s.particle_2 &&
                        s.particle_1.valid && s.particle_2.valid);
            }
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
        if (this.camera.mode !== 'first_person' && !this.death_in_progress) {
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

            // Draw aura ring around frightened ghosts
            if (is_frightened && ghost._aura_particles && ghost._aura_particles.length > 1) {
                const aura = ghost._aura_particles;
                const seg_mat = this.materials.ghost_aura;
                const count = aura.length;
                for (let i = 0; i < count; i++) {
                    const p1 = aura[i];
                    const p2 = aura[(i + 1) % count];
                    if (!p1.valid || !p2.valid) continue;

                    const v1 = p1.pos;
                    const v2 = p2.pos;
                    const mid = v1.plus(v2).times(0.5);
                    const dir = v2.minus(v1);
                    const len = dir.norm();
                    if (len < 1e-4) continue;

                    // Build transform for a thin cylinder segment between p1 and p2
                    let model = Mat4.translation(mid[0], mid[1], mid[2]);

                    // Default cylinder points along +y; align to dir.
                    const up = vec3(0, 1, 0);
                    const d = dir.normalized();
                    let axis = up.cross(d);
                    const axis_norm = axis.norm();
                    if (axis_norm > 1e-4) {
                        axis = axis.times(1 / axis_norm);
                        const angle = Math.acos(up.dot(d));
                        model = model.times(Mat4.rotation(angle, axis[0], axis[1], axis[2]));
                    }

                    model = model.times(Mat4.scale(0.03, len / 2, 0.03));
                    this.shapes.aura_segment.draw(caller, this.uniforms, model, seg_mat);
                }
            }
        }

        // ── Draw pellet / power / ghost particle effects ──────────────────────
        if (this.particle_sim) {
            for (const p of this.particle_sim.particles) {
                if (!p.valid) continue;

                // If this particle has a lifetime, fade alpha over its duration.
                // Win confetti fades more slowly so it stays visible for longer.
                let alpha = 1;
                if (p.max_life > 0) {
                    let ratio = p.life / p.max_life;
                    if (p.tag === "win_confetti") {
                        ratio *= 0.5; // half as fast fade-out
                    }
                    alpha = Math.max(0, 1 - ratio);
                }

                // Base size: power pellets / ghost explosions can override via p.size;
                // otherwise, tinted particles default larger than plain pellet sparks.
                const base_color = p.tint || color(1, 1, 0, 1);
                const scale = (p.size != null)
                    ? p.size
                    : (p.tint ? 0.13 : 0.08);
                const transform = Mat4.translation(p.pos[0], p.pos[1], p.pos[2])
                    .times(Mat4.scale(scale, scale, scale));

                // If the particle has its own tint, use that; otherwise default to yellow.
                const mat = { ...this.materials.particle,
                    color: color(base_color[0], base_color[1], base_color[2], alpha) };
                this.shapes.particle.draw(caller, this.uniforms, transform, mat);
            }
        }

        // ── Update HUD overlay ────────────────────────────────────────────────
        this._update_hud();
    }
}