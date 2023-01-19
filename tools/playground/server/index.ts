import express, { Express, Request, Response } from 'express';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { Compiler } from '../../../src/compiler.js';
import sqlite3 from 'better-sqlite3';

const storage_dir = path.join(os.homedir(), ".ts2wasm_playground");

const app: Express = express();
const port = process.env.PORT || 3001;

function make_storage_dir() {
    if (!fs.existsSync(storage_dir)) {
        fs.mkdirSync(storage_dir);
    }
}

function store_case(buffer: string, file_name: string, e: string) {
    const file_path = path.join(storage_dir, file_name);
    fs.writeFileSync(file_path, buffer);
    fs.appendFileSync(file_path, `\n// Error message: ${e}`)

    return file_path;
}

function get_feedback_db() {
    make_storage_dir();
    const db_dir = path.join(storage_dir, 'feedback.sqlite');

    if (!fs.existsSync(db_dir)) {
        let db = new sqlite3(db_dir);
        db.exec(`
            CREATE TABLE suggestions
            (
                ID INTEGER PRIMARY KEY AUTOINCREMENT,
                user VARCHAR(128) NOT NULL,
                suggestion VARCHAR(4096) NOT NULL
            );
        `);

        return db;
    }

    const db = new sqlite3(db_dir);
    return db;
}

app.all('*', function (req, res, next) {

    //设为指定的域
    res.header('Access-Control-Allow-Origin', "*");
    res.header("Access-Control-Allow-Headers", "X-Requested-With");
    res.header('Access-Control-Allow-Headers', 'Content-Type');
    res.header("Access-Control-Allow-Methods", "PUT,POST,GET,DELETE,OPTIONS");
    res.header('Access-Control-Allow-Credentials', 'true');
    res.header("X-Powered-By", ' 3.2.1');

    // Disable caching for content files
    res.header("Cache-Control", "no-cache, no-store, must-revalidate");
    res.header("Pragma", "no-cache");
    res.header("Expires", '0');

    if (req.method == 'OPTIONS') {
        res.status(200).send();
        return;
    }

    next();
});

app.post('/feedback', async (req: Request, res: Response) => {
    let buffer = "";
    req.on('data', (chunk) => {
        buffer += chunk.toString();
    })

    req.on('end', () => {
        let content = JSON.parse(buffer);
        console.log(`[${content.user}] suggested:\n${content.suggests}`);
        const db = get_feedback_db();
        const stmt = db.prepare(`INSERT INTO suggestions (user, suggestion) VALUES (?, ?)`);
        stmt.run([content.user, content.suggests]);
        res.status(200).send();
    })
})

app.post('/compile', (req: Request, res: Response) => {
    let buffer = "";
    req.on('data', (chunk) => {
        buffer += chunk.toString();
    })

    req.on('end', () => {
        let tmpDir;
        const prefix = 'ts2wasm-playground';
        try {
            tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
            let tempfile = path.join(tmpDir, 'index.ts');
            fs.writeFileSync(tempfile, buffer);

            console.log(`Saving data to temp file [${tempfile}]`);

            // checkTSFiles([tempfile]);
            // if (hasError) {
            //     res.send('Invalid TypeScript code');
            //     return;
            // }

            // console.log(`Pass TSC check`);

            const compiler = new Compiler();
            try {
                compiler.compile([tempfile]);
            } catch (e: any) {
                console.log(e);
                console.log(`Recording as file [${store_case(buffer, path.basename(tmpDir) + '.ts', e)}]`)
                res.send(e.toString());
                return;
            }

            res.send(compiler.binaryenModule.emitText());
        }
        catch {
            res.status(500).send('Failed to create workspace');
        }
        finally {
            try {
                if (tmpDir) {
                    fs.rmSync(tmpDir, { recursive: true });
                }
            }
            catch (e) {
                console.log(`An error has occurred while removing the temp folder at ${tmpDir}. Please remove it manually. Error: ${e}`);
            }
        }
    })
});

app.listen(port, () => {
    console.log(`⚡️[server]: Server is running at http://localhost:${port}`);
});
