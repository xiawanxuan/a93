#ifndef FE_SOLVER_H
#define FE_SOLVER_H

#include <Eigen/Dense>
#include <Eigen/Sparse>
#include <vector>
#include <array>
#include <string>
#include <map>

namespace WoodStress {

struct Node2D {
    double x, y;
    int id;
};

struct Hole {
    std::vector<Node2D> polygon;
    double margin;
};

struct QuadElement {
    std::array<int, 4> nodeIds;
    int id;
    double E;
    double nu;
    bool isHoleBoundary;
};

struct StrainGauge {
    int id;
    int channel;
    double x, y;
    double angle;
};

struct FEResult {
    Eigen::VectorXd nodeStressXX;
    Eigen::VectorXd nodeStressYY;
    Eigen::VectorXd nodeStressXY;
    Eigen::VectorXd nodeVonMises;
    Eigen::VectorXd elemVonMises;
    double maxVonMises;
    double avgVonMises;
    double solveTimeMs;
};

struct CrossSection {
    double width;
    double height;
    int divX;
    int divY;
    std::vector<Node2D> nodes;
    std::vector<QuadElement> elements;
    std::vector<StrainGauge> gauges;
    std::vector<Hole> holes;
};

class FESolver {
public:
    FESolver();
    ~FESolver();

    bool initializeCrossSection(CrossSection& section);
    FEResult solveInverse(const CrossSection& section,
                          const std::map<int, double>& gaugeStrains);

    CrossSection createRectangularSection(
        double width, double height,
        int divX = 50, int divY = 100,
        double E = 10.0e9, double nu = 0.35);

    void addGauge(CrossSection& section, int id, int channel,
                  double x, double y, double angle_deg);

    void addHole(CrossSection& section, const std::vector<Node2D>& polygon, double margin = 0.02);

    void markHoleBoundaryElements(CrossSection& section) const;

    std::vector<double> getElementCenters(const CrossSection& section) const;

private:
    Eigen::MatrixXd buildStrainDisplacementMatrix(
        const QuadElement& elem, const std::vector<Node2D>& nodes,
        double xi, double eta) const;

    Eigen::MatrixXd buildConstitutiveMatrix(double E, double nu) const;

    Eigen::MatrixXd buildElementStiffness(
        const QuadElement& elem, const std::vector<Node2D>& nodes) const;

    Eigen::VectorXd shapeFunctions(double xi, double eta) const;
    Eigen::MatrixXd shapeFunctionDerivatives(double xi, double eta) const;

    Eigen::SparseMatrix<double> buildGlobalStiffness(
        const CrossSection& section) const;

    std::vector<int> getBoundaryNodeIds(const CrossSection& section) const;

    Eigen::MatrixXd buildGaugeInterpolationMatrix(
        const CrossSection& section) const;

    Eigen::VectorXd interpolateNodeStrains(
        const CrossSection& section,
        const std::map<int, double>& gaugeStrains) const;

    FEResult computeStresses(
        const CrossSection& section,
        const Eigen::VectorXd& displacements) const;

    double computeVonMises(double sxx, double syy, double sxy) const;

    double gaussianWeight(double r, double dm) const;

    Eigen::MatrixXd buildMLSBasisMatrix(double x, double y) const;

    Eigen::MatrixXd buildMLSWeightMatrix(
        const std::vector<Node2D>& nodes,
        const std::vector<int>& supportNodeIds,
        double x, double y, double dm) const;

    Eigen::MatrixXd buildMLSShapeFunction(
        const std::vector<Node2D>& nodes,
        const std::vector<int>& supportNodeIds,
        double x, double y, double dm) const;

    Eigen::MatrixXd buildMLSStrainDisplacementMatrix(
        const CrossSection& section,
        const std::vector<int>& supportNodeIds,
        double x, double y, double dm,
        double gaugeAngle) const;

    std::vector<int> findSupportNodes(
        const std::vector<Node2D>& nodes,
        double x, double y, double dm) const;

    bool isElementNearHole(
        const QuadElement& elem,
        const std::vector<Node2D>& nodes,
        const Hole& hole) const;

    double pointToPolygonDistance(
        double x, double y,
        const std::vector<Node2D>& polygon) const;

    bool isPointInPolygon(
        double x, double y,
        const std::vector<Node2D>& polygon) const;
};

}

#endif
