import {tiny, defs} from './examples/common.js';
import {get_wall_positions, get_pellet_positions, get_power_pellet_positions, MAZE_COLS, MAZE_ROWS, WALL_HEIGHT, FLOOR_MARGIN} from './pacman-map.js';
import {Pellet, PowerPellet, create_pellet_assets} from './pacman-pellets.js';

const { vec3, vec4, color, Mat4, Shape, Material, Shader, Texture, Component } = tiny;

export class Pacman extends Component
{
  init()
  {
    this.shapes = { wall: new defs.Cube(), floor: new defs.Cube() };
    const phong = new defs.Phong_Shader();
    this.materials = {
      wall: { shader: phong, ambient: 0.3, diffusivity: 1, specularity: 0.3, color: color(0.2, 0.3, 1, 1) },
      floor: { shader: phong, ambient: 0.5, diffusivity: 0.8, specularity: 0, color: color(0, 0, 0, 1) }
    };
    this.wall_positions = get_wall_positions();

    this.pellet_assets = create_pellet_assets();
    this.pellets = get_pellet_positions().map(([x, z]) => new Pellet(x, z));
    this.power_pellets = get_power_pellet_positions().map(([x, z]) => new PowerPellet(x, z));
  }

  render_controls()
  {
    // All placeholder default
    this.control_panel.innerHTML += "Pacman game placeholder<br>";
    this.key_triggered_button("(Un)pause animation", ["Alt", "a"], () => this.uniforms.animate ^= 1);
  }

  render_animation(caller)
  {
    if (!caller.controls)
    {
      this.animated_children.push(caller.controls = new defs.Movement_Controls({ uniforms: this.uniforms }));
      caller.controls.add_mouse_controls(caller.canvas);
      Shader.assign_camera(Mat4.look_at(vec3(0, 50, 0), vec3(0, 0, 0), vec3(0, 0, -1)), this.uniforms);
    }
    this.uniforms.projection_transform = Mat4.perspective(Math.PI / 4, caller.width / caller.height, 1, 200);
    this.uniforms.lights = [defs.Phong_Shader.light_source(vec4(0, 1, 1, 0), color(1, 1, 1, 1), 100000)];

    const half_x = MAZE_COLS / 2 + FLOOR_MARGIN;
    const half_z = MAZE_ROWS / 2 + FLOOR_MARGIN;
    const floor_transform = Mat4.translation(0, -0.5, 0).times(Mat4.scale(half_x, 0.5, half_z));
    this.shapes.floor.draw(caller, this.uniforms, floor_transform, this.materials.floor);

    for (const [x, z] of this.wall_positions) {
      const wall_transform = Mat4.translation(x, WALL_HEIGHT / 2, z).times(Mat4.scale(0.5, WALL_HEIGHT / 2, 0.5));
      this.shapes.wall.draw(caller, this.uniforms, wall_transform, this.materials.wall);
    }

    for (const pellet of this.pellets) pellet.draw(caller, this.uniforms, this.pellet_assets);
    for (const pellet of this.power_pellets) pellet.draw(caller, this.uniforms, this.pellet_assets);
  }
}
