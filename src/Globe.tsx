import { useEffect, useRef } from "react";
import * as THREE from "three";

// Stylized continent outlines. The globe is an illustrative instrument, not live probe geolocation.
const land = [
  [
    [-168, 70],
    [-130, 72],
    [-100, 80],
    [-55, 58],
    [-60, 45],
    [-82, 25],
    [-100, 15],
    [-114, 30],
    [-130, 49],
    [-168, 60],
  ],
  [
    [-81, 12],
    [-50, 5],
    [-35, -10],
    [-50, -35],
    [-68, -55],
    [-78, -20],
  ],
  [
    [-17, 36],
    [10, 38],
    [34, 30],
    [50, 10],
    [35, -30],
    [18, -35],
    [5, -5],
    [-17, 15],
  ],
  [
    [-10, 36],
    [-10, 60],
    [30, 72],
    [70, 75],
    [130, 70],
    [175, 55],
    [145, 35],
    [120, 20],
    [105, 0],
    [80, 8],
    [65, 28],
    [35, 35],
  ],
  [
    [112, -11],
    [140, -10],
    [155, -30],
    [133, -40],
    [115, -30],
  ],
  [
    [45, -13],
    [51, -15],
    [49, -26],
    [44, -25],
  ],
] as number[][][];
function inside(x: number, y: number, polygon: number[][]) {
  let yes = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i],
      [xj, yj] = polygon[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi)
      yes = !yes;
  }
  return yes;
}
function position(lon: number, lat: number, radius = 1) {
  const phi = THREE.MathUtils.degToRad(90 - lat),
    theta = THREE.MathUtils.degToRad(lon + 180);
  return new THREE.Vector3(
    -radius * Math.sin(phi) * Math.cos(theta),
    radius * Math.cos(phi),
    radius * Math.sin(phi) * Math.sin(theta),
  );
}

export default function Globe() {
  const mount = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = mount.current!;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
    } catch {
      element.classList.add("globe-fallback");
      return;
    }
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 100);
    camera.position.z = 4.3;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    element.appendChild(renderer.domElement);
    const globe = new THREE.Group();
    scene.add(globe);
    globe.rotation.set(0.15, -0.75, -0.15);
    const sphere = new THREE.Mesh(
      new THREE.SphereGeometry(0.985, 48, 48),
      new THREE.MeshBasicMaterial({ color: "#101f32" }),
    );
    globe.add(sphere);
    const points: number[] = [];
    for (let lat = -60; lat < 80; lat += 3) {
      for (
        let lon = -180;
        lon < 180;
        lon += 3 / Math.max(0.3, Math.cos((lat * Math.PI) / 180))
      ) {
        if (land.some((p) => inside(lon, lat, p)))
          points.push(...position(lon, lat).toArray());
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(points, 3),
    );
    globe.add(
      new THREE.Points(
        geometry,
        new THREE.PointsMaterial({
          color: "#76a9c4",
          size: 0.012,
          transparent: true,
          opacity: 0.85,
        }),
      ),
    );
    for (let lat = -60; lat <= 60; lat += 30) {
      const ring = Array.from({ length: 129 }, (_, i) =>
        position((i / 128) * 360 - 180, lat, 1.003),
      );
      globe.add(
        new THREE.Line(
          new THREE.BufferGeometry().setFromPoints(ring),
          new THREE.LineBasicMaterial({
            color: "#29405a",
            transparent: true,
            opacity: 0.5,
          }),
        ),
      );
    }
    for (let lon = -180; lon < 180; lon += 30) {
      const meridian = Array.from({ length: 65 }, (_, i) =>
        position(lon, (i / 64) * 180 - 90, 1.003),
      );
      globe.add(
        new THREE.Line(
          new THREE.BufferGeometry().setFromPoints(meridian),
          new THREE.LineBasicMaterial({
            color: "#29405a",
            transparent: true,
            opacity: 0.45,
          }),
        ),
      );
    }
    const origin = position(100.5, 13.7, 1.02);
    [
      [-74, 41, "#98ddff"],
      [0, 51, "#cab5ff"],
      [139, 36, "#f3c98c"],
    ].forEach(([lon, lat, color]) => {
      const end = position(Number(lon), Number(lat), 1.02);
      const mid = origin.clone().add(end).normalize().multiplyScalar(1.55);
      const curve = new THREE.QuadraticBezierCurve3(origin, mid, end);
      globe.add(
        new THREE.Line(
          new THREE.BufferGeometry().setFromPoints(curve.getPoints(60)),
          new THREE.LineBasicMaterial({
            color: String(color),
            transparent: true,
            opacity: 0.8,
          }),
        ),
      );
      const marker = new THREE.Mesh(
        new THREE.SphereGeometry(0.023, 12, 12),
        new THREE.MeshBasicMaterial({ color: String(color) }),
      );
      marker.position.copy(end);
      globe.add(marker);
    });
    const resize = () => {
      const { width, height } = element.getBoundingClientRect();
      renderer.setSize(width, height);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(element);
    resize();
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    let pointerX = 0,
      pointerY = 0,
      raf = 0,
      visible = true;
    const pointer = (e: PointerEvent) => {
      const rect = element.getBoundingClientRect();
      pointerX = (e.clientX - rect.left) / rect.width - 0.5;
      pointerY = (e.clientY - rect.top) / rect.height - 0.5;
    };
    element.addEventListener("pointermove", pointer);
    const visibility = () => {
      visible = !document.hidden;
    };
    document.addEventListener("visibilitychange", visibility);
    const animate = () => {
      raf = requestAnimationFrame(animate);
      if (!visible) return;
      if (!reduced.matches) {
        globe.rotation.y += 0.001;
        globe.rotation.x += (pointerY * 0.15 + 0.15 - globe.rotation.x) * 0.02;
      }
      scene.rotation.y += (pointerX * 0.22 - scene.rotation.y) * 0.02;
      renderer.render(scene, camera);
    };
    animate();
    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
      element.removeEventListener("pointermove", pointer);
      document.removeEventListener("visibilitychange", visibility);
      scene.traverse((object) => {
        if (
          object instanceof THREE.Mesh ||
          object instanceof THREE.Line ||
          object instanceof THREE.Points
        ) {
          object.geometry.dispose();
          (Array.isArray(object.material)
            ? object.material
            : [object.material]
          ).forEach((m) => m.dispose());
        }
      });
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, []);
  return (
    <div
      className="globe"
      ref={mount}
      role="img"
      aria-label="Animated illustrative globe with network paths"
    />
  );
}
