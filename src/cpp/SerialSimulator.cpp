#include "SerialSimulator.h"
#include <chrono>
#include <cmath>
#include <algorithm>
#include <iostream>

namespace WoodStress {

SerialSimulator::SerialSimulator()
    : running_(false),
      numChannels_(32),
      sampleRateHz_(5.0),
      noiseLevel_(5.0),
      frameCounter_(0),
      loadAmplitude_(150.0),
      loadFrequencyHz_(0.1),
      loadPatternType_(0),
      maxBufferSize_(1000),
      rng_(std::random_device{}()),
      noiseDist_(0.0, 1.0),
      useRealSerial_(false),
      baudRate_(115200),
      serialHandle_(nullptr) {
    lastFrame_.timestamp = 0;
    lastFrame_.frameId = 0;
    lastFrame_.channels.assign(numChannels_, 0.0);
}

SerialSimulator::~SerialSimulator() {
    stop();
    disconnectPort();
}

void SerialSimulator::configure(int numChannels, double sampleRateHz) {
    numChannels_ = std::max(1, std::min(128, numChannels));
    sampleRateHz_ = std::max(0.1, std::min(100.0, sampleRateHz));
    lastFrame_.channels.assign(numChannels_, 0.0);
}

void SerialSimulator::setGaugePositions(
    const std::map<int, std::pair<double, double>>& positions) {
    gaugePositions_ = positions;
}

void SerialSimulator::setLoadPattern(double amplitude, double frequencyHz, int patternType) {
    loadAmplitude_ = amplitude;
    loadFrequencyHz_ = frequencyHz;
    loadPatternType_ = patternType;
}

void SerialSimulator::setCallback(DataCallback callback) {
    callback_ = std::move(callback);
}

void SerialSimulator::setNoiseLevel(double microstrain) {
    noiseLevel_ = microstrain;
}

void SerialSimulator::injectFault(int channel, double multiplier) {
    if (multiplier == 1.0) {
        faultMultipliers_.erase(channel);
    } else {
        faultMultipliers_[channel] = multiplier;
    }
}

bool SerialSimulator::start() {
    if (running_.exchange(true)) return false;
    frameCounter_ = 0;
    workThread_ = std::thread(&SerialSimulator::runThread, this);
    return true;
}

bool SerialSimulator::stop() {
    if (!running_.exchange(false)) return false;
    if (workThread_.joinable()) {
        workThread_.join();
    }
    return true;
}

bool SerialSimulator::isRunning() const {
    return running_.load();
}

SerialDataFrame SerialSimulator::readLastFrame() {
    std::lock_guard<std::mutex> lock(frameMutex_);
    return lastFrame_;
}

std::vector<SerialDataFrame> SerialSimulator::readBufferedFrames(size_t maxCount) {
    std::lock_guard<std::mutex> lock(frameMutex_);
    std::vector<SerialDataFrame> result;
    size_t count = std::min(maxCount, frameBuffer_.size());
    result.reserve(count);
    for (size_t i = 0; i < count; i++) {
        result.push_back(std::move(frameBuffer_.front()));
        frameBuffer_.pop();
    }
    return result;
}

double SerialSimulator::generateStrain(int channel, uint64_t timeMs) {
    double t = timeMs / 1000.0;
    double base = 0.0;
    double phase = (channel % 8) * 0.25;
    double yFactor = 1.0;

    auto it = gaugePositions_.find(channel);
    if (it != gaugePositions_.end()) {
        yFactor = 0.5 + it->second.second * 1.5;
    } else {
        yFactor = 0.5 + (channel % 4) * 0.3;
    }

    switch (loadPatternType_) {
        case 1: {
            base = loadAmplitude_ * yFactor *
                   std::abs(std::sin(2.0 * M_PI * loadFrequencyHz_ * t + phase));
            break;
        }
        case 2: {
            double period = 1.0 / loadFrequencyHz_;
            double phaseT = std::fmod(t + phase * period, period) / period;
            base = loadAmplitude_ * yFactor *
                   (phaseT < 0.1 ? phaseT * 10.0 : (phaseT > 0.9 ? (1.0 - phaseT) * 10.0 : 1.0));
            break;
        }
        case 3: {
            base = loadAmplitude_ * yFactor * 0.5 *
                   (std::sin(2.0 * M_PI * loadFrequencyHz_ * t) +
                    std::sin(2.0 * M_PI * loadFrequencyHz_ * 3.0 * t + phase) * 0.3 +
                    std::sin(2.0 * M_PI * loadFrequencyHz_ * 5.0 * t + phase * 2) * 0.1);
            break;
        }
        default: {
            base = loadAmplitude_ * yFactor *
                   std::sin(2.0 * M_PI * loadFrequencyHz_ * t + phase);
        }
    }

    double drift = std::sin(t * 0.01 + channel * 0.3) * 2.0;
    double noise = noiseDist_(rng_) * noiseLevel_;

    double strain = base + drift + noise;

    auto fit = faultMultipliers_.find(channel);
    if (fit != faultMultipliers_.end()) {
        strain *= fit->second;
    }

    return strain * 1.0e-6;
}

void SerialSimulator::runThread() {
    using clock = std::chrono::high_resolution_clock;
    auto nextFrame = clock::now();
    int64_t intervalUs = static_cast<int64_t>(1000000.0 / sampleRateHz_);

    while (running_.load()) {
        auto now = clock::now();
        if (now >= nextFrame) {
            SerialDataFrame frame;
            frame.frameId = static_cast<int>(frameCounter_++);
            frame.timestamp = static_cast<uint64_t>(
                std::chrono::duration_cast<std::chrono::milliseconds>(
                    std::chrono::system_clock::now().time_since_epoch()).count());

            frame.channels.resize(numChannels_);
            for (int ch = 0; ch < numChannels_; ch++) {
                frame.channels[ch] = generateStrain(ch, frame.timestamp);
            }

            {
                std::lock_guard<std::mutex> lock(frameMutex_);
                lastFrame_ = frame;
                frameBuffer_.push(frame);
                while (frameBuffer_.size() > maxBufferSize_) {
                    frameBuffer_.pop();
                }
            }

            if (callback_) {
                callback_(frame);
            }

            nextFrame = now + std::chrono::microseconds(intervalUs);
        } else {
            std::this_thread::sleep_for(std::chrono::microseconds(100));
        }
    }
}

std::vector<std::string> SerialSimulator::listVirtualPorts() {
    std::vector<std::string> ports;
#ifdef _WIN32
    for (int i = 1; i <= 256; i++) {
        ports.push_back("COM" + std::to_string(i));
    }
#else
    ports.push_back("/dev/ttyV0");
    ports.push_back("/dev/ttyV1");
    ports.push_back("/dev/ttyUSB0");
    ports.push_back("/dev/ttyUSB1");
#endif
    ports.push_back("VIRTUAL_SIM");
    return ports;
}

bool SerialSimulator::connectPort(const std::string& portName, int baudRate) {
    if (portName == "VIRTUAL_SIM") {
        useRealSerial_ = false;
        return start();
    }
    serialPortName_ = portName;
    baudRate_ = baudRate;
    useRealSerial_ = true;
    return start();
}

void SerialSimulator::disconnectPort() {
    stop();
    serialHandle_ = nullptr;
    useRealSerial_ = false;
}

}
