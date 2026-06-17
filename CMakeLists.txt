cmake_minimum_required(VERSION 3.15)
project(wood_stress_native CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_POSITION_INDEPENDENT_CODE ON)

if(MSVC)
    add_compile_options(/W3 /O2)
else()
    add_compile_options(-Wall -O2)
endif()

include_directories(${CMAKE_JS_INC})
include_directories(${CMAKE_CURRENT_SOURCE_DIR}/src/cpp)

find_package(Eigen3 3.3 QUIET)
if(NOT Eigen3_FOUND)
    message(STATUS "Eigen3 not found via find_package, checking include paths...")
    if(DEFINED ENV{EIGEN3_INCLUDE_DIR})
        include_directories($ENV{EIGEN3_INCLUDE_DIR})
        message(STATUS "Using EIGEN3_INCLUDE_DIR: $ENV{EIGEN3_INCLUDE_DIR}")
    else()
        set(EIGEN_FALLBACK "${CMAKE_CURRENT_SOURCE_DIR}/third_party/eigen3")
        if(EXISTS "${EIGEN_FALLBACK}")
            include_directories(${EIGEN_FALLBACK})
            message(STATUS "Using bundled Eigen at ${EIGEN_FALLBACK}")
        else()
            message(FATAL_ERROR "Eigen3 not found. Please install Eigen3 or set EIGEN3_INCLUDE_DIR environment variable.")
        endif()
    endif()
else()
    message(STATUS "Found Eigen3: ${EIGEN3_INCLUDE_DIR}")
endif()

find_path(SQLITE3_INCLUDE_DIR sqlite3.h
    PATHS
        $ENV{SQLITE3_INCLUDE_DIR}
        /usr/include
        /usr/local/include
        ${CMAKE_CURRENT_SOURCE_DIR}/third_party/sqlite3
)

find_library(SQLITE3_LIBRARY NAMES sqlite3 sqlite3.lib
    PATHS
        $ENV{SQLITE3_LIB_DIR}
        /usr/lib
        /usr/local/lib
        ${CMAKE_CURRENT_SOURCE_DIR}/third_party/sqlite3
)

if(NOT SQLITE3_INCLUDE_DIR)
    message(WARNING "SQLite3 include not found, building without SQLite support in C++ layer")
    add_definitions(-DNO_SQLITE_CPP)
else()
    include_directories(${SQLITE3_INCLUDE_DIR})
endif()

set(CPP_SOURCES
    src/cpp/FESolver.cpp
    src/cpp/SafetyEvaluator.cpp
    src/cpp/SerialSimulator.cpp
    native_addon.cc
)

if(SQLITE3_LIBRARY OR SQLITE3_INCLUDE_DIR)
    list(APPEND CPP_SOURCES src/cpp/SQLiteDataAccess.cpp)
endif()

add_library(${PROJECT_NAME} SHARED ${CPP_SOURCES} ${CMAKE_JS_SRC})

set_target_properties(${PROJECT_NAME} PROPERTIES
    PREFIX ""
    SUFFIX ".node"
)

target_link_libraries(${PROJECT_NAME}
    ${CMAKE_JS_LIB}
    ${SQLITE3_LIBRARY}
)

target_include_directories(${PROJECT_NAME} PRIVATE
    ${CMAKE_CURRENT_SOURCE_DIR}/node_modules/node-addon-api
)

if(MSVC AND CMAKE_JS_NODELIB_DEF AND CMAKE_JS_NODELIB_TARGET)
    execute_process(COMMAND node -e "require('${CMAKE_JS_NODELIB_DEF}').nodeLib('${CMAKE_JS_NODELIB_TARGET}', '${CMAKE_JS_ARCH}')")
endif()
