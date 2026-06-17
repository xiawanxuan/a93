#ifndef SAFETY_EVALUATOR_H
#define SAFETY_EVALUATOR_H

#include <string>
#include <vector>
#include <map>
#include <memory>
#include <functional>

namespace WoodStress {

enum class SafetyStatus {
    SAFE = 0,
    WARNING = 1,
    ALARM = 2,
    UNKNOWN = 3
};

struct SafetyReport {
    SafetyStatus status;
    double maxStress;
    double allowableStress;
    double safetyFactor;
    double utilizationRatio;
    std::string statusMessage;
    std::vector<int> alarmChannels;
    std::vector<int> warningChannels;
    std::map<int, double> channelUtilization;
    std::map<int, double> channelStress;
    double evaluationTimeMs;
    uint64_t timestamp;
};

struct WoodMaterialParams {
    std::string woodType;
    double allowableBendingStress;
    double allowableShearStress;
    double allowableCompressionStress;
    double E;
    double nu;
    double density;
};

class SafetyEvaluator {
public:
    SafetyEvaluator();
    ~SafetyEvaluator();

    void setWoodMaterial(const WoodMaterialParams& params);
    WoodMaterialParams getCurrentMaterial() const;

    void setWarningThreshold(double ratio);
    void setAlarmThreshold(double ratio);
    double getWarningThreshold() const;
    double getAlarmThreshold() const;

    SafetyReport evaluateSection(const std::vector<double>& elemVonMises,
                                  double maxVonMises,
                                  const std::map<int, double>& channelStress);

    SafetyReport evaluateChannels(const std::map<int, double>& channelStress);

    SafetyStatus getOverallStatus(const SafetyReport& report) const;

    static std::string statusToString(SafetyStatus status);
    static std::string statusToColor(SafetyStatus status);

private:
    WoodMaterialParams material_;
    double warningThreshold_;
    double alarmThreshold_;
};

}

#endif
