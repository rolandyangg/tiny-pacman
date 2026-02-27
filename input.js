export function register_key_bindings(component) {

    // ── Camera mode selection ─────────────────────────────────────────────────
    component.key_triggered_button("Top-Down Camera",    ["1"], () => {
        component.camera.mode = 'top_down';
    });
    component.key_triggered_button("Third-Person Camera", ["2"], () => {
        component.camera.mode = 'third_person';
    });
    component.key_triggered_button("First-Person Camera", ["3"], () => {
        component.camera.mode = 'first_person';
    });
    component.new_line();

    // ── Third-person zoom ─────────────────────────────────────────────────────
    component.key_triggered_button("Zoom In",  ["z"], () => {
        component.camera.follow_dist = Math.max(1.5, component.camera.follow_dist - 0.5);
    });
    component.key_triggered_button("Zoom Out", ["x"], () => {
        component.camera.follow_dist = Math.min(8.0, component.camera.follow_dist + 0.5);
    });
    component.new_line();

    // ── Movement ─────────────────────────────────────────────────────────
    // In first/third person: directions are relative to current facing dir
    // In top-down: directions are absolute (north/south/east/west)

    component.key_triggered_button("← / Turn Left",  ["a"], () => {
        const p = component.player;
        if (_is_local_mode(component)) {
            // 90 deg CCW of current facing: (fz, -fx)
            p.set_direction(p.last_dir_z, -p.last_dir_x);
        } else {
            p.set_direction(-1, 0);
        }
    });

    component.key_triggered_button("→ / Turn Right", ["d"], () => {
        const p = component.player;
        if (_is_local_mode(component)) {
            // 90 deg CW of current facing: (-fz, fx)
            p.set_direction(-p.last_dir_z, p.last_dir_x);
        } else {
            p.set_direction(1, 0);
        }
    });

    component.key_triggered_button("↑ / Forward",    ["w"], () => {
        const p = component.player;
        if (_is_local_mode(component)) {
            p.set_direction(p.last_dir_x, p.last_dir_z);
        } else {
            p.set_direction(0, -1);
        }
    });

    component.key_triggered_button("↓ / Backward",   ["s"], () => {
        const p = component.player;
        if (_is_local_mode(component)) {
            p.set_direction(-p.last_dir_x, -p.last_dir_z);
        } else {
            p.set_direction(0, 1);
        }
    });
}

// ── Helpers ───────────────────────────────────────────────────────────────────

// Returns true when controls should be relative to pac mans facing direction
function _is_local_mode(component) {
    const mode = component.camera.mode;
    return mode === 'first_person' || mode === 'third_person';
}