#ifndef SERIAL_SIMULATOR_H
#define SERIAL_SIMULATOR_H

#include <string>
#include <vector>
#include <map>
#include <thread>
#include <atomic>
#include <functional>
#include <mutex>
#include <queue>
#include <random>
#include <cstdint>

namespace WoodStress {

struct SerialDataFrame {
    uint64_t timestamp;
    int frameId;
    std::vector<double> channels;
};

using DataCallback = std::function<void(const SerialDataFrame&)>;

class SerialSimulator {
public:
    SerialSimulator();
    ~SerialSimulator();

    void configure(int numChannels, double sampleRateHz);
    void setGaugePositions(const std::map<int, std::pair<double, double>>& positions);
    void setLoadPattern(double amplitude, double frequencyHz, int patternType);

    bool start();
    bool stop();
    bool isRunning() const;

    void setCallback(DataCallback callback);

    void setNoiseLevel(double microstrain);
    void injectFault(int channel, double multiplier);

    SerialDataFrame readLastFrame();
    std::vector<SerialDataFrame> readBufferedFrames(size_t maxCount);

    int getNumChannels() const { return numChannels_; }
    double getSampleRate() const { return sampleRateHz_; }

    static std::vector<std::string> listVirtualPorts();
    bool connectPort(const std::string& portName, int baudRate);
    void disconnectPort();

private:
    void runThread();
    double generateStrain(int channel, uint64_t timeMs);

    std::atomic<bool> running_;
    std::thread workThread_;
    DataCallback callback_;

    int numChannels_;
    double sampleRateHz_;
    double noiseLevel_;
    uint64_t frameCounter_;

    double loadAmplitude_;
    double loadFrequencyHz_;
    int loadPatternType_;

    std::map<int, std::pair<double, double>> gaugePositions_;
    std::map<int, double> faultMultipliers_;

    mutable std::mutex frameMutex_;
    SerialDataFrame lastFrame_;
    std::queue<SerialDataFrame> frameBuffer_;
    size_t maxBufferSize_;

    std::mt19937 rng_;
    std::normal_distribution<double> noiseDist_;

    bool useRealSerial_;
    std::string serialPortName_;
    int baudRate_;
    void* serialHandle_;
};

}

#endif
