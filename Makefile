#
# Copyright (C) 2024 Xiaomi Corporation
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#      http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.
#

include $(APPDIR)/Make.defs

TS2WASM_RUNTIMELIB_ROOT := $(APPDIR)/frameworks/runtimes/typescript/ts2wasm/runtime-library
QUICKJS_ROOT := $(APPDIR)/interpreters/quickjs/quickjs
DYNTYPE_ROOT := ${TS2WASM_RUNTIMELIB_ROOT}/libdyntype
STDLIB_ROOT := ${TS2WASM_RUNTIMELIB_ROOT}/stdlib
STRUCT_DYN_ROOT := ${TS2WASM_RUNTIMELIB_ROOT}/struct-dyn
UTILS_ROOT := ${TS2WASM_RUNTIMELIB_ROOT}/utils
# TODO: WAMR's internal interface should not be used directly, this need to be modified
IWASM_ROOT := $(APPDIR)/interpreters/wamr/wamr/core/iwasm

# WASM_ENABLE_MODULE_INST_CONTEXT is not defined
ifeq ($(CONFIG_INTERPRETERS_WAMR_MODULE_INSTANCE_CONTEXT),y)
CFLAGS += -DWASM_ENABLE_MODULE_INST_CONTEXT=1
else
CFLAGS += -DWASM_ENABLE_MODULE_INST_CONTEXT=0
endif
# WASM_GC_MANUALLY is not defined
ifeq ($(CONFIG_INTERPRETERS_WAMR_GC_MANUALLY),y)
CFLAGS += -DWASM_GC_MANUALLY=1
else
CFLAGS += -DWASM_GC_MANUALLY=0
endif

ifeq ($(CONFIG_INTERPRETERS_WAMR_LOG),y)
CFLAGS += -DWASM_ENABLE_LOG=1
else
CFLAGS += -DWASM_ENABLE_LOG=0
endif

ifeq ($(CONFIG_INTERPRETERS_WAMR_AOT),y)
CFLAGS += -DWASM_ENABLE_AOT=1
CFLAGS += -I$(IWASM_ROOT)/aot
else
CFLAGS += -DWASM_ENABLE_AOT=0
endif

ifeq ($(CONFIG_INTERPRETERS_WAMR_FAST), y)
CFLAGS += -DWASM_ENABLE_FAST_INTERP=1
CFLAGS += -DWASM_ENABLE_INTERP=1
else
CFLAGS += -DWASM_ENABLE_FAST_INTERP=0
endif

ifeq ($(CONFIG_INTERPRETERS_WAMR_USE_SIMPLE_LIBDYNTYPE), y)
CFLAGS += -DUSE_SIMPLE_LIBDYNTYPE=1
LIBDYNTYPE_DYNAMIC_DIR := ${DYNTYPE_ROOT}/dynamic-simple
else
LIBDYNTYPE_DYNAMIC_DIR := ${DYNTYPE_ROOT}/dynamic-qjs
endif
LIBDYNTYPE_EXTREF_DIR := ${DYNTYPE_ROOT}/extref
STRUCT_INDIRECT_DIR := ${TS2WASM_RUNTIMELIB_ROOT}/struct-indirect
STRINGREF_DIR := ${TS2WASM_RUNTIMELIB_ROOT}/stringref

# TODO: Ignored warnings need to be addressed
CFLAGS += -Wno-strict-prototypes
CFLAGS += -Wno-unused-variable
CFLAGS += -Wno-implicit-function-declaration

# TODO: The WAMR header files used need to be modified later
CFLAGS += ${INCDIR_PREFIX}$(APPDIR)/interpreters/wamr/wamr/core/iwasm/interpreter
CFLAGS += ${INCDIR_PREFIX}$(APPDIR)/interpreters/wamr/wamr/core/iwasm/common
CFLAGS += ${INCDIR_PREFIX}$(APPDIR)/interpreters/wamr/wamr/core/iwasm/libraries/thread-mgr
CFLAGS += ${INCDIR_PREFIX}$(APPDIR)/interpreters/wamr/wamr/core/shared/platform/include
CFLAGS += ${INCDIR_PREFIX}$(APPDIR)/interpreters/wamr/wamr/core/shared/utils
CFLAGS += ${INCDIR_PREFIX}$(APPDIR)/interpreters/wamr/wamr/core/shared/utils/uncommon
CFLAGS += ${INCDIR_PREFIX}$(APPDIR)/interpreters/wamr/wamr/core/shared/mem-alloc
CFLAGS += ${INCDIR_PREFIX}$(APPDIR)/interpreters/wamr/wamr/core/shared/platform/nuttx
CFLAGS += ${INCDIR_PREFIX}$(APPDIR)/interpreters/wamr/wamr/core/iwasm/common/gc
CFLAGS += ${INCDIR_PREFIX}$(APPDIR)/interpreters/wamr/wamr/core/iwasm/common/gc/stringref

ifeq ($(CONFIG_INTERPRETERS_WAMR_GC),y)
CFLAGS += -DWASM_ENABLE_GC=1
CFLAGS += -DWASM_ENABLE_REF_TYPES=1
CFLAGS += -DWASM_ENABLE_GC_BINARYEN=1
CFLAGS += -DWASM_ENABLE_SPEC=0
CFLAGS += -DWASM_ENABLE_STRINGREF=1

VPATH += ${DYNTYPE_ROOT}
VPATH += ${STDLIB_ROOT}
VPATH += ${STRUCT_DYN_ROOT}
VPATH += ${UTILS_ROOT}
VPATH += ${TS2WASM_RUNTIMELIB_ROOT}
VPATH += ${LIBDYNTYPE_DYNAMIC_DIR}
VPATH += ${STRUCT_INDIRECT_DIR}
VPATH += ${LIBDYNTYPE_EXTREF_DIR}
VPATH += ${STRINGREF_DIR}

CSRCS += ${LIBDYNTYPE_DYNAMIC_DIR}/context.c \
         ${LIBDYNTYPE_DYNAMIC_DIR}/fallback.c \
         ${LIBDYNTYPE_DYNAMIC_DIR}/object.c \
         ${LIBDYNTYPE_EXTREF_DIR}/extref.c \
         ${DYNTYPE_ROOT}/libdyntype.c \
         ${DYNTYPE_ROOT}/lib_dyntype_wrapper.c \
         ${STDLIB_ROOT}/lib_array.c \
         ${STDLIB_ROOT}/lib_console.c \
         ${STDLIB_ROOT}/lib_timer.c \
         ${UTILS_ROOT}/type_utils.c \
         ${UTILS_ROOT}/wamr_utils.c \
         ${UTILS_ROOT}/object_utils.c \
         ${STRUCT_INDIRECT_DIR}/lib_struct_indirect.c

MAINSRC = ${TS2WASM_RUNTIMELIB_ROOT}/main.c
PROGNAME  = iwasm
PRIORITY  = 100
STACKSIZE = 8192
MODULE    = $(CONFIG_INTERPRETERS_WAMR)

ifeq ($(CONFIG_INTERPRETERS_WAMR_USE_SIMPLE_LIBDYNTYPE), y)
CSRCS += ${LIBDYNTYPE_DYNAMIC_DIR}/dyn-value/dyn_value.c
CSRCS += ${LIBDYNTYPE_DYNAMIC_DIR}/dyn-value/class/date.c
CSRCS += ${LIBDYNTYPE_DYNAMIC_DIR}/dyn-value/class/dyn_class.c
CSRCS += ${LIBDYNTYPE_DYNAMIC_DIR}/dyn-value/class/object.c
CSRCS += ${LIBDYNTYPE_DYNAMIC_DIR}/dyn-value/class/string.c
CSRCS += ${STRINGREF_DIR}/stringref_simple.c
CFLAGS += -I${LIBDYNTYPE_DYNAMIC_DIR}/dyn-value
else
CSRCS += ${STRINGREF_DIR}/stringref_qjs.c
endif
endif

CFLAGS += -DWASM_DISABLE_WAKEUP_BLOCKING_OP=0

CFLAGS += -I${QUICKJS_ROOT} \
          -I${DYNTYPE_ROOT} \
          -I${STDLIB_ROOT} \
          -I${STRUCT_DYN_ROOT} \
          -I${UTILS_ROOT} \
          -I${LIBDYNTYPE_DYNAMIC_DIR} \
          -I${STRUCT_INDIRECT_DIR}

VPATH += ${QUICKJS_ROOT}

include $(APPDIR)/Application.mk
