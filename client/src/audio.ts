export class AudioEngine {
  private ctx?: AudioContext;
  private musicTimer?: ReturnType<typeof setInterval>;
  volume = Number(localStorage.getItem('luma-sound') ?? 0.35);
  music = Number(localStorage.getItem('luma-music') ?? 0.12);
  muted = localStorage.getItem('luma-muted') === 'true';
  private note = 0;
  unlock() {
    this.ctx ??= new AudioContext();
    void this.ctx.resume();
    if (!this.musicTimer)
      this.musicTimer = setInterval(() => {
        const notes = [130.81, 164.81, 196, 261.63, 196, 164.81, 146.83, 196];
        this.tone(notes[this.note++ % notes.length], 1.8, 'sine', this.music * 0.08);
      }, 1800);
  }
  private tone(
    freq: number,
    duration: number,
    type: OscillatorType = 'sine',
    level = this.volume * 0.14,
    end?: number,
  ) {
    if (!this.ctx || this.muted || level <= 0) return;
    const now = this.ctx.currentTime,
      osc = this.ctx.createOscillator(),
      gain = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, now);
    if (end) osc.frequency.exponentialRampToValueAtTime(end, now + duration);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, level), now + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    osc.connect(gain).connect(this.ctx.destination);
    osc.start(now);
    osc.stop(now + duration + 0.05);
  }
  play(type: 'eat' | 'boost' | 'death' | 'join' | 'click') {
    if (type === 'eat') this.tone(660 + Math.random() * 220, 0.09);
    if (type === 'boost') this.tone(100, 0.28, 'triangle', this.volume * 0.09, 220);
    if (type === 'death') this.tone(260, 0.65, 'triangle', this.volume * 0.15, 45);
    if (type === 'join') {
      this.tone(330, 0.25);
      setTimeout(() => this.tone(660, 0.4), 110);
    }
    if (type === 'click') this.tone(500, 0.06);
  }
  save() {
    localStorage.setItem('luma-sound', String(this.volume));
    localStorage.setItem('luma-music', String(this.music));
    localStorage.setItem('luma-muted', String(this.muted));
  }
}
