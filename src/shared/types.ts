export interface Node2D {
  id: number;
  x: number;
  y: number;
}

export interface Hole {
  polygon: Node2D[];
  margin: number;
}

export interface QuadElement {
  id: number;
  nodeIds: [number, number, number, number];
  isHoleBoundary?: boolean;
}

export interface StrainGauge {
  id: number;
  channel: number;
  x: number;
  y: number;
  angle: number;
}

export interface CrossSection {
  width: number;
  height: number;
  nodeCount: number;
  elementCount: number;
  gaugeCount: number;
  nodes: Node2D[];
  elements: QuadElement[];
  gauges: StrainGauge[];
  holes?: Hole[];
}

export interface FEResult {
  nodeStressXX: number[];
  nodeStressYY: number[];
  nodeStressXY: number[];
  nodeVonMises: number[];
  elemVonMises: number[];
  maxVonMises: number;
  avgVonMises: number;
  solveTimeMs: number;
}

export enum SafetyStatusCode {
  SAFE = 0,
  WARNING = 1,
  ALARM = 2,
  UNKNOWN = 3,
}

export interface SafetyReport {
  status: SafetyStatusCode;
  statusString: string;
  statusColor: string;
  maxStress: number;
  allowableStress: number;
  safetyFactor: number;
  utilizationRatio: number;
  statusMessage: string;
  evaluationTimeMs: number;
  timestamp: bigint | number;
  alarmChannels: number[];
  warningChannels: number[];
  channelUtilization: Record<string, number>;
}

export interface SerialDataFrame {
  timestamp: bigint | number;
  frameId: number;
  channels: number[];
}

export interface SectionInfo {
  id: number;
  name: string;
  memberType: string;
  width: number;
  height: number;
  length: number;
  positionX: number;
  positionY: number;
  positionZ: number;
  material: string;
  allowableStress?: number;
  notes: string;
}

export interface GaugeConfig {
  id: number;
  channel: number;
  sectionId: number;
  posX: number;
  posY: number;
  posZ: number;
  angle: number;
  gaugeType: string;
  resistance: number;
  gaugeFactor: number;
}

export interface StressSnapshot {
  id: number;
  timestamp: bigint | number;
  sectionId: number;
  maxVonMises: number;
  avgVonMises: number;
  utilizationRatio: number;
  status: number;
  elemVonMises: number[];
}

export interface StressCycle {
  range: number;
  mean: number;
  count: number;
}

export interface FatigueParams {
  C: number;
  m: number;
  fatigueLimit: number;
}

export interface RemainingLifeResult {
  cumulativeDamage: number;
  damageRatePerYear: number;
  remainingLifeYears: number;
  maintenanceLevel: 1 | 2 | 3;
  maintenanceAdvice: string;
  cycles: StressCycle[];
  totalCycles: number;
  maxCycleRange: number;
  equivalentStressRange: number;
  computeTimeMs: number;
}

export interface PlaybackConfig {
  startTime: number;
  endTime: number;
  currentTime: number;
  playbackRate: number;
  isPlaying: boolean;
  snapshots: StressSnapshot[];
  currentIndex: number;
}

export interface AppConfig {
  sampleRateHz: number;
  numChannels: number;
  warningThreshold: number;
  alarmThreshold: number;
  serialPort: string;
  baudRate: number;
  defaultSectionId: number;
}

export const IPC_CHANNELS = {
  FE_CREATE_SECTION: 'fe:create-section',
  FE_ADD_HOLE: 'fe:add-hole',
  FE_SOLVE_INVERSE: 'fe:solve-inverse',
  FE_PREDICT_REMAINING_LIFE: 'fe:predict-remaining-life',
  SAFETY_EVALUATE: 'safety:evaluate',
  SERIAL_START: 'serial:start',
  SERIAL_STOP: 'serial:stop',
  SERIAL_READ_FRAME: 'serial:read-frame',
  SERIAL_DATA: 'serial:data',
  SERIAL_SET_LOAD_PATTERN: 'serial:set-load-pattern',
  SERIAL_LIST_PORTS: 'serial:list-ports',
  DB_OPEN: 'db:open',
  DB_SAVE_SNAPSHOT: 'db:save-snapshot',
  DB_QUERY_SNAPSHOTS: 'db:query-snapshots',
  DB_GET_SECTIONS: 'db:get-sections',
  DB_GET_SECTION: 'db:get-section',
  DB_GET_GAUGES: 'db:get-gauges',
  DB_GET_GAUGES_BY_SECTION: 'db:get-gauges-by-section',
  APP_GET_CONFIG: 'app:get-config',
  APP_SET_CONFIG: 'app:set-config',
} as const;
