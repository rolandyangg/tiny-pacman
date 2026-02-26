import {tiny} from './examples/common.js';

const { vec3, Mat4, Shader } = tiny;

export class CameraController {
    constructor() {
        this.reset();
    }

    reset() {
        this.mode           = 'top_down'; //top_down, first_person, third_person
        this.cam_look_x     = 0;
        this.cam_look_z     = -1; // default looking down for top down
        this.cam_third_x    = 0;
        this.cam_third_z    = 0;
        this.follow_dist    = 3.5; // third person default follow dist
    }

    // camera logic, applies after every delta t
    apply(dt, player, uniforms, caller) {
        if (this.mode === 'first_person') {
            this._apply_first_person(dt, player, uniforms, caller);
        } else if (this.mode === 'third_person') {
            this._apply_third_person(dt, player, uniforms, caller);
        } else {
            this._apply_top_down(uniforms, caller);
        }
    }

    // apply first person transform
    _apply_first_person(dt, player, uniforms, caller) {
        const SMOOTHING  = 8.0; // so the camera doesn't snap
        const EYE_HEIGHT = 0.55;
        const FOV        = Math.PI / 6; // 30 deg
        const PULL_BACK  = 0.2;

        // Lerp stored look direction toward player's last facing
        this.cam_look_x += (player.last_dir_x - this.cam_look_x) * SMOOTHING * dt;
        this.cam_look_z += (player.last_dir_z - this.cam_look_z) * SMOOTHING * dt;

        const eye = vec3(
            player.x - this.cam_look_x * PULL_BACK,
            EYE_HEIGHT,
            player.z - this.cam_look_z * PULL_BACK
        );
        const at = vec3(
            player.x + this.cam_look_x,
            EYE_HEIGHT,
            player.z + this.cam_look_z
        );

        Shader.assign_camera(Mat4.look_at(eye, at, vec3(0, 1, 0)), uniforms);
        uniforms.projection_transform =
            Mat4.perspective(FOV, caller.width / caller.height, 0.1, 200);
    }

    _apply_third_person(dt, player, uniforms, caller) {
        const SMOOTHING   = 6.0; // so the cam doesnt snpa
        const CAM_HEIGHT  = 2.5;
        const LOOK_HEIGHT = 0.35;
        const FOV         = Math.PI / 4;

        // Lerp look direction (same approach as first-person)
        this.cam_look_x += (player.last_dir_x - this.cam_look_x) * SMOOTHING * dt;
        this.cam_look_z += (player.last_dir_z - this.cam_look_z) * SMOOTHING * dt;

        const target_cam_x = player.x - this.cam_look_x * this.follow_dist;
        const target_cam_z = player.z - this.cam_look_z * this.follow_dist;

        // Smooth the camera position
        this.cam_third_x += (target_cam_x - this.cam_third_x) * SMOOTHING * dt;
        this.cam_third_z += (target_cam_z - this.cam_third_z) * SMOOTHING * dt;

        const eye = vec3(this.cam_third_x, CAM_HEIGHT, this.cam_third_z);
        const at  = vec3(player.x, LOOK_HEIGHT, player.z);

        Shader.assign_camera(Mat4.look_at(eye, at, vec3(0, 1, 0)), uniforms);
        uniforms.projection_transform =
            Mat4.perspective(FOV, caller.width / caller.height, 0.1, 200);
    }

    _apply_top_down(uniforms, caller) {
        Shader.assign_camera(
            Mat4.look_at(vec3(0, 50, 0), vec3(0, 0, 0), vec3(0, 0, -1)),
            uniforms
        );
        uniforms.projection_transform =
            Mat4.perspective(Math.PI / 4, caller.width / caller.height, 1, 200);
    }
}