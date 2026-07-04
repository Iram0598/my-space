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
import { gsap } from 'gsap';
import * as THREE from 'three';

@Component({
  selector: 'app-home',
  templateUrl: 'home.page.html',
  styleUrls: ['home.page.scss'],
  standalone: true,
  imports: [IonContent],
  encapsulation: ViewEncapsulation.None,
})
export class HomePage implements AfterViewInit, OnDestroy {
  @ViewChild('threeCanvas') canvasRef!: ElementRef<HTMLCanvasElement>;

  activeView: string | null = null;

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

  private orbitTl: gsap.core.Timeline | null = null;
  private panelTl: gsap.core.Timeline | null = null;
  private leaveTimer: ReturnType<typeof setTimeout> | null = null;

  private readonly ORBIT_R = 190;
  private readonly ORBIT_R_COMPACT = 125;

  constructor(private ngZone: NgZone, private cdr: ChangeDetectorRef) {}

  ngAfterViewInit(): void {
    this.ngZone.runOutsideAngular(() => this.initThree());

    // GSAP initial states — all controlled from here, no CSS transforms
    gsap.set('.orbit-container', { xPercent: -50, yPercent: -50 });
    gsap.set('.orbit-logo', { opacity: 0, y: 12 });
    gsap.set('.orbit-item', { xPercent: -50, yPercent: -50, x: 0, y: 0, opacity: 0, scale: 0.5, pointerEvents: 'none' });
    gsap.set('.content-panel', { y: '100%', opacity: 0 });
    gsap.set('.close-btn', { opacity: 0, pointerEvents: 'none' });

    // Logo entrance
    gsap.to('.orbit-logo', { opacity: 1, y: 0, duration: 1.4, ease: 'power3.out', delay: 0.4 });
  }

  ngOnDestroy(): void {
    cancelAnimationFrame(this.rafId);
    window.removeEventListener('mousemove', this.onMouse);
    window.removeEventListener('resize', this.onResize);
    this.starTexture?.dispose();
    this.renderer?.dispose();
    if (this.leaveTimer) clearTimeout(this.leaveTimer);
  }

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
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.starTexture = this.createStarTexture();
    const material = new THREE.PointsMaterial({
      color: 0xffffff,
      size: 0.055,
      transparent: true,
      opacity: 0.88,
      sizeAttenuation: true,
      map: this.starTexture,
      alphaTest: 0.004,
      depthWrite: false,
    });
    this.particles = new THREE.Points(geometry, material);
    this.scene.add(this.particles);

    window.addEventListener('mousemove', this.onMouse);
    window.addEventListener('resize', this.onResize);
    this.loop();
  }

  private readonly onMouse = (e: MouseEvent): void => {
    this.mouse.x = (e.clientX / window.innerWidth - 0.5) * 2;
    this.mouse.y = -(e.clientY / window.innerHeight - 0.5) * 2;
  };

  private readonly onResize = (): void => {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
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
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d')!;
    const c = size / 2;
    const gradient = ctx.createRadialGradient(c, c, 0, c, c, c);
    gradient.addColorStop(0,    'rgba(255,255,255,1)');
    gradient.addColorStop(0.12, 'rgba(255,255,255,0.9)');
    gradient.addColorStop(0.35, 'rgba(255,255,255,0.3)');
    gradient.addColorStop(1,    'rgba(255,255,255,0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, size, size);
    return new THREE.CanvasTexture(canvas);
  }

  // ── Orbit hover ──────────────────────────────────────────

  onOrbitHover(): void {
    this.mouseOverOrbit = true;
    if (this.leaveTimer) { clearTimeout(this.leaveTimer); this.leaveTimer = null; }
    if (!this.isMenuOpen) {
      this.isMenuOpen = true;
      this.animateOrbitIn(this.ORBIT_R);
    }
  }

  onOrbitLeave(): void {
    this.mouseOverOrbit = false;
    if (this.activeView) return; // keep orbit when content is showing
    this.leaveTimer = setTimeout(() => {
      this.leaveTimer = null;
      this.animateOrbitOut();
    }, 220);
  }

  private animateOrbitIn(radius: number): void {
    this.orbitTl?.kill();
    const tl = gsap.timeline();
    this.orbitTl = tl;
    const ease = 'back.out(1.5)';
    const dur = 0.7;
    // Orbit items are nth-children: index them by querying all four
    const items = document.querySelectorAll('.orbit-item');
    // top, right, bottom, left
    const targets = [
      { el: items[0], x: 0,       y: -radius },
      { el: items[1], x: radius,  y: 0       },
      { el: items[2], x: 0,       y: radius  },
      { el: items[3], x: -radius, y: 0       },
    ];
    targets.forEach(({ el, x, y }, i) => {
      tl.to(el, { x, y, opacity: 1, scale: 1, pointerEvents: 'auto', duration: dur, ease }, i * 0.06);
    });
  }

  private animateOrbitOut(): void {
    this.orbitTl?.kill();
    const tl = gsap.timeline({
      onComplete: () => { this.isMenuOpen = false; },
    });
    this.orbitTl = tl;
    tl.to('.orbit-item', {
      opacity: 0, x: 0, y: 0, scale: 0.5, pointerEvents: 'none',
      duration: 0.4, ease: 'power3.in', stagger: 0.05,
    });
  }

  // ── Section view ─────────────────────────────────────────

  toggleView(view: string): void {
    if (this.activeView === view) {
      this.closePanel();
    } else if (this.activeView !== null) {
      // Switch content in-place without re-animating
      this.activeView = view;
      this.cdr.detectChanges();
    } else {
      this.openPanel(view);
    }
  }

  closePanel(): void {
    this.panelTl?.kill();
    const tl = gsap.timeline({ defaults: { ease: 'power4.inOut' } });
    this.panelTl = tl;

    tl.to('.close-btn', { opacity: 0, pointerEvents: 'none', duration: 0.2 }, 0)
      .to('.content-panel', { y: '100%', opacity: 0, duration: 0.6, ease: 'power4.in' }, 0.05)
      .to('.orbit-container', { y: 0, duration: 0.75 }, 0.1)
      .call(() => {
        this.ngZone.run(() => {
          this.activeView = null;
          // Expand or collapse orbit depending on whether mouse is still in the zone
          if (this.mouseOverOrbit) {
            this.animateOrbitIn(this.ORBIT_R);
          } else {
            this.isMenuOpen = false;
            this.animateOrbitOut();
          }
        });
      });
  }

  private openPanel(view: string): void {
    this.panelTl?.kill();
    this.activeView = view;
    this.cdr.detectChanges();

    const shiftY = -(window.innerHeight * 0.18);
    const tl = gsap.timeline({ defaults: { ease: 'power4.inOut' } });
    this.panelTl = tl;

    const items = document.querySelectorAll('.orbit-item');
    const targets = [
      { el: items[0], x: 0,                    y: -this.ORBIT_R_COMPACT },
      { el: items[1], x: this.ORBIT_R_COMPACT,  y: 0                    },
      { el: items[2], x: 0,                    y: this.ORBIT_R_COMPACT  },
      { el: items[3], x: -this.ORBIT_R_COMPACT, y: 0                    },
    ];

    // Orbit compresses upward
    tl.to('.orbit-container', { y: shiftY, duration: 0.8 }, 0);
    targets.forEach(({ el, x, y }, i) => {
      tl.to(el, { x, y, duration: 0.8 }, i * 0.04);
    });

    // Panel slides up
    tl.fromTo('.content-panel',
      { y: '100%', opacity: 0 },
      { y: 0, opacity: 1, duration: 0.75, ease: 'power4.out' },
      0.05
    );

    // Close button appears
    tl.to('.close-btn', { opacity: 1, pointerEvents: 'auto', duration: 0.35, ease: 'power2.out' }, 0.65);
  }
}
