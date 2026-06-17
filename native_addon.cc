#include <napi.h>
#include "src/cpp/FESolver.h"
#include "src/cpp/SafetyEvaluator.h"
#include "src/cpp/SerialSimulator.h"
#ifndef NO_SQLITE_CPP
#include "src/cpp/SQLiteDataAccess.h"
#endif
#include <memory>
#include <map>
#include <mutex>
#include <thread>
#include <vector>

using namespace Napi;
using namespace WoodStress;

namespace {

std::unique_ptr<FESolver> g_solver;
std::unique_ptr<SafetyEvaluator> g_evaluator;
std::unique_ptr<SerialSimulator> g_serial;
#ifndef NO_SQLITE_CPP
std::unique_ptr<SQLiteDataAccess> g_db;
#endif
std::mutex g_mutex;
ThreadSafeFunction g_dataCallbackTsfn;
int g_currentSectionId = 1;
double g_sectionWidth = 0.2;
double g_sectionHeight = 0.4;
std::shared_ptr<CrossSection> g_section;

void ensureInitialized() {
    if (!g_solver) {
        g_solver = std::make_unique<FESolver>();
    }
    if (!g_evaluator) {
        g_evaluator = std::make_unique<SafetyEvaluator>();
    }
    if (!g_serial) {
        g_serial = std::make_unique<SerialSimulator>();
    }
}

Object toNapiObject(const Napi::CallbackInfo& info, const FEResult& result) {
    Object obj = Object::New(info.Env());
    Array sxx = Array::New(info.Env(), result.nodeStressXX.size());
    Array syy = Array::New(info.Env(), result.nodeStressYY.size());
    Array sxy = Array::New(info.Env(), result.nodeStressXY.size());
    Array vm = Array::New(info.Env(), result.nodeVonMises.size());
    Array elem = Array::New(info.Env(), result.elemVonMises.size());

    for (int i = 0; i < result.nodeStressXX.size(); i++) {
        sxx[i] = Number::New(info.Env(), result.nodeStressXX(i));
        syy[i] = Number::New(info.Env(), result.nodeStressYY(i));
        sxy[i] = Number::New(info.Env(), result.nodeStressXY(i));
        vm[i] = Number::New(info.Env(), result.nodeVonMises(i));
    }
    for (int i = 0; i < result.elemVonMises.size(); i++) {
        elem[i] = Number::New(info.Env(), result.elemVonMises(i));
    }
    obj.Set("nodeStressXX", sxx);
    obj.Set("nodeStressYY", syy);
    obj.Set("nodeStressXY", sxy);
    obj.Set("nodeVonMises", vm);
    obj.Set("elemVonMises", elem);
    obj.Set("maxVonMises", Number::New(info.Env(), result.maxVonMises));
    obj.Set("avgVonMises", Number::New(info.Env(), result.avgVonMises));
    obj.Set("solveTimeMs", Number::New(info.Env(), result.solveTimeMs));
    return obj;
}

Napi::Value InitFESolverCreateSection(const CallbackInfo& info) {
    Env env = info.Env();
    std::lock_guard<std::mutex> lock(g_mutex);
    ensureInitialized();

    double width = info[0].IsNumber() ? info[0].As<Number>().DoubleValue() : 0.2;
    double height = info[1].IsNumber() ? info[1].As<Number>().DoubleValue() : 0.4;
    int divX = info[2].IsNumber() ? (int)info[2].As<Number>().Int32Value() : 50;
    int divY = info[3].IsNumber() ? (int)info[3].As<Number>().Int32Value() : 100;
    double E = info[4].IsNumber() ? info[4].As<Number>().DoubleValue() : 10.0e9;
    double nu = info[5].IsNumber() ? info[5].As<Number>().DoubleValue() : 0.35;

    g_sectionWidth = width;
    g_sectionHeight = height;
    g_section = std::make_shared<CrossSection>(
        g_solver->createRectangularSection(width, height, divX, divY, E, nu));

    if (info[6].IsArray()) {
        Array gauges = info[6].As<Array>();
        for (uint32_t i = 0; i < gauges.Length(); i++) {
            if (gauges[i].IsObject()) {
                Object g = gauges[i].As<Object>();
                int id = g.Has("id") ? g.Get("id").As<Number>().Int32Value() : (int)i;
                int channel = g.Has("channel") ? g.Get("channel").As<Number>().Int32Value() : (int)i;
                double x = g.Has("x") ? g.Get("x").As<Number>().DoubleValue() : 0;
                double y = g.Has("y") ? g.Get("y").As<Number>().DoubleValue() : 0;
                double angle = g.Has("angle") ? g.Get("angle").As<Number>().DoubleValue() : 0;
                g_solver->addGauge(*g_section, id, channel, x, y, angle);
            }
        }
    }

    Object result = Object::New(env);
    result.Set("nodeCount", Number::New(env, g_section->nodes.size()));
    result.Set("elementCount", Number::New(env, g_section->elements.size()));
    result.Set("gaugeCount", Number::New(env, g_section->gauges.size()));
    result.Set("width", Number::New(env, width));
    result.Set("height", Number::New(env, height));

    Array nodes = Array::New(env, g_section->nodes.size());
    for (size_t i = 0; i < g_section->nodes.size(); i++) {
        Object nd = Object::New(env);
        nd.Set("id", Number::New(env, g_section->nodes[i].id));
        nd.Set("x", Number::New(env, g_section->nodes[i].x));
        nd.Set("y", Number::New(env, g_section->nodes[i].y));
        nodes[i] = nd;
    }
    result.Set("nodes", nodes);

    Array elements = Array::New(env, g_section->elements.size());
    for (size_t i = 0; i < g_section->elements.size(); i++) {
        Object el = Object::New(env);
        el.Set("id", Number::New(env, g_section->elements[i].id));
        Array nids = Array::New(env, 4);
        nids[0] = Number::New(env, g_section->elements[i].nodeIds[0]);
        nids[1] = Number::New(env, g_section->elements[i].nodeIds[1]);
        nids[2] = Number::New(env, g_section->elements[i].nodeIds[2]);
        nids[3] = Number::New(env, g_section->elements[i].nodeIds[3]);
        el.Set("nodeIds", nids);
        elements[i] = el;
    }
    result.Set("elements", elements);

    Array gaugesOut = Array::New(env, g_section->gauges.size());
    for (size_t i = 0; i < g_section->gauges.size(); i++) {
        Object g = Object::New(env);
        g.Set("id", Number::New(env, g_section->gauges[i].id));
        g.Set("channel", Number::New(env, g_section->gauges[i].channel));
        g.Set("x", Number::New(env, g_section->gauges[i].x));
        g.Set("y", Number::New(env, g_section->gauges[i].y));
        g.Set("angle", Number::New(env, g_section->gauges[i].angle));
        gaugesOut[i] = g;
    }
    result.Set("gauges", gaugesOut);

    return result;
}

Napi::Value FESolveInverse(const CallbackInfo& info) {
    Env env = info.Env();
    std::lock_guard<std::mutex> lock(g_mutex);
    ensureInitialized();

    if (!g_section) {
        Error::New(env, "Section not initialized").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    std::map<int, double> gaugeStrains;
    if (info[0].IsObject()) {
        Object strains = info[0].As<Object>();
        Array keys = strains.GetPropertyNames();
        for (uint32_t i = 0; i < keys.Length(); i++) {
            Napi::Value key = keys[i];
            int channel = key.As<Number>().Int32Value();
            double strain = strains.Get(key).As<Number>().DoubleValue();
            gaugeStrains[channel] = strain;
        }
    }

    FEResult result = g_solver->solveInverse(*g_section, gaugeStrains);
    return toNapiObject(info, result);
}

Napi::Value SafetyEvaluate(const CallbackInfo& info) {
    Env env = info.Env();
    std::lock_guard<std::mutex> lock(g_mutex);
    ensureInitialized();

    std::vector<double> elemVM;
    double maxVM = 0;
    if (info[0].IsArray()) {
        Array arr = info[0].As<Array>();
        elemVM.reserve(arr.Length());
        for (uint32_t i = 0; i < arr.Length(); i++) {
            double v = arr[i].As<Number>().DoubleValue();
            elemVM.push_back(v);
            maxVM = std::max(maxVM, v);
        }
    }

    std::map<int, double> channelStress;
    if (info[1].IsObject()) {
        Object obj = info[1].As<Object>();
        Array keys = obj.GetPropertyNames();
        for (uint32_t i = 0; i < keys.Length(); i++) {
            Napi::Value key = keys[i];
            int ch = key.As<Number>().Int32Value();
            channelStress[ch] = obj.Get(key).As<Number>().DoubleValue();
        }
    }

    if (info.Length() > 2 && info[2].IsObject()) {
        Object mat = info[2].As<Object>();
        WoodMaterialParams params = g_evaluator->getCurrentMaterial();
        if (mat.Has("allowableStress")) {
            params.allowableBendingStress = mat.Get("allowableStress").As<Number>().DoubleValue();
        }
        if (mat.Has("E")) {
            params.E = mat.Get("E").As<Number>().DoubleValue();
        }
        g_evaluator->setWoodMaterial(params);
    }

    if (info.Length() > 3 && info[3].IsNumber()) {
        g_evaluator->setWarningThreshold(info[3].As<Number>().DoubleValue());
    }
    if (info.Length() > 4 && info[4].IsNumber()) {
        g_evaluator->setAlarmThreshold(info[4].As<Number>().DoubleValue());
    }

    SafetyReport report = g_evaluator->evaluateSection(elemVM, maxVM, channelStress);

    Object obj = Object::New(env);
    obj.Set("status", Number::New(env, (int)report.status));
    obj.Set("statusString", String::New(env, SafetyEvaluator::statusToString(report.status)));
    obj.Set("statusColor", String::New(env, SafetyEvaluator::statusToColor(report.status)));
    obj.Set("maxStress", Number::New(env, report.maxStress));
    obj.Set("allowableStress", Number::New(env, report.allowableStress));
    obj.Set("safetyFactor", Number::New(env, report.safetyFactor));
    obj.Set("utilizationRatio", Number::New(env, report.utilizationRatio));
    obj.Set("statusMessage", String::New(env, report.statusMessage));
    obj.Set("evaluationTimeMs", Number::New(env, report.evaluationTimeMs));
    obj.Set("timestamp", BigInt::New(env, report.timestamp));

    Array alarmChs = Array::New(env, report.alarmChannels.size());
    for (size_t i = 0; i < report.alarmChannels.size(); i++) {
        alarmChs[i] = Number::New(env, report.alarmChannels[i]);
    }
    obj.Set("alarmChannels", alarmChs);

    Array warnChs = Array::New(env, report.warningChannels.size());
    for (size_t i = 0; i < report.warningChannels.size(); i++) {
        warnChs[i] = Number::New(env, report.warningChannels[i]);
    }
    obj.Set("warningChannels", warnChs);

    Object chUtil = Object::New(env);
    for (const auto& [ch, val] : report.channelUtilization) {
        chUtil.Set(String::New(env, std::to_string(ch)), Number::New(env, val));
    }
    obj.Set("channelUtilization", chUtil);

    return obj;
}

void serialDataCallbackWrapper(Napi::Env env, Function jsCallback, const SerialDataFrame* frame) {
    if (!frame) return;
    if (frame != nullptr) {
        Object obj = Object::New(env);
        obj.Set("timestamp", BigInt::New(env, frame->timestamp));
        obj.Set("frameId", Number::New(env, frame->frameId));
        Array chs = Array::New(env, frame->channels.size());
        for (size_t i = 0; i < frame->channels.size(); i++) {
            chs[i] = Number::New(env, frame->channels[i]);
        }
        obj.Set("channels", chs);
        jsCallback.Call({obj});
    }
    delete frame;
}

Napi::Value SerialStart(const CallbackInfo& info) {
    Env env = info.Env();
    std::lock_guard<std::mutex> lock(g_mutex);
    ensureInitialized();

    int channels = info[0].IsNumber() ? info[0].As<Number>().Int32Value() : 32;
    double rate = info[1].IsNumber() ? info[1].As<Number>().DoubleValue() : 5.0;
    g_serial->configure(channels, rate);

    if (info.Length() > 2 && info[2].IsFunction()) {
        if (g_dataCallbackTsfn) g_dataCallbackTsfn.Release();
        Function cb = info[2].As<Function>();
        g_dataCallbackTsfn = ThreadSafeFunction::New(
            env, cb, "SerialDataCallback", 0, 1,
            [](Napi::Env, void*){});
        g_serial->setCallback([](const SerialDataFrame& f) {
            SerialDataFrame* copy = new SerialDataFrame(f);
            napi_status status = g_dataCallbackTsfn.BlockingCall(copy, serialDataCallbackWrapper);
            if (status != napi_ok) delete copy;
        });
    }

    bool ok = g_serial->start();
    return Boolean::New(env, ok);
}

Napi::Value SerialStop(const CallbackInfo& info) {
    Env env = info.Env();
    std::lock_guard<std::mutex> lock(g_mutex);
    bool ok = g_serial ? g_serial->stop() : false;
    if (g_dataCallbackTsfn) {
        g_dataCallbackTsfn.Release();
        g_dataCallbackTsfn = nullptr;
    }
    return Boolean::New(env, ok);
}

Napi::Value SerialReadFrame(const CallbackInfo& info) {
    Env env = info.Env();
    if (!g_serial) return env.Undefined();
    SerialDataFrame f = g_serial->readLastFrame();
    Object obj = Object::New(env);
    obj.Set("timestamp", BigInt::New(env, f.timestamp));
    obj.Set("frameId", Number::New(env, f.frameId));
    Array chs = Array::New(env, f.channels.size());
    for (size_t i = 0; i < f.channels.size(); i++) {
        chs[i] = Number::New(env, f.channels[i]);
    }
    obj.Set("channels", chs);
    return obj;
}

Napi::Value SerialSetLoadPattern(const CallbackInfo& info) {
    Env env = info.Env();
    std::lock_guard<std::mutex> lock(g_mutex);
    if (!g_serial) return Boolean::New(env, false);
    double amp = info[0].IsNumber() ? info[0].As<Number>().DoubleValue() : 100;
    double freq = info[1].IsNumber() ? info[1].As<Number>().DoubleValue() : 0.1;
    int type = info[2].IsNumber() ? info[2].As<Number>().Int32Value() : 0;
    g_serial->setLoadPattern(amp, freq, type);
    return Boolean::New(env, true);
}

Napi::Value SerialInjectFault(const CallbackInfo& info) {
    Env env = info.Env();
    std::lock_guard<std::mutex> lock(g_mutex);
    if (!g_serial) return Boolean::New(env, false);
    int channel = info[0].As<Number>().Int32Value();
    double mult = info[1].IsNumber() ? info[1].As<Number>().DoubleValue() : 1.0;
    g_serial->injectFault(channel, mult);
    return Boolean::New(env, true);
}

Napi::Value SerialListPorts(const CallbackInfo& info) {
    Env env = info.Env();
    auto ports = SerialSimulator::listVirtualPorts();
    Array arr = Array::New(env, ports.size());
    for (size_t i = 0; i < ports.size(); i++) {
        arr[i] = String::New(env, ports[i]);
    }
    return arr;
}

#ifndef NO_SQLITE_CPP

Napi::Value DBOpen(const CallbackInfo& info) {
    Env env = info.Env();
    std::lock_guard<std::mutex> lock(g_mutex);
    if (!g_db) g_db = std::make_unique<SQLiteDataAccess>();
    std::string path = info[0].IsString() ? info[0].As<String>().Utf8Value() : "monitor.db";
    bool ok = g_db->open(path);
    if (ok) g_db->initSchema();
    return Boolean::New(env, ok);
}

Napi::Value DBClose(const CallbackInfo& info) {
    Env env = info.Env();
    std::lock_guard<std::mutex> lock(g_mutex);
    if (g_db) g_db->close();
    return env.Undefined();
}

Napi::Value DBInsertStrainBatch(const CallbackInfo& info) {
    Env env = info.Env();
    if (!g_db) return Boolean::New(env, false);
    if (!info[0].IsArray()) return Boolean::New(env, false);

    Array arr = info[0].As<Array>();
    std::vector<StrainRecord> records;
    records.reserve(arr.Length());
    for (uint32_t i = 0; i < arr.Length(); i++) {
        if (!arr[i].IsObject()) {
            Object o = arr[i].As<Object>();
            StrainRecord r{};
            r.timestamp = o.Has("timestamp") ? (uint64_t)o.Get("timestamp").As<BigInt>().Int64Value() : 0;
            r.frameId = o.Has("frameId") ? o.Get("frameId").As<Number>().Int32Value() : 0;
            r.channel = o.Has("channel") ? o.Get("channel").As<Number>().Int32Value() : 0;
            r.strainValue = o.Has("strainValue") ? o.Get("strainValue").As<Number>().DoubleValue() : 0;
            r.sectionId = o.Has("sectionId") ? o.Get("sectionId").As<Number>().Int32Value() : -1;
            records.push_back(r);
        }
    }
    return Boolean::New(env, g_db->insertStrainBatch(records));
}

Napi::Value DBSaveSnapshot(const CallbackInfo& info) {
    Env env = info.Env();
    if (!g_db || !info[0].IsObject()) return Boolean::New(env, false);
    Object o = info[0].As<Object>();
    StressSnapshot s{};
    s.timestamp = o.Has("timestamp") ? (uint64_t)o.Get("timestamp").As<BigInt>().Int64Value() : 0;
    s.sectionId = o.Has("sectionId") ? o.Get("sectionId").As<Number>().Int32Value() : -1;
    s.maxVonMises = o.Has("maxVonMises") ? o.Get("maxVonMises").As<Number>().DoubleValue() : 0;
    s.avgVonMises = o.Has("avgVonMises") ? o.Get("avgVonMises").As<Number>().DoubleValue() : 0;
    s.utilizationRatio = o.Has("utilizationRatio") ? o.Get("utilizationRatio").As<Number>().DoubleValue() : 0;
    s.status = o.Has("status") ? o.Get("status").As<Number>().Int32Value() : 0;
    if (o.Has("elemVonMises") && o.Get("elemVonMises").IsArray()) {
        Array ea = o.Get("elemVonMises").As<Array>();
        s.elemVonMises.reserve(ea.Length());
        for (uint32_t i = 0; i < ea.Length(); i++) {
            s.elemVonMises.push_back(ea[i].As<Number>().DoubleValue());
        }
    }
    return Boolean::New(env, g_db->saveStressSnapshot(s));
}

Napi::Value DBQuerySnapshots(const CallbackInfo& info) {
    Env env = info.Env();
    if (!g_db) return Array::New(env, 0);
    uint64_t start = info[0].IsBigInt() ? (uint64_t)info[0].As<BigInt>().Int64Value() : 0;
    uint64_t end = info[1].IsBigInt() ? (uint64_t)info[1].As<BigInt>().Int64Value() : 0;
    int secId = info.Length() > 2 && info[2].IsNumber() ? info[2].As<Number>().Int32Value() : -1;
    auto snaps = g_db->queryStressByTime(start, end, secId);
    Array result = Array::New(env, snaps.size());
    for (size_t i = 0; i < snaps.size(); i++) {
        Object o = Object::New(env);
        o.Set("id", Number::New(env, (double)snaps[i].id));
        o.Set("timestamp", BigInt::New(env, snaps[i].timestamp));
        o.Set("sectionId", Number::New(env, snaps[i].sectionId));
        o.Set("maxVonMises", Number::New(env, snaps[i].maxVonMises));
        o.Set("avgVonMises", Number::New(env, snaps[i].avgVonMises));
        o.Set("utilizationRatio", Number::New(env, snaps[i].utilizationRatio));
        o.Set("status", Number::New(env, snaps[i].status));
        Array evm = Array::New(env, snaps[i].elemVonMises.size());
        for (size_t j = 0; j < snaps[i].elemVonMises.size(); j++) {
            evm[j] = Number::New(env, snaps[i].elemVonMises[j]);
        }
        o.Set("elemVonMises", evm);
        result[i] = o;
    }
    return result;
}

Napi::Value DBInsertSection(const CallbackInfo& info) {
    Env env = info.Env();
    if (!g_db || !info[0].IsObject()) return Number::New(env, -1);
    Object o = info[0].As<Object>();
    SectionInfo s{};
    s.name = o.Has("name") ? o.Get("name").As<String>().Utf8Value() : "";
    s.memberType = o.Has("memberType") ? o.Get("memberType").As<String>().Utf8Value() : "beam";
    s.width = o.Has("width") ? o.Get("width").As<Number>().DoubleValue() : 0;
    s.height = o.Has("height") ? o.Get("height").As<Number>().DoubleValue() : 0;
    s.length = o.Has("length") ? o.Get("length").As<Number>().DoubleValue() : 0;
    s.positionX = o.Has("positionX") ? o.Get("positionX").As<Number>().DoubleValue() : 0;
    s.positionY = o.Has("positionY") ? o.Get("positionY").As<Number>().DoubleValue() : 0;
    s.positionZ = o.Has("positionZ") ? o.Get("positionZ").As<Number>().DoubleValue() : 0;
    s.material = o.Has("material") ? o.Get("material").As<String>().Utf8Value() : "Pine";
    s.notes = o.Has("notes") ? o.Get("notes").As<String>().Utf8Value() : "";
    int id = g_db->insertSection(s);
    return Number::New(env, id);
}

Napi::Value DBGetAllSections(const CallbackInfo& info) {
    Env env = info.Env();
    if (!g_db) return Array::New(env, 0);
    auto sections = g_db->getAllSections();
    Array result = Array::New(env, sections.size());
    for (size_t i = 0; i < sections.size(); i++) {
        Object o = Object::New(env);
        o.Set("id", Number::New(env, sections[i].id));
        o.Set("name", String::New(env, sections[i].name));
        o.Set("memberType", String::New(env, sections[i].memberType));
        o.Set("width", Number::New(env, sections[i].width));
        o.Set("height", Number::New(env, sections[i].height));
        o.Set("length", Number::New(env, sections[i].length));
        o.Set("positionX", Number::New(env, sections[i].positionX));
        o.Set("positionY", Number::New(env, sections[i].positionY));
        o.Set("positionZ", Number::New(env, sections[i].positionZ));
        o.Set("material", String::New(env, sections[i].material));
        o.Set("notes", String::New(env, sections[i].notes));
        result[i] = o;
    }
    return result;
}

Napi::Value DBGetSection(const CallbackInfo& info) {
    Env env = info.Env();
    if (!g_db) return env.Null();
    int id = info[0].As<Number>().Int32Value();
    auto sec = g_db->getSection(id);
    if (!sec) return env.Null();
    Object o = Object::New(env);
    o.Set("id", Number::New(env, sec->id));
    o.Set("name", String::New(env, sec->name));
    o.Set("memberType", String::New(env, sec->memberType));
    o.Set("width", Number::New(env, sec->width));
    o.Set("height", Number::New(env, sec->height));
    o.Set("length", Number::New(env, sec->length));
    o.Set("positionX", Number::New(env, sec->positionX));
    o.Set("positionY", Number::New(env, sec->positionY));
    o.Set("positionZ", Number::New(env, sec->positionZ));
    o.Set("material", String::New(env, sec->material));
    o.Set("notes", String::New(env, sec->notes));
    return o;
}

Napi::Value DBInsertGauge(const CallbackInfo& info) {
    Env env = info.Env();
    if (!g_db || !info[0].IsObject()) return Number::New(env, -1);
    Object o = info[0].As<Object>();
    GaugeConfig g{};
    g.channel = o.Has("channel") ? o.Get("channel").As<Number>().Int32Value() : 0;
    g.sectionId = o.Has("sectionId") ? o.Get("sectionId").As<Number>().Int32Value() : -1;
    g.posX = o.Has("posX") ? o.Get("posX").As<Number>().DoubleValue() : 0;
    g.posY = o.Has("posY") ? o.Get("posY").As<Number>().DoubleValue() : 0;
    g.posZ = o.Has("posZ") ? o.Get("posZ").As<Number>().DoubleValue() : 0;
    g.angle = o.Has("angle") ? o.Get("angle").As<Number>().DoubleValue() : 0;
    g.gaugeType = o.Has("gaugeType") ? o.Get("gaugeType").As<String>().Utf8Value() : "unidirectional";
    g.resistance = o.Has("resistance") ? o.Get("resistance").As<Number>().DoubleValue() : 120;
    g.gaugeFactor = o.Has("gaugeFactor") ? o.Get("gaugeFactor").As<Number>().DoubleValue() : 2.0;
    int id = g_db->insertGauge(g);
    return Number::New(env, id);
}

Napi::Value DBGetGaugesBySection(const CallbackInfo& info) {
    Env env = info.Env();
    if (!g_db) return Array::New(env, 0);
    int sid = info[0].As<Number>().Int32Value();
    auto gauges = g_db->getGaugesBySection(sid);
    Array result = Array::New(env, gauges.size());
    for (size_t i = 0; i < gauges.size(); i++) {
        Object o = Object::New(env);
        o.Set("id", Number::New(env, gauges[i].id));
        o.Set("channel", Number::New(env, gauges[i].channel));
        o.Set("sectionId", Number::New(env, gauges[i].sectionId));
        o.Set("posX", Number::New(env, gauges[i].posX));
        o.Set("posY", Number::New(env, gauges[i].posY));
        o.Set("posZ", Number::New(env, gauges[i].posZ));
        o.Set("angle", Number::New(env, gauges[i].angle));
        o.Set("gaugeType", String::New(env, gauges[i].gaugeType));
        o.Set("resistance", Number::New(env, gauges[i].resistance));
        o.Set("gaugeFactor", Number::New(env, gauges[i].gaugeFactor));
        result[i] = o;
    }
    return result;
}

Napi::Value DBGetAllGauges(const CallbackInfo& info) {
    Env env = info.Env();
    if (!g_db) return Array::New(env, 0);
    auto gauges = g_db->getAllGauges();
    Array result = Array::New(env, gauges.size());
    for (size_t i = 0; i < gauges.size(); i++) {
        Object o = Object::New(env);
        o.Set("id", Number::New(env, gauges[i].id));
        o.Set("channel", Number::New(env, gauges[i].channel));
        o.Set("sectionId", Number::New(env, gauges[i].sectionId));
        o.Set("posX", Number::New(env, gauges[i].posX));
        o.Set("posY", Number::New(env, gauges[i].posY));
        o.Set("posZ", Number::New(env, gauges[i].posZ));
        o.Set("angle", Number::New(env, gauges[i].angle));
        o.Set("gaugeType", String::New(env, gauges[i].gaugeType));
        o.Set("resistance", Number::New(env, gauges[i].resistance));
        o.Set("gaugeFactor", Number::New(env, gauges[i].gaugeFactor));
        result[i] = o;
    }
    return result;
}

#endif

Object Init(Env env, Object exports, Object module) {
    exports.Set("feCreateSection", Function::New(env, FESolverCreateSection));
    exports.Set("feSolveInverse", Function::New(env, FESolveInverse));
    exports.Set("safetyEvaluate", Function::New(env, SafetyEvaluate));
    exports.Set("serialStart", Function::New(env, SerialStart));
    exports.Set("serialStop", Function::New(env, SerialStop));
    exports.Set("serialReadFrame", Function::New(env, SerialReadFrame));
    exports.Set("serialSetLoadPattern", Function::New(env, SerialSetLoadPattern));
    exports.Set("serialInjectFault", Function::New(env, SerialInjectFault));
    exports.Set("serialListPorts", Function::New(env, SerialListPorts));
#ifndef NO_SQLITE_CPP
    exports.Set("dbOpen", Function::New(env, DBOpen));
    exports.Set("dbClose", Function::New(env, DBClose));
    exports.Set("dbInsertStrainBatch", Function::New(env, DBInsertStrainBatch));
    exports.Set("dbSaveSnapshot", Function::New(env, DBSaveSnapshot));
    exports.Set("dbQuerySnapshots", Function::New(env, DBQuerySnapshots));
    exports.Set("dbInsertSection", Function::New(env, DBInsertSection));
    exports.Set("dbGetAllSections", Function::New(env, DBGetAllSections));
    exports.Set("dbGetSection", Function::New(env, DBGetSection));
    exports.Set("dbInsertGauge", Function::New(env, DBInsertGauge));
    exports.Set("dbGetGaugesBySection", Function::New(env, DBGetGaugesBySection));
    exports.Set("dbGetAllGauges", Function::New(env, DBGetAllGauges));
#endif
    return exports;
}

NODE_API_MODULE(wood_stress_native, Init)

}
