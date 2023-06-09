#
# Copyright (C) 2023 Intel Corporation.  All rights reserved.
# SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
#

cmake_minimum_required(VERSION 2.8)

project(iwasm_gc)

if (NOT CMAKE_BUILD_TYPE)
  set(CMAKE_BUILD_TYPE Release)
endif ()

set (CMAKE_C_FLAGS "${CMAKE_C_FLAGS} -fdata-sections -ffunction-sections -Werror")
set (CMAKE_EXE_LINKER_FLAGS "${CMAKE_EXE_LINKER_FLAGS} -Wl,--gc-sections")

## WAMR
include(${CMAKE_CURRENT_LIST_DIR}/wamr_config.cmake)
add_library(vmlib ${WAMR_RUNTIME_LIB_SOURCE})

## quickjs
set(QUICKJS_SRC_DIR ${CMAKE_CURRENT_LIST_DIR}/deps/quickjs)

include_directories(${QUICKJS_SRC_DIR})

set(QUICKJS_SOURCE
    ${QUICKJS_SRC_DIR}/cutils.c
    ${QUICKJS_SRC_DIR}/libregexp.c
    ${QUICKJS_SRC_DIR}/libunicode.c
    ${QUICKJS_SRC_DIR}/quickjs.c)

## libdyntype
set(LIBDYNTYPE_DIR ${CMAKE_CURRENT_LIST_DIR}/dyntype)

include_directories(${LIBDYNTYPE_DIR})

set(LIBDYNTYPE_SOURCE
    ${LIBDYNTYPE_DIR}/dyntype.c
    ${LIBDYNTYPE_DIR}/lib_dyntype_wrapper.c
)

## stdlib
set(STDLIB_DIR ${CMAKE_CURRENT_LIST_DIR}/stdlib)

include_directories(${STDLIB_DIR})

set(STDLIB_SOURCE
    ${STDLIB_DIR}/lib_console.c
    ${STDLIB_DIR}/lib_array.c
)

## struct-dyn
set(STRUCT_DYN_DIR ${CMAKE_CURRENT_LIST_DIR}/struct-dyn)

include_directories(${STRUCT_DYN_DIR})

set(STRUCT_DYN_SOURCE
    ${STRUCT_DYN_DIR}/lib_structdyn.c
)

## utils
set(UTILS_DIR ${CMAKE_CURRENT_LIST_DIR}/utils)

include_directories(${UTILS_DIR})

set(UTILS_SOURCE
    ${UTILS_DIR}/type_utils.c
    ${UTILS_DIR}/wamr_utils.c
)

# Ignore warnings of QuickJS
set_source_files_properties(
    ${QUICKJS_SOURCE}
    PROPERTIES
    COMPILE_FLAGS "-w"
)

include (${SHARED_DIR}/utils/uncommon/shared_uncommon.cmake)
add_executable(iwasm_gc main.c
    ${UNCOMMON_SHARED_SOURCE}
    ${QUICKJS_SOURCE}
    ${LIBDYNTYPE_SOURCE}
    ${STDLIB_SOURCE}
    ${STRUCT_DYN_SOURCE}
    ${UTILS_SOURCE}
)
target_link_libraries (iwasm_gc vmlib -lm -ldl -lpthread)
