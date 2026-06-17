#include "SafetyEvaluator.h"
#include <chrono>
#include <sstream>
#include <iomanip>
#include <cmath>

namespace WoodStress {

SafetyEvaluator::SafetyEvaluator()
    : warningThreshold_(0.8), alarmThreshold_(1.0) {
    material_.woodType = "Pine (松木材)";
    material_.allowableBendingStress = 11.0e6;
    material_.allowableShearStress = 1.2e6;
    material_.allowableCompressionStress = 10.0e6;
    material_.E = 10.0e9;
    material_.nu = 0.35;
    material_.density = 450.0;
}

SafetyEvaluator::~SafetyEvaluator() = default;

void SafetyEvaluator::setWoodMaterial(const WoodMaterialParams& params) {
    material_ = params;
}

WoodMaterialParams SafetyEvaluator::getCurrentMaterial() const {
    return material_;
}

void SafetyEvaluator::setWarningThreshold(double ratio) {
    warningThreshold_ = ratio;
}

void SafetyEvaluator::setAlarmThreshold(double ratio) {
    alarmThreshold_ = ratio;
}

double SafetyEvaluator::getWarningThreshold() const {
    return warningThreshold_;
}

double SafetyEvaluator::getAlarmThreshold() const {
    return alarmThreshold_;
}

std::string SafetyEvaluator::statusToString(SafetyStatus status) {
    switch (status) {
        case SafetyStatus::SAFE:    return "安全";
        case SafetyStatus::WARNING: return "预警";
        case SafetyStatus::ALARM:   return "报警";
        default:                    return "未知";
    }
}

std::string SafetyEvaluator::statusToColor(SafetyStatus status) {
    switch (status) {
        case SafetyStatus::SAFE:    return "#22c55e";
        case SafetyStatus::WARNING: return "#eab308";
        case SafetyStatus::ALARM:   return "#ef4444";
        default:                    return "#9ca3af";
    }
}

SafetyStatus SafetyEvaluator::getOverallStatus(const SafetyReport& report) const {
    if (!report.alarmChannels.empty()) return SafetyStatus::ALARM;
    if (!report.warningChannels.empty()) return SafetyStatus::WARNING;
    if (report.utilizationRatio >= alarmThreshold_) return SafetyStatus::ALARM;
    if (report.utilizationRatio >= warningThreshold_) return SafetyStatus::WARNING;
    return SafetyStatus::SAFE;
}

SafetyReport SafetyEvaluator::evaluateSection(
    const std::vector<double>& elemVonMises,
    double maxVonMises,
    const std::map<int, double>& channelStress) {

    auto t0 = std::chrono::high_resolution_clock::now();

    SafetyReport report;
    report.allowableStress = material_.allowableBendingStress;
    report.maxStress = maxVonMises;
    report.utilizationRatio = report.allowableStress > 0
        ? report.maxStress / report.allowableStress
        : 0.0;
    report.safetyFactor = report.maxStress > 0
        ? report.allowableStress / report.maxStress
        : 999.0;
    report.channelStress = channelStress;

    for (const auto& [ch, stress] : channelStress) {
        double ratio = report.allowableStress > 0
            ? stress / report.allowableStress : 0.0;
        report.channelUtilization[ch] = ratio;
        if (ratio >= alarmThreshold_) {
            report.alarmChannels.push_back(ch);
        } else if (ratio >= warningThreshold_) {
            report.warningChannels.push_back(ch);
        }
    }

    if (report.utilizationRatio >= alarmThreshold_) {
        report.status = SafetyStatus::ALARM;
        std::ostringstream oss;
        oss << std::fixed << std::setprecision(2)
            << "危险！最大应力达到许用应力的 "
            << (report.utilizationRatio * 100.0) << "%";
        report.statusMessage = oss.str();
    } else if (report.utilizationRatio >= warningThreshold_) {
        report.status = SafetyStatus::WARNING;
        std::ostringstream oss;
        oss << std::fixed << std::setprecision(2)
            << "注意：最大应力已达许用应力的 "
            << (report.utilizationRatio * 100.0) << "%";
        report.statusMessage = oss.str();
    } else {
        report.status = SafetyStatus::SAFE;
        std::ostringstream oss;
        oss << std::fixed << std::setprecision(2)
            << "结构安全，最大应力利用率 "
            << (report.utilizationRatio * 100.0) << "%";
        report.statusMessage = oss.str();
    }

    auto t1 = std::chrono::high_resolution_clock::now();
    report.evaluationTimeMs = std::chrono::duration<double, std::milli>(t1 - t0).count();
    report.timestamp = static_cast<uint64_t>(
        std::chrono::duration_cast<std::chrono::milliseconds>(
            std::chrono::system_clock::now().time_since_epoch()).count());

    return report;
}

SafetyReport SafetyEvaluator::evaluateChannels(
    const std::map<int, double>& channelStress) {
    double maxStress = 0.0;
    for (const auto& [ch, stress] : channelStress) {
        maxStress = std::max(maxStress, std::abs(stress));
    }
    std::vector<double> dummy;
    return evaluateSection(dummy, maxStress, channelStress);
}

}
