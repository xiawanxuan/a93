import { app, BrowserWindow, ipcMain, dialog } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import type { IpcMainInvokeEvent } from 'electron';
import {
  IPC_CHANNELS,
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

let mainWindow: BrowserWindow | null = null;
let nativeAddon: any = null;
let dbInitialized = false;
let feInitialized = false;
let currentSectionInfo: SectionInfo | null = null;
let stressBuffer: StressSnapshot[] = [];
let autoSaveTimer: NodeJS.Timeout | null = null;

const DEFAULT_CONFIG: AppConfig = {
  sampleRateHz: 5,
  numChannels: 32,
  warningThreshold: 0.8,
  alarmThreshold: 1.0,
  serialPort: 'VIRTUAL_SIM',
  baudRate: 115200,
  defaultSectionId: 1,
};

function loadNativeAddon(): boolean {
  try {
    const addonPath = path.join(
      __dirname,
      '..',
      '..',
      'build',
      'Release',
      'wood_stress_native.node'
    );
    if (fs.existsSync(addonPath)) {
      nativeAddon = require(addonPath);
      console.log('Native addon loaded from:', addonPath);
      return true;
    }
    const debugPath = path.join(
      __dirname,
      '..',
      '..',
      'build',
      'Debug',
      'wood_stress_native.node'
    );
    if (fs.existsSync(debugPath)) {
      nativeAddon = require(debugPath);
      console.log('Native addon loaded from:', debugPath);
      return true;
    }
    console.warn('Native addon not found, using fallback implementations');
    return false;
  } catch (err) {
    console.error('Failed to load native addon:', err);
    return false;
  }
}

function createDefaultGauges(): Array<{
  id: number;
  channel: number;
  x: number;
  y: number;
  angle: number;
}> {
  const gauges: Array<{ id: number; channel: number; x: number; y: number; angle: number }> = [];
  const positions = [
    [0.025, 0.38], [0.075, 0.38], [0.125, 0.38], [0.175, 0.38],
    [0.025, 0.30], [0.075, 0.30], [0.125, 0.30], [0.175, 0.30],
    [0.025, 0.20], [0.075, 0.20], [0.125, 0.20], [0.175, 0.20],
    [0.025, 0.10], [0.075, 0.10], [0.125, 0.10], [0.175, 0.10],
    [0.025, 0.02], [0.075, 0.02], [0.125, 0.02], [0.175, 0.02],
    [0.02, 0.20], [0.02, 0.20], [0.18, 0.20], [0.18, 0.20],
    [0.05, 0.10], [0.15, 0.10], [0.25, 0.10], [0.15, 0.05],
    [0.05, 0.20], [0.15, 0.20], [0.25, 0.20], [0.15, 0.25],
  ];
  const angles = [
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    45, -45, 45, -45,
    0, 0, 0, 0, 0, 0, 0, 0,
  ];
  for (let i = 0; i < 32; i++) {
    gauges.push({ id: i, channel: i, x: positions[i][0], y: positions[i][1], angle: angles[i] });
  }
  return gauges;
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1600,
    height: 1000,
    minWidth: 1280,
    minHeight: 800,
    show: false,
    backgroundColor: '#0f172a',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
    title: '古建筑木结构应力监测系统 v1.0',
    icon: path.join(__dirname, '..', '..', 'assets', 'icon.png'),
  });

  const isDev = !app.isPackaged;
  if (isDev) {
    mainWindow.loadURL('http://localhost:8080');
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  }

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function initDatabase(): void {
  if (!nativeAddon) return;
  const dbPath = path.join(app.getPath('userData'), 'monitor.db');
  console.log('Database path:', dbPath);
  try {
    nativeAddon.dbOpen(dbPath);
    dbInitialized = true;
  } catch (err) {
    console.error('Failed to init database:', err);
  }
}

function initFEModule(): void {
  if (!nativeAddon) {
    feInitialized = true;
    return;
  }
  try {
    const width = 0.2;
    const height = 0.4;
    const divX = 50;
    const divY = 100;
    const E = 10e9;
    const nu = 0.35;
    const gauges = createDefaultGauges();
    nativeAddon.feCreateSection(width, height, divX, divY, E, nu, gauges);
    feInitialized = true;
    console.log('FE module initialized');
  } catch (err) {
    console.error('Failed to init FE module:', err);
  }
}

function handleSerialData(frame: SerialDataFrame): void {
  if (!mainWindow || !mainWindow.webContents) return;

  let feResult: FEResult | null = null;
  let safetyReport: SafetyReport | null = null;

  if (nativeAddon) {
    try {
      const strains: Record<string, number> = {};
      frame.channels.forEach((v, i) => {
        strains[String(i)] = v;
      });
      feResult = nativeAddon.feSolveInverse(strains);

      const channelStress: Record<string, number> = {};
      frame.channels.forEach((strain, i) => {
        const stress = strain * 10e9;
        channelStress[String(i)] = Math.abs(stress);
      });

      if (feResult) {
        safetyReport = nativeAddon.safetyEvaluate(
          feResult.elemVonMises,
          channelStress,
          { allowableStress: 11e6, E: 10e9 },
          DEFAULT_CONFIG.warningThreshold,
          DEFAULT_CONFIG.alarmThreshold
        );

        if (dbInitialized && nativeAddon.dbSaveSnapshot && safetyReport) {
          const snapshot: StressSnapshot = {
            id: 0,
            timestamp: typeof frame.timestamp === 'bigint' ? frame.timestamp : BigInt(frame.timestamp),
            sectionId: DEFAULT_CONFIG.defaultSectionId,
            maxVonMises: feResult.maxVonMises,
            avgVonMises: feResult.avgVonMises,
            utilizationRatio: safetyReport.utilizationRatio,
            status: safetyReport.status,
            elemVonMises: feResult.elemVonMises,
          };
          stressBuffer.push(snapshot);
        }
      }
    } catch (err) {
      console.error('FE/Safety compute error:', err);
    }
  }

  mainWindow.webContents.send(IPC_CHANNELS.SERIAL_DATA, {
    frame,
    feResult,
    safetyReport,
  });
}

function startAutoSave(): void {
  if (autoSaveTimer) return;
  autoSaveTimer = setInterval(() => {
    if (stressBuffer.length > 0 && nativeAddon && dbInitialized) {
      const buffer = [...stressBuffer];
      stressBuffer = [];
      try {
        for (const snap of buffer) {
          nativeAddon.dbSaveSnapshot(snap);
        }
      } catch (err) {
        console.error('Auto-save error:', err);
      }
    }
  }, 1000);
}

function registerIpcHandlers(): void {
  ipcMain.handle(
    IPC_CHANNELS.FE_CREATE_SECTION,
    (_event: IpcMainInvokeEvent, ...args: any[]) => {
      if (nativeAddon) {
        return nativeAddon.feCreateSection(...args);
      }
      return { nodeCount: 5051, elementCount: 5000, gaugeCount: 32 };
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.FE_SOLVE_INVERSE,
    (_event: IpcMainInvokeEvent, strains: Record<string, number>) => {
      if (nativeAddon) {
        return nativeAddon.feSolveInverse(strains);
      }
      return generateMockFEResult();
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.SAFETY_EVALUATE,
    (_event: IpcMainInvokeEvent, ...args: any[]) => {
      if (nativeAddon) {
        return nativeAddon.safetyEvaluate(...args);
      }
      return generateMockSafetyReport();
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.SERIAL_START,
    (_event: IpcMainInvokeEvent, channels: number, rate: number) => {
      DEFAULT_CONFIG.numChannels = channels;
      DEFAULT_CONFIG.sampleRateHz = rate;
      if (nativeAddon) {
        return nativeAddon.serialStart(channels, rate, handleSerialData);
      }
      return startMockSerial(channels, rate);
    }
  );

  ipcMain.handle(IPC_CHANNELS.SERIAL_STOP, () => {
    if (nativeAddon) {
      return nativeAddon.serialStop();
    }
    return stopMockSerial();
  });

  ipcMain.handle(IPC_CHANNELS.SERIAL_READ_FRAME, () => {
    if (nativeAddon) {
      return nativeAddon.serialReadFrame();
    }
    return readMockFrame();
  });

  ipcMain.handle(
    IPC_CHANNELS.SERIAL_SET_LOAD_PATTERN,
    (_event: IpcMainInvokeEvent, amp: number, freq: number, type: number) => {
      if (nativeAddon) {
        return nativeAddon.serialSetLoadPattern(amp, freq, type);
      }
      return setMockLoadPattern(amp, freq, type);
    }
  );

  ipcMain.handle(IPC_CHANNELS.SERIAL_LIST_PORTS, () => {
    if (nativeAddon) {
      return nativeAddon.serialListPorts();
    }
    return ['VIRTUAL_SIM', 'COM1', 'COM2', 'COM3', 'COM4'];
  });

  ipcMain.handle(IPC_CHANNELS.DB_OPEN, (_event: IpcMainInvokeEvent, dbPath?: string) => {
    if (!nativeAddon) return false;
    try {
      const p = dbPath || path.join(app.getPath('userData'), 'monitor.db');
      const ok = nativeAddon.dbOpen(p);
      if (ok) dbInitialized = true;
      return ok;
    } catch (err) {
      console.error('DB open error:', err);
      return false;
    }
  });

  ipcMain.handle(
    IPC_CHANNELS.DB_SAVE_SNAPSHOT,
    (_event: IpcMainInvokeEvent, snapshot: StressSnapshot) => {
      if (!nativeAddon || !dbInitialized) return false;
      try {
        return nativeAddon.dbSaveSnapshot(snapshot);
      } catch {
        return false;
      }
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.DB_QUERY_SNAPSHOTS,
    (_event: IpcMainInvokeEvent, start: number, end: number, sectionId?: number) => {
      if (!nativeAddon || !dbInitialized) return [];
      try {
        const s = typeof start === 'bigint' ? start : BigInt(start);
        const e = typeof end === 'bigint' ? end : BigInt(end);
        return nativeAddon.dbQuerySnapshots(s, e, sectionId ?? -1);
      } catch {
        return [];
      }
    }
  );

  ipcMain.handle(IPC_CHANNELS.DB_GET_SECTIONS, () => {
    if (!nativeAddon || !dbInitialized) {
      return getMockSections();
    }
    try {
      return nativeAddon.dbGetAllSections();
    } catch {
      return getMockSections();
    }
  });

  ipcMain.handle(IPC_CHANNELS.DB_GET_SECTION, (_event: IpcMainInvokeEvent, id: number) => {
    if (!nativeAddon || !dbInitialized) return null;
    try {
      return nativeAddon.dbGetSection(id);
    } catch {
      return null;
    }
  });

  ipcMain.handle(IPC_CHANNELS.DB_GET_GAUGES, () => {
    if (!nativeAddon || !dbInitialized) {
      return getMockGauges();
    }
    try {
      return nativeAddon.dbGetAllGauges();
    } catch {
      return getMockGauges();
    }
  });

  ipcMain.handle(
    IPC_CHANNELS.DB_GET_GAUGES_BY_SECTION,
    (_event: IpcMainInvokeEvent, sectionId: number) => {
      if (!nativeAddon || !dbInitialized) return getMockGauges();
      try {
        return nativeAddon.dbGetGaugesBySection(sectionId);
      } catch {
        return getMockGauges();
      }
    }
  );

  ipcMain.handle(IPC_CHANNELS.APP_GET_CONFIG, () => {
    return { ...DEFAULT_CONFIG };
  });

  ipcMain.handle(
    IPC_CHANNELS.APP_SET_CONFIG,
    (_event: IpcMainInvokeEvent, config: Partial<AppConfig>) => {
      Object.assign(DEFAULT_CONFIG, config);
      return true;
    }
  );
}

let mockSerialTimer: NodeJS.Timeout | null = null;
let mockFrameId = 0;
let mockLoadAmp = 150;
let mockLoadFreq = 0.1;
let mockLoadType = 0;

function generateMockFEResult(): FEResult {
  const nElems = 5000;
  const nNodes = 5051;
  const elemVM: number[] = [];
  const nodeVM: number[] = [];
  const sxx: number[] = [];
  const syy: number[] = [];
  const sxy: number[] = [];

  for (let i = 0; i < nElems; i++) {
    const row = Math.floor(i / 50);
    const col = i % 50;
    const base = (Math.abs(row - 50) / 50) * 8e6;
    const variance = (col / 50) * 2e6;
    const vm = base + variance + (Math.random() - 0.5) * 1e6;
    elemVM.push(Math.max(0, vm));
  }

  let maxVM = 0;
  for (let i = 0; i < nNodes; i++) {
    const row = Math.floor(i / 51);
    const dist = Math.abs(row - 100);
    const vm = (dist / 100) * 10e6 + (Math.random() - 0.5) * 0.5e6;
    nodeVM.push(Math.max(0, vm));
    sxx.push((Math.random() - 0.3) * 5e6);
    syy.push((Math.random() - 0.5) * 1e6);
    sxy.push((Math.random() - 0.5) * 2e6);
    maxVM = Math.max(maxVM, nodeVM[i]);
  }

  return {
    nodeStressXX: sxx,
    nodeStressYY: syy,
    nodeStressXY: sxy,
    nodeVonMises: nodeVM,
    elemVonMises: elemVM,
    maxVonMises: maxVM,
    avgVonMises: elemVM.reduce((a, b) => a + b, 0) / nElems,
    solveTimeMs: 20 + Math.random() * 10,
  };
}

function generateMockSafetyReport(): SafetyReport {
  const ratio = 0.3 + Math.random() * 0.9;
  let status = SafetyStatusCode.SAFE;
  let statusStr = '安全';
  let color = '#22c55e';
  let msg = '结构安全';

  if (ratio >= 1.0) {
    status = SafetyStatusCode.ALARM;
    statusStr = '报警';
    color = '#ef4444';
    msg = '危险！应力超过许用值';
  } else if (ratio >= 0.8) {
    status = SafetyStatusCode.WARNING;
    statusStr = '预警';
    color = '#eab308';
    msg = '注意：应力接近许用值';
  }

  const alarms: number[] = [];
  const warns: number[] = [];
  const util: Record<string, number> = {};
  for (let i = 0; i < 32; i++) {
    const r = 0.2 + Math.random() * ratio;
    util[String(i)] = r;
    if (r >= 1.0) alarms.push(i);
    else if (r >= 0.8) warns.push(i);
  }

  return {
    status,
    statusString: statusStr,
    statusColor: color,
    maxStress: ratio * 11e6,
    allowableStress: 11e6,
    safetyFactor: 11e6 / (ratio * 11e6 + 1e-6),
    utilizationRatio: ratio,
    statusMessage: msg,
    evaluationTimeMs: 0.5 + Math.random() * 0.5,
    timestamp: Date.now(),
    alarmChannels: alarms,
    warningChannels: warns,
    channelUtilization: util,
  };
}

function generateMockFrame(channels: number): SerialDataFrame {
  const chs: number[] = [];
  const t = Date.now() / 1000;
  for (let i = 0; i < channels; i++) {
    const yFactor = 0.5 + (i % 4) * 0.3;
    let base = 0;
    const phase = (i % 8) * 0.25;
    if (mockLoadType === 0) {
      base = Math.sin(2 * Math.PI * mockLoadFreq * t + phase);
    } else if (mockLoadType === 1) {
      base = Math.abs(Math.sin(2 * Math.PI * mockLoadFreq * t + phase));
    } else if (mockLoadType === 2) {
      const period = 1 / mockLoadFreq;
      const pt = ((t + phase * period) % period) / period;
      base = pt < 0.1 ? pt * 10 : pt > 0.9 ? (1 - pt) * 10 : 1;
    } else {
      base = 0.5 * (Math.sin(2 * Math.PI * mockLoadFreq * t) +
        Math.sin(2 * Math.PI * mockLoadFreq * 3 * t + phase) * 0.3);
    }
    const strain = (base * mockLoadAmp * yFactor +
      Math.sin(t * 0.01 + i * 0.3) * 2 +
      (Math.random() - 0.5) * 5) * 1e-6;
    chs.push(strain);
  }
  return {
    timestamp: Date.now(),
    frameId: mockFrameId++,
    channels: chs,
  };
}

let lastMockFrame: SerialDataFrame = generateMockFrame(32);

function startMockSerial(channels: number, rate: number): boolean {
  stopMockSerial();
  const interval = Math.max(100, 1000 / rate);
  mockFrameId = 0;
  mockSerialTimer = setInterval(() => {
    lastMockFrame = generateMockFrame(channels);
    handleSerialData(lastMockFrame);
  }, interval);
  startAutoSave();
  return true;
}

function stopMockSerial(): boolean {
  if (mockSerialTimer) {
    clearInterval(mockSerialTimer);
    mockSerialTimer = null;
  }
  return true;
}

function readMockFrame(): SerialDataFrame {
  return lastMockFrame;
}

function setMockLoadPattern(amp: number, freq: number, type: number): boolean {
  mockLoadAmp = amp;
  mockLoadFreq = freq;
  mockLoadType = type;
  return true;
}

function getMockSections(): SectionInfo[] {
  return [
    {
      id: 1,
      name: '正殿明间主梁-1',
      memberType: 'beam',
      width: 0.2,
      height: 0.4,
      length: 3.0,
      positionX: 0,
      positionY: 0,
      positionZ: 5.0,
      material: 'Pine (松木材)',
      allowableStress: 11e6,
      notes: '松木材，许用弯曲应力11MPa',
    },
    {
      id: 2,
      name: '正殿金柱-1',
      memberType: 'column',
      width: 0.3,
      height: 0.3,
      length: 5.5,
      positionX: 2.5,
      positionY: 0,
      positionZ: 0,
      material: 'Cedar (杉木材)',
      allowableStress: 10e6,
      notes: '杉木柱，许用压应力10MPa',
    },
  ];
}

function getMockGauges(): GaugeConfig[] {
  const gauges: GaugeConfig[] = [];
  const positions = [
    [0.025, 0.38], [0.075, 0.38], [0.125, 0.38], [0.175, 0.38],
    [0.025, 0.30], [0.075, 0.30], [0.125, 0.30], [0.175, 0.30],
    [0.025, 0.20], [0.075, 0.20], [0.125, 0.20], [0.175, 0.20],
    [0.025, 0.10], [0.075, 0.10], [0.125, 0.10], [0.175, 0.10],
    [0.025, 0.02], [0.075, 0.02], [0.125, 0.02], [0.175, 0.02],
    [0.02, 0.20], [0.02, 0.20], [0.18, 0.20], [0.18, 0.20],
    [0.05, 0.10], [0.15, 0.10], [0.25, 0.10], [0.15, 0.05],
    [0.05, 0.20], [0.15, 0.20], [0.25, 0.20], [0.15, 0.25],
  ];
  const angles = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 45, -45, 45, -45, 0, 0, 0, 0, 0, 0, 0, 0];
  for (let i = 0; i < 32; i++) {
    gauges.push({
      id: i + 1,
      channel: i,
      sectionId: i < 24 ? 1 : 2,
      posX: positions[i][0],
      posY: positions[i][1],
      posZ: 0,
      angle: angles[i],
      gaugeType: i >= 20 && i <= 23 ? 'rosette' : 'unidirectional',
      resistance: 120.0,
      gaugeFactor: 2.0,
    });
  }
  return gauges;
}

app.whenReady().then(() => {
  console.log('App starting...');
  loadNativeAddon();
  createWindow();
  initDatabase();
  initFEModule();
  registerIpcHandlers();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  stopMockSerial();
  if (autoSaveTimer) clearInterval(autoSaveTimer);
  if (nativeAddon && nativeAddon.serialStop) nativeAddon.serialStop();
  if (nativeAddon && nativeAddon.dbClose) nativeAddon.dbClose();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
