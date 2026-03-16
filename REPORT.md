# CS C174C Term Project Report: Pac-Man+ (3D Pac-Man)

**Members:** Jesus Cuevas (UID: 305966056), Tahsin Ahmed (306008946),
Aneesh Ratnala (106490501), Roland Yang (506053914)

---

## 1. Project Overview & Theme

**Pac-Man+** is a 3D re-creation of the classic arcade game Pac-Man. The theme is a
faithful adaptation of the original: the player controls Pac-Man through a maze, collects
pellets and power pellets, avoids four ghosts, and uses the power pellets to temporarily
turn the tables and eat ghosts for bonus points. The project combines real-time 3D graphics
with classic gameplay, rendered in WebGL using the **tiny-graphics** library, as discussed
in class.

The application runs in the latest Chrome and uses HTML, JavaScript, and the framework's
built-in shaders. Rendering and core logic are implemented directly on top of tiny-graphics
without relying on third-party game engines.

**Creativity** is shown in translating 2D maze gameplay into a 3D scene: a top-down view
of a 3D maze with walls, floor, and lit characters; multiple camera modes (top-down,
first-person, third-person) with smooth following; a cinematic director system with
spline-based camera transitions; a BFS-based autopilot that plays the game autonomously;
and ghost AI that closely mirrors the original (Blinky, Pinky, Inky, Clyde) with distinct
chase behaviors and a ghost house with Blinky starting outside and the others exiting
to chase.

Essentially, we wanted to use animation techniques from this class to create a new way
to enjoy what might be the world's most ubiquitous game.

---

## 2. Technical Implementation

The project is structured as a single main scene (`Pacman` component in `pacman.js`)
that composes:

- **Rendering:** Walls and floor as cubes, Pac-Man and ghosts as subdivision spheres,
  pellets and power pellets as smaller spheres, all drawn with the Phong shader
  from tiny-graphics.

- **Maze:** A 28×31 tile grid defined in `pacman-map.js` (ASCII grid: walls, paths,
  pellets, power pellets, ghost house). World-space tile centers are computed for
  movement and collision.

- **Player:** `PacmanPlayer` in `pacman-player.js`: tile-based movement, direction
  buffering (WASD), and wall checks so turns happen at tile centers and movement
  stays aligned to the maze.

- **Ghosts:** `Ghost` class in `pacman-ghosts.js`: each ghost has a spawn (Blinky
  outside the house, others inside), release logic, and pathfinding toward a target
  tile. Chase targets differ by ghost.

- **Camera:** `CameraController` in `camera.js`: top-down, first-person, and
  third-person modes with lerp-based smooth following, plus a **cinematic mode**
  driven by a `Director` class in `pacman-director.js`. Pressing P engages cinematic
  mode alongside the BFS autopilot.

- **Director:** `Director` class in `pacman-director.js`: selects and sequences camera
  shots automatically, computing eye positions as offsets from Pac-Man's position and
  transitioning between shots using Catmull-Rom splines where appropriate.

- **Autopilot:** `PacmanAutopilot` in `pacman-autopilot.js`: a BFS-based agent that
  plays the game autonomously, evaluating a priority-ordered decision stack each tick
  to flee ghosts, hunt frightened ghosts, or collect the nearest pellet.

- **Input:** Keyboard controls in `input.js`: game state (pause, reset, score, lives)
  is updated in the main game loop in `pacman.js`.

The game loop advances with delta time: move player, collect pellets and power pellets,
update frightened timer, update ghost AI, resolve ghost–player collisions, then draw the
scene and HUD. Win/loss overlays and a score/lives HUD are implemented with HTML/CSS
over the canvas.

---

## 3. Four Animation Algorithms

As required, our project uses **at least four** computer animation algorithms that
support the same theme (3D Pac-Man).

### 3.1 Collision Detection

Collision is used for core gameplay and is implemented in two ways:

- **Sphere–sphere (or radius-based) collision:** Pac-Man collects a pellet or power
  pellet when the distance between their centers is below `COLLECT_RADIUS`.
  Ghost–player collision uses a similar threshold (`GHOST_COLLIDE_RADIUS`): if the
  distance is below it and ghosts are not frightened, the player loses a life (and
  ghosts/player respawn); if frightened, the ghost is eaten and the player gains points.

- **Tile/wall collision:** The maze is a grid. The player and ghosts use `world_to_tile`
  to get tile coordinates and `is_wall(col, row)` to test adjacent tiles. Movement is
  constrained so entities never enter wall tiles; turns and direction changes are
  validated against the grid so motion stays on the path and feels correct. For Pac-Man
  specifically, wall contact uses a penalty-based response inspired by Assignment 3's
  penalty-spring collision: when a blocked tile is detected ahead, Pac-Man overshoots
  the tile center, strikes the wall face, and is reflected back toward the center with
  a damped restitution coefficient (BOUNCE_RESTITUTION = 0.55), coming to rest at the
  tile center.

No third-party physics libraries are used; all checks are done in the game logic.

### 3.2 Pathfinding & Behavioral Animation (Ghost AI + Autopilot)

Ghost behavior is **rule-based behavioral animation**: at each tile center, each ghost
chooses the next direction by evaluating a target and picking the adjacent tile that
minimizes distance to that target (no full-path search).

- **Modes:** Each ghost alternates between **scatter** (move toward a fixed corner) and
  **chase** (move toward a chase target) on a time-based schedule (e.g., scatter for
  7 seconds, chase for 20, repeating). When a power pellet is active, ghosts use
  **frightened** mode: random valid direction at each tile, slower speed, and they
  can be eaten.

- **Targets:**
  - **Blinky (red):** Chase target = Pac-Man's current tile.
  - **Pinky (pink):** Chase target = tile 4 steps ahead of Pac-Man in his current
    direction (ambush).
  - **Inky (cyan):** Chase target = point derived from "2 tiles ahead of Pac-Man"
    and Blinky's position (vector-based target).
  - **Clyde (orange):** Chases Pac-Man's tile until within ~8 tiles, then switches
    target to his scatter corner ("gets scared").

- **Ghost house:** Blinky spawns outside the house; Pinky, Inky, and Clyde spawn
  inside and are released immediately (0 dots). Once released, they pathfind toward
  the exit tile and then behave normally. This uses the same "choose direction toward
  target" logic with the exit tile as the target.

The **BFS autopilot** (`pacman-autopilot.js`) implements a separate agent that plays
the game autonomously by treating the maze as a tile graph and running breadth-first
search to find shortest paths to targets. Each decision tick it evaluates a
priority-ordered stack: a random mistake roll (to prevent repeating play), then flee
if a non-frightened ghost is within danger radius (BFS flee or grab a nearby power
pellet), then BFS-hunt the nearest frightened ghost, then BFS toward the nearest
uneaten pellet. Key thresholds (danger radius, flee lookahead, hunt give-up distance)
are randomized per session via Gaussian noise so no two runs play identically. The
autopilot engages alongside cinematic mode when the player presses P, creating a live
broadcast-like view.

### 3.3 Parametric Motion & Spline-Based Camera

Smooth turning and movement transitions are implemented using parametric motion in
time and interpolation:

- **Parametric motion:** Player and ghost positions are updated each frame with
  `position += direction * speed * dt`, so movement is defined as a function of time
  (parametric in *t*). This gives continuous, predictable motion along the current
  direction.

- **Smooth turning:** The player uses **direction buffering**: the next input direction
  is stored and applied only when the player reaches a tile center. That way turns
  happen at discrete decision points and movement does not jitter; transitions between
  directions are smooth and aligned to the maze grid. Ghosts use the same idea by
  choosing a new direction only when near the center of a tile.

- **Movement smoothing (camera):** In first-person and third-person modes, the camera
  does not snap to the player's facing. The look direction is **interpolated** each
  frame toward the player's direction (e.g.
  `cam_look_x += (player.last_dir_x - cam_look_x) * SMOOTHING * dt` in `camera.js`).
  Third-person also interpolates the camera position toward a point behind the player.
  These transitions produce smooth camera motion instead of instant snaps.

- **Cinematic director & Catmull-Rom splines:** Cinematic mode introduces a `Director`
  class (`pacman-director.js`) that selects and sequences camera shots automatically.
  The director holds a shot type, a countdown timer, and the last eye position as its
  complete state. Shot positions are computed each frame as offsets from Pac-Man's
  current position and smoothed facing direction, so the camera continuously tracks
  movement between cuts. When certain events occur, the director interrupts with an
  event-specific shot. Ghost-approach and near-ghost shots, as well as the opening
  descent from the initial overhead position, transition via **Catmull-Rom splines**:
  a 4-point curve where P1 is the current eye position and P2 is the target, and
  phantom endpoints P0 and P3 are offset laterally and upward from P1 and P2 to shape
  a cinematic arcing motion. A per-frame LERP additionally smooths the rendered eye
  toward the recomputed target, eliminating snapping on both cuts and mid-shot
  direction changes.

### 3.4 Particle Systems (Visual Effects)

The particle system is adapted from Assignment 3 and implemented in `particle-springs.js` with a shared `ParticleSimulation` in the main game loop. The simulation uses **Verlet integration**, gravity (`g_acc`), and a ground plane (y = 0) with penalty-style collision and restitution so particles bounce. Each **Particle** has mass, position, velocity, optional lifetime (`life`/`max_life`), optional color tint and size, and is updated by accumulating external forces (gravity, spring forces) then stepping with the chosen integrator. **Springs** connect pairs of particles with stiffness `ks`, damping `kd`, and rest length; they apply elastic and viscous forces but are **not rendered**—only the particle spheres are drawn.

**Effect types (all spawn particles with velocities in random or structured directions):**

- **Pellet collected:** 5 particles at the pellet position, random outward + upward velocity; connected in a **ring** with springs (ks=30, kd=2, rest_length=0.4). Short lifetime (~2 s), default yellow.
- **Power pellet collected:** 15 particles, stronger outward + upward burst; again a **ring** of springs (ks=25, kd=2.5, rest_length=0.6). White tint, larger size, ~3 s life.
- **Ghost eaten:** 14 particles at the ghost position, radial explosion with upward bias; **ring** springs (ks=20, kd=1.5) for a cohesive “gooey” burst. Per-particle tint matches the ghost color (red/pink/cyan/orange), ~1.5 s life.
- **Ghost frightened aura:** 12 particles arranged in a **ring** around the ghost (radius 0.5), tangential initial velocity; ring springs (ks=40, kd=4, rest length from arc). Blue tint, small size; no max life—they persist and are translated each frame with the ghost until the ghost leaves frightened mode, then they are culled.
- **Pac-Man death:** 40 particles at the player position, outward spiral-like velocity; **no springs**—free burst. Yellow tint, ~2.5 s life; game waits for these to expire before respawn.
- **Win confetti:** Large burst (~800 particles) scattered across the maze footprint, random bright colors and upward burst; **no springs**. Used when all pellets are collected.

---

## 4. Gameplay Loop & Features

- **Start:** Pac-Man and ghosts spawn (Blinky outside, others inside then immediately
  released). Pellets and power pellets are placed from the maze data.
- **Loop:** Player moves (WASD); toggles between cameras & zooms (Z/C); pellets and
  power pellets are collected by distance; power pellet starts the frightened timer.
  Ghosts update (pathfinding, mode, release) and then ghost–player collision is checked.
  Score and lives update; on death, player and ghosts respawn and dot counters reset so
  ghost release behavior matches level start.
- **End:** Game over when lives reach zero; win when all pellets and power pellets
  are collected.

**Features:** 3D maze and characters; keyboard controls; multiple camera modes
(top-down, first-person, third-person); cinematic director mode with Catmull-Rom spline
transitions (with BFS auto-player); power pellets and scoring; lives and HUD;
win/lose overlays; reset and pause.

---

## 5. External Code & References

- **tiny-graphics library:** Used as the base framework (WebGL, shapes, shaders,
  components). The project uses the library's component structure, Phong shader, and
  math utilities; minor adaptations may exist in the project for convenience.
- **No other third-party libraries** are used for rendering or core game logic.
  The implementation is HTML + JavaScript, with optional use of GLSL only as provided
  by tiny-graphics.

---

## 6. Conclusion

Pac-Man+ delivers a 3D re-creation of the classic arcade game in the browser, built on
the tiny-graphics framework. Our project realizes this theme: a real-time 3D maze with
tile-based movement, collision for pellets and ghosts, behavioral ghost AI (chase,
scatter, frightened), parametric motion plus interpolation for smooth turning and camera
following, and a Catmull-Rom spline cinematic director system. The four algorithm areas
from our proposal (collision detection, pathfinding and ghost AI, spline-based/parametric
motion and movement smoothing, and particle systems) are all tied to this single Pac-Man+
theme, and our result is Pac-Man+: enhancing gameplay while keeping the original's feel.