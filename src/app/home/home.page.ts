import {
  AfterViewInit,
  ChangeDetectorRef,
  Component,
  ElementRef,
  NgZone,
  OnDestroy,
  ViewChild,
  ViewEncapsulation,
} from '@angular/core';
import { IonContent } from '@ionic/angular/standalone';
import { FormsModule } from '@angular/forms';
import { gsap } from 'gsap';
import * as THREE from 'three';

interface OrbitCfg {
  angle: number;
  speed: number; // radians per second
  radius: number; // current animated radius in px (tweened by GSAP)
}

@Component({
  selector: 'app-home',
  templateUrl: 'home.page.html',
  styleUrls: ['home.page.scss'],
  standalone: true,
  imports: [IonContent, FormsModule],
  encapsulation: ViewEncapsulation.None,
})
export class HomePage implements AfterViewInit, OnDestroy {
  @ViewChild('threeCanvas') canvasRef!: ElementRef<HTMLCanvasElement>;

  activeView: string | null = null;
  isMuted = false;

  contactName    = '';
  contactEmail   = '';
  contactMessage = '';
  contactSent    = false;
  contactSending = false;

  private isMenuOpen = false;
  private mouseOverOrbit = false;

  private renderer!: THREE.WebGLRenderer;
  private scene!: THREE.Scene;
  private camera!: THREE.PerspectiveCamera;
  private particles!: THREE.Points;
  private starTexture!: THREE.Texture;
  private rafId = 0;
  private mouse = { x: 0, y: 0 };
  private mouseSmooth = { x: 0, y: 0 };
  private rotBase = { x: 0, y: 0 };

  private panelTl: gsap.core.Timeline | null = null;
  private leaveTimer: ReturnType<typeof setTimeout> | null = null;
  private orbitOutCallId: gsap.core.Tween | null = null;
  private cursorMoveFn: ((e: MouseEvent) => void) | null = null;

  private coordLatEl: HTMLElement | null = null;
  private coordLonEl: HTMLElement | null = null;

  private introAudio: HTMLAudioElement | null = null;
  private bgAudio: HTMLAudioElement | null = null;
  private introTl: gsap.core.Timeline | null = null;
  private introFinishing = false;
  private audioCtx: AudioContext | null = null;
  private staticGain: GainNode | null = null;
  private staticSource: AudioBufferSourceNode | null = null;

  private readonly INTRO_LINES = [
    'Every journey begins with a single launch.',
    'Not toward another planet... but toward an idea.',
    'Every line of code became a star.',
    'Every challenge became another orbit.',
    'Welcome, traveler.',
  ];

  // One entry per nav item, matched by DOM order: projects, experience, blogs, contact
  private orbitConfigs: OrbitCfg[] = [
    { angle: -Math.PI / 2, speed: 0.14, radius: 0 }, // projects  — start top
    { angle: 0,            speed: 0.10, radius: 0 }, // experience — start right
    { angle: Math.PI / 2,  speed: 0.07, radius: 0 }, // blogs      — start bottom
    { angle: Math.PI,      speed: 0.12, radius: 0 }, // contact    — start left
  ];

  // Base radii designed for a ~1024px viewport; scaled down for smaller screens
  private readonly BASE_RADII         = [155, 195, 230, 175];
  private readonly BASE_RADII_COMPACT  = [100, 127, 149, 114];
  private ORBIT_RADII: number[]        = [...this.BASE_RADII];
  private ORBIT_RADII_COMPACT: number[] = [...this.BASE_RADII_COMPACT];

  // GSAP quickSetters for per-frame x/y updates — avoids creating new tweens each tick
  private xSetters: ((v: number) => void)[] = [];
  private ySetters: ((v: number) => void)[] = [];
  private orbitTickerFn: ((time: number, deltaTime: number) => void) | null = null;

  constructor(private ngZone: NgZone, private cdr: ChangeDetectorRef) {}

  ngAfterViewInit(): void {
    this.computeResponsiveRadii();
    this.ngZone.runOutsideAngular(() => this.initThree());

    gsap.set('.three-canvas', { opacity: 0 });
    gsap.set('.orbit-container', { xPercent: -50, yPercent: -50 });
    gsap.set('.orbit-logo', { opacity: 0, y: 16 });
    gsap.set('.orbit-logo img', { opacity: 0 });
    gsap.set('.orbit-item', {
      xPercent: -50, yPercent: -50,
      x: 0, y: 0,
      opacity: 0, scale: 0.5,
      pointerEvents: 'none',
    });
    gsap.set('.orbit-ring', { opacity: 0 });
    gsap.set('.content-panel', { y: '100%', opacity: 0 });
    gsap.set('.close-btn', { opacity: 0, pointerEvents: 'none' });

    // Build quickSetters once — elements are stable (no *ngFor)
    document.querySelectorAll<HTMLElement>('.orbit-item').forEach(el => {
      this.xSetters.push(gsap.quickSetter(el, 'x', 'px') as (v: number) => void);
      this.ySetters.push(gsap.quickSetter(el, 'y', 'px') as (v: number) => void);
    });

    this.coordLatEl = document.querySelector<HTMLElement>('.coord-lat');
    this.coordLonEl = document.querySelector<HTMLElement>('.coord-lon');

    this.initCursor();
    gsap.set('.cursor-dot, .cursor-ring', { autoAlpha: 0 });
    this.initIntro();
  }

  async sendContact(): Promise<void> {
    if (!this.contactName || !this.contactEmail || !this.contactMessage) return;
    this.contactSending = true;
    this.cdr.detectChanges();
    try {
      await fetch('/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          'form-name': 'contact',
          name: this.contactName,
          email: this.contactEmail,
          message: this.contactMessage,
        }).toString(),
      });
      this.contactSent = true;
    } finally {
      this.contactSending = false;
      this.cdr.detectChanges();
    }
  }

  ngOnDestroy(): void {
    cancelAnimationFrame(this.rafId);
    window.removeEventListener('mousemove', this.onMouse);
    window.removeEventListener('resize', this.onResize);
    if (this.cursorMoveFn) window.removeEventListener('mousemove', this.cursorMoveFn);
    this.stopOrbitTicker();
    this.starTexture?.dispose();
    this.renderer?.dispose();
    if (this.leaveTimer) clearTimeout(this.leaveTimer);
    this.introTl?.kill();
    this.introAudio?.pause();
    this.bgAudio?.pause();
    this.stopStaticNoise();
  }

  // ── Ambient audio ─────────────────────────────────────────

  toggleMute(): void {
    this.isMuted = !this.isMuted;
    if (this.bgAudio) this.bgAudio.muted = this.isMuted;
  }

  private startBgAudio(): void {
    this.bgAudio = new Audio('assets/sounds/marooned.mp3');
    this.bgAudio.loop = true;
    this.bgAudio.volume = 0;
    this.bgAudio.muted = this.isMuted;
    this.bgAudio.play().catch(() => {});

    // Fade volume in slowly
    const vol = { v: 0 };
    gsap.to(vol, {
      v: 0.5,
      duration: 5,
      ease: 'power1.out',
      onUpdate: () => { if (this.bgAudio) this.bgAudio.volume = vol.v; },
    });

    // Reveal the mute button
    gsap.to('.mute-btn', { opacity: 1, duration: 1.2, ease: 'power2.out', delay: 0.3 });
  }

  // ── Cinematic intro ───────────────────────────────────────

  private initIntro(): void {
    const screen = document.querySelector<HTMLElement>('.intro-screen')!;
    const handler = () => {
      screen.removeEventListener('click', handler);
      // Fade out the pre-screen label, then wait 3s of black silence before sequence
      gsap.to('.intro-pre', { opacity: 0, duration: 0.6, ease: 'power2.in' });
      gsap.delayedCall(3, () => this.runIntroSequence());
    };
    screen.addEventListener('click', handler);
  }

  private runIntroSequence(): void {
    const screen = document.querySelector<HTMLElement>('.intro-screen')!;
    const seqEl  = document.querySelector<HTMLElement>('.intro-seq')!;
    const textEl = document.querySelector<HTMLElement>('.intro-text')!;
    const skipEl = document.querySelector<HTMLElement>('.intro-skip')!;

    this.introAudio = new Audio('assets/sounds/liftoff_countdown.mp3');
    this.introAudio.play().catch(() => {});

    this.startStaticNoise();

    // Profile: starts big (scale 2.3 ≈ 220px), hidden; will scale down to orbit-logo size (96px)
    gsap.set('.intro-profile', { xPercent: -50, yPercent: -50, scale: 2.3, opacity: 0 });
    gsap.set('.intro-profile-glow', { opacity: 0 });

    const tl = gsap.timeline();
    this.introTl = tl;

    tl.to(seqEl,  { opacity: 1, duration: 0.5 }, 0.5)
      .to(skipEl, { opacity: 1, pointerEvents: 'auto', duration: 0.5 }, 1.1);

    const inDur   = 2.0;
    const holdDur = 2.5;
    const outDur  = 1.5;
    const gap     = 0.5;
    const cycle   = inDur + holdDur + outDur + gap; // 6.5s per line
    const startAt = 1.5;
    const lastIdx = this.INTRO_LINES.length - 1;

    this.INTRO_LINES.forEach((line, i) => {
      const t      = startAt + i * cycle;
      const isLast = i === lastIdx;

      tl.call(() => {
        textEl.textContent = line;
        gsap.set(textEl, { opacity: 0, y: 8 });
      }, [], t)
      .to(textEl, { opacity: 1, y: 0, duration: inDur, ease: 'power2.out' }, t + 0.02);

      if (!isLast) {
        tl.to(textEl, { opacity: 0, y: -8, duration: outDur, ease: 'power2.in' }, t + 0.02 + inDur + holdDur);
      }
      // Last line ("Welcome, traveler.") holds for 6s, then profile animation begins
    });

    // lastT = 1.5 + 4×6.5 = 27.5  |  profileT = 27.5 + 2.0(fade-in) + 6.0(hold) = 35.5
    const lastT    = startAt + lastIdx * cycle;
    const profileT = lastT + inDur + 6.0;

    tl
      // Fade out intro audio once "Welcome, traveler." is fully visible
      .call(() => {
        if (!this.introAudio) return;
        const audio = this.introAudio;
        const vol = { v: audio.volume };
        gsap.to(vol, {
          v: 0, duration: 2.0, ease: 'power1.in',
          onUpdate: () => { audio.volume = vol.v; },
          onComplete: () => { audio.pause(); this.introAudio = null; },
        });
      }, [], lastT)
      // Dissolve text + hide skip; profile waits until text is fully gone
      .to(textEl, { opacity: 0, y: -8, duration: 1.5, ease: 'power2.in' }, profileT)
      .to(skipEl, { opacity: 0, pointerEvents: 'none', duration: 0.5 }, profileT)
      // Profile fades in after text is fully gone (profileT + 1.5)
      .to('.intro-profile', { opacity: 1, duration: 1.5, ease: 'power2.out' }, profileT + 1.5)
      // Glow blooms slightly after
      .to('.intro-profile-glow', { opacity: 1, duration: 2.5, ease: 'power2.out' }, profileT + 2.0)
      // Profile scales down to orbit-logo size (scale:1 = 96px)
      .to('.intro-profile', { scale: 1, duration: 3.5, ease: 'power3.inOut' }, profileT + 3.0)
      // Stars fade in as scale-down starts
      .call(() => {
        this.stopStaticNoise();
        gsap.to('.three-canvas', { opacity: 1, duration: 4.5, ease: 'power1.out' });
        gsap.to('.cursor-dot, .cursor-ring', { autoAlpha: 1, duration: 1.2, delay: 2 });
      }, [], profileT + 3.0)
      // Overlay fades out 2s into the scale-down
      .to(screen, { opacity: 0, duration: 2.5, ease: 'power2.inOut' }, profileT + 5.0)
      // Once overlay is gone, reveal orbit logo and profile image
      .call(() => {
        this.introFinishing = true;
        screen.style.display = 'none';
        gsap.set('.orbit-logo', { opacity: 1, y: 0 });
        gsap.to('.orbit-logo img', { opacity: 1, duration: 1.6, ease: 'power2.out', delay: 0.2 });
        this.startBgAudio();
      }, [], profileT + 7.5);

    // Safety: if timeline somehow stalls, force skip after 85s
    gsap.delayedCall(85, () => { if (!this.introFinishing) this.skipIntro(); });
  }

  skipIntro(): void {
    if (this.introFinishing) return;
    this.introFinishing = true;
    this.introTl?.kill();
    this.introAudio?.pause();
    this.introAudio = null;
    this.stopStaticNoise();

    const screen = document.querySelector<HTMLElement>('.intro-screen');
    if (!screen) return;

    gsap.to('.three-canvas', { opacity: 1, duration: 4.5, ease: 'power1.out' });
    gsap.to('.cursor-dot, .cursor-ring', { autoAlpha: 1, duration: 1, delay: 1 });

    gsap.to(screen, {
      opacity: 0, duration: 1.5, ease: 'power2.inOut',
      onComplete: () => {
        screen.style.display = 'none';
        gsap.set('.orbit-logo', { opacity: 1, y: 0 });
        gsap.to('.orbit-logo img', { opacity: 1, duration: 1.6, ease: 'power2.out', delay: 0.2 });
        this.startBgAudio();
      },
    });
  }

  private startStaticNoise(): void {
    try {
      this.audioCtx = new AudioContext();
      const rate = this.audioCtx.sampleRate;
      const buf  = this.audioCtx.createBuffer(1, rate * 2, rate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;

      this.staticSource = this.audioCtx.createBufferSource();
      this.staticSource.buffer = buf;
      this.staticSource.loop   = true;

      const bpf = this.audioCtx.createBiquadFilter();
      bpf.type            = 'bandpass';
      bpf.frequency.value = 1800;
      bpf.Q.value         = 0.7;

      this.staticGain = this.audioCtx.createGain();
      this.staticGain.gain.value = 0;

      this.staticSource.connect(bpf);
      bpf.connect(this.staticGain);
      this.staticGain.connect(this.audioCtx.destination);
      this.staticSource.start();

      const now = this.audioCtx.currentTime;
      this.staticGain.gain.setTargetAtTime(0.05, now, 0.4);
      this.staticGain.gain.setTargetAtTime(0.012, now + 2.5, 1.2);
    } catch { /* Safari / blocked AudioContext — skip static */ }
  }

  private stopStaticNoise(): void {
    if (!this.audioCtx || !this.staticGain) return;
    try {
      this.staticGain.gain.setTargetAtTime(0, this.audioCtx.currentTime, 0.4);
      setTimeout(() => {
        this.staticSource?.stop();
        this.audioCtx?.close();
        this.audioCtx    = null;
        this.staticGain  = null;
        this.staticSource = null;
      }, 1500);
    } catch {}
  }

  // ── Custom cursor ─────────────────────────────────────────

  private initCursor(): void {
    if (!window.matchMedia('(hover: hover)').matches) return;

    this.ngZone.runOutsideAngular(() => {
      const dot  = document.querySelector<HTMLElement>('.cursor-dot')!;
      const ring = document.querySelector<HTMLElement>('.cursor-ring')!;

      gsap.set([dot, ring], { xPercent: -50, yPercent: -50, x: -100, y: -100 });

      const dotX  = gsap.quickTo(dot,  'x', { duration: 0 });
      const dotY  = gsap.quickTo(dot,  'y', { duration: 0 });
      const ringX = gsap.quickTo(ring, 'x', { duration: 0.12, ease: 'power2.out' });
      const ringY = gsap.quickTo(ring, 'y', { duration: 0.12, ease: 'power2.out' });

      this.cursorMoveFn = (e: MouseEvent) => {
        dotX(e.clientX);
        dotY(e.clientY);
        ringX(e.clientX);
        ringY(e.clientY);
      };
      window.addEventListener('mousemove', this.cursorMoveFn);

      // Expand ring + hide dot on any interactive element
      document.querySelectorAll<HTMLElement>(
        'a, button, .orbit-item, .orbit-logo, .hud-card'
      ).forEach(el => {
        el.addEventListener('mouseenter', () => {
          gsap.to(ring, { scale: 1.8, opacity: 0.9, duration: 0.2, ease: 'power2.out' });
          gsap.to(dot,  { scale: 0, duration: 0.15 });
        });
        el.addEventListener('mouseleave', () => {
          gsap.to(ring, { scale: 1, opacity: 1, duration: 0.25, ease: 'power2.out' });
          gsap.to(dot,  { scale: 1, duration: 0.2 });
        });
      });
    });
  }

  // ── Three.js ──────────────────────────────────────────────

  private initThree(): void {
    const canvas = this.canvasRef.nativeElement;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 100);
    this.camera.position.z = 4;

    this.renderer = new THREE.WebGLRenderer({ canvas, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);

    const count = 2000;
    const positions = new Float32Array(count * 3);
    for (let i = 0; i < count * 3; i += 3) {
      positions[i]     = (Math.random() - 0.5) * 14;
      positions[i + 1] = (Math.random() - 0.5) * 10;
      positions[i + 2] = (Math.random() - 0.5) * 6;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.starTexture = this.createStarTexture();
    const mat = new THREE.PointsMaterial({
      color: 0xffffff, size: 0.055, transparent: true, opacity: 0.88,
      sizeAttenuation: true, map: this.starTexture, alphaTest: 0.004, depthWrite: false,
    });
    this.particles = new THREE.Points(geo, mat);
    this.scene.add(this.particles);

    window.addEventListener('mousemove', this.onMouse);
    window.addEventListener('resize', this.onResize);
    this.loop();
  }

  private readonly onMouse = (e: MouseEvent): void => {
    this.updateCoords(e.clientX, e.clientY);
    if (this.activeView) return; // freeze parallax while panel is open
    this.mouse.x = (e.clientX / window.innerWidth - 0.5) * 2;
    this.mouse.y = -(e.clientY / window.innerHeight - 0.5) * 2;
  };

  private updateCoords(cx: number, cy: number): void {
    if (!this.coordLatEl || !this.coordLonEl) return;
    const lat = (0.5 - cy / window.innerHeight) * 180;
    const lon = (cx / window.innerWidth - 0.5) * 360;
    this.coordLatEl.textContent = this.toDMS(lat, true);
    this.coordLonEl.textContent = this.toDMS(lon, false);
  }

  private toDMS(decimal: number, isLat: boolean): string {
    const dir = isLat ? (decimal >= 0 ? 'N' : 'S') : (decimal >= 0 ? 'E' : 'W');
    const abs = Math.abs(decimal);
    const deg = Math.floor(abs);
    const minFull = (abs - deg) * 60;
    const min = Math.floor(minFull);
    const sec = ((minFull - min) * 60).toFixed(1);
    const degStr = isLat
      ? String(deg).padStart(2, '0')
      : String(deg).padStart(3, '0');
    return `${degStr}°${String(min).padStart(2, '0')}'${sec.padStart(4, '0')}"${dir}`;
  }

  private readonly onResize = (): void => {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.computeResponsiveRadii();
    if (this.isMenuOpen) {
      const radii = this.activeView ? this.ORBIT_RADII_COMPACT : this.ORBIT_RADII;
      const rings = document.querySelectorAll('.orbit-ring');
      radii.forEach((r, i) => {
        gsap.to(this.orbitConfigs[i], { radius: r, duration: 0.4 });
        gsap.to(rings[i], { attr: { r }, duration: 0.4 });
      });
    }
  };

  private loop(): void {
    this.rafId = requestAnimationFrame(() => this.loop());
    this.mouseSmooth.x += (this.mouse.x - this.mouseSmooth.x) * 0.04;
    this.mouseSmooth.y += (this.mouse.y - this.mouseSmooth.y) * 0.04;
    this.rotBase.x += 0.00007;
    this.rotBase.y += 0.00018;
    this.particles.rotation.x = this.rotBase.x + this.mouseSmooth.y * 0.06;
    this.particles.rotation.y = this.rotBase.y + this.mouseSmooth.x * 0.12;
    this.renderer.render(this.scene, this.camera);
  }

  private createStarTexture(): THREE.Texture {
    const size = 64;
    const canvas = document.createElement('canvas');
    canvas.width = size; canvas.height = size;
    const ctx = canvas.getContext('2d')!;
    const c = size / 2;
    const g = ctx.createRadialGradient(c, c, 0, c, c, c);
    g.addColorStop(0,    'rgba(255,255,255,1)');
    g.addColorStop(0.12, 'rgba(255,255,255,0.9)');
    g.addColorStop(0.35, 'rgba(255,255,255,0.3)');
    g.addColorStop(1,    'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
    return new THREE.CanvasTexture(canvas);
  }

  // ── Responsive radii ─────────────────────────────────────
  // Scale orbit radii so the largest ring fits within 40% of the smaller
  // viewport dimension, keeping items on-screen on any device.

  private computeResponsiveRadii(): void {
    const vmin = Math.min(window.innerWidth, window.innerHeight);
    const maxAllowed = vmin * 0.40;
    const maxBase = Math.max(...this.BASE_RADII);
    const scale = Math.min(1, maxAllowed / maxBase);
    this.ORBIT_RADII = this.BASE_RADII.map(r => Math.round(r * scale));
    this.ORBIT_RADII_COMPACT = this.BASE_RADII_COMPACT.map(r => Math.round(r * scale));
  }

  // ── Orbit ticker ──────────────────────────────────────────
  // Runs on GSAP's ticker every frame. Uses quickSetters (no tween allocation) to
  // position each item at cos/sin of its angle multiplied by its current radius.
  // The radius is itself a GSAP-tweened value, so items naturally spiral in/out.

  private startOrbitTicker(): void {
    if (this.orbitTickerFn) return;
    this.orbitTickerFn = (_time: number, deltaTime: number) => {
      const dt = deltaTime / 1000; // ms → seconds
      this.orbitConfigs.forEach((cfg, i) => {
        cfg.angle += cfg.speed * dt;
        this.xSetters[i](Math.cos(cfg.angle) * cfg.radius);
        this.ySetters[i](Math.sin(cfg.angle) * cfg.radius);
      });
    };
    gsap.ticker.add(this.orbitTickerFn);
  }

  private stopOrbitTicker(): void {
    if (this.orbitTickerFn) {
      gsap.ticker.remove(this.orbitTickerFn);
      this.orbitTickerFn = null;
    }
  }

  // ── Orbit hover ───────────────────────────────────────────

  onOrbitHover(): void {
    if (this.activeView) return; // panel open — ignore hover
    this.mouseOverOrbit = true;
    if (this.leaveTimer) { clearTimeout(this.leaveTimer); this.leaveTimer = null; }
    if (!this.isMenuOpen) {
      this.isMenuOpen = true;
      this.animateOrbitIn(this.ORBIT_RADII);
    }
  }

  onOrbitLeave(): void {
    this.mouseOverOrbit = false;
    if (this.activeView) return;
    this.leaveTimer = setTimeout(() => {
      this.leaveTimer = null;
      this.animateOrbitOut();
    }, 600);
  }

  private animateOrbitIn(radii: number[]): void {
    // Cancel any pending collapse cleanup
    this.orbitOutCallId?.kill();
    this.orbitOutCallId = null;
    this.orbitConfigs.forEach(cfg => gsap.killTweensOf(cfg));
    gsap.killTweensOf('.orbit-ring');

    const items = document.querySelectorAll('.orbit-item');
    const rings = document.querySelectorAll('.orbit-ring');

    // Snap rings to full size before fading in so compact-→-full never glitches
    this.ORBIT_RADII.forEach((r, i) => gsap.set(rings[i], { attr: { r } }));

    this.startOrbitTicker();

    radii.forEach((r, i) => {
      // Tween the radius value — the ticker reads it live, so items spiral outward
      gsap.to(this.orbitConfigs[i], { radius: r, duration: 0.8, ease: 'back.out(1.5)', delay: i * 0.07 });
      gsap.to(items[i], { opacity: 1, scale: 1, pointerEvents: 'auto', duration: 0.7, ease: 'back.out(1.5)', delay: i * 0.07 });
      gsap.to(rings[i], { opacity: 1, duration: 0.9, ease: 'power2.out', delay: i * 0.1 });
    });
  }

  private animateOrbitOut(): void {
    this.orbitConfigs.forEach(cfg => gsap.killTweensOf(cfg));
    gsap.killTweensOf('.orbit-ring');

    const items = document.querySelectorAll('.orbit-item');

    // Shrink radii to 0 — ticker drives items back to center as radius → 0
    this.orbitConfigs.forEach((cfg, i) => {
      gsap.to(cfg, { radius: 0, duration: 0.45, ease: 'power3.in', delay: i * 0.05 });
      gsap.to(items[i], { opacity: 0, scale: 0.5, pointerEvents: 'none', duration: 0.45, ease: 'power3.in', delay: i * 0.05 });
    });

    gsap.to('.orbit-ring', { opacity: 0, duration: 0.35, ease: 'power2.in', stagger: 0.06 });

    // Stop ticker only after all items have fully collapsed
    const stopAfter = 0.45 + 3 * 0.05 + 0.1;
    this.orbitOutCallId = gsap.delayedCall(stopAfter, () => {
      this.orbitOutCallId = null;
      this.stopOrbitTicker();
      this.isMenuOpen = false;
    });
  }

  // ── Section view ──────────────────────────────────────────

  toggleView(view: string): void {
    if (this.activeView === view) {
      this.closePanel();
    } else if (this.activeView !== null) {
      // Swap content in-place — orbit stays in compact mode
      this.activeView = view;
      this.cdr.detectChanges();
    } else {
      this.openPanel(view);
    }
  }

  closePanel(): void {
    this.panelTl?.kill();
    this.orbitConfigs.forEach(cfg => gsap.killTweensOf(cfg));
    gsap.killTweensOf('.orbit-ring');

    const isMobile = window.innerWidth < 640;
    const tl = gsap.timeline({ defaults: { ease: 'power4.inOut' } });
    this.panelTl = tl;

    tl.to('.close-btn', { opacity: 0, pointerEvents: 'none', duration: 0.2 }, 0)
      .to('.content-panel', { y: '100%', opacity: 0, duration: 0.6, ease: 'power4.in' }, 0.05);

    if (isMobile) {
      // Fade orbit back in after panel starts dismissing
      tl.to('.orbit-container', { opacity: 1, y: 0, duration: 0.5, ease: 'power3.out' }, 0.3);
    } else {
      tl.to('.orbit-container', { y: 0, duration: 0.75 }, 0.1);
    }

    tl.call(() => {
      this.ngZone.run(() => {
        this.activeView = null;
        const rings = document.querySelectorAll('.orbit-ring');
        if (this.mouseOverOrbit) {
          this.ORBIT_RADII.forEach((r, i) => {
            gsap.to(this.orbitConfigs[i], { radius: r, duration: 0.6, ease: 'back.out(1.5)' });
            gsap.to(rings[i], { attr: { r }, duration: 0.6, ease: 'back.out(1.5)' });
          });
        } else {
          this.animateOrbitOut();
        }
      });
    });
  }

  private openPanel(view: string): void {
    this.panelTl?.kill();
    this.orbitConfigs.forEach(cfg => gsap.killTweensOf(cfg));
    gsap.killTweensOf('.orbit-ring');
    this.activeView = view;
    this.cdr.detectChanges();

    const isMobile = window.innerWidth < 640;
    const rings = document.querySelectorAll('.orbit-ring');

    if (isMobile) {
      // On mobile: hide the orbit entirely so the 92vh panel has full focus
      gsap.to('.orbit-container', { opacity: 0, y: -30, duration: 0.3, ease: 'power3.in' });
    } else {
      // Desktop: compress orbit to compact radii and shift it upward
      const shiftY = -(window.innerHeight * 0.18);
      this.ORBIT_RADII_COMPACT.forEach((r, i) => {
        gsap.to(this.orbitConfigs[i], { radius: r, duration: 0.8, ease: 'power4.inOut' });
        gsap.to(rings[i], { attr: { r }, duration: 0.8, ease: 'power4.inOut' });
      });
      gsap.to('.orbit-container', { y: shiftY, duration: 0.8, ease: 'power4.inOut' });
    }

    const tl = gsap.timeline({ defaults: { ease: 'power4.inOut' } });
    this.panelTl = tl;
    tl.fromTo('.content-panel',
        { y: '100%', opacity: 0 },
        { y: 0, opacity: 1, duration: 0.35, ease: 'power4.out' },
        0.05
      )
      .to('.content-panel', { opacity: 0.12, duration: 0.05 }, 0.42)
      .to('.content-panel', { opacity: 1,    duration: 0.05 }, 0.47)
      .to('.content-panel', { opacity: 0.3,  duration: 0.04 }, 0.53)
      .to('.content-panel', { opacity: 1,    duration: 0.08 }, 0.57)
      .to('.close-btn', { opacity: 1, pointerEvents: 'auto', duration: 0.3, ease: 'power2.out' }, 0.72);
  }
}
