import React, { useRef, useEffect, useCallback } from 'react';
import type { CrossSection, FEResult, StrainGauge } from '../../shared/types';
import {
  interpolateColor,
  colorToCss,
  renderColorGradient,
  formatStress,
  formatTimestamp,
} from '../utils/color';

interface StressCloudChartProps {
  section: CrossSection | null;
  feResult: FEResult | null;
  gauges: StrainGauge[];
  maxStressScale?: number;
  minStressScale?: number;
  showGaugeMarkers?: boolean;
  showGrid?: boolean;
  showContour?: boolean;
  onResize?: () => void;
}

export const StressCloudChart: React.FC<StressCloudChartProps> = ({
  section,
  feResult,
  gauges,
  maxStressScale,
  minStressScale = 0,
  showGaugeMarkers = true,
  showGrid = false,
  showContour = false,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const dprRef = useRef<number>(1);

  const resize = useCallback(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const rect = container.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    dprRef.current = dpr;

    canvas.width = Math.floor(rect.width * dpr);
    canvas.height = Math.floor(rect.height * dpr);
    canvas.style.width = rect.width + 'px';
    canvas.style.height = rect.height + 'px';
  }, []);

  useEffect(() => {
    resize();
    const obs = new ResizeObserver(resize);
    if (containerRef.current) obs.observe(containerRef.current);
    window.addEventListener('resize', resize);
    return () => {
      obs.disconnect();
      window.removeEventListener('resize', resize);
    };
  }, [resize]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !section) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const W = canvas.width;
    const H = canvas.height;
    const dpr = dprRef.current;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const rect = { width: W / dpr, height: H / dpr };
    ctx.clearRect(0, 0, rect.width, rect.height);

    const padding = { top: 40, right: 40, bottom: 50, left: 60 };
    const plotW = rect.width - padding.left - padding.right;
    const plotH = rect.height - padding.top - padding.bottom;

    const scaleX = plotW / section.width;
    const scaleY = plotH / section.height;
    const scale = Math.min(scaleX, scaleY);

    const offsetX = padding.left + (plotW - section.width * scale) / 2;
    const offsetY = padding.top + (plotH - section.height * scale) / 2;

    const toScreenX = (x: number) => offsetX + x * scale;
    const toScreenY = (y: number) => offsetY + (section.height - y) * scale;

    ctx.strokeStyle = '#334155';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    for (let i = 0; i <= 4; i++) {
      const y = offsetY + (i * plotH) / 4;
      ctx.beginPath();
      ctx.moveTo(offsetX, y);
      ctx.lineTo(offsetX + plotW, y);
      ctx.stroke();

      const x = offsetX + (i * plotW) / 4;
      ctx.beginPath();
      ctx.moveTo(x, offsetY);
      ctx.lineTo(x, offsetY + plotH);
      ctx.stroke();
    }
    ctx.setLineDash([]);

    ctx.fillStyle = '#64748b';
    ctx.font = '10px -apple-system, sans-serif';
    ctx.textAlign = 'center';
    for (let i = 0; i <= 4; i++) {
      const val = (i * section.height) / 4;
      ctx.fillText((val * 1000).toFixed(0) + ' mm', 28, offsetY + plotH - (i * plotH) / 4 + 3);
    }
    ctx.textAlign = 'center';
    for (let i = 0; i <= 4; i++) {
      const val = (i * section.width) / 4;
      ctx.fillText((val * 1000).toFixed(0) + ' mm', offsetX + (i * plotW) / 4, offsetY + plotH + 16);
    }

    ctx.fillStyle = '#94a3b8';
    ctx.font = '11px -apple-system, sans-serif';
    ctx.save();
    ctx.translate(14, offsetY + plotH / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.textAlign = 'center';
    ctx.fillText('截面高度 (mm)', 0, 0);
    ctx.restore();
    ctx.fillText('截面宽度 (mm)', offsetX + plotW / 2, rect.height - 8);

    ctx.strokeStyle = '#475569';
    ctx.lineWidth = 2;
    ctx.strokeRect(offsetX, offsetY, section.width * scale, section.height * scale);

    if (showGrid && section.elements.length > 0) {
      ctx.strokeStyle = 'rgba(71, 85, 105, 0.3)';
      ctx.lineWidth = 0.5;
      for (const elem of section.elements) {
        const pts = elem.nodeIds.map(nid => section.nodes[nid]);
        ctx.beginPath();
        ctx.moveTo(toScreenX(pts[0].x), toScreenY(pts[0].y));
        for (let i = 1; i < pts.length; i++) {
          ctx.lineTo(toScreenX(pts[i].x), toScreenY(pts[i].y));
        }
        ctx.closePath();
        ctx.stroke();
      }
    }

    if (feResult && feResult.elemVonMises.length > 0 && section.elements.length === feResult.elemVonMises.length) {
      const maxV = maxStressScale ?? feResult.maxVonMises;
      const minV = minStressScale;

      for (let ei = 0; ei < section.elements.length; ei++) {
        const elem = section.elements[ei];
        const vm = feResult.elemVonMises[ei];
        const t = maxV > minV ? (vm - minV) / (maxV - minV) : 0;
        const color = interpolateColor(t);

        const pts = elem.nodeIds.map(nid => section.nodes[nid]);
        ctx.beginPath();
        ctx.moveTo(toScreenX(pts[0].x), toScreenY(pts[0].y));
        for (let i = 1; i < pts.length; i++) {
          ctx.lineTo(toScreenX(pts[i].x), toScreenY(pts[i].y));
        }
        ctx.closePath();
        ctx.fillStyle = colorToCss(color, 0.92);
        ctx.fill();
      }

      if (showContour) {
        ctx.strokeStyle = 'rgba(255,255,255,0.08)';
        ctx.lineWidth = 0.5;
        for (const elem of section.elements) {
          const pts = elem.nodeIds.map(nid => section.nodes[nid]);
          ctx.beginPath();
          ctx.moveTo(toScreenX(pts[0].x), toScreenY(pts[0].y));
          for (let i = 1; i < pts.length; i++) {
            ctx.lineTo(toScreenX(pts[i].x), toScreenY(pts[i].y));
          }
          ctx.closePath();
          ctx.stroke();
        }
      }
    } else {
      ctx.fillStyle = 'rgba(51, 65, 85, 0.4)';
      ctx.fillRect(offsetX, offsetY, section.width * scale, section.height * scale);
      ctx.fillStyle = '#64748b';
      ctx.font = 'bold 16px -apple-system, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('等待数据采集...', offsetX + section.width * scale / 2, offsetY + section.height * scale / 2);
    }

    ctx.strokeStyle = '#f1f5f9';
    ctx.lineWidth = 2;
    ctx.strokeRect(offsetX, offsetY, section.width * scale, section.height * scale);

    if (showGaugeMarkers && gauges.length > 0) {
      for (const g of gauges) {
        if (g.x < 0 || g.x > section.width || g.y < 0 || g.y > section.height) continue;
        const sx = toScreenX(g.x);
        const sy = toScreenY(g.y);

        ctx.save();
        ctx.translate(sx, sy);
        ctx.rotate(-g.angle * Math.PI / 180);

        ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
        ctx.strokeStyle = '#1e293b';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.rect(-7, -3, 14, 6);
        ctx.fill();
        ctx.stroke();

        ctx.strokeStyle = '#dc2626';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(-4, 0);
        ctx.lineTo(4, 0);
        ctx.stroke();

        ctx.fillStyle = '#dc2626';
        ctx.fillRect(-1, -0.8, 2, 1.6);
        ctx.restore();

        ctx.fillStyle = '#f1f5f9';
        ctx.font = 'bold 9px -apple-system, sans-serif';
        ctx.textAlign = 'left';
        ctx.fillText(`CH${g.channel}`, sx + 10, sy + 3);
      }
    }

    const barW = Math.min(300, rect.width - 100);
    const barX = rect.width / 2 - barW / 2;
    const barY = rect.height - 40;

    ctx.fillStyle = 'rgba(15, 23, 42, 0.85)';
    ctx.strokeStyle = '#334155';
    ctx.lineWidth = 1;
    roundRect(ctx, barX - 10, barY - 18, barW + 20, 38, 6);
    ctx.fill();
    ctx.stroke();

    renderColorGradient(ctx, barX, barY - 4, barW, 10);

    const maxV = feResult ? (maxStressScale ?? feResult.maxVonMises) : 1;
    const midV = maxV / 2;
    ctx.fillStyle = '#94a3b8';
    ctx.font = '10px -apple-system, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(`0`, barX, barY + 16);
    ctx.fillText(`${formatStress(midV)} ${maxV >= 1e6 ? 'MPa' : 'Pa'}`, barX + barW / 2, barY + 16);
    ctx.fillText(`${formatStress(maxV)} ${maxV >= 1e6 ? 'MPa' : 'Pa'}`, barX + barW, barY + 16);

    ctx.fillStyle = '#e2e8f0';
    ctx.font = '11px -apple-system, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Von Mises 等效应力分布云图', rect.width / 2, 22);

    if (feResult) {
      ctx.fillStyle = '#64748b';
      ctx.font = '10px -apple-system, sans-serif';
      ctx.textAlign = 'right';
      ctx.fillText(
        `节点: ${section.nodes.length} | 单元: ${section.elements.length} | 求解耗时: ${feResult.solveTimeMs.toFixed(1)}ms`,
        rect.width - 12,
        14
      );
    }
  }, [section, feResult, gauges, maxStressScale, minStressScale, showGaugeMarkers, showGrid, showContour]);

  return (
    <div ref={containerRef} className="canvas-container">
      <canvas ref={canvasRef} />
    </div>
  );
};

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}
