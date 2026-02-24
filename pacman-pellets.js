import {tiny, defs} from './examples/common.js';
import {PELLET_Y} from './pacman-map.js';

const { color, Mat4, Component } = tiny;

export function create_pellet_assets() {
  const phong = new defs.Phong_Shader();
  return {
    shapes: {
      pellet: new defs.Subdivision_Sphere(1),
      power_pellet: new defs.Subdivision_Sphere(2),
    },
    materials: {
      pellet: { shader: phong, ambient: 1, diffusivity: 0.2, specularity: 0.1, color: color(1, 1, 0.2, 1) },
      power_pellet: { shader: phong, ambient: 1, diffusivity: 0.3, specularity: 0.2, color: color(1, 1, 0.1, 1) },
    }
  };
}

export class Pellet {
  static radius = 0.12;

  constructor(x, z) {
    this.x = x;
    this.z = z;
    this.eaten = false;
    this.transform = Mat4.translation(x, PELLET_Y, z)
      .times(Mat4.scale(Pellet.radius, Pellet.radius, Pellet.radius));
  }

  eat() { this.eaten = true; }

  draw(caller, uniforms, assets) {
    if (this.eaten) return;
    assets.shapes.pellet.draw(caller, uniforms, this.transform, assets.materials.pellet);
  }
}

export class PowerPellet {
  static radius = 0.22;

  constructor(x, z) {
    this.x = x;
    this.z = z;
    this.eaten = false;
    this.transform = Mat4.translation(x, PELLET_Y, z)
      .times(Mat4.scale(PowerPellet.radius, PowerPellet.radius, PowerPellet.radius));
  }

  eat() { this.eaten = true; }

  draw(caller, uniforms, assets) {
    if (this.eaten) return;
    assets.shapes.power_pellet.draw(caller, uniforms, this.transform, assets.materials.power_pellet);
  }
}

