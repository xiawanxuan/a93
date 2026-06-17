import React from 'react';
import type { SafetyReport } from '../../shared/types';
import {
  formatStress,
  formatUtilization,
  formatTimestamp,
} from '../utils/color';

interface SafetyIndicatorProps {
  report: SafetyReport | null;
}

export const SafetyIndicator: React.FC<SafetyIndicatorProps> = ({ report }) => {
  const statusClass = !report
    ? ''
    : report.status === 2
    ? 'status-alarm'
    : report.status === 1
    ? 'status-warning'
    : 'status-safe';

  return (
    <div>
      <div className={`status-indicator ${statusClass}`}>
        <div className="status-dot" />
        <div>
          <div className="status-text" style={{ color: report?.statusColor ?? '#9ca3af' }}>
            {report?.statusString ?? '等待数据'}
          </div>
          <div style={{ fontSize: '11px', color: '#64748b', marginTop: '2px' }}>
            {report ? formatTimestamp(report.timestamp) : '--:--:--'}
          </div>
        </div>
      </div>

      {report && (
        <>
          <div className="status-message" style={{ color: report.statusColor }}>
            {report.statusMessage}
          </div>

          <div className="stats-grid">
            <div className="mini-stat">
              <div className="label">最大应力</div>
              <div className="value">
                {formatStress(report.maxStress)}
                <span style={{ fontSize: '11px', color: '#64748b', fontWeight: 400, marginLeft: '3px' }}>
                  {report.maxStress >= 1e6 ? 'MPa' : 'Pa'}
                </span>
              </div>
            </div>
            <div className="mini-stat">
              <div className="label">许用应力</div>
              <div className="value">
                {formatStress(report.allowableStress)}
                <span style={{ fontSize: '11px', color: '#64748b', fontWeight: 400, marginLeft: '3px' }}>
                  {report.allowableStress >= 1e6 ? 'MPa' : 'Pa'}
                </span>
              </div>
            </div>
          </div>

          <div className="metric-card">
            <div className="metric-label">应力利用率</div>
            <div className="metric-value" style={{ color: report.statusColor }}>
              {formatUtilization(report.utilizationRatio)}
            </div>
            <div className="metric-bar">
              <div
                className="metric-bar-fill"
                style={{
                  width: `${Math.min(100, report.utilizationRatio * 100)}%`,
                  background: report.statusColor,
                }}
              />
            </div>
          </div>

          <div className="metric-card">
            <div className="metric-label">安全系数</div>
            <div className="metric-value" style={{ color: report.safetyFactor >= 1.5 ? '#22c55e' : report.safetyFactor >= 1.0 ? '#eab308' : '#ef4444' }}>
              {report.safetyFactor >= 999 ? '∞' : report.safetyFactor.toFixed(2)}
            </div>
          </div>

          {report.alarmChannels.length > 0 && (
            <div className="metric-card" style={{ borderColor: 'rgba(239, 68, 68, 0.5)' }}>
              <div className="metric-label" style={{ color: '#f87171' }}>
                报警通道 ({report.alarmChannels.length})
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginTop: '6px' }}>
                {report.alarmChannels.slice(0, 12).map((ch) => (
                  <span key={ch} className="status-tag tag-alarm">
                    CH{ch}
                  </span>
                ))}
                {report.alarmChannels.length > 12 && (
                  <span className="status-tag tag-alarm">+{report.alarmChannels.length - 12}</span>
                )}
              </div>
            </div>
          )}

          {report.warningChannels.length > 0 && (
            <div className="metric-card" style={{ borderColor: 'rgba(234, 179, 8, 0.5)' }}>
              <div className="metric-label" style={{ color: '#facc15' }}>
                预警通道 ({report.warningChannels.length})
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginTop: '6px' }}>
                {report.warningChannels.slice(0, 12).map((ch) => (
                  <span key={ch} className="status-tag tag-warning">
                    CH{ch}
                  </span>
                ))}
                {report.warningChannels.length > 12 && (
                  <span className="status-tag tag-warning">+{report.warningChannels.length - 12}</span>
                )}
              </div>
            </div>
          )}

          <div style={{ fontSize: '10px', color: '#64748b', textAlign: 'right', marginTop: '8px' }}>
            评估耗时: {report.evaluationTimeMs.toFixed(2)} ms
          </div>
        </>
      )}
    </div>
  );
};
