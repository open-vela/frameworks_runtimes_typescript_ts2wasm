cmake_minimum_required(VERSION 2.8)

project(libdyntype)

include_directories(.)

set(LIB_QUICKJS
    cutils.c
    libregexp.c
    libunicode.c
    quickjs.c)

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
