import log4js from 'log4js';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const curPath = path.dirname(fileURLToPath(import.meta.url));
const logDirPath = path.join(curPath, '..', '..', 'logs');

const logConfig = {
    appenders: {
        console: {
            type: 'console',
        },
        file: {
            type: 'dateFile',
            filename: `${logDirPath}/output.log`,
            alwaysIncludePattern: true,
            pattern: 'yyyy-MM-dd',
            keepFileExt: true,
            numBackups: 3,
        },
        errorFile: {
            type: 'dateFile',
            filename: `${logDirPath}/error.log`,
            alwaysIncludePattern: true,
            pattern: 'yyyy-MM-dd',
            keepFileExt: true,
            numBackups: 3,
        },
        errors: {
            type: 'logLevelFilter',
            level: 'ERROR',
            appender: 'errorFile',
        },
    },
    categories: {
        default: {
            appenders: ['file', 'errors'],
            level: 'debug',
        },
    },
};

export default logConfig;