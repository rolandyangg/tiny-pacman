import { tiny, defs } from './examples/common.js';

// Pull these names into this module's scope for convenience:
const { vec3, vec4, color, Mat4, Shape, Material, Shader, Texture, Component } = tiny;

// Standalone particle-spring physics engine for visual effects.
// This module is not yet wired into the Pacman gameplay; it just exposes
// reusable classes that can be imported elsewhere later.

class Particle {
  constructor() {
    this.mass = 0;
    this.pos = vec3(0, 0, 0);
    this.vel = vec3(0, 0, 0);
    this.acc = vec3(0, 0, 0);
    this.ext_force = vec3(0, 0, 0);
    this.valid = false;

    // For Verlet integration
    this.prev_pos = null;
  }

  update(dt, integration_method) {
    if (!this.valid) {
      throw "Initialization not complete";
    }

    if (this.mass <= 0) throw "Particle mass must be positive";

    // F = ma
    this.acc = this.ext_force.times(1 / this.mass);

    if (integration_method === "euler") {
      this.pos = this.pos.plus(this.vel.times(dt));
      this.vel = this.vel.plus(this.acc.times(dt));
      return;
    }
    else if (integration_method === "symplectic") {
      this.vel = this.vel.plus(this.acc.times(dt));
      // One step ahead (v(t + dt) used)
      this.pos = this.pos.plus(this.vel.times(dt));
      return;
    }
    else if (integration_method === "verlet") {
      if (this.prev_pos === null) {
        // Initialize previous position using velocity
        this.prev_pos = this.pos.minus(this.vel.times(dt));
      }

      // Verlet integration:
      // x(t + dt) = 2 x(t) - x(t - dt) + a(t) * dt^2
      const next_pos = this.pos.times(2).minus(this.prev_pos).plus(this.acc.times(dt * dt));

      // Forward difference to compute velocity
      const next_vel = next_pos.minus(this.pos).times(1 / dt);

      this.prev_pos = this.pos;
      this.pos = next_pos;
      this.vel = next_vel;
      return;
    }

    throw "Unknown integration method: " + integration_method;
  }
}

class Spring {
  constructor() {
    this.particle_1 = null;
    this.particle_2 = null;
    this.ks = 0;
    this.kd = 0;
    this.rest_length = 0;
    this.valid = false;
  }

  update() {
    if (!this.valid) {
      throw "Initialization not complete";
    }

    const x_j = this.particle_2;
    const x_i = this.particle_1;

    const D_ij = x_j.pos.minus(x_i.pos);
    const d_ij = D_ij.norm();
    // Safeguard in case particles are on top of each other
    if (d_ij < 1e-8) {
      return;
    }

    const d_hat = D_ij.times(1 / d_ij);
    const v_ij = x_j.vel.minus(x_i.vel);

    // Spring force (elastic)
    const fs = d_hat.times(this.ks * (d_ij - this.rest_length));

    // Damper force (viscous)
    const fd = d_hat.times(this.kd * v_ij.dot(d_hat));

    const fe_ij = fs.plus(fd);

    // Apply equal and opposite forces
    this.particle_1.ext_force.add_by(fe_ij);
    this.particle_2.ext_force.subtract_by(fe_ij);
  }
}

// Renamed to avoid conflict with defs.Simulation from collisions-demo.js.
class ParticleSimulation {
  constructor() {
    this.particles = [];
    this.springs = [];
    this.g_acc = vec3(0, -9.8, 0);
    this.ground_ks = 0;
    this.ground_kd = 0;

    this.integration_method = null;
    this.valid = false;
    this.integration_dt = 0.01;
    this.t_sim = 0; // simulation time accumulator (seconds)
  }

  update(dt) {
    if (!this.valid) {
      throw "Initialization not complete";
    }

    for (const p of this.particles) {
      if (!p.valid) continue;

      // Reset external force accumulator
      p.ext_force = vec3(0, 0, 0);

      // Add gravity
      p.ext_force = p.ext_force.plus(this.g_acc.times(p.mass));

      // Ground collision and damping (penalty method for plane y=0)
      const plane_p = vec3(0, 0, 0);
      const plane_n = vec3(0, 1, 0);

      const phi = p.pos.minus(plane_p).dot(plane_n);

      if (phi < 0) {
        const penetration = -phi;
        const vn = p.vel.dot(plane_n);
        let fN = this.ground_ks * penetration - this.ground_kd * vn;
        if (fN < 0) fN = 0;

        p.ext_force.add_by(plane_n.times(fN));

        // Simple restitution on collision
        const e = 0.9; // restitution coefficient (0 = no bounce, 1 = perfect)
        if (vn < 0) {
          const restitution = plane_n.times(vn * (1 + e));
          p.vel = p.vel.minus(restitution);
        }

        // Simple tangential (viscous) friction to damp motion parallel to the plane
        const vN = plane_n.times(p.vel.dot(plane_n));
        const vT = p.vel.minus(vN);

        const kt = 15;
        p.ext_force.add_by(vT.times(-kt));
      }
    }

    for (const s of this.springs) {
      if (!s.valid) continue;
      s.update();
    }

    for (const p of this.particles) {
      if (!p.valid) continue;
      p.update(dt, this.integration_method);
    }

    this.t_sim += dt;
  }
}

export { Particle, Spring, ParticleSimulation };

