import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { StressCloudChart } from './components/StressCloudChart';
import { SafetyIndicator } from './components/SafetyIndicator';
import { StrainDataPanel } from './components/StrainDataPanel';
import { PlaybackController } from './components/PlaybackController';
import { SectionSelector } from './components/SectionSelector';
import type {
  CrossSection,
  FEResult,
  SafetyReport,
  SerialDataFrame,
  SectionInfo,
  GaugeConfig,
  StressSnapshot,
  AppConfig,
  StrainGauge,
} from '../shared/types';
import { SafetyStatusCode } from '../shared/types';
import { formatStress, formatTimestamp } from './utils/color';

const App: React.FC = () => {
  const [appConfig, setAppConfig] = useState<AppConfig | null>(null);
  const [sections, setSections] = useState<SectionInfo[]>([]);
  const [gauges, setGauges] = useState<GaugeConfig[]>([]);
  const [selectedSectionId, setSelectedSectionId] = useState<number>(1);
  const [crossSection, setCrossSection] = useState<CrossSection | null>(null);
  const [currentFrame, setCurrentFrame] = useState<SerialDataFrame | null>(null);
  const [feResult, setFeResult] = useState<FEResult | null>(null);
  const [playbackFeResult, setPlaybackFeResult] = useState<FEResult | null>(null);
  const [safetyReport, setSafetyReport] = useState<SafetyReport | null>(null);
  const [isLiveMode, setIsLiveMode] = useState(true);
  const [isAcquiring, setIsAcquiring] = useState(false);
  const [currentTime, setCurrentTime] = useState<number>(Date.now());
  const [historySnapshots, setHistorySnapshots] = useState<StressSnapshot[]>([]);
  const [liveSnapshots, setLiveSnapshots] = useState<StressSnapshot[]>([]);
  const [showGaugeMarkers, setShowGaugeMarkers] = useState(true);
  const [showGrid, setShowGrid] = useState(false);
  const [showContour, setShowContour] = useState(false);

  const cleanupRef = useRef<(() => void) | null>(null);
  const sectionGauges = useMemo<StrainGauge[]>(() => {
    return gauges
      .filter((g) => g.sectionId === selectedSectionId)
      .map((g) => ({
        id: g.id,
        channel: g.channel,
        x: g.posX,
        y: g.posY,
        angle: g.angle,
      }));
  }, [gauges, selectedSectionId]);

  const currentSectionInfo = useMemo(
    () => sections.find((s) => s.id === selectedSectionId) || null,
    [sections, selectedSectionId]
  );

  const displayFeResult = isLiveMode ? feResult : playbackFeResult;

  const loadConfig = useCallback(async () => {
    try {
      const cfg = await window.api.appGetConfig();
      setAppConfig(cfg);
    } catch (err) {
      console.error('Failed to load config:', err);
    }
  }, []);

  const loadSections = useCallback(async () => {
    try {
      const secs = await window.api.dbGetSections();
      setSections(secs);
    } catch (err) {
      console.error('Failed to load sections:', err);
    }
  }, []);

  const loadGauges = useCallback(async () => {
    try {
      const gs = await window.api.dbGetGauges();
      setGauges(gs);
    } catch (err) {
      console.error('Failed to load gauges:', err);
    }
  }, []);

  const initializeCrossSection = useCallback(
    async (sectionInfo: SectionInfo | null) => {
      if (!sectionInfo) return;
      try {
        const sectionGaugesForFE = gauges
          .filter((g) => g.sectionId === sectionInfo.id)
          .map((g) => ({
            id: g.id,
            channel: g.channel,
            x: g.posX,
            y: g.posY,
            angle: g.angle,
          }));

        const E = 10e9;
        const nu = 0.35;
        const divX = Math.max(10, Math.round(sectionInfo.width * 250));
        const divY = Math.max(10, Math.round(sectionInfo.height * 250));

        const cs = await window.api.feCreateSection(
          sectionInfo.width,
          sectionInfo.height,
          divX,
          divY,
          E,
          nu,
          sectionGaugesForFE
        );
        setCrossSection(cs as CrossSection);
      } catch (err) {
        console.error('Failed to initialize cross section:', err);
      }
    },
    [gauges]
  );

  const startAcquisition = useCallback(async () => {
    if (!appConfig) return;
    try {
      await window.api.serialStart(appConfig.numChannels, appConfig.sampleRateHz);
      setIsAcquiring(true);
    } catch (err) {
      console.error('Failed to start acquisition:', err);
    }
  }, [appConfig]);

  const stopAcquisition = useCallback(async () => {
    try {
      await window.api.serialStop();
      setIsAcquiring(false);
    } catch (err) {
      console.error('Failed to stop acquisition:', err);
    }
  }, []);

  const handleSerialData = useCallback(
    (data: {
      frame: SerialDataFrame;
      feResult: FEResult | null;
      safetyReport: SafetyReport | null;
    }) => {
      setCurrentFrame(data.frame);
      if (data.feResult) {
        setFeResult(data.feResult);
      }
      if (data.safetyReport) {
        setSafetyReport(data.safetyReport);
      }
      if (isLiveMode) {
        setCurrentTime(
          typeof data.frame.timestamp === 'bigint'
            ? Number(data.frame.timestamp)
            : data.frame.timestamp
        );
      }
      if (data.feResult && data.safetyReport) {
        const snapshot: StressSnapshot = {
          id: 0,
          timestamp:
            typeof data.frame.timestamp === 'bigint'
              ? data.frame.timestamp
              : BigInt(data.frame.timestamp),
          sectionId: selectedSectionId,
          maxVonMises: data.feResult.maxVonMises,
          avgVonMises: data.feResult.avgVonMises,
          utilizationRatio: data.safetyReport.utilizationRatio,
          status: data.safetyReport.status,
          elemVonMises: data.feResult.elemVonMises,
        };
        setLiveSnapshots((prev) => {
          const next = [...prev, snapshot];
          if (next.length > 3600) {
            return next.slice(-3600);
          }
          return next;
        });
      }
    },
    [isLiveMode, selectedSectionId]
  );

  useEffect(() => {
    loadConfig();
    loadSections();
    loadGauges();
  }, [loadConfig, loadSections, loadGauges]);

  useEffect(() => {
    if (currentSectionInfo && gauges.length > 0) {
      initializeCrossSection(currentSectionInfo);
    }
  }, [currentSectionInfo, gauges, initializeCrossSection]);

  useEffect(() => {
    if (cleanupRef.current) {
      cleanupRef.current();
    }
    const cleanup = window.api.onSerialData(handleSerialData);
    cleanupRef.current = cleanup;
    return () => {
      if (cleanupRef.current) {
        cleanupRef.current();
        cleanupRef.current = null;
      }
    };
  }, [handleSerialData]);

  useEffect(() => {
    if (!isAcquiring) {
      startAcquisition();
    }
    return () => {
      stopAcquisition();
    };
  }, [isAcquiring, startAcquisition, stopAcquisition]);

  const handleSelectSection = useCallback(
    (sectionId: number) => {
      setSelectedSectionId(sectionId);
      setFeResult(null);
      setPlaybackFeResult(null);
      setSafetyReport(null);
    },
    []
  );

  const handleRefresh = useCallback(() => {
    loadSections();
    loadGauges();
  }, [loadSections, loadGauges]);

  const handleTimeChange = useCallback(
    (time: number, snapshot?: StressSnapshot) => {
      setCurrentTime(time);
      if (snapshot && crossSection) {
        const nNodes = crossSection.nodes.length;
        const playbackFEResult: FEResult = {
          nodeStressXX: new Array(nNodes).fill(0),
          nodeStressYY: new Array(nNodes).fill(0),
          nodeStressXY: new Array(nNodes).fill(0),
          nodeVonMises: new Array(nNodes).fill(0),
          elemVonMises: snapshot.elemVonMises,
          maxVonMises: snapshot.maxVonMises,
          avgVonMises: snapshot.avgVonMises,
          solveTimeMs: 0,
        };
        setPlaybackFeResult(playbackFEResult);
        if (currentSectionInfo) {
          const allowable = currentSectionInfo.allowableStress ?? 11e6;
          const ratio = snapshot.utilizationRatio;
          let status: SafetyStatusCode = SafetyStatusCode.SAFE;
          let statusString = '安全';
          let statusColor = '#22c55e';
          let msg = '结构安全';
          if (ratio >= 1.0) {
            status = SafetyStatusCode.ALARM;
            statusString = '报警';
            statusColor = '#ef4444';
            msg = '危险！应力超过许用值';
          } else if (ratio >= 0.8) {
            status = SafetyStatusCode.WARNING;
            statusString = '预警';
            statusColor = '#eab308';
            msg = '注意：应力接近许用值';
          }
          setSafetyReport({
            status,
            statusString,
            statusColor,
            maxStress: snapshot.maxVonMises,
            allowableStress: allowable,
            safetyFactor: allowable / (snapshot.maxVonMises || 1),
            utilizationRatio: ratio,
            statusMessage: msg,
            evaluationTimeMs: 0,
            timestamp: snapshot.timestamp,
            alarmChannels: [],
            warningChannels: [],
            channelUtilization: {},
          });
        }
      }
    },
    [crossSection, currentSectionInfo]
  );

  const handleToggleLive = useCallback(async () => {
    if (isLiveMode) {
      setIsLiveMode(false);
      const endT = Date.now();
      const startT = endT - 10 * 60 * 1000;
      setHistorySnapshots(liveSnapshots);
      if (liveSnapshots.length > 0) {
        const first = liveSnapshots[0];
        handleTimeChange(
          typeof first.timestamp === 'bigint' ? Number(first.timestamp) : first.timestamp,
          first
        );
      }
    } else {
      setIsLiveMode(true);
      setPlaybackFeResult(null);
      if (currentFrame) {
        setCurrentTime(
          typeof currentFrame.timestamp === 'bigint'
            ? Number(currentFrame.timestamp)
            : currentFrame.timestamp
        );
      }
    }
  }, [isLiveMode, liveSnapshots, currentFrame, handleTimeChange]);

  const handleLoadHistory = useCallback(
    async (startTime: number, endTime: number) => {
      try {
        const snaps = await window.api.dbQuerySnapshots(startTime, endTime, selectedSectionId);
        setHistorySnapshots(snaps);
      } catch (err) {
        console.error('Failed to load history:', err);
      }
    },
    [selectedSectionId]
  );

  const activeSnapshots = isLiveMode ? liveSnapshots : historySnapshots;

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="logo">
          <div className="logo-icon">🏛</div>
          <span>古建筑木结构应力监测系统</span>
        </div>
        <div className="header-right">
          <div className="toolbar-section">
            <span className="label">构件:</span>
            <span style={{ fontSize: '13px', fontWeight: 600, color: '#f1f5f9' }}>
              {currentSectionInfo?.name ?? '加载中...'}
            </span>
          </div>
          <div className="toolbar-section">
            <span className="label">状态:</span>
            <span
              style={{
                fontSize: '13px',
                fontWeight: 600,
                color: isAcquiring ? '#22c55e' : '#9ca3af',
              }}
            >
              {isAcquiring ? (isLiveMode ? '● 实时采集中' : '● 回放模式') : '○ 已停止'}
            </span>
          </div>
          {currentSectionInfo && feResult && (
            <div className="toolbar-section">
              <span className="badge">
                <span className="label">σ_max:</span>
                <span className="value" style={{ color: safetyReport?.statusColor }}>
                  {formatStress(feResult.maxVonMises)}{' '}
                  {feResult.maxVonMises >= 1e6 ? 'MPa' : 'Pa'}
                </span>
              </span>
            </div>
          )}
          <div className="toolbar-section">
            <span style={{ fontSize: '12px', color: '#94a3b8', fontFamily: 'Courier New, monospace' }}>
              {formatTimestamp(currentTime, 'full')}
            </span>
          </div>
        </div>
      </header>

      <div className="main-body">
        <div className="panel">
          <div className="panel-header">
            <span className="title">构件与截面</span>
          </div>
          <div className="panel-body">
            <SectionSelector
              sections={sections}
              gauges={gauges}
              selectedSectionId={selectedSectionId}
              onSelectSection={handleSelectSection}
              onRefresh={handleRefresh}
            />
          </div>
        </div>

        <div className="panel">
          <div className="panel-header">
            <span className="title">应力分布云图</span>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '11px', color: '#94a3b8', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={showGaugeMarkers}
                  onChange={(e) => setShowGaugeMarkers(e.target.checked)}
                  style={{ cursor: 'pointer' }}
                />
                测点
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '11px', color: '#94a3b8', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={showGrid}
                  onChange={(e) => setShowGrid(e.target.checked)}
                  style={{ cursor: 'pointer' }}
                />
                网格
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '11px', color: '#94a3b8', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={showContour}
                  onChange={(e) => setShowContour(e.target.checked)}
                  style={{ cursor: 'pointer' }}
                />
                等值线
              </label>
            </div>
          </div>
          <div className="panel-body" style={{ padding: 0 }}>
            <StressCloudChart
              section={crossSection}
              feResult={displayFeResult}
              gauges={sectionGauges}
              showGaugeMarkers={showGaugeMarkers}
              showGrid={showGrid}
              showContour={showContour}
            />
          </div>
        </div>

        <div className="panel">
          <div className="panel-header">
            <span className="title">实时监测</span>
          </div>
          <div className="panel-body">
            <div className="section-title">安全评估</div>
            <SafetyIndicator report={safetyReport} />

            <div className="form-divider" />

            <div className="section-title">应变数据</div>
            <StrainDataPanel
              frame={currentFrame}
              safetyReport={safetyReport}
              gaugeChannels={sectionGauges.map((g) => g.channel)}
            />
          </div>
        </div>
      </div>

      <PlaybackController
        snapshots={activeSnapshots}
        isLiveMode={isLiveMode}
        currentTime={currentTime}
        onTimeChange={handleTimeChange}
        onToggleLive={handleToggleLive}
        onLoadHistory={handleLoadHistory}
      />
    </div>
  );
};

export default App;
