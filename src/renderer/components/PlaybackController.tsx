import React, { useRef, useState, useCallback, useEffect } from 'react';
import type { StressSnapshot, PlaybackConfig } from '../../shared/types';
import { formatTimestamp, formatDuration } from '../utils/color';

interface PlaybackControllerProps {
  snapshots: StressSnapshot[];
  isLiveMode: boolean;
  currentTime: number;
  onTimeChange: (time: number, snapshot?: StressSnapshot) => void;
  onToggleLive: () => void;
  onLoadHistory: (startTime: number, endTime: number) => Promise<void>;
}

export const PlaybackController: React.FC<PlaybackControllerProps> = ({
  snapshots,
  isLiveMode,
  currentTime,
  onTimeChange,
  onToggleLive,
  onLoadHistory,
}) => {
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [isDragging, setIsDragging] = useState(false);
  const trackRef = useRef<HTMLDivElement>(null);
  const playIntervalRef = useRef<number | null>(null);

  const startTime = snapshots.length > 0 ? Number(snapshots[0].timestamp) : currentTime - 60000;
  const endTime = snapshots.length > 0 ? Number(snapshots[snapshots.length - 1].timestamp) : currentTime;
  const totalDuration = Math.max(1, endTime - startTime);

  const getTimeFromPosition = useCallback(
    (clientX: number): number => {
      if (!trackRef.current) return currentTime;
      const rect = trackRef.current.getBoundingClientRect();
      const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      return startTime + ratio * totalDuration;
    },
    [startTime, totalDuration, currentTime]
  );

  const findSnapshotAtTime = useCallback(
    (time: number): StressSnapshot | undefined => {
      if (snapshots.length === 0) return undefined;
      let left = 0;
      let right = snapshots.length - 1;
      while (left < right) {
        const mid = Math.floor((left + right) / 2);
        if (Number(snapshots[mid].timestamp) < time) {
          left = mid + 1;
        } else {
          right = mid;
        }
      }
      return snapshots[Math.max(0, left - 1)] || snapshots[0];
    },
    [snapshots]
  );

  const handleTrackMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (isLiveMode) return;
      setIsDragging(true);
      const time = getTimeFromPosition(e.clientX);
      const snap = findSnapshotAtTime(time);
      onTimeChange(time, snap);
    },
    [isLiveMode, getTimeFromPosition, findSnapshotAtTime, onTimeChange]
  );

  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      const time = getTimeFromPosition(e.clientX);
      const snap = findSnapshotAtTime(time);
      onTimeChange(time, snap);
    };

    const handleMouseUp = () => {
      setIsDragging(false);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging, getTimeFromPosition, findSnapshotAtTime, onTimeChange]);

  useEffect(() => {
    if (!isPlaying || isLiveMode) {
      if (playIntervalRef.current) {
        window.clearInterval(playIntervalRef.current);
        playIntervalRef.current = null;
      }
      return;
    }

    const stepMs = 100;
    playIntervalRef.current = window.setInterval(() => {
      const nextTime = currentTime + stepMs * playbackRate * 10;
      if (nextTime >= endTime) {
        setIsPlaying(false);
        onTimeChange(endTime, snapshots[snapshots.length - 1]);
      } else {
        const snap = findSnapshotAtTime(nextTime);
        onTimeChange(nextTime, snap);
      }
    }, stepMs);

    return () => {
      if (playIntervalRef.current) {
        window.clearInterval(playIntervalRef.current);
        playIntervalRef.current = null;
      }
    };
  }, [isPlaying, isLiveMode, playbackRate, currentTime, endTime, findSnapshotAtTime, onTimeChange, snapshots]);

  const handlePlayPause = () => {
    if (isLiveMode) {
      onToggleLive();
    }
    setIsPlaying(!isPlaying);
  };

  const handleStepBackward = () => {
    if (snapshots.length === 0) return;
    const currentIdx = snapshots.findIndex((s) => Number(s.timestamp) >= currentTime);
    const prevIdx = Math.max(0, currentIdx - 1);
    const snap = snapshots[prevIdx];
    onTimeChange(Number(snap.timestamp), snap);
  };

  const handleStepForward = () => {
    if (snapshots.length === 0) return;
    const currentIdx = snapshots.findIndex((s) => Number(s.timestamp) >= currentTime);
    const nextIdx = Math.min(snapshots.length - 1, currentIdx + 1);
    const snap = snapshots[nextIdx];
    onTimeChange(Number(snap.timestamp), snap);
  };

  const handleSeekToStart = () => {
    if (snapshots.length === 0) return;
    const snap = snapshots[0];
    onTimeChange(Number(snap.timestamp), snap);
  };

  const handleSeekToEnd = () => {
    if (snapshots.length === 0) return;
    const snap = snapshots[snapshots.length - 1];
    onTimeChange(Number(snap.timestamp), snap);
  };

  const progressPercent = totalDuration > 0 ? ((currentTime - startTime) / totalDuration) * 100 : 0;

  return (
    <div className="playback-bar">
      <div className="playback-controls">
        <button
          className="playback-btn"
          onClick={handleSeekToStart}
          disabled={isLiveMode || snapshots.length === 0}
          title="跳到开始"
        >
          ⏮
        </button>
        <button
          className="playback-btn"
          onClick={handleStepBackward}
          disabled={isLiveMode || snapshots.length === 0}
          title="上一帧"
        >
          ⏪
        </button>
        <button
          className={`playback-btn play ${isLiveMode ? 'btn-success' : ''}`}
          onClick={handlePlayPause}
          title={isLiveMode ? (isPlaying ? '暂停实时' : '开始实时') : isPlaying ? '暂停' : '播放'}
        >
          {isLiveMode ? (isPlaying ? '⏸' : '●') : isPlaying ? '⏸' : '▶'}
        </button>
        <button
          className="playback-btn"
          onClick={handleStepForward}
          disabled={isLiveMode || snapshots.length === 0}
          title="下一帧"
        >
          ⏩
        </button>
        <button
          className="playback-btn"
          onClick={handleSeekToEnd}
          disabled={isLiveMode || snapshots.length === 0}
          title="跳到结尾"
        >
          ⏭
        </button>

        <div style={{ width: '1px', height: '28px', background: '#334155', margin: '0 6px' }} />

        <select
          value={playbackRate}
          onChange={(e) => setPlaybackRate(Number(e.target.value))}
          style={{
            padding: '5px 8px',
            background: '#0f172a',
            color: '#e2e8f0',
            border: '1px solid #334155',
            borderRadius: '6px',
            fontSize: '12px',
          }}
        >
          <option value={0.25}>0.25×</option>
          <option value={0.5}>0.5×</option>
          <option value={1}>1×</option>
          <option value={2}>2×</option>
          <option value={4}>4×</option>
          <option value={8}>8×</option>
        </select>

        <button
          className={`btn btn-small ${isLiveMode ? 'btn-success' : ''}`}
          onClick={onToggleLive}
          style={{ marginLeft: '4px' }}
        >
          {isLiveMode ? '● 实时' : '📼 回放'}
        </button>
      </div>

      <div className="timeline-container">
        <div
          ref={trackRef}
          className="timeline-track"
          onMouseDown={handleTrackMouseDown}
          style={{ cursor: isLiveMode ? 'not-allowed' : 'pointer' }}
        >
          <div className="timeline-progress" style={{ width: `${progressPercent}%` }} />
        </div>
        <div
          className="timeline-handle"
          style={{ left: `${progressPercent}%` }}
        />
        <div className="timeline-labels">
          <span>{formatTimestamp(startTime, 'time')}</span>
          <span>{formatTimestamp(endTime, 'time')}</span>
        </div>
      </div>

      <div className="playback-info">
        <div className="time-current">{formatTimestamp(currentTime, 'time')}</div>
        <div className="time-range">
          {formatDuration(Math.floor((endTime - startTime) / 1000))}
          {snapshots.length > 0 && ` · ${snapshots.length} 帧`}
        </div>
        {isLiveMode && (
          <div className="listening-indicator">
            <span className="listening-dot" />
            实时采集中
          </div>
        )}
      </div>
    </div>
  );
};
