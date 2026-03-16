export class SoundManager {
    constructor(mapping) {
        this.sounds = {};
        for (const [name, url] of Object.entries(mapping)) {
            const audio = new Audio(url);
            audio.preload = 'auto';
            this.sounds[name] = audio;
        }
    }

    play(name, { volume = 1.0 } = {}) {
        const template = this.sounds[name];
        if (!template) return;

        // Clone so multiple instances can overlap without cutting off
        const audio = template.cloneNode();
        audio.volume = volume;
        audio.play().catch(() => {
            // Ignore autoplay / gesture errors.
        });
    }
}

