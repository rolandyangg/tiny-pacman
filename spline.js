import {tiny} from './examples/common.js';
const { vec3 } = tiny;

// Adapted from assignment 1
export class CatmullRomSpline {
    constructor() {
        this.points = [];
        this.size   = 0;
    }

    add_point(p) {
        this.points.push(p);
        this.size++;
    }

    _compute_segment_index(t) {
        const n = this.size;
        if (t >= 1.0) return n - 2;
        return Math.floor(t * (n - 1));
    }

    _compute_local_t(t, seg_idx) {
        const n       = this.size;
        const t_start = seg_idx       / (n - 1);
        const t_end   = (seg_idx + 1) / (n - 1);
        return (t - t_start) / (t_end - t_start);
    }

    // Basis functions for CR segment
    _cr_segment(P0, P1, P2, P3, t) {
        const t2 = t * t;
        const t3 = t2 * t;

        const a0 = -t3 + 2*t2 - t;
        const a1 =  3*t3 - 5*t2 + 2;
        const a2 = -3*t3 + 4*t2 + t;
        const a3 =  t3   - t2;

        return P0.times(a0 * 0.5)
            .plus(P1.times(a1 * 0.5))
            .plus(P2.times(a2 * 0.5))
            .plus(P3.times(a3 * 0.5));
    }

    // Evaluate spline at t
    compute_position(t) {
        if (this.size === 0) return vec3(0, 0, 0);
        if (this.size === 1) return this.points[0];
        if (this.size === 2) {
            // Linear fallback
            return this.points[0].times(1 - t).plus(this.points[1].times(t));
        }

        t = Math.max(0, Math.min(1, t));

        const n       = this.size;
        const seg     = this._compute_segment_index(t);
        const local_t = this._compute_local_t(t, seg);

        const P1 = this.points[seg];
        const P2 = this.points[seg + 1];

        // reflect neighbor across endpoint when out of range
        const P0 = seg > 0
            ? this.points[seg - 1]
            : P1.times(2).minus(P2);

        const P3 = seg + 2 < n
            ? this.points[seg + 2]
            : P2.times(2).minus(P1);

        return this._cr_segment(P0, P1, P2, P3, local_t);
    }
}