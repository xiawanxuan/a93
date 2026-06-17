#ifndef SQLITE_DATA_ACCESS_H
#define SQLITE_DATA_ACCESS_H

#ifndef NO_SQLITE_CPP

#include <sqlite3.h>
#include <string>
#include <vector>
#include <map>
#include <memory>
#include <cstdint>
#include <optional>

namespace WoodStress {

struct StrainRecord {
    int64_t id;
    uint64_t timestamp;
    int frameId;
    int channel;
    double strainValue;
    int sectionId;
};

struct StressSnapshot {
    int64_t id;
    uint64_t timestamp;
    int sectionId;
    double maxVonMises;
    double avgVonMises;
    double utilizationRatio;
    int status;
    std::vector<double> elemVonMises;
};

struct SectionInfo {
    int id;
    std::string name;
    std::string memberType;
    double width;
    double height;
    double length;
    double positionX;
    double positionY;
    double positionZ;
    std::string material;
    std::string notes;
};

struct GaugeConfig {
    int id;
    int channel;
    int sectionId;
    double posX;
    double posY;
    double posZ;
    double angle;
    std::string gaugeType;
    double resistance;
    double gaugeFactor;
};

class SQLiteDataAccess {
public:
    SQLiteDataAccess();
    ~SQLiteDataAccess();

    bool open(const std::string& dbPath);
    void close();
    bool isOpen() const;

    bool initSchema();
    bool executeSql(const std::string& sql);

    bool insertStrainRecord(const StrainRecord& record);
    bool insertStrainBatch(const std::vector<StrainRecord>& records);
    std::vector<StrainRecord> queryStrainByTime(
        uint64_t startTime, uint64_t endTime,
        int sectionId = -1, int channel = -1);

    bool saveStressSnapshot(const StressSnapshot& snapshot);
    std::vector<StressSnapshot> queryStressByTime(
        uint64_t startTime, uint64_t endTime, int sectionId = -1);
    std::optional<StressSnapshot> getLatestSnapshot(int sectionId = -1);

    int insertSection(const SectionInfo& section);
    bool updateSection(const SectionInfo& section);
    bool deleteSection(int id);
    std::vector<SectionInfo> getAllSections();
    std::optional<SectionInfo> getSection(int id);

    int insertGauge(const GaugeConfig& gauge);
    bool updateGauge(const GaugeConfig& gauge);
    bool deleteGauge(int id);
    std::vector<GaugeConfig> getGaugesBySection(int sectionId);
    std::vector<GaugeConfig> getAllGauges();

    bool beginTransaction();
    bool commitTransaction();
    bool rollbackTransaction();

    int64_t getLastInsertId();
    std::string getLastError() const;

    bool vacuum();
    bool exportToCsv(const std::string& tableName, const std::string& csvPath);

private:
    sqlite3* db_;
    std::string lastError_;
    bool inTransaction_;

    static int stressSnapshotCallback(void* data, int argc,
                                       char** argv, char** azColName);
};

}

#endif
#endif
