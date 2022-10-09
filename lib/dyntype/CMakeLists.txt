cmake_minimum_required(VERSION 2.8)

project(libdyntype)

set(QUICKJS_SRC_DIR ${CMAKE_CURRENT_LIST_DIR}/quickjs)

include_directories(.)
include_directories(${QUICKJS_SRC_DIR})

set(LIB_QUICKJS
    ${QUICKJS_SRC_DIR}/cutils.c
    ${QUICKJS_SRC_DIR}/libregexp.c
    ${QUICKJS_SRC_DIR}/libunicode.c
    ${QUICKJS_SRC_DIR}/quickjs.c)

set(LIB_DYNTYPE
    dyntype.c)

add_library(quickjs SHARED ${LIB_QUICKJS})
add_library(dyntype SHARED ${LIB_DYNTYPE})

set(LIBS
    dyntype
    quickjs
    m
)

add_executable(test ./test/test.c )
target_link_libraries(test ${LIBS})
