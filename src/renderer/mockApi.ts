import {
  CrossSection,
  FEResult,
  SafetyReport,
  SerialDataFrame,
  SectionInfo,
  GaugeConfig,
  StressSnapshot,
  AppConfig,
  SafetyStatusCode,
} from '../shared/types';

const MOCK_SECTIONS: SectionInfo[] = [
  {
    id: 1,
    name: '主梁',
    memberType: 'beam',
    width: 0.3,
    height: 0.5,
    length: 6.0,
    positionX: 0,
    positionY: 3.5,
    positionZ: 0,
    material: '松木材',
    allowableStress: 11e6,
    notes: '大雄宝殿主承重梁，始建于明代',
  },
  {
    id: 2,
    name: '金柱',
    memberType: 'column',
    width: 0.4,
    height: 0.4,
    length: 8.0,
    positionX: 2.5,
    positionY: 0,
    positionZ: 1.5,
    material: '柏木材',
    allowableStress: 12e6,
    notes: '前檐金柱，有轻微虫蛀痕迹',
  },
];

function generateMockGauges(): GaugeConfig[] {
  const gauges: GaugeConfig[] = [];
  const section1Gauges = 16;
  const section2Gauges = 16;

  for (let i = 0; i < section1Gauges; i++) {
    const row = Math.floor(i / 4);
    const col = i % 4;
    gauges.push({
      id: i + 1,
      channel: i,
      sectionId: 1,
      posX: -0.12 + col * 0.08,
      posY: -0.2 + row * 0.133,
      posZ: 3.0,
      angle: [0, 45, 90, -45][i % 4],
      gaugeType: 'resistance',
      resistance: 120,
      gaugeFactor: 2.0,
    });
  }

  for (let i = 0; i < section2Gauges; i++) {
    const row = Math.floor(i / 4);
    const col = i % 4;
    gauges.push({
      id: section1Gauges + i + 1,
      channel: section1Gauges + i,
      sectionId: 2,
      posX: -0.15 + col * 0.1,
      posY: -0.15 + row * 0.1,
      posZ: 4.0,
      angle: [0, 45, 90, -45][i % 4],
      gaugeType: 'resistance',
      resistance: 120,
      gaugeFactor: 2.0,
    });
  }

  return gauges;
}

const MOCK_GAUGES = generateMockGauges();

const DEFAULT_CONFIG: AppConfig = {
  sampleRateHz: 5,
  numChannels: 32,
  warningThreshold: 0.8,
  alarmThreshold: 1.0,
  serialPort: 'COM3',
  baudRate: 115200,
  defaultSectionId: 1,
};

function createRectangularSection(
  width: number,
  height: number,
  divX: number,
  divY: number,
  E: number,
  nu: number,
  gauges: Array<{ id: number; channel: number; x: number; y: number; angle: number }>
): CrossSection {
  const nodes: { id: number; x: number; y: number }[] = [];
  const elements: { id: number; nodeIds: [number, number, number, number] }[] = [];

  for (let j = 0; j <= divY; j++) {
    for (let i = 0; i <= divX; i++) {
      nodes.push({
        id: j * (divX + 1) + i,
        x: -width / 2 + (i * width) / divX,
        y: -height / 2 + (j * height) / divY,
      });
    }
  }

  for (let j = 0; j < divY; j++) {
    for (let i = 0; i < divX; i++) {
      const n0 = j * (divX + 1) + i;
      const n1 = j * (divX + 1) + i + 1;
      const n2 = (j + 1) * (divX + 1) + i + 1;
      const n3 = (j + 1) * (divX + 1) + i;
      elements.push({
        id: j * divX + i,
        nodeIds: [n0, n1, n2, n3],
      });
    }
  }

  return {
    width,
    height,
    nodeCount: nodes.length,
    elementCount: elements.length,
    gaugeCount: gauges.length,
    nodes,
    elements,
    gauges,
  };
}

function generateMockFEResult(elementCount: number, loadAmplitude: number = 1.0): FEResult {
  const nodeCount = Math.floor(Math.sqrt(elementCount) + 1) ** 2;
  const nodeStressXX: number[] = [];
  const nodeStressYY: number[] = [];
  const nodeStressXY: number[] = [];
  const nodeVonMises: number[] = [];
  const elemVonMises: number[] = [];

  const gridSize = Math.floor(Math.sqrt(elementCount));
  const allowable = 11e6;

  for (let i = 0; i < nodeCount; i++) {
    const row = Math.floor(i / (gridSize + 1));
    const col = i % (gridSize + 1);
    const yFactor = Math.abs(row - gridSize / 2) / (gridSize / 2);
    const xFactor = Math.abs(col - gridSize / 2) / (gridSize / 2);

    const baseStress = allowable * 0.4 * loadAmplitude;
    const bendingStress = allowable * 0.5 * loadAmplitude * yFactor;
    const stressXX = baseStress + bendingStress;
    const stressYY = baseStress * 0.3 * xFactor;
    const stressXY = allowable * 0.1 * loadAmplitude * Math.sin(row * 0.5) * Math.cos(col * 0.5);

    nodeStressXX.push(stressXX);
    nodeStressYY.push(stressYY);
    nodeStressXY.push(stressXY);

    const vm = Math.sqrt(
      stressXX * stressXX - stressXX * stressYY + stressYY * stressYY + 3 * stressXY * stressXY
    );
    nodeVonMises.push(vm);
  }

  for (let i = 0; i < elementCount; i++) {
    const row = Math.floor(i / gridSize);
    const col = i % gridSize;
    const n0 = row * (gridSize + 1) + col;
    const n1 = row * (gridSize + 1) + col + 1;
    const n2 = (row + 1) * (gridSize + 1) + col + 1;
    const n3 = (row + 1) * (gridSize + 1) + col;
    const avgVm =
      (nodeVonMises[n0] + nodeVonMises[n1] + nodeVonMises[n2] + nodeVonMises[n3]) / 4;
    elemVonMises.push(avgVm);
  }

  const maxVonMises = Math.max(...elemVonMises);
  const avgVonMises = elemVonMises.reduce((a, b) => a + b, 0) / elemVonMises.length;

  return {
    nodeStressXX,
    nodeStressYY,
    nodeStressXY,
    nodeVonMises,
    elemVonMises,
    maxVonMises,
    avgVonMises,
    solveTimeMs: 8 + Math.random() * 12,
  };
}

function generateMockSafetyReport(
  elemVonMises: number[],
  channelStress: Record<string, number>,
  material?: { allowableStress: number; E: number },
  warningThreshold: number = 0.8,
  alarmThreshold: number = 1.0
): SafetyReport {
  const allowableStress = material?.allowableStress || 11e6;
  const maxStress = Math.max(...elemVonMises);
  const utilizationRatio = maxStress / allowableStress;
  const safetyFactor = allowableStress / maxStress;

  let status: SafetyStatusCode;
  let statusString: string;
  let statusColor: string;
  let statusMessage: string;

  if (utilizationRatio >= alarmThreshold) {
    status = SafetyStatusCode.ALARM;
    statusString = '红色报警';
    statusColor = '#ef4444';
    statusMessage = '最大应力超过许用应力，结构存在严重安全隐患！';
  } else if (utilizationRatio >= warningThreshold) {
    status = SafetyStatusCode.WARNING;
    statusString = '黄色预警';
    statusColor = '#f59e0b';
    statusMessage = '应力水平较高，建议密切关注并安排检测。';
  } else {
    status = SafetyStatusCode.SAFE;
    statusString = '安全';
    statusColor = '#10b981';
    statusMessage = '结构应力水平在安全范围内。';
  }

  const alarmChannels: number[] = [];
  const warningChannels: number[] = [];
  const channelUtilization: Record<string, number> = {};

  Object.entries(channelStress).forEach(([ch, stress]) => {
    const util = stress / allowableStress;
    channelUtilization[ch] = util;
    if (util >= alarmThreshold) {
      alarmChannels.push(parseInt(ch));
    } else if (util >= warningThreshold) {
      warningChannels.push(parseInt(ch));
    }
  });

  return {
    status,
    statusString,
    statusColor,
    maxStress,
    allowableStress,
    safetyFactor,
    utilizationRatio,
    statusMessage,
    evaluationTimeMs: 1 + Math.random() * 3,
    timestamp: Date.now(),
    alarmChannels,
    warningChannels,
    channelUtilization,
  };
}

function generateMockFrame(
  frameId: number,
  numChannels: number,
  loadType: number = 0
): SerialDataFrame {
  const t = frameId * 0.1;
  const channels: number[] = [];

  for (let i = 0; i < numChannels; i++) {
    const phase = i * 0.2;
    let baseStrain: number;

    switch (loadType) {
      case 0:
        baseStrain = 80 * Math.sin(0.5 * t + phase) + 20 * Math.sin(1.5 * t + phase * 2);
        break;
      case 1:
        baseStrain = 60 * (Math.abs(Math.sin(0.3 * t + phase)) * 2 - 1);
        break;
      case 2:
        baseStrain = 50 + 40 * Math.min(1, Math.max(0, Math.sin(0.2 * t + phase)));
        break;
      case 3:
      default:
        baseStrain =
          50 * Math.sin(0.4 * t + phase) +
          30 * Math.sign(Math.sin(0.1 * t + phase)) +
          15 * Math.sin(2 * t + phase * 3);
    }

    const noise = (Math.random() - 0.5) * 5;
    const drift = Math.sin(t * 0.05 + i * 0.1) * 2;
    channels.push(baseStrain + noise + drift);
  }

  return {
    timestamp: Date.now(),
    frameId,
    channels,
  };
}

class MockSerialSimulator {
  private isRunning = false;
  private frameId = 0;
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private listeners: Array<
    (data: {
      frame: SerialDataFrame;
      feResult: FEResult | null;
      safetyReport: SafetyReport | null;
    }) => void
  > = [];
  private sampleRate = 5;
  private numChannels = 32;
  private loadType = 0;
  private loadAmplitude = 1.0;
  private currentSection: CrossSection | null = null;

  setSection(section: CrossSection) {
    this.currentSection = section;
  }

  setLoadParams(amp: number, freq: number, type: number) {
    this.loadAmplitude = amp;
    this.loadType = type;
  }

  start(channels: number, rate: number): boolean {
    if (this.isRunning) return false;
    this.numChannels = channels;
    this.sampleRate = rate;
    this.isRunning = true;

    const intervalMs = 1000 / this.sampleRate;
    this.intervalId = setInterval(() => this.tick(), intervalMs);
    return true;
  }

  stop(): boolean {
    if (!this.isRunning) return false;
    this.isRunning = false;
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    return true;
  }

  addListener(
    callback: (data: {
      frame: SerialDataFrame;
      feResult: FEResult | null;
      safetyReport: SafetyReport | null;
    }) => void
  ): () => void {
    this.listeners.push(callback);
    return () => {
      const idx = this.listeners.indexOf(callback);
      if (idx >= 0) this.listeners.splice(idx, 1);
    };
  }

  readFrame(): SerialDataFrame {
    return generateMockFrame(this.frameId++, this.numChannels, this.loadType);
  }

  private tick() {
    if (!this.isRunning) return;
    const frame = this.readFrame();
    const elementCount = this.currentSection?.elementCount || 5000;
    const feResult = generateMockFEResult(elementCount, this.loadAmplitude);

    const channelStress: Record<string, number> = {};
    frame.channels.forEach((strain, idx) => {
      const E = 10e9;
      channelStress[String(idx)] = Math.abs(strain * 1e-6 * E);
    });

    const safetyReport = generateMockSafetyReport(
      feResult.elemVonMises,
      channelStress,
      { allowableStress: 11e6, E: 10e9 },
      DEFAULT_CONFIG.warningThreshold,
      DEFAULT_CONFIG.alarmThreshold
    );

    const data = { frame, feResult, safetyReport };
    this.listeners.forEach((l) => l(data));
  }
}

const serialSimulator = new MockSerialSimulator();
let currentSection: CrossSection | null = null;
let currentConfig = { ...DEFAULT_CONFIG };

export const mockApi = {
  feCreateSection: (
    width: number,
    height: number,
    divX: number,
    divY: number,
    E: number,
    nu: number,
    gauges: Array<{ id: number; channel: number; x: number; y: number; angle: number }>
  ): Promise<CrossSection> => {
    return new Promise((resolve) => {
      setTimeout(() => {
        currentSection = createRectangularSection(width, height, divX, divY, E, nu, gauges);
        serialSimulator.setSection(currentSection);
        resolve(currentSection);
      }, 50);
    });
  },

  feSolveInverse: (strains: Record<string, number>): Promise<FEResult> => {
    return new Promise((resolve) => {
      setTimeout(() => {
        const elementCount = currentSection?.elementCount || 5000;
        const feResult = generateMockFEResult(elementCount);
        resolve(feResult);
      }, 20);
    });
  },

  safetyEvaluate: (
    elemVonMises: number[],
    channelStress: Record<string, number>,
    material?: { allowableStress: number; E: number },
    warningThreshold?: number,
    alarmThreshold?: number
  ): Promise<SafetyReport> => {
    return new Promise((resolve) => {
      setTimeout(() => {
        const report = generateMockSafetyReport(
          elemVonMises,
          channelStress,
          material,
          warningThreshold,
          alarmThreshold
        );
        resolve(report);
      }, 10);
    });
  },

  serialStart: (channels: number, rate: number): Promise<boolean> => {
    return new Promise((resolve) => {
      setTimeout(() => {
        const result = serialSimulator.start(channels, rate);
        resolve(result);
      }, 100);
    });
  },

  serialStop: (): Promise<boolean> => {
    return new Promise((resolve) => {
      setTimeout(() => {
        const result = serialSimulator.stop();
        resolve(result);
      }, 100);
    });
  },

  serialReadFrame: (): Promise<SerialDataFrame> => {
    return new Promise((resolve) => {
      setTimeout(() => {
        const frame = serialSimulator.readFrame();
        resolve(frame);
      }, 10);
    });
  },

  serialSetLoadPattern: (amp: number, freq: number, type: number): Promise<boolean> => {
    return new Promise((resolve) => {
      setTimeout(() => {
        serialSimulator.setLoadParams(amp, freq, type);
        resolve(true);
      }, 10);
    });
  },

  serialListPorts: (): Promise<string[]> => {
    return new Promise((resolve) => {
      setTimeout(() => {
        resolve(['COM1', 'COM3 (虚拟)', 'COM5']);
      }, 50);
    });
  },

  onSerialData: (
    callback: (data: {
      frame: SerialDataFrame;
      feResult: FEResult | null;
      safetyReport: SafetyReport | null;
    }) => void
  ) => {
    return serialSimulator.addListener(callback);
  },

  dbOpen: (dbPath?: string): Promise<boolean> => {
    return new Promise((resolve) => {
      setTimeout(() => resolve(true), 100);
    });
  },

  dbSaveSnapshot: (snapshot: StressSnapshot): Promise<boolean> => {
    return new Promise((resolve) => {
      setTimeout(() => resolve(true), 10);
    });
  },

  dbQuerySnapshots: (start: number, end: number, sectionId?: number): Promise<StressSnapshot[]> => {
    return new Promise((resolve) => {
      setTimeout(() => {
        const snapshots: StressSnapshot[] = [];
        const count = Math.min(3600, Math.floor((end - start) / 200));
        for (let i = 0; i < count; i++) {
          const t = start + i * 200;
          const elementCount = 5000;
          const feResult = generateMockFEResult(elementCount, 0.7 + Math.sin(i * 0.1) * 0.3);
          const channelStress: Record<string, number> = {};
          for (let c = 0; c < 32; c++) {
            channelStress[String(c)] = feResult.maxVonMises * (0.5 + Math.random() * 0.3);
          }
          const safetyReport = generateMockSafetyReport(
            feResult.elemVonMises,
            channelStress,
            { allowableStress: 11e6, E: 10e9 },
            DEFAULT_CONFIG.warningThreshold,
            DEFAULT_CONFIG.alarmThreshold
          );

          snapshots.push({
            id: i + 1,
            timestamp: t,
            sectionId: sectionId || 1,
            maxVonMises: feResult.maxVonMises,
            avgVonMises: feResult.avgVonMises,
            utilizationRatio: safetyReport.utilizationRatio,
            status: safetyReport.status,
            elemVonMises: feResult.elemVonMises,
          });
        }
        resolve(snapshots);
      }, 200);
    });
  },

  dbGetSections: (): Promise<SectionInfo[]> => {
    return new Promise((resolve) => {
      setTimeout(() => resolve(MOCK_SECTIONS), 50);
    });
  },

  dbGetSection: (id: number): Promise<SectionInfo | null> => {
    return new Promise((resolve) => {
      setTimeout(() => {
        const section = MOCK_SECTIONS.find((s) => s.id === id) || null;
        resolve(section);
      }, 30);
    });
  },

  dbGetGauges: (): Promise<GaugeConfig[]> => {
    return new Promise((resolve) => {
      setTimeout(() => resolve(MOCK_GAUGES), 50);
    });
  },

  dbGetGaugesBySection: (sectionId: number): Promise<GaugeConfig[]> => {
    return new Promise((resolve) => {
      setTimeout(() => {
        const gauges = MOCK_GAUGES.filter((g) => g.sectionId === sectionId);
        resolve(gauges);
      }, 30);
    });
  },

  appGetConfig: (): Promise<AppConfig> => {
    return new Promise((resolve) => {
      setTimeout(() => resolve({ ...currentConfig }), 20);
    });
  },

  appSetConfig: (config: Partial<AppConfig>): Promise<boolean> => {
    return new Promise((resolve) => {
      setTimeout(() => {
        currentConfig = { ...currentConfig, ...config };
        resolve(true);
      }, 20);
    });
  },
};

if (typeof window !== 'undefined' && !window.api) {
  (window as any).api = mockApi;
}
