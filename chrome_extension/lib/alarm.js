// Chuong bao lien tuc (Web Audio, khong can file am thanh) — keu cho toi khi stop().
//
// Chrome chi cho phat am thanh sau khi nguoi dung da tung bam vao trang: goi unlock()
// trong cac nut (Bat dau, Tiep tuc job, Thu chuong). Tab Dashboard nam an phia sau van keu.

export class Alarm {
  constructor(sleep) {
    this.sleep = sleep; // hen gio khong bi ha toc khi tab an (timer-worker)
    this.ctx = null;
    this.ringing = false;
    this.muted = false;
    this.onChange = null;
  }

  /** Tao / danh thuc AudioContext — goi trong luc xu ly 1 cu bam. */
  unlock() {
    try {
      this.ctx ??= new AudioContext();
      if (this.ctx.state === "suspended") this.ctx.resume();
    } catch { /* trinh duyet khong ho tro */ }
  }

  get blocked() {
    return !this.ctx || this.ctx.state !== "running";
  }

  /** 1 hoi chuong: 3 tieng bip cao-thap-cao. */
  beep() {
    this.unlock();
    const ctx = this.ctx;
    if (!ctx) return;
    const t0 = ctx.currentTime + 0.02;
    [988, 740, 988].forEach((freq, i) => {
      const t = t0 + i * 0.28;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "triangle";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(0.5, t + 0.02);
      gain.gain.linearRampToValueAtTime(0, t + 0.22);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 0.25);
    });
  }

  /** Bat dau keu lap lai (khong cho) — moi ~2.5 giay 1 hoi. */
  start() {
    if (this.ringing) return;
    this.ringing = true;
    this.muted = false;
    this.onChange?.();
    (async () => {
      while (this.ringing) {
        if (!this.muted) this.beep();
        await this.sleep(2500);
      }
    })();
  }

  /** Tat tieng tam thoi (nguoi dung dang giai captcha) — van "dang bao". */
  mute() {
    this.muted = true;
    this.onChange?.();
  }

  stop() {
    if (!this.ringing) return;
    this.ringing = false;
    this.muted = false;
    this.onChange?.();
  }
}
