import {tiny, defs} from './examples/common.js';

const { vec3, vec4, color, Mat4, Shape, Material, Shader, Texture, Component } = tiny;

export class Pacman extends Component
{
  init()
  {
    this.shapes = {};
    this.materials = {};
  }

  render_controls()
  {
    // All placeholder default
    this.control_panel.innerHTML += "Pacman game placeholder<br>";
    this.key_triggered_button("(Un)pause animation", ["Alt", "a"], () => this.uniforms.animate ^= 1);
  }

  render_animation(caller)
  {
    // All placeholder default
    if (!caller.controls)
    {
      this.animated_children.push(caller.controls = new defs.Movement_Controls({ uniforms: this.uniforms }));
      caller.controls.add_mouse_controls(caller.canvas);
      Shader.assign_camera(Mat4.translation(0, 0, -10), this.uniforms);
    }
    this.uniforms.projection_transform = Mat4.perspective(Math.PI / 4, caller.width / caller.height, 1, 100);
    this.uniforms.lights = [defs.Phong_Shader.light_source(vec4(0, 0, 1, 0), color(1, 1, 1, 1), 100000)];
  }
}
