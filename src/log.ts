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
        const msg = Logger.msgCollectInProduction(args);
        fileLogger.info(msg);
    }

    static trace(...args: any[]) {
        const msg = Logger.msgCollectInProduction(args);
        fileLogger.trace(Logger.getLocation(), ...msg);
    }

    static debug(...args: any[]) {
        const msg = Logger.msgCollectInProduction(args);
        fileLogger.debug(Logger.getLocation(), ...msg);
    }

    static warn(...args: any[]) {
        const msg = Logger.msgCollectInProduction(args);
        fileLogger.warn(Logger.getLocation(), ...msg);
    }

    static error(...args: any[]) {
        const msg = Logger.msgCollectInProduction(args);
        fileLogger.error(Logger.getLocation(), ...msg);
    }

    static getLocation(depth = 2): string {
        const stackFrames = stackTrace.getSync();
        const stackFrame = stackFrames[depth];
        const lineNumber = stackFrame.lineNumber!;
        const columnNumber = stackFrame.columnNumber!;
        const fileName = stackFrame.fileName!;
        const pathBaseName = path.basename(fileName);
        return `${pathBaseName} (line: ${lineNumber}, column: ${columnNumber}): \n`;
    }

    static msgCollectInProduction(args: any[]) {
        const res: any[] = [];
        for (let i = 0; i < args.length; i++) {
            if (
                args[i] instanceof Error &&
                process.env.NODE_ENV === 'production'
            ) {
                res.push(args[i].message);
            } else {
                res.push(args[i]);
            }
        }
        return res;
    }
}
