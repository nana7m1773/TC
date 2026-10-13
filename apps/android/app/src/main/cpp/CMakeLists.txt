cmake_minimum_required(VERSION 3.22.1)
project(muyu_inference LANGUAGES C CXX)
# APK is debug signed for sideloading; inference kernels still need production optimization.
set(CMAKE_C_FLAGS_DEBUG "-O3" CACHE STRING "" FORCE)
set(CMAKE_CXX_FLAGS_DEBUG "-O3" CACHE STRING "" FORCE)
if(NOT EXISTS "${LLAMA_SOURCE_DIR}/include/llama.h")
  message(FATAL_ERROR "Pinned llama.cpp b11429 source is required. Run scripts/build-android.sh or provide LLAMA_SOURCE_DIR.")
endif()
set(BUILD_SHARED_LIBS OFF CACHE BOOL "" FORCE)
set(LLAMA_BUILD_TESTS OFF CACHE BOOL "" FORCE)
set(LLAMA_BUILD_TOOLS OFF CACHE BOOL "" FORCE)
set(LLAMA_BUILD_EXAMPLES OFF CACHE BOOL "" FORCE)
set(LLAMA_BUILD_SERVER OFF CACHE BOOL "" FORCE)
set(LLAMA_BUILD_COMMON ON CACHE BOOL "" FORCE)
set(LLAMA_BUILD_MTMD ON CACHE BOOL "" FORCE)
set(MTMD_VIDEO OFF CACHE BOOL "" FORCE)
set(LLAMA_OPENSSL OFF CACHE BOOL "" FORCE)
set(LLAMA_SUBPROCESS OFF CACHE BOOL "" FORCE)
set(LLAMA_CURL OFF CACHE BOOL "" FORCE)
set(GGML_NATIVE OFF CACHE BOOL "" FORCE)
set(GGML_OPENMP OFF CACHE BOOL "" FORCE)
set(GGML_BACKEND_DL OFF CACHE BOOL "" FORCE)
set(CMAKE_POSITION_INDEPENDENT_CODE ON)
add_subdirectory("${LLAMA_SOURCE_DIR}" llama-build EXCLUDE_FROM_ALL)
add_library(muyu-inference SHARED inference.cpp)
target_compile_features(muyu-inference PRIVATE cxx_std_17)
target_link_libraries(muyu-inference PRIVATE mtmd llama-common llama android log)
target_link_options(muyu-inference PRIVATE "-Wl,--exclude-libs,ALL")

# Keep whisper's pinned GGML build separate from llama's pinned GGML build.
include(ExternalProject)
set(SPEECH_BINARY_DIR "${CMAKE_BINARY_DIR}/speech-native")
ExternalProject_Add(muyu-speech-build
    SOURCE_DIR "${CMAKE_CURRENT_SOURCE_DIR}/speech-engine"
    BINARY_DIR "${SPEECH_BINARY_DIR}"
    CMAKE_ARGS
        "-DCMAKE_TOOLCHAIN_FILE=${CMAKE_TOOLCHAIN_FILE}"
        "-DCMAKE_MAKE_PROGRAM=${CMAKE_MAKE_PROGRAM}"
        "-DCMAKE_BUILD_TYPE=Release"
        "-DANDROID_ABI=${ANDROID_ABI}"
        "-DANDROID_PLATFORM=${ANDROID_PLATFORM}"
        "-DANDROID_STL=c++_shared"
        "-DWHISPER_SOURCE_DIR=${WHISPER_SOURCE_DIR}"
    BUILD_COMMAND "${CMAKE_COMMAND}" --build <BINARY_DIR> --target muyu-speech --parallel 2
    BUILD_ALWAYS TRUE
    BUILD_BYPRODUCTS "${SPEECH_BINARY_DIR}/libmuyu-speech.so"
    INSTALL_COMMAND ""
)
set_property(DIRECTORY APPEND PROPERTY CMAKE_CONFIGURE_DEPENDS "${CMAKE_CURRENT_SOURCE_DIR}/speech.cpp" "${CMAKE_CURRENT_SOURCE_DIR}/speech-engine/CMakeLists.txt")
add_library(muyu-speech SHARED IMPORTED)
set_target_properties(muyu-speech PROPERTIES IMPORTED_LOCATION "${SPEECH_BINARY_DIR}/libmuyu-speech.so")
add_dependencies(muyu-speech muyu-speech-build)
add_dependencies(muyu-inference muyu-speech-build)
target_link_libraries(muyu-inference PRIVATE muyu-speech)
