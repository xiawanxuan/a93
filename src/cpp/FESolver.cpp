#include "FESolver.h"
#include <Eigen/Dense>
#include <Eigen/SparseLU>
#include <Eigen/IterativeLinearSolvers>
#include <chrono>
#include <cmath>
#include <algorithm>

namespace WoodStress {

FESolver::FESolver() = default;
FESolver::~FESolver() = default;

CrossSection FESolver::createRectangularSection(
    double width, double height, int divX, int divY, double E, double nu) {
    CrossSection section;
    section.width = width;
    section.height = height;
    section.divX = divX;
    section.divY = divY;

    int nodeCount = (divX + 1) * (divY + 1);
    section.nodes.reserve(nodeCount);

    for (int j = 0; j <= divY; j++) {
        for (int i = 0; i <= divX; i++) {
            Node2D node;
            node.x = (i * width) / divX;
            node.y = (j * height) / divY;
            node.id = j * (divX + 1) + i;
            section.nodes.push_back(node);
        }
    }

    int elemCount = divX * divY;
    section.elements.reserve(elemCount);

    for (int j = 0; j < divY; j++) {
        for (int i = 0; i < divX; i++) {
            QuadElement elem;
            elem.id = j * divX + i;
            elem.nodeIds[0] = j * (divX + 1) + i;
            elem.nodeIds[1] = j * (divX + 1) + (i + 1);
            elem.nodeIds[2] = (j + 1) * (divX + 1) + (i + 1);
            elem.nodeIds[3] = (j + 1) * (divX + 1) + i;
            elem.E = E;
            elem.nu = nu;
            section.elements.push_back(elem);
        }
    }

    return section;
}

void FESolver::addGauge(CrossSection& section, int id, int channel,
                        double x, double y, double angle_deg) {
    StrainGauge gauge;
    gauge.id = id;
    gauge.channel = channel;
    gauge.x = x;
    gauge.y = y;
    gauge.angle = angle_deg * M_PI / 180.0;
    section.gauges.push_back(gauge);
}

bool FESolver::initializeCrossSection(CrossSection& section) {
    return !section.nodes.empty() && !section.elements.empty();
}

Eigen::VectorXd FESolver::shapeFunctions(double xi, double eta) const {
    Eigen::VectorXd N(4);
    N(0) = 0.25 * (1 - xi) * (1 - eta);
    N(1) = 0.25 * (1 + xi) * (1 - eta);
    N(2) = 0.25 * (1 + xi) * (1 + eta);
    N(3) = 0.25 * (1 - xi) * (1 + eta);
    return N;
}

Eigen::MatrixXd FESolver::shapeFunctionDerivatives(double xi, double eta) const {
    Eigen::MatrixXd dN(4, 2);
    dN(0, 0) = -0.25 * (1 - eta);
    dN(0, 1) = -0.25 * (1 - xi);
    dN(1, 0) = 0.25 * (1 - eta);
    dN(1, 1) = -0.25 * (1 + xi);
    dN(2, 0) = 0.25 * (1 + eta);
    dN(2, 1) = 0.25 * (1 + xi);
    dN(3, 0) = -0.25 * (1 + eta);
    dN(3, 1) = 0.25 * (1 - xi);
    return dN;
}

Eigen::MatrixXd FESolver::buildStrainDisplacementMatrix(
    const QuadElement& elem, const std::vector<Node2D>& nodes,
    double xi, double eta) const {
    Eigen::MatrixXd dN = shapeFunctionDerivatives(xi, eta);
    Eigen::MatrixXd J(2, 2);
    J.setZero();

    for (int a = 0; a < 4; a++) {
        const Node2D& nd = nodes[elem.nodeIds[a]];
        J(0, 0) += dN(a, 0) * nd.x;
        J(0, 1) += dN(a, 0) * nd.y;
        J(1, 0) += dN(a, 1) * nd.x;
        J(1, 1) += dN(a, 1) * nd.y;
    }

    double detJ = J.determinant();
    Eigen::MatrixXd Jinv = J.inverse();
    Eigen::MatrixXd dNxy = dN * Jinv;

    Eigen::MatrixXd B(3, 8);
    B.setZero();
    for (int a = 0; a < 4; a++) {
        int idx = a * 2;
        B(0, idx)     = dNxy(a, 0);
        B(1, idx + 1) = dNxy(a, 1);
        B(2, idx)     = dNxy(a, 1);
        B(2, idx + 1) = dNxy(a, 0);
    }
    return B;
}

Eigen::MatrixXd FESolver::buildConstitutiveMatrix(double E, double nu) const {
    Eigen::MatrixXd D(3, 3);
    double factor = E / (1 - nu * nu);
    D << 1.0,  nu,   0.0,
         nu,   1.0,  0.0,
         0.0,  0.0,  0.5 * (1 - nu);
    return D * factor;
}

Eigen::MatrixXd FESolver::buildElementStiffness(
    const QuadElement& elem, const std::vector<Node2D>& nodes) const {
    Eigen::MatrixXd Ke(8, 8);
    Ke.setZero();

    Eigen::MatrixXd D = buildConstitutiveMatrix(elem.E, elem.nu);

    std::vector<double> gauss_pts = {-0.5773502691896257, 0.5773502691896257};
    std::vector<double> gauss_wts = {1.0, 1.0};

    for (double xi : gauss_pts) {
        for (double eta : gauss_pts) {
            Eigen::MatrixXd dN = shapeFunctionDerivatives(xi, eta);
            Eigen::MatrixXd J(2, 2);
            J.setZero();
            for (int a = 0; a < 4; a++) {
                const Node2D& nd = nodes[elem.nodeIds[a]];
                J(0, 0) += dN(a, 0) * nd.x;
                J(0, 1) += dN(a, 0) * nd.y;
                J(1, 0) += dN(a, 1) * nd.x;
                J(1, 1) += dN(a, 1) * nd.y;
            }
            double detJ = J.determinant();
            Eigen::MatrixXd B = buildStrainDisplacementMatrix(elem, nodes, xi, eta);
            Ke += B.transpose() * D * B * detJ;
        }
    }
    return Ke;
}

Eigen::SparseMatrix<double> FESolver::buildGlobalStiffness(
    const CrossSection& section) const {
    int nNodes = static_cast<int>(section.nodes.size());
    int nDofs = nNodes * 2;

    using Triplet = Eigen::Triplet<double>;
    std::vector<Triplet> tripletList;
    tripletList.reserve(section.elements.size() * 64);

    for (const QuadElement& elem : section.elements) {
        Eigen::MatrixXd Ke = buildElementStiffness(elem, section.nodes);
        for (int a = 0; a < 4; a++) {
            for (int b = 0; b < 4; b++) {
                int nodeA = elem.nodeIds[a];
                int nodeB = elem.nodeIds[b];
                for (int da = 0; da < 2; da++) {
                    for (int db = 0; db < 2; db++) {
                        int row = nodeA * 2 + da;
                        int col = nodeB * 2 + db;
                        tripletList.emplace_back(row, col, Ke(a * 2 + da, b * 2 + db));
                    }
                }
            }
        }
    }

    Eigen::SparseMatrix<double> K(nDofs, nDofs);
    K.setFromTriplets(tripletList.begin(), tripletList.end());
    return K;
}

std::vector<int> FESolver::getBoundaryNodeIds(const CrossSection& section) const {
    std::vector<int> boundary;
    for (const Node2D& nd : section.nodes) {
        if (std::abs(nd.y) < 1e-9) {
            boundary.push_back(nd.id);
        }
    }
    return boundary;
}

Eigen::MatrixXd FESolver::buildGaugeInterpolationMatrix(
    const CrossSection& section) const {
    int nGauges = static_cast<int>(section.gauges.size());
    int nNodes = static_cast<int>(section.nodes.size());
    Eigen::MatrixXd G(nGauges, nNodes * 2);
    G.setZero();

    for (int g = 0; g < nGauges; g++) {
        const StrainGauge& gauge = section.gauges[g];
        for (const QuadElement& elem : section.elements) {
            const Node2D& n0 = section.nodes[elem.nodeIds[0]];
            const Node2D& n2 = section.nodes[elem.nodeIds[2]];
            if (gauge.x >= n0.x - 1e-9 && gauge.x <= n2.x + 1e-9 &&
                gauge.y >= n0.y - 1e-9 && gauge.y <= n2.y + 1e-9) {
                double dx = n2.x - n0.x;
                double dy = n2.y - n0.y;
                double xi = dx > 1e-9 ? 2.0 * (gauge.x - n0.x) / dx - 1.0 : 0.0;
                double eta = dy > 1e-9 ? 2.0 * (gauge.y - n0.y) / dy - 1.0 : 0.0;

                Eigen::MatrixXd B = buildStrainDisplacementMatrix(elem, section.nodes, xi, eta);
                double c = std::cos(gauge.angle);
                double s = std::sin(gauge.angle);
                Eigen::RowVector3d strainTransform;
                strainTransform << c * c, s * s, 2.0 * c * s;
                Eigen::RowVectorXd transformed = strainTransform * B;

                for (int a = 0; a < 4; a++) {
                    int nodeId = elem.nodeIds[a];
                    G(g, nodeId * 2)     = transformed(a * 2);
                    G(g, nodeId * 2 + 1) = transformed(a * 2 + 1);
                }
                break;
            }
        }
    }
    return G;
}

Eigen::VectorXd FESolver::interpolateNodeStrains(
    const CrossSection& section,
    const std::map<int, double>& gaugeStrains) const {
    int nNodes = static_cast<int>(section.nodes.size());
    Eigen::VectorXd measuredStrains = Eigen::VectorXd::Zero(section.gauges.size());
    Eigen::MatrixXd G = buildGaugeInterpolationMatrix(section);

    int validGauges = 0;
    for (size_t g = 0; g < section.gauges.size(); g++) {
        auto it = gaugeStrains.find(section.gauges[g].channel);
        if (it != gaugeStrains.end()) {
            measuredStrains(g) = it->second;
            validGauges++;
        }
    }

    int nDofs = nNodes * 2;
    Eigen::SparseMatrix<double> K = buildGlobalStiffness(section);
    Eigen::SparseMatrix<double> Ksparse = K.sparseView();

    Eigen::SparseMatrix<double> Gsparse = G.sparseView();

    double lambda = 1e-4;
    Eigen::SparseMatrix<double> GtG = Gsparse.transpose() * Gsparse;
    Eigen::SparseMatrix<double> lhs = lambda * Ksparse + GtG;
    Eigen::VectorXd rhs = Gsparse.transpose() * measuredStrains;

    std::vector<int> bcNodes = getBoundaryNodeIds(section);
    for (int nid : bcNodes) {
        for (int d = 0; d < 2; d++) {
            int dof = nid * 2 + d;
            for (Eigen::SparseMatrix<double>::InnerIterator it(lhs, dof); it; ++it) {
                if (it.row() != it.col()) {
                    rhs(it.row()) -= it.value() * 0.0;
                }
            }
            lhs.prune([dof](int r, int c, double) { return r != dof && c != dof; });
            lhs.insert(dof, dof) = 1.0;
            rhs(dof) = 0.0;
        }
    }
    lhs.makeCompressed();

    Eigen::SparseLU<Eigen::SparseMatrix<double>> solver;
    solver.compute(lhs);
    if (solver.info() != Eigen::Success) {
        Eigen::BiCGSTAB<Eigen::SparseMatrix<double>> fallbackSolver;
        fallbackSolver.setTolerance(1e-10);
        fallbackSolver.compute(lhs);
        return fallbackSolver.solve(rhs);
    }
    return solver.solve(rhs);
}

double FESolver::computeVonMises(double sxx, double syy, double sxy) const {
    return std::sqrt(sxx * sxx - sxx * syy + syy * syy + 3.0 * sxy * sxy);
}

FEResult FESolver::computeStresses(
    const CrossSection& section,
    const Eigen::VectorXd& displacements) const {
    FEResult result;
    int nNodes = static_cast<int>(section.nodes.size());
    int nElems = static_cast<int>(section.elements.size());

    result.nodeStressXX = Eigen::VectorXd::Zero(nNodes);
    result.nodeStressYY = Eigen::VectorXd::Zero(nNodes);
    result.nodeStressXY = Eigen::VectorXd::Zero(nNodes);
    result.nodeVonMises = Eigen::VectorXd::Zero(nNodes);
    result.elemVonMises = Eigen::VectorXd::Zero(nElems);

    Eigen::VectorXi nodeCount = Eigen::VectorXi::Zero(nNodes);

    double maxVM = 0.0;
    double sumVM = 0.0;

    for (size_t e = 0; e < section.elements.size(); e++) {
        const QuadElement& elem = section.elements[e];
        Eigen::MatrixXd D = buildConstitutiveMatrix(elem.E, elem.nu);
        Eigen::VectorXd ue(8);
        for (int a = 0; a < 4; a++) {
            ue(a * 2)     = displacements(elem.nodeIds[a] * 2);
            ue(a * 2 + 1) = displacements(elem.nodeIds[a] * 2 + 1);
        }

        double eSxx = 0, eSyy = 0, eSxy = 0;
        std::vector<double> gauss_pts = {-0.5773502691896257, 0.5773502691896257};

        for (double xi : gauss_pts) {
            for (double eta : gauss_pts) {
                Eigen::MatrixXd B = buildStrainDisplacementMatrix(elem, section.nodes, xi, eta);
                Eigen::VectorXd strain = B * ue;
                Eigen::VectorXd stress = D * strain;
                eSxx += stress(0) * 0.25;
                eSyy += stress(1) * 0.25;
                eSxy += stress(2) * 0.25;
            }
        }

        double elemVM = computeVonMises(eSxx, eSyy, eSxy);
        result.elemVonMises(e) = elemVM;
        maxVM = std::max(maxVM, elemVM);
        sumVM += elemVM;

        for (int a = 0; a < 4; a++) {
            int nid = elem.nodeIds[a];
            result.nodeStressXX(nid) += eSxx;
            result.nodeStressYY(nid) += eSyy;
            result.nodeStressXY(nid) += eSxy;
            nodeCount(nid)++;
        }
    }

    for (int i = 0; i < nNodes; i++) {
        if (nodeCount(i) > 0) {
            result.nodeStressXX(i) /= nodeCount(i);
            result.nodeStressYY(i) /= nodeCount(i);
            result.nodeStressXY(i) /= nodeCount(i);
            result.nodeVonMises(i) = computeVonMises(
                result.nodeStressXX(i),
                result.nodeStressYY(i),
                result.nodeStressXY(i));
        }
    }

    result.maxVonMises = maxVM;
    result.avgVonMises = nElems > 0 ? sumVM / nElems : 0.0;
    return result;
}

FEResult FESolver::solveInverse(
    const CrossSection& section,
    const std::map<int, double>& gaugeStrains) {
    auto t0 = std::chrono::high_resolution_clock::now();

    Eigen::VectorXd displacements = interpolateNodeStrains(section, gaugeStrains);
    FEResult result = computeStresses(section, displacements);

    auto t1 = std::chrono::high_resolution_clock::now();
    result.solveTimeMs = std::chrono::duration<double, std::milli>(t1 - t0).count();
    return result;
}

std::vector<double> FESolver::getElementCenters(const CrossSection& section) const {
    std::vector<double> centers;
    centers.reserve(section.elements.size() * 2);
    for (const QuadElement& elem : section.elements) {
        double cx = 0, cy = 0;
        for (int a = 0; a < 4; a++) {
            cx += section.nodes[elem.nodeIds[a]].x;
            cy += section.nodes[elem.nodeIds[a]].y;
        }
        centers.push_back(cx / 4.0);
        centers.push_back(cy / 4.0);
    }
    return centers;
}

}
