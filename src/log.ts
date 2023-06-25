/*
 * Copyright (C) 2023 Intel Corporation.  All rights reserved.
 * SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
 */

import path from 'path';
import log4js from 'log4js';
import stackTrace from 'stacktrace-js';
import config from '../config/log4js.js';

export enum LoggerLevel {
    TRACE = 'TRACE',
    DEBUG = 'DEBUG',
    INFO = 'INFO',
    WARN = 'WARN',
    ERROR = 'ERROR',
}

log4js.configure(config);

const fileLogger = log4js.getLogger();
fileLogger.level = LoggerLevel.TRACE;

export const consoleLogger = log4js.getLogger('console');
consoleLogger.level = LoggerLevel.ERROR;

export class Logger {
    static info(...args: any[]) {
        fileLogger.info(args);
    }

    static trace(...args: any[]) {
        fileLogger.trace(Logger.getStackTrace(), ...args);
    }

    static debug(...args: any[]) {
        fileLogger.debug(Logger.getStackTrace(), ...args);
    }

    static warn(...args: any[]) {
        fileLogger.warn(Logger.getStackTrace(), ...args);
    }

    static error(...args: any[]) {
        fileLogger.error(Logger.getStackTrace(), ...args);
    }

    static getStackTrace(depth = 2): string {
        const stackFrames = stackTrace.getSync();
        const stackFrame = stackFrames[depth];
        const lineNumber = stackFrame.lineNumber!;
        const columnNumber = stackFrame.columnNumber!;
        const fileName = stackFrame.fileName!;
        const pathBaseName = path.basename(fileName);
        return `${pathBaseName} (line: ${lineNumber}, column: ${columnNumber}): \n`;
    }
}
