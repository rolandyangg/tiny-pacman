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

    // ── Autopilot toggle ──────────────────────────────────────────────────────
    component.key_triggered_button("Toggle Autopilot", ["p"], () => {
        component.autopilot_on = !component.autopilot_on;
    });
    component.new_line();

    // ── WASD movement ─────────────────────────────────────────────────────────
    // In first/third person: directions are relative to current facing.
    // In top-down:           directions are absolute (north/south/east/west).

    component.key_triggered_button("← / Turn Left",  ["a"], () => {
        if (component.autopilot_on) return; // ignore input during autopilot
        const p = component.player;
        if (_is_local_mode(component)) {
            p.set_direction(p.last_dir_z, -p.last_dir_x);
        } else {
            p.set_direction(-1, 0);
        }
    });

    component.key_triggered_button("→ / Turn Right", ["d"], () => {
        if (component.autopilot_on) return;
        const p = component.player;
        if (_is_local_mode(component)) {
            p.set_direction(-p.last_dir_z, p.last_dir_x);
        } else {
            p.set_direction(1, 0);
        }
    });

    component.key_triggered_button("↑ / Forward",    ["w"], () => {
        if (component.autopilot_on) return;
        const p = component.player;
        if (_is_local_mode(component)) {
            p.set_direction(p.last_dir_x, p.last_dir_z);
        } else {
            p.set_direction(0, -1);
        }
    });

    component.key_triggered_button("↓ / Backward",   ["s"], () => {
        if (component.autopilot_on) return;
        const p = component.player;
        if (_is_local_mode(component)) {
            p.set_direction(-p.last_dir_x, -p.last_dir_z);
        } else {
            p.set_direction(0, 1);
        }
    });
}

// ── Helpers ───────────────────────────────────────────────────────────────────

// Returns true when controls should be relative to Pac-Man's facing direction
function _is_local_mode(component) {
    const mode = component.camera.mode;
    return mode === 'first_person' || mode === 'third_person';
}