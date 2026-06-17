export interface RGB {
  r: number;
  g: number;
  b: number;
}

export function interpolateColor(t: number): RGB {
  const clampedT = Math.max(0, Math.min(1, t));
  const stops = [
    { t: 0.0, c: [0, 0, 128] },
    { t: 0.25, c: [0, 128, 255] },
    { t: 0.5, c: [0, 255, 255] },
    { t: 0.75, c: [255, 255, 0] },
    { t: 0.9, c: [255, 128, 0] },
    { t: 1.0, c: [255, 0, 0] },
  ];

  if (clampedT <= stops[0].t) {
    return { r: stops[0].c[0], g: stops[0].c[1], b: stops[0].c[2] };
  }
  if (clampedT >= stops[stops.length - 1].t) {
    return { r: stops[stops.length - 1].c[0], g: stops[stops.length - 1].c[1], b: stops[stops.length - 1].c[2] };
  }

  for (let i = 0; i < stops.length - 1; i++) {
    const s0 = stops[i];
    const s1 = stops[i + 1];
    if (clampedT >= s0.t && clampedT <= s1.t) {
      const localT = (clampedT - s0.t) / (s1.t - s0.t);
      return {
        r: Math.round(s0.c[0] + (s1.c[0] - s0.c[0]) * localT),
        g: Math.round(s0.c[1] + (s1.c[1] - s0.c[1]) * localT),
        b: Math.round(s0.c[2] + (s1.c[2] - s0.c[2]) * localT),
      };
    }
  }
  return { r: 255, g: 255, b: 255 };
}

export function colorToCss(rgb: RGB, alpha = 1): string {
  if (alpha < 1) {
    return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${alpha})`;
  }
  return `rgb(${rgb.r}, ${rgb.g}, ${rgb.b})`;
}

export function colorToHex(rgb: RGB): string {
  const toHex = (v: number) => v.toString(16).padStart(2, '0');
  return `#${toHex(rgb.r)}${toHex(rgb.g)}${toHex(rgb.b)}`;
}

export function generateColorStops(count: number): string[] {
  const stops: string[] = [];
  for (let i = 0; i < count; i++) {
    const t = i / (count - 1);
    stops.push(colorToHex(interpolateColor(t)));
  }
  return stops;
}

export function renderColorGradient(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number): void {
  const gradient = ctx.createLinearGradient(x, y, x + width, y);
  gradient.addColorStop(0.0, colorToCss(interpolateColor(0)));
  gradient.addColorStop(0.25, colorToCss(interpolateColor(0.25)));
  gradient.addColorStop(0.5, colorToCss(interpolateColor(0.5)));
  gradient.addColorStop(0.75, colorToCss(interpolateColor(0.75)));
  gradient.addColorStop(0.9, colorToCss(interpolateColor(0.9)));
  gradient.addColorStop(1.0, colorToCss(interpolateColor(1.0)));
  ctx.fillStyle = gradient;
  ctx.fillRect(x, y, width, height);
}

export function formatStrain(value: number): string {
  const microstrain = value * 1e6;
  if (Math.abs(microstrain) >= 1000) {
    return microstrain.toFixed(1);
  }
  return microstrain.toFixed(3);
}

export function formatStress(value: number): string {
  if (value >= 1e6) {
    return (value / 1e6).toFixed(2);
  } else if (value >= 1e3) {
    return (value / 1e3).toFixed(2);
  }
  return value.toFixed(4);
}

export function getStressUnit(value: number): string {
  if (value >= 1e6) return 'MPa';
  if (value >= 1e3) return 'kPa';
  return 'Pa';
}

export function formatTimestamp(ts: number | bigint, format: 'full' | 'time' | 'date' = 'time'): string {
  const num = typeof ts === 'bigint' ? Number(ts) : ts;
  const d = new Date(num);
  if (isNaN(d.getTime())) return '--:--:--';
  const pad = (n: number) => n.toString().padStart(2, '0');
  switch (format) {
    case 'full':
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
    case 'date':
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    case 'time':
    default:
      return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  }
}

export function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function formatNumber(num: number, decimals = 2): string {
  if (Math.abs(num) >= 1000) {
    return num.toFixed(decimals);
  }
  return num.toFixed(decimals);
}

export function formatUtilization(ratio: number): string {
  return `${(ratio * 100).toFixed(1)}%`;
}

export function getStatusFromUtilization(ratio: number, warn = 0.8, alarm = 1.0): 'safe' | 'warning' | 'alarm' {
  if (ratio >= alarm) return 'alarm';
  if (ratio >= warn) return 'warning';
  return 'safe';
}
