-- =====================================================
-- 古建筑木结构应力监测系统数据库 Schema
-- =====================================================
-- 版本: 1.0
-- 描述: 存储构件信息、应变片配置、实时应变数据、
--       应力快照、报警日志等监测数据
-- =====================================================

PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;

-- =====================================================
-- 构件截面表
-- 存储木梁/木柱的截面几何信息与材质参数
-- =====================================================
CREATE TABLE IF NOT EXISTS sections (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    member_type TEXT NOT NULL DEFAULT 'beam',
    width REAL NOT NULL,
    height REAL NOT NULL,
    length REAL DEFAULT 0,
    position_x REAL DEFAULT 0,
    position_y REAL DEFAULT 0,
    position_z REAL DEFAULT 0,
    material TEXT DEFAULT 'Pine',
    allowable_stress REAL DEFAULT 11000000.0,
    elastic_modulus REAL DEFAULT 10000000000.0,
    poisson_ratio REAL DEFAULT 0.35,
    notes TEXT,
    created_at INTEGER DEFAULT (strftime('%s','now'))
);

CREATE INDEX IF NOT EXISTS idx_sections_member_type ON sections(member_type);

-- =====================================================
-- 应变片配置表
-- 存储每个应变片的通道号、安装位置、角度等参数
-- =====================================================
CREATE TABLE IF NOT EXISTS gauges (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    channel INTEGER NOT NULL UNIQUE,
    section_id INTEGER REFERENCES sections(id) ON DELETE SET NULL,
    pos_x REAL NOT NULL,
    pos_y REAL NOT NULL,
    pos_z REAL DEFAULT 0,
    angle REAL DEFAULT 0,
    gauge_type TEXT DEFAULT 'unidirectional',
    resistance REAL DEFAULT 120.0,
    gauge_factor REAL DEFAULT 2.0,
    installed_at INTEGER DEFAULT (strftime('%s','now'))
);

CREATE INDEX IF NOT EXISTS idx_gauges_section_id ON gauges(section_id);

-- =====================================================
-- 原始应变数据表
-- 存储各通道采集到的原始微应变数据
-- =====================================================
CREATE TABLE IF NOT EXISTS strain_data (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp INTEGER NOT NULL,
    frame_id INTEGER NOT NULL,
    channel INTEGER NOT NULL,
    strain_value REAL NOT NULL,
    section_id INTEGER REFERENCES sections(id),
    FOREIGN KEY(channel) REFERENCES gauges(channel)
);

CREATE INDEX IF NOT EXISTS idx_strain_time ON strain_data(timestamp);
CREATE INDEX IF NOT EXISTS idx_strain_channel ON strain_data(channel);
CREATE INDEX IF NOT EXISTS idx_strain_section ON strain_data(section_id);
CREATE INDEX IF NOT EXISTS idx_strain_time_channel ON strain_data(timestamp, channel);

-- =====================================================
-- 应力快照表
-- 存储有限元求解后的应力分布快照（用于历史回放）
-- elem_vonMises 以BLOB形式存储所有单元的von Mises应力
-- =====================================================
CREATE TABLE IF NOT EXISTS stress_snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp INTEGER NOT NULL,
    section_id INTEGER REFERENCES sections(id),
    max_von_mises REAL NOT NULL,
    avg_von_mises REAL NOT NULL,
    utilization_ratio REAL NOT NULL,
    status INTEGER NOT NULL DEFAULT 0,
    elem_von_mises BLOB
);

CREATE INDEX IF NOT EXISTS idx_snapshot_time ON stress_snapshots(timestamp);
CREATE INDEX IF NOT EXISTS idx_snapshot_section ON stress_snapshots(section_id);
CREATE INDEX IF NOT EXISTS idx_snapshot_status ON stress_snapshots(status);

-- =====================================================
-- 报警日志表
-- 记录预警和报警事件
-- type: 1=WARNING 预警, 2=ALARM 报警
-- =====================================================
CREATE TABLE IF NOT EXISTS alarms_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp INTEGER NOT NULL,
    section_id INTEGER REFERENCES sections(id),
    channel INTEGER,
    type INTEGER NOT NULL,
    stress_value REAL,
    threshold REAL,
    message TEXT
);

CREATE INDEX IF NOT EXISTS idx_alarms_time ON alarms_log(timestamp);
CREATE INDEX IF NOT EXISTS idx_alarms_type ON alarms_log(type);

-- =====================================================
-- 系统配置表
-- 存储全局配置参数（键值对形式）
-- =====================================================
CREATE TABLE IF NOT EXISTS system_config (
    key TEXT PRIMARY KEY,
    value TEXT,
    updated_at INTEGER DEFAULT (strftime('%s','now'))
);

-- =====================================================
-- 会话记录视图
-- 统计每天的监测数据量
-- =====================================================
CREATE VIEW IF NOT EXISTS v_daily_statistics AS
SELECT
    DATE(timestamp / 1000, 'unixepoch', 'localtime') AS record_date,
    section_id,
    COUNT(DISTINCT frame_id) AS frame_count,
    COUNT(*) AS strain_records,
    MAX(max_von_mises) AS peak_stress
FROM stress_snapshots
GROUP BY record_date, section_id
ORDER BY record_date DESC;

-- =====================================================
-- 插入示例数据（默认截面和应变片配置）
-- =====================================================

-- 木梁截面示例: 200mm x 400mm, 长3000mm
INSERT OR IGNORE INTO sections
    (name, member_type, width, height, length, position_x, position_y, position_z,
     material, allowable_stress, elastic_modulus, poisson_ratio, notes)
VALUES
    ('正殿明间主梁-1', 'beam', 0.20, 0.40, 3.0, 0.0, 0.0, 5.0,
     'Pine', 11000000.0, 10000000000.0, 0.35, '松木材，许用弯曲应力11MPa');

INSERT OR IGNORE INTO sections
    (name, member_type, width, height, length, position_x, position_y, position_z,
     material, allowable_stress, elastic_modulus, poisson_ratio, notes)
VALUES
    ('正殿金柱-1', 'column', 0.30, 0.30, 5.5, 2.5, 0.0, 0.0,
     'Cedar', 10000000.0, 9500000000.0, 0.33, '杉木柱，许用压应力10MPa');

-- 32个应变片配置（分布在梁截面的上下缘和两侧）
INSERT OR IGNORE INTO gauges
    (channel, section_id, pos_x, pos_y, angle, gauge_type, resistance, gauge_factor)
VALUES
    -- 梁上缘（受压区）4个
    (0, 1, 0.025, 0.38, 0.0, 'unidirectional', 120.0, 2.0),
    (1, 1, 0.075, 0.38, 0.0, 'unidirectional', 120.0, 2.0),
    (2, 1, 0.125, 0.38, 0.0, 'unidirectional', 120.0, 2.0),
    (3, 1, 0.175, 0.38, 0.0, 'unidirectional', 120.0, 2.0),

    -- 梁上缘近中性轴
    (4, 1, 0.025, 0.30, 0.0, 'unidirectional', 120.0, 2.0),
    (5, 1, 0.075, 0.30, 0.0, 'unidirectional', 120.0, 2.0),
    (6, 1, 0.125, 0.30, 0.0, 'unidirectional', 120.0, 2.0),
    (7, 1, 0.175, 0.30, 0.0, 'unidirectional', 120.0, 2.0),

    -- 中性轴处
    (8, 1, 0.025, 0.20, 0.0, 'unidirectional', 120.0, 2.0),
    (9, 1, 0.075, 0.20, 0.0, 'unidirectional', 120.0, 2.0),
    (10, 1, 0.125, 0.20, 0.0, 'unidirectional', 120.0, 2.0),
    (11, 1, 0.175, 0.20, 0.0, 'unidirectional', 120.0, 2.0),

    -- 梁下缘近中性轴
    (12, 1, 0.025, 0.10, 0.0, 'unidirectional', 120.0, 2.0),
    (13, 1, 0.075, 0.10, 0.0, 'unidirectional', 120.0, 2.0),
    (14, 1, 0.125, 0.10, 0.0, 'unidirectional', 120.0, 2.0),
    (15, 1, 0.175, 0.10, 0.0, 'unidirectional', 120.0, 2.0),

    -- 梁下缘（受拉区）4个
    (16, 1, 0.025, 0.02, 0.0, 'unidirectional', 120.0, 2.0),
    (17, 1, 0.075, 0.02, 0.0, 'unidirectional', 120.0, 2.0),
    (18, 1, 0.125, 0.02, 0.0, 'unidirectional', 120.0, 2.0),
    (19, 1, 0.175, 0.02, 0.0, 'unidirectional', 120.0, 2.0),

    -- 两侧剪切应变片（45度）
    (20, 1, 0.02, 0.20, 45.0, 'rosette', 120.0, 2.0),
    (21, 1, 0.02, 0.20, -45.0, 'rosette', 120.0, 2.0),
    (22, 1, 0.18, 0.20, 45.0, 'rosette', 120.0, 2.0),
    (23, 1, 0.18, 0.20, -45.0, 'rosette', 120.0, 2.0),

    -- 柱截面应变片（通道24-31）
    (24, 2, 0.05, 0.10, 0.0, 'unidirectional', 120.0, 2.0),
    (25, 2, 0.15, 0.10, 0.0, 'unidirectional', 120.0, 2.0),
    (26, 2, 0.25, 0.10, 0.0, 'unidirectional', 120.0, 2.0),
    (27, 2, 0.15, 0.05, 0.0, 'unidirectional', 120.0, 2.0),
    (28, 2, 0.05, 0.20, 0.0, 'unidirectional', 120.0, 2.0),
    (29, 2, 0.15, 0.20, 0.0, 'unidirectional', 120.0, 2.0),
    (30, 2, 0.25, 0.20, 0.0, 'unidirectional', 120.0, 2.0),
    (31, 2, 0.15, 0.25, 0.0, 'unidirectional', 120.0, 2.0);

-- 默认系统配置
INSERT OR IGNORE INTO system_config (key, value) VALUES
    ('sample_rate_hz', '5'),
    ('num_channels', '32'),
    ('warning_threshold', '0.8'),
    ('alarm_threshold', '1.0'),
    ('data_retention_days', '365'),
    ('auto_save_interval_s', '1'),
    ('serial_port', 'VIRTUAL_SIM'),
    ('baud_rate', '115200'),
    ('default_section_id', '1');

-- =====================================================
-- 触发器：自动更新配置修改时间
-- =====================================================
CREATE TRIGGER IF NOT EXISTS trg_config_update
AFTER UPDATE ON system_config
BEGIN
    UPDATE system_config SET updated_at = strftime('%s','now') WHERE key = NEW.key;
END;
