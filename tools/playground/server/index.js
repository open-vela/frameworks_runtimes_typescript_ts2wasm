"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g;
    return g = { next: verb(0), "throw": verb(1), "return": verb(2) }, typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (g && (g = 0, op[0] && (_ = 0)), _) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
};
exports.__esModule = true;
var express_1 = require("express");
var fs_1 = require("fs");
var os_1 = require("os");
var path_1 = require("path");
var compiler_js_1 = require("../../../src/compiler.js");
var better_sqlite3_1 = require("better-sqlite3");
var storage_dir = path_1["default"].join(os_1["default"].homedir(), ".ts2wasm_playground");
var app = (0, express_1["default"])();
var port = process.env.PORT || 3001;
function make_storage_dir() {
    if (!fs_1["default"].existsSync(storage_dir)) {
        fs_1["default"].mkdirSync(storage_dir);
    }
}
function store_case(buffer, file_name, e) {
    var file_path = path_1["default"].join(storage_dir, file_name);
    fs_1["default"].writeFileSync(file_path, buffer);
    fs_1["default"].appendFileSync(file_path, "\n// Error message: ".concat(e));
    return file_path;
}
function get_feedback_db() {
    make_storage_dir();
    var db_dir = path_1["default"].join(storage_dir, 'feedback.sqlite');
    if (!fs_1["default"].existsSync(db_dir)) {
        var db_1 = new better_sqlite3_1["default"](db_dir);
        db_1.exec("\n            CREATE TABLE suggestions\n            (\n                ID INTEGER PRIMARY KEY AUTOINCREMENT,\n                user VARCHAR(128) NOT NULL,\n                suggestion VARCHAR(4096) NOT NULL\n            );\n        ");
        return db_1;
    }
    var db = new better_sqlite3_1["default"](db_dir);
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
app.post('/feedback', function (req, res) { return __awaiter(void 0, void 0, void 0, function () {
    var buffer;
    return __generator(this, function (_a) {
        buffer = "";
        req.on('data', function (chunk) {
            buffer += chunk.toString();
        });
        req.on('end', function () {
            var content = JSON.parse(buffer);
            console.log("[".concat(content.user, "] suggested:\n").concat(content.suggests));
            var db = get_feedback_db();
            var stmt = db.prepare("INSERT INTO suggestions (user, suggestion) VALUES (?, ?)");
            stmt.run([content.user, content.suggests]);
            res.status(200).send();
        });
        return [2 /*return*/];
    });
}); });
app.post('/compile', function (req, res) {
    var buffer = "";
    req.on('data', function (chunk) {
        buffer += chunk.toString();
    });
    req.on('end', function () {
        var tmpDir;
        var prefix = 'ts2wasm-playground';
        try {
            tmpDir = fs_1["default"].mkdtempSync(path_1["default"].join(os_1["default"].tmpdir(), prefix));
            var tempfile = path_1["default"].join(tmpDir, 'index.ts');
            fs_1["default"].writeFileSync(tempfile, buffer);
            console.log("Saving data to temp file [".concat(tempfile, "]"));
            // checkTSFiles([tempfile]);
            // if (hasError) {
            //     res.send('Invalid TypeScript code');
            //     return;
            // }
            // console.log(`Pass TSC check`);
            var compiler = new compiler_js_1.Compiler();
            try {
                compiler.compile([tempfile]);
            }
            catch (e) {
                console.log(e);
                console.log("Recording as file [".concat(store_case(buffer, path_1["default"].basename(tmpDir) + '.ts', e), "]"));
                res.send(e.toString());
                return;
            }
            res.send(compiler.binaryenModule.emitText());
        }
        catch (_a) {
            res.status(500).send('Failed to create workspace');
        }
        finally {
            try {
                if (tmpDir) {
                    fs_1["default"].rmSync(tmpDir, { recursive: true });
                }
            }
            catch (e) {
                console.log("An error has occurred while removing the temp folder at ".concat(tmpDir, ". Please remove it manually. Error: ").concat(e));
            }
        }
    });
});
app.listen(port, function () {
    console.log("\u26A1\uFE0F[server]: Server is running at http://localhost:".concat(port));
});
