cmake_minimum_required (VERSION 2.8)

project(unittest)

set (CMAKE_CXX_STANDARD 14)

set (UNITTEST_ROOT_DIR ${CMAKE_CURRENT_LIST_DIR})
set (QJS_ROOT_DIR ${UNITTEST_ROOT_DIR}/../)

set (CMAKE_C_FLAGS "${CMAKE_C_FLAGS} -Werror")
set (CMAKE_CXX_FLAGS "${CMAKE_CXX_FLAGS} -Werror")

if (EXISTS /usr/src/gtest)
    # Use googletest installed in system
    add_subdirectory(/usr/src/gtest ${CMAKE_CURRENT_BINARY_DIR}/gtest)
else ()
    include(FetchContent)
    FetchContent_Declare(
        googletest
        URL https://github.com/google/googletest/archive/609281088cfefc76f9d0ce82e1ff6c30cc3591e5.zip
    )

    message("Fetching googletest ...")
    FetchContent_MakeAvailable(googletest)
endif()

include(GoogleTest)
enable_testing()

# add lcov support commands
set(CMAKE_C_FLAGS "-fprofile-arcs -ftest-coverage ${CMAKE_C_FLAGS}")
set(CMAKE_CXX_FLAGS "-fprofile-arcs -ftest-coverage ${CMAKE_CXX_FLAGS}")

add_custom_command(OUTPUT cov-display
    COMMAND lcov -d . -c -o "test.info"
    COMMAND lcov --remove test.info '/usr/*' -o test.info
    COMMAND lcov --remove test.info '*/test/*' -o test.info
    COMMAND lcov --remove test.info '*/quickjs/*' -o test.info
    COMMAND genhtml test.info -o result
    COMMENT "generate html"
)
add_custom_target(cov-test DEPENDS cov-display)

if (DEFINED UNITTEST_USE_SANITIZER)
    message("Sanitizer enabled")
    if (UNITTEST_USE_SANITIZER EQUAL 1)
        set(CMAKE_C_FLAGS "${CMAKE_C_FLAGS} -fsanitize=signed-integer-overflow  \
                          -fsanitize=undefined -fsanitize=address  \
                          -fno-sanitize=bounds,bounds-strict,alignment \
                          -fno-sanitize-recover")
        set(CMAKE_CXX_FLAGS "${CMAKE_CXX_FLAGS} -fsanitize=signed-integer-overflow  \
                          -fsanitize=undefined -fsanitize=address  \
                          -fno-sanitize=bounds,bounds-strict,alignment \
                          -fno-sanitize-recover")
    endif ()
endif ()

add_subdirectory(${QJS_ROOT_DIR} ${CMAKE_CURRENT_BINARY_DIR}/libdyntype)
include_directories(${QJS_ROOT_DIR})

add_executable(
    object_property_test
    ${CMAKE_CURRENT_LIST_DIR}/object_property_test.cc
)
target_link_libraries(object_property_test dyntype gtest_main gcov)

gtest_discover_tests(object_property_test)
