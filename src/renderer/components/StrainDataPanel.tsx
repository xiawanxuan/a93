import React, { useMemo } from 'react';
import type { SerialDataFrame, SafetyReport } from '../../shared/types';
import { formatStrain, getStatusFromUtilization } from '../utils/color';

interface StrainDataPanelProps {
  frame: SerialDataFrame | null;
  safetyReport: SafetyReport | null;
  gaugeChannels?: number[];
}

export const StrainDataPanel: React.FC<StrainDataPanelProps> = ({
  frame,
  safetyReport,
  gaugeChannels,
}) => {
  const displayChannels = useMemo(() => {
    if (!frame) return [];
    const channels = gaugeChannels && gaugeChannels.length > 0
      ? gaugeChannels
      : frame.channels.map((_, i) => i);
    return channels.filter((ch) => ch >= 0 && ch < frame.channels.length);
  }, [frame, gaugeChannels]);

  const histogramData = useMemo(() => {
    if (!frame) return [];
    const values = displayChannels.map((ch) => Math.abs(frame.channels[ch]));
    const max = Math.max(...values, 1e-9);
    return values.map((v) => (v / max) * 100);
  }, [frame, displayChannels]);

  const getChannelStatus = (channel: number): 'safe' | 'warning' | 'alarm' => {
    if (!safetyReport) return 'safe';
    const util = safetyReport.channelUtilization[String(channel)];
    if (util === undefined) return 'safe';
    return getStatusFromUtilization(util, 0.8, 1.0);
  };

  const stats = useMemo(() => {
    if (!frame) return null;
    const values = displayChannels.map((ch) => frame.channels[ch]);
    const max = Math.max(...values.map(Math.abs));
    const avg = values.reduce((a, b) => a + Math.abs(b), 0) / values.length;
    return { max, avg, count: values.length };
  }, [frame, displayChannels]);

  return (
    <div>
      {stats && (
        <div className="stats-grid">
          <div className="mini-stat">
            <div className="label">通道数</div>
            <div className="value">{stats.count}</div>
          </div>
          <div className="mini-stat">
            <div className="label">峰值应变</div>
            <div className="value">
              {formatStrain(stats.max)}
              <span style={{ fontSize: '11px', color: '#64748b', fontWeight: 400, marginLeft: '3px' }}>
                με
              </span>
            </div>
          </div>
        </div>
      )}

      {histogramData.length > 0 && (
        <div className="metric-card">
          <div className="metric-label">应变幅值分布</div>
          <div className="histogram">
            {histogramData.slice(0, 32).map((h, i) => (
              <div
                key={i}
                className="bar"
                style={{
                  height: `${Math.max(5, h)}%`,
                  background:
                    getChannelStatus(displayChannels[i]) === 'alarm'
                      ? 'linear-gradient(180deg, #ef4444, #dc2626)'
                      : getChannelStatus(displayChannels[i]) === 'warning'
                      ? 'linear-gradient(180deg, #eab308, #ca8a04)'
                      : 'linear-gradient(180deg, #3b82f6, #2563eb)',
                }}
              />
            ))}
          </div>
        </div>
      )}

      {frame && (
        <div style={{ fontSize: '10px', color: '#64748b', marginBottom: '8px' }}>
          帧ID: {frame.frameId} | 通道: {frame.channels.length}
        </div>
      )}

      <div style={{ maxHeight: '380px', overflowY: 'auto', margin: '0 -4px', padding: '0 4px' }}>
        <table className="data-table">
          <thead>
            <tr>
              <th className="channel-col">通道</th>
              <th className="strain-col">应变 (με)</th>
              <th>状态</th>
            </tr>
          </thead>
          <tbody>
            {frame &&
              displayChannels.map((ch) => {
                const strain = frame.channels[ch];
                const status = getChannelStatus(ch);
                const tagClass =
                  status === 'alarm'
                    ? 'tag-alarm'
                    : status === 'warning'
                    ? 'tag-warning'
                    : 'tag-safe';
                const statusText =
                  status === 'alarm' ? '报警' : status === 'warning' ? '预警' : '正常';
                return (
                  <tr key={ch}>
                    <td className="channel-col">CH{ch.toString().padStart(2, '0')}</td>
                    <td className="strain-col">{formatStrain(strain)}</td>
                    <td>
                      <span className={`status-tag ${tagClass}`}>{statusText}</span>
                    </td>
                  </tr>
                );
              })}
            {!frame && (
              <tr>
                <td colSpan={3} style={{ textAlign: 'center', color: '#64748b', padding: '30px 0' }}>
                  等待数据采集...
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};
