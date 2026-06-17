#include "SQLiteDataAccess.h"

#ifndef NO_SQLITE_CPP
#include <sstream>
#include <cstring>
#include <iostream>

namespace WoodStress {

SQLiteDataAccess::SQLiteDataAccess()
    : db_(nullptr), inTransaction_(false) {}

SQLiteDataAccess::~SQLiteDataAccess() {
    close();
}

bool SQLiteDataAccess::open(const std::string& dbPath) {
    close();
    int rc = sqlite3_open(dbPath.c_str(), &db_);
    if (rc != SQLITE_OK) {
        lastError_ = sqlite3_errmsg(db_);
        sqlite3_close(db_);
        db_ = nullptr;
        return false;
    }
    sqlite3_exec(db_, "PRAGMA journal_mode=WAL;", nullptr, nullptr, nullptr);
    sqlite3_exec(db_, "PRAGMA synchronous=NORMAL;", nullptr, nullptr, nullptr);
    sqlite3_exec(db_, "PRAGMA foreign_keys=ON;", nullptr, nullptr, nullptr);
    return true;
}

void SQLiteDataAccess::close() {
    if (db_) {
        if (inTransaction_) {
            rollbackTransaction();
        }
        sqlite3_close(db_);
        db_ = nullptr;
    }
}

bool SQLiteDataAccess::isOpen() const {
    return db_ != nullptr;
}

bool SQLiteDataAccess::initSchema() {
    if (!isOpen()) return false;

    const char* schema = R"(
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
            notes TEXT,
            created_at INTEGER DEFAULT (strftime('%s','now'))
        );

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

        CREATE TABLE IF NOT EXISTS system_config (
            key TEXT PRIMARY KEY,
            value TEXT,
            updated_at INTEGER DEFAULT (strftime('%s','now'))
        );
    )";

    return executeSql(schema);
}

bool SQLiteDataAccess::executeSql(const std::string& sql) {
    if (!isOpen()) return false;
    char* errMsg = nullptr;
    int rc = sqlite3_exec(db_, sql.c_str(), nullptr, nullptr, &errMsg);
    if (rc != SQLITE_OK && errMsg) {
        lastError_ = errMsg;
        sqlite3_free(errMsg);
        return false;
    }
    return true;
}

bool SQLiteDataAccess::beginTransaction() {
    if (!isOpen() || inTransaction_) return false;
    if (executeSql("BEGIN TRANSACTION;")) {
        inTransaction_ = true;
        return true;
    }
    return false;
}

bool SQLiteDataAccess::commitTransaction() {
    if (!isOpen() || !inTransaction_) return false;
    if (executeSql("COMMIT;")) {
        inTransaction_ = false;
        return true;
    }
    return false;
}

bool SQLiteDataAccess::rollbackTransaction() {
    if (!isOpen()) return false;
    inTransaction_ = false;
    return executeSql("ROLLBACK;");
}

int64_t SQLiteDataAccess::getLastInsertId() {
    if (!isOpen()) return -1;
    return static_cast<int64_t>(sqlite3_last_insert_rowid(db_));
}

std::string SQLiteDataAccess::getLastError() const {
    return lastError_;
}

bool SQLiteDataAccess::insertStrainRecord(const StrainRecord& r) {
    if (!isOpen()) return false;
    const char* sql =
        "INSERT INTO strain_data (timestamp, frame_id, channel, strain_value, section_id) "
        "VALUES (?, ?, ?, ?, ?);";
    sqlite3_stmt* stmt = nullptr;
    if (sqlite3_prepare_v2(db_, sql, -1, &stmt, nullptr) != SQLITE_OK) {
        lastError_ = sqlite3_errmsg(db_);
        return false;
    }
    sqlite3_bind_int64(stmt, 1, static_cast<sqlite3_int64>(r.timestamp));
    sqlite3_bind_int(stmt, 2, r.frameId);
    sqlite3_bind_int(stmt, 3, r.channel);
    sqlite3_bind_double(stmt, 4, r.strainValue);
    if (r.sectionId > 0) sqlite3_bind_int(stmt, 5, r.sectionId);
    else sqlite3_bind_null(stmt, 5);

    bool ok = sqlite3_step(stmt) == SQLITE_DONE;
    if (!ok) lastError_ = sqlite3_errmsg(db_);
    sqlite3_finalize(stmt);
    return ok;
}

bool SQLiteDataAccess::insertStrainBatch(const std::vector<StrainRecord>& records) {
    if (!isOpen()) return false;
    bool wasInTx = inTransaction_;
    if (!wasInTx) beginTransaction();

    const char* sql =
        "INSERT INTO strain_data (timestamp, frame_id, channel, strain_value, section_id) "
        "VALUES (?, ?, ?, ?, ?);";
    sqlite3_stmt* stmt = nullptr;
    if (sqlite3_prepare_v2(db_, sql, -1, &stmt, nullptr) != SQLITE_OK) {
        lastError_ = sqlite3_errmsg(db_);
        if (!wasInTx) rollbackTransaction();
        return false;
    }

    bool allOk = true;
    for (const auto& r : records) {
        sqlite3_reset(stmt);
        sqlite3_bind_int64(stmt, 1, static_cast<sqlite3_int64>(r.timestamp));
        sqlite3_bind_int(stmt, 2, r.frameId);
        sqlite3_bind_int(stmt, 3, r.channel);
        sqlite3_bind_double(stmt, 4, r.strainValue);
        if (r.sectionId > 0) sqlite3_bind_int(stmt, 5, r.sectionId);
        else sqlite3_bind_null(stmt, 5);
        if (sqlite3_step(stmt) != SQLITE_DONE) {
            allOk = false;
            lastError_ = sqlite3_errmsg(db_);
            break;
        }
    }
    sqlite3_finalize(stmt);

    if (allOk && !wasInTx) allOk = commitTransaction();
    else if (!allOk && !wasInTx) rollbackTransaction();
    return allOk;
}

std::vector<StrainRecord> SQLiteDataAccess::queryStrainByTime(
    uint64_t startTime, uint64_t endTime, int sectionId, int channel) {
    std::vector<StrainRecord> result;
    if (!isOpen()) return result;

    std::ostringstream oss;
    oss << "SELECT id, timestamp, frame_id, channel, strain_value, COALESCE(section_id, 0) "
        << "FROM strain_data WHERE timestamp BETWEEN " << startTime << " AND " << endTime;
    if (sectionId > 0) oss << " AND section_id = " << sectionId;
    if (channel >= 0) oss << " AND channel = " << channel;
    oss << " ORDER BY timestamp ASC;";

    sqlite3_stmt* stmt = nullptr;
    if (sqlite3_prepare_v2(db_, oss.str().c_str(), -1, &stmt, nullptr) != SQLITE_OK) {
        lastError_ = sqlite3_errmsg(db_);
        return result;
    }

    while (sqlite3_step(stmt) == SQLITE_ROW) {
        StrainRecord r;
        r.id = sqlite3_column_int64(stmt, 0);
        r.timestamp = static_cast<uint64_t>(sqlite3_column_int64(stmt, 1));
        r.frameId = sqlite3_column_int(stmt, 2);
        r.channel = sqlite3_column_int(stmt, 3);
        r.strainValue = sqlite3_column_double(stmt, 4);
        r.sectionId = sqlite3_column_int(stmt, 5);
        result.push_back(r);
    }
    sqlite3_finalize(stmt);
    return result;
}

bool SQLiteDataAccess::saveStressSnapshot(const StressSnapshot& s) {
    if (!isOpen()) return false;
    const char* sql =
        "INSERT INTO stress_snapshots (timestamp, section_id, max_von_mises, "
        "avg_von_mises, utilization_ratio, status, elem_von_mises) "
        "VALUES (?, ?, ?, ?, ?, ?, ?);";
    sqlite3_stmt* stmt = nullptr;
    if (sqlite3_prepare_v2(db_, sql, -1, &stmt, nullptr) != SQLITE_OK) {
        lastError_ = sqlite3_errmsg(db_);
        return false;
    }
    sqlite3_bind_int64(stmt, 1, static_cast<sqlite3_int64>(s.timestamp));
    if (s.sectionId > 0) sqlite3_bind_int(stmt, 2, s.sectionId);
    else sqlite3_bind_null(stmt, 2);
    sqlite3_bind_double(stmt, 3, s.maxVonMises);
    sqlite3_bind_double(stmt, 4, s.avgVonMises);
    sqlite3_bind_double(stmt, 5, s.utilizationRatio);
    sqlite3_bind_int(stmt, 6, s.status);

    if (!s.elemVonMises.empty()) {
        size_t byteSize = s.elemVonMises.size() * sizeof(double);
        sqlite3_bind_blob(stmt, 7, s.elemVonMises.data(), static_cast<int>(byteSize), SQLITE_TRANSIENT);
    } else {
        sqlite3_bind_null(stmt, 7);
    }

    bool ok = sqlite3_step(stmt) == SQLITE_DONE;
    if (!ok) lastError_ = sqlite3_errmsg(db_);
    sqlite3_finalize(stmt);
    return ok;
}

std::vector<StressSnapshot> SQLiteDataAccess::queryStressByTime(
    uint64_t startTime, uint64_t endTime, int sectionId) {
    std::vector<StressSnapshot> result;
    if (!isOpen()) return result;

    std::ostringstream oss;
    oss << "SELECT id, timestamp, COALESCE(section_id, 0), max_von_mises, "
        << "avg_von_mises, utilization_ratio, status, elem_von_mises "
        << "FROM stress_snapshots WHERE timestamp BETWEEN " << startTime << " AND " << endTime;
    if (sectionId > 0) oss << " AND section_id = " << sectionId;
    oss << " ORDER BY timestamp ASC;";

    sqlite3_stmt* stmt = nullptr;
    if (sqlite3_prepare_v2(db_, oss.str().c_str(), -1, &stmt, nullptr) != SQLITE_OK) {
        lastError_ = sqlite3_errmsg(db_);
        return result;
    }

    while (sqlite3_step(stmt) == SQLITE_ROW) {
        StressSnapshot s;
        s.id = sqlite3_column_int64(stmt, 0);
        s.timestamp = static_cast<uint64_t>(sqlite3_column_int64(stmt, 1));
        s.sectionId = sqlite3_column_int(stmt, 2);
        s.maxVonMises = sqlite3_column_double(stmt, 3);
        s.avgVonMises = sqlite3_column_double(stmt, 4);
        s.utilizationRatio = sqlite3_column_double(stmt, 5);
        s.status = sqlite3_column_int(stmt, 6);

        const void* blob = sqlite3_column_blob(stmt, 7);
        int bytes = sqlite3_column_bytes(stmt, 7);
        if (blob && bytes > 0) {
            size_t count = bytes / sizeof(double);
            s.elemVonMises.resize(count);
            std::memcpy(s.elemVonMises.data(), blob, bytes);
        }
        result.push_back(s);
    }
    sqlite3_finalize(stmt);
    return result;
}

std::optional<StressSnapshot> SQLiteDataAccess::getLatestSnapshot(int sectionId) {
    if (!isOpen()) return std::nullopt;

    std::ostringstream oss;
    oss << "SELECT id, timestamp, COALESCE(section_id, 0), max_von_mises, "
        << "avg_von_mises, utilization_ratio, status, elem_von_mises "
        << "FROM stress_snapshots ";
    if (sectionId > 0) oss << "WHERE section_id = " << sectionId << " ";
    oss << "ORDER BY timestamp DESC LIMIT 1;";

    sqlite3_stmt* stmt = nullptr;
    if (sqlite3_prepare_v2(db_, oss.str().c_str(), -1, &stmt, nullptr) != SQLITE_OK) {
        lastError_ = sqlite3_errmsg(db_);
        return std::nullopt;
    }

    std::optional<StressSnapshot> result = std::nullopt;
    if (sqlite3_step(stmt) == SQLITE_ROW) {
        StressSnapshot s;
        s.id = sqlite3_column_int64(stmt, 0);
        s.timestamp = static_cast<uint64_t>(sqlite3_column_int64(stmt, 1));
        s.sectionId = sqlite3_column_int(stmt, 2);
        s.maxVonMises = sqlite3_column_double(stmt, 3);
        s.avgVonMises = sqlite3_column_double(stmt, 4);
        s.utilizationRatio = sqlite3_column_double(stmt, 5);
        s.status = sqlite3_column_int(stmt, 6);

        const void* blob = sqlite3_column_blob(stmt, 7);
        int bytes = sqlite3_column_bytes(stmt, 7);
        if (blob && bytes > 0) {
            size_t count = bytes / sizeof(double);
            s.elemVonMises.resize(count);
            std::memcpy(s.elemVonMises.data(), blob, bytes);
        }
        result = s;
    }
    sqlite3_finalize(stmt);
    return result;
}

int SQLiteDataAccess::insertSection(const SectionInfo& s) {
    if (!isOpen()) return -1;
    const char* sql =
        "INSERT INTO sections (name, member_type, width, height, length, "
        "position_x, position_y, position_z, material, notes) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?);";
    sqlite3_stmt* stmt = nullptr;
    if (sqlite3_prepare_v2(db_, sql, -1, &stmt, nullptr) != SQLITE_OK) {
        lastError_ = sqlite3_errmsg(db_);
        return -1;
    }
    sqlite3_bind_text(stmt, 1, s.name.c_str(), -1, SQLITE_TRANSIENT);
    sqlite3_bind_text(stmt, 2, s.memberType.c_str(), -1, SQLITE_TRANSIENT);
    sqlite3_bind_double(stmt, 3, s.width);
    sqlite3_bind_double(stmt, 4, s.height);
    sqlite3_bind_double(stmt, 5, s.length);
    sqlite3_bind_double(stmt, 6, s.positionX);
    sqlite3_bind_double(stmt, 7, s.positionY);
    sqlite3_bind_double(stmt, 8, s.positionZ);
    sqlite3_bind_text(stmt, 9, s.material.c_str(), -1, SQLITE_TRANSIENT);
    sqlite3_bind_text(stmt, 10, s.notes.c_str(), -1, SQLITE_TRANSIENT);

    int id = -1;
    if (sqlite3_step(stmt) == SQLITE_DONE) {
        id = static_cast<int>(getLastInsertId());
    } else {
        lastError_ = sqlite3_errmsg(db_);
    }
    sqlite3_finalize(stmt);
    return id;
}

bool SQLiteDataAccess::updateSection(const SectionInfo& s) {
    if (!isOpen()) return false;
    const char* sql =
        "UPDATE sections SET name=?, member_type=?, width=?, height=?, length=?, "
        "position_x=?, position_y=?, position_z=?, material=?, notes=? WHERE id=?;";
    sqlite3_stmt* stmt = nullptr;
    if (sqlite3_prepare_v2(db_, sql, -1, &stmt, nullptr) != SQLITE_OK) {
        lastError_ = sqlite3_errmsg(db_);
        return false;
    }
    sqlite3_bind_text(stmt, 1, s.name.c_str(), -1, SQLITE_TRANSIENT);
    sqlite3_bind_text(stmt, 2, s.memberType.c_str(), -1, SQLITE_TRANSIENT);
    sqlite3_bind_double(stmt, 3, s.width);
    sqlite3_bind_double(stmt, 4, s.height);
    sqlite3_bind_double(stmt, 5, s.length);
    sqlite3_bind_double(stmt, 6, s.positionX);
    sqlite3_bind_double(stmt, 7, s.positionY);
    sqlite3_bind_double(stmt, 8, s.positionZ);
    sqlite3_bind_text(stmt, 9, s.material.c_str(), -1, SQLITE_TRANSIENT);
    sqlite3_bind_text(stmt, 10, s.notes.c_str(), -1, SQLITE_TRANSIENT);
    sqlite3_bind_int(stmt, 11, s.id);

    bool ok = sqlite3_step(stmt) == SQLITE_DONE;
    if (!ok) lastError_ = sqlite3_errmsg(db_);
    sqlite3_finalize(stmt);
    return ok;
}

bool SQLiteDataAccess::deleteSection(int id) {
    if (!isOpen()) return false;
    const char* sql = "DELETE FROM sections WHERE id = ?;";
    sqlite3_stmt* stmt = nullptr;
    if (sqlite3_prepare_v2(db_, sql, -1, &stmt, nullptr) != SQLITE_OK) {
        lastError_ = sqlite3_errmsg(db_);
        return false;
    }
    sqlite3_bind_int(stmt, 1, id);
    bool ok = sqlite3_step(stmt) == SQLITE_DONE;
    if (!ok) lastError_ = sqlite3_errmsg(db_);
    sqlite3_finalize(stmt);
    return ok;
}

std::vector<SectionInfo> SQLiteDataAccess::getAllSections() {
    std::vector<SectionInfo> result;
    if (!isOpen()) return result;
    const char* sql =
        "SELECT id, name, member_type, width, height, length, "
        "position_x, position_y, position_z, material, notes FROM sections ORDER BY id;";
    sqlite3_stmt* stmt = nullptr;
    if (sqlite3_prepare_v2(db_, sql, -1, &stmt, nullptr) != SQLITE_OK) {
        lastError_ = sqlite3_errmsg(db_);
        return result;
    }
    while (sqlite3_step(stmt) == SQLITE_ROW) {
        SectionInfo s;
        s.id = sqlite3_column_int(stmt, 0);
        s.name = reinterpret_cast<const char*>(sqlite3_column_text(stmt, 1));
        s.memberType = reinterpret_cast<const char*>(sqlite3_column_text(stmt, 2));
        s.width = sqlite3_column_double(stmt, 3);
        s.height = sqlite3_column_double(stmt, 4);
        s.length = sqlite3_column_double(stmt, 5);
        s.positionX = sqlite3_column_double(stmt, 6);
        s.positionY = sqlite3_column_double(stmt, 7);
        s.positionZ = sqlite3_column_double(stmt, 8);
        const char* mat = reinterpret_cast<const char*>(sqlite3_column_text(stmt, 9));
        s.material = mat ? mat : "";
        const char* notes = reinterpret_cast<const char*>(sqlite3_column_text(stmt, 10));
        s.notes = notes ? notes : "";
        result.push_back(s);
    }
    sqlite3_finalize(stmt);
    return result;
}

std::optional<SectionInfo> SQLiteDataAccess::getSection(int id) {
    if (!isOpen()) return std::nullopt;
    const char* sql =
        "SELECT id, name, member_type, width, height, length, "
        "position_x, position_y, position_z, material, notes FROM sections WHERE id = ?;";
    sqlite3_stmt* stmt = nullptr;
    if (sqlite3_prepare_v2(db_, sql, -1, &stmt, nullptr) != SQLITE_OK) {
        lastError_ = sqlite3_errmsg(db_);
        return std::nullopt;
    }
    sqlite3_bind_int(stmt, 1, id);
    std::optional<SectionInfo> result = std::nullopt;
    if (sqlite3_step(stmt) == SQLITE_ROW) {
        SectionInfo s;
        s.id = sqlite3_column_int(stmt, 0);
        s.name = reinterpret_cast<const char*>(sqlite3_column_text(stmt, 1));
        s.memberType = reinterpret_cast<const char*>(sqlite3_column_text(stmt, 2));
        s.width = sqlite3_column_double(stmt, 3);
        s.height = sqlite3_column_double(stmt, 4);
        s.length = sqlite3_column_double(stmt, 5);
        s.positionX = sqlite3_column_double(stmt, 6);
        s.positionY = sqlite3_column_double(stmt, 7);
        s.positionZ = sqlite3_column_double(stmt, 8);
        const char* mat = reinterpret_cast<const char*>(sqlite3_column_text(stmt, 9));
        s.material = mat ? mat : "";
        const char* notes = reinterpret_cast<const char*>(sqlite3_column_text(stmt, 10));
        s.notes = notes ? notes : "";
        result = s;
    }
    sqlite3_finalize(stmt);
    return result;
}

int SQLiteDataAccess::insertGauge(const GaugeConfig& g) {
    if (!isOpen()) return -1;
    const char* sql =
        "INSERT INTO gauges (channel, section_id, pos_x, pos_y, pos_z, angle, "
        "gauge_type, resistance, gauge_factor) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?);";
    sqlite3_stmt* stmt = nullptr;
    if (sqlite3_prepare_v2(db_, sql, -1, &stmt, nullptr) != SQLITE_OK) {
        lastError_ = sqlite3_errmsg(db_);
        return -1;
    }
    sqlite3_bind_int(stmt, 1, g.channel);
    if (g.sectionId > 0) sqlite3_bind_int(stmt, 2, g.sectionId);
    else sqlite3_bind_null(stmt, 2);
    sqlite3_bind_double(stmt, 3, g.posX);
    sqlite3_bind_double(stmt, 4, g.posY);
    sqlite3_bind_double(stmt, 5, g.posZ);
    sqlite3_bind_double(stmt, 6, g.angle);
    sqlite3_bind_text(stmt, 7, g.gaugeType.c_str(), -1, SQLITE_TRANSIENT);
    sqlite3_bind_double(stmt, 8, g.resistance);
    sqlite3_bind_double(stmt, 9, g.gaugeFactor);

    int id = -1;
    if (sqlite3_step(stmt) == SQLITE_DONE) {
        id = static_cast<int>(getLastInsertId());
    } else {
        lastError_ = sqlite3_errmsg(db_);
    }
    sqlite3_finalize(stmt);
    return id;
}

bool SQLiteDataAccess::updateGauge(const GaugeConfig& g) {
    if (!isOpen()) return false;
    const char* sql =
        "UPDATE gauges SET channel=?, section_id=?, pos_x=?, pos_y=?, pos_z=?, "
        "angle=?, gauge_type=?, resistance=?, gauge_factor=? WHERE id=?;";
    sqlite3_stmt* stmt = nullptr;
    if (sqlite3_prepare_v2(db_, sql, -1, &stmt, nullptr) != SQLITE_OK) {
        lastError_ = sqlite3_errmsg(db_);
        return false;
    }
    sqlite3_bind_int(stmt, 1, g.channel);
    if (g.sectionId > 0) sqlite3_bind_int(stmt, 2, g.sectionId);
    else sqlite3_bind_null(stmt, 2);
    sqlite3_bind_double(stmt, 3, g.posX);
    sqlite3_bind_double(stmt, 4, g.posY);
    sqlite3_bind_double(stmt, 5, g.posZ);
    sqlite3_bind_double(stmt, 6, g.angle);
    sqlite3_bind_text(stmt, 7, g.gaugeType.c_str(), -1, SQLITE_TRANSIENT);
    sqlite3_bind_double(stmt, 8, g.resistance);
    sqlite3_bind_double(stmt, 9, g.gaugeFactor);
    sqlite3_bind_int(stmt, 10, g.id);

    bool ok = sqlite3_step(stmt) == SQLITE_DONE;
    if (!ok) lastError_ = sqlite3_errmsg(db_);
    sqlite3_finalize(stmt);
    return ok;
}

bool SQLiteDataAccess::deleteGauge(int id) {
    if (!isOpen()) return false;
    const char* sql = "DELETE FROM gauges WHERE id = ?;";
    sqlite3_stmt* stmt = nullptr;
    if (sqlite3_prepare_v2(db_, sql, -1, &stmt, nullptr) != SQLITE_OK) {
        lastError_ = sqlite3_errmsg(db_);
        return false;
    }
    sqlite3_bind_int(stmt, 1, id);
    bool ok = sqlite3_step(stmt) == SQLITE_DONE;
    if (!ok) lastError_ = sqlite3_errmsg(db_);
    sqlite3_finalize(stmt);
    return ok;
}

std::vector<GaugeConfig> SQLiteDataAccess::getGaugesBySection(int sectionId) {
    std::vector<GaugeConfig> result;
    if (!isOpen()) return result;
    const char* sql =
        "SELECT id, channel, COALESCE(section_id, 0), pos_x, pos_y, pos_z, angle, "
        "gauge_type, resistance, gauge_factor FROM gauges "
        "WHERE section_id = ? ORDER BY channel;";
    sqlite3_stmt* stmt = nullptr;
    if (sqlite3_prepare_v2(db_, sql, -1, &stmt, nullptr) != SQLITE_OK) {
        lastError_ = sqlite3_errmsg(db_);
        return result;
    }
    sqlite3_bind_int(stmt, 1, sectionId);
    while (sqlite3_step(stmt) == SQLITE_ROW) {
        GaugeConfig g;
        g.id = sqlite3_column_int(stmt, 0);
        g.channel = sqlite3_column_int(stmt, 1);
        g.sectionId = sqlite3_column_int(stmt, 2);
        g.posX = sqlite3_column_double(stmt, 3);
        g.posY = sqlite3_column_double(stmt, 4);
        g.posZ = sqlite3_column_double(stmt, 5);
        g.angle = sqlite3_column_double(stmt, 6);
        const char* gt = reinterpret_cast<const char*>(sqlite3_column_text(stmt, 7));
        g.gaugeType = gt ? gt : "";
        g.resistance = sqlite3_column_double(stmt, 8);
        g.gaugeFactor = sqlite3_column_double(stmt, 9);
        result.push_back(g);
    }
    sqlite3_finalize(stmt);
    return result;
}

std::vector<GaugeConfig> SQLiteDataAccess::getAllGauges() {
    std::vector<GaugeConfig> result;
    if (!isOpen()) return result;
    const char* sql =
        "SELECT id, channel, COALESCE(section_id, 0), pos_x, pos_y, pos_z, angle, "
        "gauge_type, resistance, gauge_factor FROM gauges ORDER BY channel;";
    sqlite3_stmt* stmt = nullptr;
    if (sqlite3_prepare_v2(db_, sql, -1, &stmt, nullptr) != SQLITE_OK) {
        lastError_ = sqlite3_errmsg(db_);
        return result;
    }
    while (sqlite3_step(stmt) == SQLITE_ROW) {
        GaugeConfig g;
        g.id = sqlite3_column_int(stmt, 0);
        g.channel = sqlite3_column_int(stmt, 1);
        g.sectionId = sqlite3_column_int(stmt, 2);
        g.posX = sqlite3_column_double(stmt, 3);
        g.posY = sqlite3_column_double(stmt, 4);
        g.posZ = sqlite3_column_double(stmt, 5);
        g.angle = sqlite3_column_double(stmt, 6);
        const char* gt = reinterpret_cast<const char*>(sqlite3_column_text(stmt, 7));
        g.gaugeType = gt ? gt : "";
        g.resistance = sqlite3_column_double(stmt, 8);
        g.gaugeFactor = sqlite3_column_double(stmt, 9);
        result.push_back(g);
    }
    sqlite3_finalize(stmt);
    return result;
}

bool SQLiteDataAccess::vacuum() {
    return executeSql("VACUUM;");
}

bool SQLiteDataAccess::exportToCsv(const std::string& tableName, const std::string& csvPath) {
    if (!isOpen()) return false;
    sqlite3_stmt* stmt = nullptr;
    std::string sql = "SELECT * FROM " + tableName + ";";
    if (sqlite3_prepare_v2(db_, sql.c_str(), -1, &stmt, nullptr) != SQLITE_OK) {
        lastError_ = sqlite3_errmsg(db_);
        return false;
    }

    FILE* fp = fopen(csvPath.c_str(), "w");
    if (!fp) {
        sqlite3_finalize(stmt);
        return false;
    }

    int colCount = sqlite3_column_count(stmt);
    for (int i = 0; i < colCount; i++) {
        if (i > 0) fprintf(fp, ",");
        fprintf(fp, "%s", sqlite3_column_name(stmt, i));
    }
    fprintf(fp, "\n");

    while (sqlite3_step(stmt) == SQLITE_ROW) {
        for (int i = 0; i < colCount; i++) {
            if (i > 0) fprintf(fp, ",");
            int type = sqlite3_column_type(stmt, i);
            if (type == SQLITE_NULL) {
                fprintf(fp, "");
            } else if (type == SQLITE_INTEGER) {
                fprintf(fp, "%lld", static_cast<long long>(sqlite3_column_int64(stmt, i)));
            } else if (type == SQLITE_FLOAT) {
                fprintf(fp, "%.6f", sqlite3_column_double(stmt, i));
            } else if (type == SQLITE_TEXT) {
                fprintf(fp, "\"%s\"", reinterpret_cast<const char*>(sqlite3_column_text(stmt, i)));
            } else {
                fprintf(fp, "BLOB");
            }
        }
        fprintf(fp, "\n");
    }

    fclose(fp);
    sqlite3_finalize(stmt);
    return true;
}

}

#endif
