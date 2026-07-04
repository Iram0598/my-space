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

  private renderer!: THREE.WebGLRenderer;
  private scene!: THREE.Scene;
  private camera!: THREE.PerspectiveCamera;
  private particles!: THREE.Points;
  private rafId = 0;
  private mouse = { x: 0, y: 0 };
  private mouseSmooth = { x: 0, y: 0 };
  private rotBase = { x: 0, y: 0 };
  private timeline: gsap.core.Timeline | null = null;

  constructor(private ngZone: NgZone, private cdr: ChangeDetectorRef) {}

  ngAfterViewInit(): void {
    this.ngZone.runOutsideAngular(() => this.initThree());
  }

  ngOnDestroy(): void {
    cancelAnimationFrame(this.rafId);
    window.removeEventListener('mousemove', this.onMouse);
    window.removeEventListener('resize', this.onResize);
    this.renderer?.dispose();
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

    const material = new THREE.PointsMaterial({
      color: 0xffffff,
      size: 0.018,
      transparent: true,
      opacity: 0.28,
      sizeAttenuation: true,
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

    // Lerp mouse for smooth parallax
    this.mouseSmooth.x += (this.mouse.x - this.mouseSmooth.x) * 0.04;
    this.mouseSmooth.y += (this.mouse.y - this.mouseSmooth.y) * 0.04;

    // Auto drift
    this.rotBase.x += 0.00007;
    this.rotBase.y += 0.00018;

    // Combine drift + mouse offset
    this.particles.rotation.x = this.rotBase.x + this.mouseSmooth.y * 0.06;
    this.particles.rotation.y = this.rotBase.y + this.mouseSmooth.x * 0.12;

    this.renderer.render(this.scene, this.camera);
  }

  toggleView(view: string): void {
    if (view === 'home' || this.activeView === view) {
      this.animateClose();
    } else {
      this.animateOpen(view);
    }
  }

  private animateOpen(view: string): void {
    this.timeline?.kill();
    this.activeView = view;
    this.cdr.detectChanges(); // apply section-active + render section-label

    const tl = gsap.timeline({ defaults: { ease: 'power4.inOut' } });
    this.timeline = tl;

    tl
      // Profile shifts left and shrinks
      .to('.home-profile', { x: -180, scale: 0.6, duration: 0.9 }, 0)
      // Vertical axis fades
      .to('.vertical-axis', { opacity: 0, duration: 0.5, ease: 'power2.out' }, 0)
      // All nav links fade with stagger
      .to('.nav-link-group', { opacity: 0, pointerEvents: 'none', duration: 0.45, stagger: 0.07 }, 0)
      // Footer fades
      .to('.centered-footer', { opacity: 0, pointerEvents: 'none', duration: 0.4, ease: 'power2.out' }, 0)
      // Section label slides in from right
      .fromTo('.section-label',
        { opacity: 0, x: 100 },
        { opacity: 1, x: 60, duration: 0.75, ease: 'power3.out' },
        0.15
      )
      // Section content slides up
      .fromTo('.section-active',
        { opacity: 0, y: 50 },
        { opacity: 1, y: 0, duration: 0.75, ease: 'power3.out' },
        0.3
      )
      // Back button fades in
      .to('.back-btn', { opacity: 1, pointerEvents: 'auto', duration: 0.4, ease: 'power2.out' }, 0.85);
  }

  private animateClose(): void {
    this.timeline?.kill();

    const tl = gsap.timeline({ defaults: { ease: 'power4.inOut' } });
    this.timeline = tl;

    tl
      // Section content slides down and fades
      .to('.section-active', { opacity: 0, y: 30, duration: 0.4, ease: 'power3.in' }, 0)
      // Section label slides out
      .to('.section-label', { opacity: 0, x: 90, duration: 0.35, ease: 'power3.in' }, 0)
      // Back button fades
      .to('.back-btn', { opacity: 0, pointerEvents: 'none', duration: 0.25 }, 0)
      // Profile returns
      .to('.home-profile', { x: 0, scale: 1, duration: 0.85 }, 0.2)
      // Axis returns
      .to('.vertical-axis', { opacity: 1, duration: 0.6, ease: 'power2.out' }, 0.25)
      // Nav links return with stagger
      .to('.nav-link-group', { opacity: 1, pointerEvents: 'auto', duration: 0.5, stagger: 0.08 }, 0.3)
      // Footer returns
      .to('.centered-footer', { opacity: 0.6, pointerEvents: 'auto', duration: 0.5, ease: 'power2.out' }, 0.35)
      // At the end: clear all GSAP inline styles and reset state
      .call(() => {
        const active = document.querySelector('.section-active');
        if (active) gsap.set(active, { clearProps: 'all' });
        gsap.set('.home-profile, .vertical-axis, .nav-link-group, .centered-footer, .back-btn', {
          clearProps: 'all',
        });
        this.ngZone.run(() => { this.activeView = null; });
      });
  }
}
