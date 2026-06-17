import { contextBridge, ipcRenderer } from 'electron';
import { IPC_CHANNELS } from '../shared/types';
import type {
  CrossSection,
  FEResult,
  SafetyReport,
  SerialDataFrame,
  SectionInfo,
  GaugeConfig,
  StressSnapshot,
  AppConfig,
  RemainingLifeResult,
  FatigueParams,
} from '../shared/types';

const electronAPI = {
  feCreateSection: (
    width: number,
    height: number,
    divX: number,
    divY: number,
    E: number,
    nu: number,
    gauges: Array<{ id: number; channel: number; x: number; y: number; angle: number }>
  ): Promise<CrossSection> =>
    ipcRenderer.invoke(IPC_CHANNELS.FE_CREATE_SECTION, width, height, divX, divY, E, nu, gauges),

  feAddHole: (
    polygon: Array<{ x: number; y: number }>,
    margin?: number
  ): Promise<{ success: boolean; holeCount: number; holeBoundaryElements: number[]; holeBoundaryCount: number }> =>
    ipcRenderer.invoke(IPC_CHANNELS.FE_ADD_HOLE, polygon, margin),

  feSolveInverse: (strains: Record<string, number>): Promise<FEResult> =>
    ipcRenderer.invoke(IPC_CHANNELS.FE_SOLVE_INVERSE, strains),

  fePredictRemainingLife: (
    stressHistory: number[],
    monitoringDurationYears: number,
    params?: FatigueParams
  ): Promise<RemainingLifeResult> =>
    ipcRenderer.invoke(IPC_CHANNELS.FE_PREDICT_REMAINING_LIFE, stressHistory, monitoringDurationYears, params),

  safetyEvaluate: (
    elemVonMises: number[],
    channelStress: Record<string, number>,
    material?: { allowableStress: number; E: number },
    warningThreshold?: number,
    alarmThreshold?: number
  ): Promise<SafetyReport> =>
    ipcRenderer.invoke(IPC_CHANNELS.SAFETY_EVALUATE, elemVonMises, channelStress, material, warningThreshold, alarmThreshold),

  serialStart: (channels: number, rate: number): Promise<boolean> =>
    ipcRenderer.invoke(IPC_CHANNELS.SERIAL_START, channels, rate),

  serialStop: (): Promise<boolean> =>
    ipcRenderer.invoke(IPC_CHANNELS.SERIAL_STOP),

  serialReadFrame: (): Promise<SerialDataFrame> =>
    ipcRenderer.invoke(IPC_CHANNELS.SERIAL_READ_FRAME),

  serialSetLoadPattern: (amp: number, freq: number, type: number): Promise<boolean> =>
    ipcRenderer.invoke(IPC_CHANNELS.SERIAL_SET_LOAD_PATTERN, amp, freq, type),

  serialListPorts: (): Promise<string[]> =>
    ipcRenderer.invoke(IPC_CHANNELS.SERIAL_LIST_PORTS),

  onSerialData: (
    callback: (data: { frame: SerialDataFrame; feResult: FEResult | null; safetyReport: SafetyReport | null }) => void
  ) => {
    const listener = (_event: unknown, data: { frame: SerialDataFrame; feResult: FEResult | null; safetyReport: SafetyReport | null }) =>
      callback(data);
    ipcRenderer.on(IPC_CHANNELS.SERIAL_DATA, listener);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.SERIAL_DATA, listener);
  },

  dbOpen: (dbPath?: string): Promise<boolean> =>
    ipcRenderer.invoke(IPC_CHANNELS.DB_OPEN, dbPath),

  dbSaveSnapshot: (snapshot: StressSnapshot): Promise<boolean> =>
    ipcRenderer.invoke(IPC_CHANNELS.DB_SAVE_SNAPSHOT, snapshot),

  dbQuerySnapshots: (start: number, end: number, sectionId?: number): Promise<StressSnapshot[]> =>
    ipcRenderer.invoke(IPC_CHANNELS.DB_QUERY_SNAPSHOTS, start, end, sectionId),

  dbGetSections: (): Promise<SectionInfo[]> =>
    ipcRenderer.invoke(IPC_CHANNELS.DB_GET_SECTIONS),

  dbGetSection: (id: number): Promise<SectionInfo | null> =>
    ipcRenderer.invoke(IPC_CHANNELS.DB_GET_SECTION, id),

  dbGetGauges: (): Promise<GaugeConfig[]> =>
    ipcRenderer.invoke(IPC_CHANNELS.DB_GET_GAUGES),

  dbGetGaugesBySection: (sectionId: number): Promise<GaugeConfig[]> =>
    ipcRenderer.invoke(IPC_CHANNELS.DB_GET_GAUGES_BY_SECTION, sectionId),

  appGetConfig: (): Promise<AppConfig> =>
    ipcRenderer.invoke(IPC_CHANNELS.APP_GET_CONFIG),

  appSetConfig: (config: Partial<AppConfig>): Promise<boolean> =>
    ipcRenderer.invoke(IPC_CHANNELS.APP_SET_CONFIG, config),
};

contextBridge.exposeInMainWorld('api', electronAPI);

export type ElectronAPI = typeof electronAPI;
