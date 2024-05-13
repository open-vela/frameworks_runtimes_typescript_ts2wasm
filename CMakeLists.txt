if(CONFIG_TS2WASM)

  file(GLOB_RECURSE STR_REF_SRC
       ${CMAKE_CURRENT_LIST_DIR}/runtime-library/stringref/stringref_qjs.c)
  file(
    GLOB_RECURSE
    LIBDYNTYPE_SRC
    ${CMAKE_CURRENT_LIST_DIR}/runtime-library/libdyntype/dynamic-qjs/*.c
    ${CMAKE_CURRENT_LIST_DIR}/runtime-library/libdyntype/libdyntype.c
    ${CMAKE_CURRENT_LIST_DIR}/runtime-library/libdyntype/lib_dyntype_wrapper.c
    ${CMAKE_CURRENT_LIST_DIR}/runtime-library/libdyntype/extref/*.c)

  file(GLOB_RECURSE STDLIB_SRC
       ${CMAKE_CURRENT_LIST_DIR}/runtime-library/stdlib/*.c)

  file(GLOB_RECURSE STRUCT_INDIRECT_SRC
       ${CMAKE_CURRENT_LIST_DIR}/runtime-library/struct-indirect/*.c)

  file(GLOB_RECURSE UTILS_SRC
       ${CMAKE_CURRENT_LIST_DIR}/runtime-library/utils/*.c)

  list(
    APPEND
    SRC_LIST
    ${STR_REF_SRC}
    ${LIBDYNTYPE_SRC}
    ${STDLIB_SRC}
    ${STRUCT_INDIRECT_SRC}
    ${UTILS_SRC})

  # wamr headers
  set(WAMR_DIR ${NUTTX_APPS_DIR}/interpreters/wamr/wamr)
  list(APPEND WAMR_INCDIR ${WAMR_DIR}/core/shared/utils)
  list(APPEND WAMR_INCDIR ${WAMR_DIR}/core/iwasm/include)
  list(APPEND WAMR_INCDIR ${WAMR_DIR}/core/iwasm/common)
  list(APPEND WAMR_INCDIR ${WAMR_DIR}/core/iwasm/common/gc)
  list(APPEND WAMR_INCDIR ${WAMR_DIR}/core/iwasm/common/gc/stringref)
  list(APPEND WAMR_INCDIR ${WAMR_DIR}/core/iwasm/interpreter)
  list(APPEND WAMR_INCDIR ${WAMR_DIR}/core/shared/platform/nuttx)
  # end wamr headers
  list(APPEND INCDIR ${CMAKE_CURRENT_LIST_DIR}/runtime-library/libdyntype)
  list(APPEND INCDIR ${CMAKE_CURRENT_LIST_DIR}/runtime-library/utils)
  list(APPEND INCDIR ${CMAKE_CURRENT_LIST_DIR}/runtime-library/struct-indirect)
  list(APPEND INCDIR
       ${CMAKE_CURRENT_LIST_DIR}/runtime-library/libdyntype/dynamic-qjs)
  nuttx_add_library(tswamr STATIC)

  # nuttx_add_dependencies(TARGET tswamr DEPENDS wamr)
  nuttx_add_dependencies(TARGET tswamr DEPENDS libqjs)

  target_sources(tswamr PRIVATE ${SRC_LIST})
  target_include_directories(tswamr PRIVATE ${WAMR_INCDIR})
  target_include_directories(tswamr PRIVATE ${INCDIR})
  target_compile_definitions(tswamr PRIVATE -DWASM_ENABLE_GC=1
                                            -DWASM_ENABLE_STRINGREF=1)

  nuttx_export_header(TARGET tswamr INCLUDE_DIRECTORIES ${INCDIR})
  # set_property( TARGET nuttx APPEND PROPERTY NUTTX_INCLUDE_DIRECTORIES
  # ${INCDIR}) add_custom_target(TARGET nuttx_post_build POST_BUILD "npm i &&
  # npm run build")
endif()
