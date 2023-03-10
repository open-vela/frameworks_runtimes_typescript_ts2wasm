import fs from 'fs';
import path from 'path';
import binaryen from 'binaryen';
import { addWatFuncs, addWatFuncImports } from '../../src/utils.js';
import { getWatFilesDir, getFuncName } from './utils.js';
import { BuiltinNames } from './builtinUtil.js';

export function addBuiltInNoAnyFunc(curModule: binaryen.Module) {
    const watFileDir = getWatFilesDir();
    const watFiles = fs.readdirSync(watFileDir);
    for (const file of watFiles) {
        const filePath = path.join(watFileDir, file);
        const fileName = file.slice(undefined, -'.wat'.length);
        const libWat = fs.readFileSync(filePath, 'utf-8');
        const watModule = binaryen.parseText(libWat);
        if (fileName.includes('Math')) {
            for (const key in BuiltinNames.MathBuiltInFuncs) {
                /** max and min use array.length */
                if (key === 'max' || key === 'min') {
                    break;
                }
                addWatFuncs(
                    watModule,
                    getFuncName(
                        BuiltinNames.bulitIn_module_name,
                        BuiltinNames.MathBuiltInFuncs[key],
                    ),
                    curModule,
                );
            }
        }
        if (fileName.includes('string')) {
            for (const key in BuiltinNames.stringBuiltInFuncs) {
                addWatFuncs(
                    watModule,
                    getFuncName(
                        BuiltinNames.bulitIn_module_name,
                        BuiltinNames.stringBuiltInFuncs[key],
                    ),
                    curModule,
                );
            }
        }
        // if (fileName.includes('array')) {
        //     for (const key in BuiltinNames.arrayBuiltInFuncs) {
        //         /**currently, only length is implemented */
        //         if (key !== 'length') {
        //             continue;
        //         }
        //         addWatFuncs(
        //             watModule,
        //             getFuncName(
        //                 BuiltinNames.bulitIn_module_name,
        //                 BuiltinNames.arrayBuiltInFuncs[key],
        //             ),
        //             curModule,
        //         );
        //     }
        // }
    }
}

export function addBuiltInAnyFunc(curModule: binaryen.Module) {
    addBuiltInAnyFuncImport(curModule);
    const watFileDir = getWatFilesDir();
    const watFiles = fs.readdirSync(watFileDir);
    for (const file of watFiles) {
        const filePath = path.join(watFileDir, file);
        const fileName = file.slice(undefined, -'.wat'.length);
        const libWat = fs.readFileSync(filePath, 'utf-8');
        const watModule = binaryen.parseText(libWat);
        if (fileName.includes('Array')) {
            for (const key in BuiltinNames.ArrayBuiltInFuncs) {
                /**currently, only isArray is implemented */
                if (key !== 'isArray') {
                    continue;
                }
                addWatFuncs(
                    watModule,
                    getFuncName(
                        BuiltinNames.bulitIn_module_name,
                        BuiltinNames.ArrayBuiltInFuncs[key],
                    ),
                    curModule,
                );
            }
        }
    }
}

function addBuiltInAnyFuncImport(curModule: binaryen.Module) {
    for (const key in BuiltinNames.consoleBuiltInFuncs) {
        addWatFuncImports(
            getFuncName(
                BuiltinNames.bulitIn_module_name,
                BuiltinNames.consoleBuiltInFuncs[key],
            ),
            curModule,
        );
    }
}
