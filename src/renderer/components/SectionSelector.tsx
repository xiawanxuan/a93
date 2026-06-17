import React, { useEffect, useRef } from 'react';
import type { SectionInfo, GaugeConfig } from '../../shared/types';
import { interpolateColor, colorToCss } from '../utils/color';

interface SectionSelectorProps {
  sections: SectionInfo[];
  gauges: GaugeConfig[];
  selectedSectionId: number;
  onSelectSection: (sectionId: number) => void;
  onRefresh: () => void;
}

export const SectionSelector: React.FC<SectionSelectorProps> = ({
  sections,
  gauges,
  selectedSectionId,
  onSelectSection,
  onRefresh,
}) => {
  const canvasRefs = useRef<Map<number, HTMLCanvasElement>>(new Map());

  useEffect(() => {
    for (const section of sections) {
      const canvas = canvasRefs.current.get(section.id);
      if (!canvas) continue;

      const ctx = canvas.getContext('2d');
      if (!ctx) continue;

      const W = canvas.width;
      const H = canvas.height;
      const dpr = window.devicePixelRatio || 1;
      canvas.width = W * dpr;
      canvas.height = H * dpr;
      ctx.scale(dpr, dpr);

      ctx.clearRect(0, 0, W, H);

      const padding = 12;
      const plotW = W - padding * 2;
      const plotH = H - padding * 2;

      const aspect = section.width / section.height;
      let drawW = plotW;
      let drawH = plotW / aspect;
      if (drawH > plotH) {
        drawH = plotH;
        drawW = plotH * aspect;
      }

      const offsetX = padding + (plotW - drawW) / 2;
      const offsetY = padding + (plotH - drawH) / 2;

      const gradient = ctx.createLinearGradient(offsetX, offsetY, offsetX, offsetY + drawH);
      for (let i = 0; i <= 10; i++) {
        const t = i / 10;
        gradient.addColorStop(t, colorToCss(interpolateColor(t), 0.3));
      }
      ctx.fillStyle = gradient;
      ctx.fillRect(offsetX, offsetY, drawW, drawH);

      ctx.strokeStyle = selectedSectionId === section.id ? '#3b82f6' : '#475569';
      ctx.lineWidth = selectedSectionId === section.id ? 2 : 1;
      ctx.strokeRect(offsetX, offsetY, drawW, drawH);

      const sectionGauges = gauges.filter((g) => g.sectionId === section.id);
      for (const gauge of sectionGauges) {
        if (section.width <= 0 || section.height <= 0) continue;
        const gx = offsetX + (gauge.posX / section.width) * drawW;
        const gy = offsetY + drawH - (gauge.posY / section.height) * drawH;

        ctx.save();
        ctx.translate(gx, gy);
        ctx.rotate((-gauge.angle * Math.PI) / 180);
        ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
        ctx.strokeStyle = '#1e293b';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.rect(-4, -2, 8, 4);
        ctx.fill();
        ctx.stroke();
        ctx.strokeStyle = '#dc2626';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(-2, 0);
        ctx.lineTo(2, 0);
        ctx.stroke();
        ctx.restore();
      }

      ctx.fillStyle = '#94a3b8';
      ctx.font = '10px -apple-system, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(
        `${(section.width * 1000).toFixed(0)}×${(section.height * 1000).toFixed(0)} mm`,
        W / 2,
        H - 4
      );
    }
  }, [sections, gauges, selectedSectionId]);

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
        <div className="section-title">构件列表</div>
        <button className="btn btn-small" onClick={onRefresh}>
          ↻
        </button>
      </div>

      {sections.length === 0 ? (
        <div className="empty-state">
          <div className="icon">📐</div>
          <div className="message">暂无构件数据</div>
        </div>
      ) : (
        sections.map((section) => {
          const sectionGauges = gauges.filter((g) => g.sectionId === section.id);
          const isActive = selectedSectionId === section.id;
          return (
            <div
              key={section.id}
              className={`section-thumb ${isActive ? 'active' : ''}`}
              onClick={() => onSelectSection(section.id)}
            >
              <div className="thumb-canvas">
                <canvas
                  ref={(el) => {
                    if (el) canvasRefs.current.set(section.id, el);
                  }}
                  style={{ width: '100%', height: '100%' }}
                  width={220}
                  height={100}
                />
              </div>
              <div className="section-name">{section.name}</div>
              <div className="section-info">
                <span>{section.memberType === 'beam' ? '木梁' : '木柱'}</span>
                <span>{sectionGauges.length} 测点</span>
              </div>
              <div style={{ fontSize: '11px', color: '#64748b', marginTop: '4px' }}>
                {section.material}
              </div>
            </div>
          );
        })
      )}

      <div className="form-divider" />

      <div className="section-title">采集控制</div>

      <div className="control-group">
        <label>采样频率</label>
        <div className="control-row">
          <select defaultValue={5}>
            <option value={1}>1 Hz</option>
            <option value={2}>2 Hz</option>
            <option value={5}>5 Hz</option>
            <option value={10}>10 Hz</option>
          </select>
        </div>
      </div>

      <div className="control-group">
        <label>载荷模式</label>
        <select defaultValue={0}>
          <option value={0}>正弦载荷</option>
          <option value={1}>脉动载荷</option>
          <option value={2}>阶跃载荷</option>
          <option value={3}>复合载荷</option>
        </select>
      </div>

      <div className="control-group">
        <label>
          显示选项
        </label>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
            <span className="switch">
              <input type="checkbox" defaultChecked />
              <span className="switch-slider" />
            </span>
            <span style={{ fontSize: '12px', color: '#94a3b8' }}>显示应变片标记</span>
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
            <span className="switch">
              <input type="checkbox" />
              <span className="switch-slider" />
            </span>
            <span style={{ fontSize: '12px', color: '#94a3b8' }}>显示有限元网格</span>
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
            <span className="switch">
              <input type="checkbox" />
              <span className="switch-slider" />
            </span>
            <span style={{ fontSize: '12px', color: '#94a3b8' }}>显示等值线</span>
          </label>
        </div>
      </div>
    </div>
  );
};
