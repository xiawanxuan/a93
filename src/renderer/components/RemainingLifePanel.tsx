import React, { useState, useCallback } from 'react';
import type { RemainingLifeResult, StressSnapshot } from '../../shared/types';

interface RemainingLifePanelProps {
  snapshots: StressSnapshot[];
  remainingLife: RemainingLifeResult | null;
  onPredict: (stressHistory: number[], monitoringYears: number) => void;
}

function formatLifeYears(years: number): string {
  if (years >= 999) return '>999';
  if (years >= 100) return years.toFixed(0);
  if (years >= 10) return years.toFixed(1);
  if (years >= 1) return years.toFixed(2);
  if (years >= 0.01) return years.toFixed(3);
  return years.toExponential(2);
}

function getMaintenanceColor(level: 1 | 2 | 3): string {
  switch (level) {
    case 1: return '#22c55e';
    case 2: return '#f59e0b';
    case 3: return '#ef4444';
  }
}

function getMaintenanceLabel(level: 1 | 2 | 3): string {
  switch (level) {
    case 1: return '常规监测';
    case 2: return '加强维护';
    case 3: return '紧急加固';
  }
}

function getDamageBarColor(damage: number): string {
  if (damage < 0.3) return '#22c55e';
  if (damage < 0.5) return '#84cc16';
  if (damage < 0.7) return '#f59e0b';
  if (damage < 0.9) return '#f97316';
  return '#ef4444';
}

export const RemainingLifePanel: React.FC<RemainingLifePanelProps> = ({
  snapshots,
  remainingLife,
  onPredict,
}) => {
  const [isComputing, setIsComputing] = useState(false);

  const handlePredict = useCallback(async () => {
    if (snapshots.length < 10) return;
    setIsComputing(true);
    try {
      const stressHistory = snapshots.map((s) => s.maxVonMises);
      const firstTime = Number(snapshots[0].timestamp);
      const lastTime = Number(snapshots[snapshots.length - 1].timestamp);
      const monitoringYears = (lastTime - firstTime) / (365.25 * 24 * 3600 * 1000);
      onPredict(stressHistory, Math.max(monitoringYears, 1e-6));
    } finally {
      setIsComputing(false);
    }
  }, [snapshots, onPredict]);

  const damagePct = remainingLife
    ? Math.min(100, remainingLife.cumulativeDamage * 100)
    : 0;
  const lifePct = remainingLife
    ? Math.min(100, Math.max(0, remainingLife.remainingLifeYears / 100 * 100))
    : 0;

  return (
    <div className="remaining-life-panel">
      <div className="rl-header">
        <span className="rl-title">剩余寿命预测</span>
        <button
          className={`rl-predict-btn ${isComputing ? 'computing' : ''}`}
          onClick={handlePredict}
          disabled={snapshots.length < 10 || isComputing}
        >
          {isComputing ? '计算中...' : '预测'}
        </button>
      </div>

      {!remainingLife && snapshots.length < 10 && (
        <div className="rl-empty">
          <div className="rl-empty-icon">⏳</div>
          <div>需要至少10个应力数据点</div>
          <div style={{ fontSize: '11px', color: '#475569', marginTop: '4px' }}>
            当前: {snapshots.length} 个数据点
          </div>
        </div>
      )}

      {!remainingLife && snapshots.length >= 10 && (
        <div className="rl-empty">
          <div className="rl-empty-icon">📊</div>
          <div>点击"预测"按钮开始分析</div>
          <div style={{ fontSize: '11px', color: '#475569', marginTop: '4px' }}>
            已有 {snapshots.length} 个数据点
          </div>
        </div>
      )}

      {remainingLife && (
        <div className="rl-content">
          <div className="rl-life-display">
            <div className="rl-life-value" style={{
              color: remainingLife.remainingLifeYears >= 50
                ? '#22c55e'
                : remainingLife.remainingLifeYears >= 10
                ? '#84cc16'
                : remainingLife.remainingLifeYears >= 3
                ? '#f59e0b'
                : '#ef4444',
            }}>
              {formatLifeYears(remainingLife.remainingLifeYears)}
            </div>
            <div className="rl-life-unit">年</div>
          </div>

          <div className="rl-damage-section">
            <div className="rl-damage-label">
              <span>累积损伤 D</span>
              <span className="rl-damage-value">{remainingLife.cumulativeDamage.toExponential(3)}</span>
            </div>
            <div className="rl-damage-bar">
              <div
                className="rl-damage-bar-fill"
                style={{
                  width: `${damagePct}%`,
                  background: getDamageBarColor(remainingLife.cumulativeDamage),
                }}
              />
              <div className="rl-damage-markers">
                <div className="rl-damage-marker" style={{ left: '30%' }}>
                  <span>0.3</span>
                </div>
                <div className="rl-damage-marker" style={{ left: '70%' }}>
                  <span>0.7</span>
                </div>
              </div>
            </div>
          </div>

          <div className="rl-stats-grid">
            <div className="rl-stat">
              <div className="rl-stat-label">年损伤率</div>
              <div className="rl-stat-value">{remainingLife.damageRatePerYear.toExponential(2)}/yr</div>
            </div>
            <div className="rl-stat">
              <div className="rl-stat-label">总循环数</div>
              <div className="rl-stat-value">{remainingLife.totalCycles}</div>
            </div>
            <div className="rl-stat">
              <div className="rl-stat-label">最大应力幅</div>
              <div className="rl-stat-value">
                {(remainingLife.maxCycleRange / 1e6).toFixed(2)}
                <span style={{ fontSize: '10px', color: '#64748b' }}> MPa</span>
              </div>
            </div>
            <div className="rl-stat">
              <div className="rl-stat-label">等效应力幅</div>
              <div className="rl-stat-value">
                {(remainingLife.equivalentStressRange / 1e6).toFixed(2)}
                <span style={{ fontSize: '10px', color: '#64748b' }}> MPa</span>
              </div>
            </div>
          </div>

          <div className="rl-maintenance" style={{
            borderLeftColor: getMaintenanceColor(remainingLife.maintenanceLevel),
          }}>
            <div className="rl-maintenance-header">
              <span
                className="rl-maintenance-badge"
                style={{
                  background: getMaintenanceColor(remainingLife.maintenanceLevel),
                }}
              >
                {getMaintenanceLabel(remainingLife.maintenanceLevel)}
              </span>
              <span style={{ fontSize: '11px', color: '#94a3b8' }}>
                三级维护建议
              </span>
            </div>
            <div className="rl-maintenance-text">
              {remainingLife.maintenanceAdvice}
            </div>
          </div>

          {remainingLife.cycles.length > 0 && (
            <div className="rl-cycles-section">
              <div className="rl-cycles-title">应力循环统计 (Top 5)</div>
              <div className="rl-cycles-table">
                <div className="rl-cycles-header">
                  <span>应力幅</span>
                  <span>均值</span>
                  <span>次数</span>
                  <span>损伤</span>
                </div>
                {remainingLife.cycles.slice(0, 5).map((c, i) => {
                  const Nf = 1e12 / Math.pow(c.range, 5.0);
                  const dmg = c.count / Nf;
                  return (
                    <div key={i} className="rl-cycles-row">
                      <span>{(c.range / 1e6).toFixed(2)} MPa</span>
                      <span>{(c.mean / 1e6).toFixed(2)}</span>
                      <span>{c.count}</span>
                      <span style={{ color: dmg > 0.01 ? '#f59e0b' : '#94a3b8' }}>
                        {dmg.toExponential(2)}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <div style={{ fontSize: '10px', color: '#475569', textAlign: 'right', marginTop: '6px' }}>
            S-N: N={remainingLife.equivalentStressRange > 0 ? '10¹²/σ⁵' : '--'} |
            计算耗时: {remainingLife.computeTimeMs.toFixed(2)} ms
          </div>
        </div>
      )}
    </div>
  );
};
