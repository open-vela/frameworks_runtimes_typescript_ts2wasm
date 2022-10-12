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

add_library(quickjs ${LIB_QUICKJS})
add_library(dyntype ${LIB_DYNTYPE})
target_link_libraries(dyntype quickjs)
