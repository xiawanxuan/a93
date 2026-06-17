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

struct QuadElement {
    std::array<int, 4> nodeIds;
    int id;
    double E;
    double nu;
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
};

}

#endif
