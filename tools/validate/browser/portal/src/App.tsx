/*
 * Copyright (C) 2023 Intel Corporation.  All rights reserved.
 * SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
 */

import "./App.css";
import "antd/dist/reset.css";
import { Divider, Typography, Button, Card, Col, Row, Space, Layout, Modal, Input, message, Switch, Select, Progress, List, Timeline, Collapse } from "antd";
import { BrowserRouter as Router, Route } from "react-router-dom";
import { useEffect, useRef, useState } from "react";
import { CheckOutlined, CloseOutlined, UserOutlined } from "@ant-design/icons";
// @ts-ignore
import * as validator from './validate'

import validationItems from './validate_data.json' assert { type: 'json' };

const { Header, Footer, Sider, Content } = Layout;
const { Title, Paragraph, Text, Link } = Typography;
const { Panel } = Collapse;

let totalTestCases = 0;

validationItems.forEach((item) => {
  totalTestCases += item.entries.length;
})

function App() {
  const [prog, setProg] = useState(0);
  const [errorsMap, setErrorsMap] = useState([]);
  const [passRatio, setPassRatio] = useState(0);
  const [totalFiles, setTotalFiles] = useState(totalTestCases);
  const [totalFailed, setTotalFailed] = useState(0);
  const [showRatio, setShowRatio] = useState(false);
  const [currentModule, setCurrentModule] = useState('');

  async function traverseDirectory() {
    setTotalFiles(totalTestCases);
    setTotalFailed(0);
    let count = 0;
    setProg(0);
    setShowRatio(false);
    setErrorsMap([]);

    let errors: any = [];
    let failed = 0;

    for (let item of validationItems) {
        const moduleName = item.module;
        let wasmInstance : WebAssembly.Instance;

        setCurrentModule(moduleName);
        try {
          let { instance } = await WebAssembly.instantiateStreaming(
            fetch(`./wasm_modules/${moduleName}.wasm`), validator.importObject
          );
          wasmInstance = instance;
        }
        catch (e) {
          console.error(`${moduleName} instantiate failed`);
          failed += item.entries.length;

          count += item.entries.length;
          setProg(Math.round(count / totalTestCases * 100));

          errors.push({
            case: moduleName,
            error: `instantiate failed: ${e}`
          })
          setErrorsMap(errors);
          continue;
        }

        validator.setWasmMemory(wasmInstance.exports.default);

        for (let entry of item.entries) {
          const exportFunc = entry.name;
          const parameters = entry.args;
          let expect : any = entry.result;

          if (expect === 'undefined') {
            expect = undefined;
          }

          count++;
          setProg(Math.round(count / totalTestCases * 100));

          try {
            setCurrentModule(`${moduleName}:${exportFunc}`);
            const func = wasmInstance.exports[exportFunc];
            const res = (func as any).call(func, ...parameters);

            // output res
            const output = expect == res;
            if (!output) {
              errors.push({
                case: `${moduleName}:${exportFunc}`,
                error: `expect result: ${expect}, but got ${res}`
              })
              failed++;
            }
          }
          catch (e) {
            console.error(`${moduleName}:${exportFunc} execute failed`);
            failed += item.entries.length;

            errors.push({
              case: `${moduleName}:${exportFunc}`,
              error: `error: ${e}`
            })
            continue;
          }

          setErrorsMap(errors);
        };
    };

    setTotalFailed(failed);
    setPassRatio(Math.round((totalFiles - failed) / totalFiles * 100))
    setShowRatio(true);
    setCurrentModule('');
  }

  const startValidation = () => {
    traverseDirectory();
  }

  return (
    <Card className="shadow-xl rounded-3xl bg-sky-50 bg-gradient-to-r from-sky-200">
      <Typography>
        <Title>ts2wasm samples validation</Title>
        <Paragraph>
          This page is used to validate the execution results of the wasm module generated by ts2wasm.
        </Paragraph>

        <Title level={2}>How it works?</Title>
        <Paragraph>
          <ul>
            <li>
              <p>The server will compile all the samples before startup, and launch a http-server once compilation finished</p>
            </li>
            <li>
              <p>This page fetch the wasm module from server one by one, execute the module in the <Text strong>browser</Text> and validate the result</p>
            </li>
          </ul>
        </Paragraph>

        <Title level={2}>Browser requirement</Title>
        <Paragraph>
          <ul>
            <li>
              <p>Latest chrome browser</p>
            </li>
            <li>
              <p>WebAssembly Garbage Collection flag enabled (chrome://flags/#enable-webassembly-garbage-collection)</p>
            </li>
            <li>
              <p>Experimental WebAssembly flag enabled (chrome://flags/#enable-experimental-webassembly-features)</p>
            </li>
          </ul>
        </Paragraph>

        <Divider />
        <Button onClick={startValidation}>Start validation</Button>
        {currentModule &&
          <span className="ml-5 font-mono text-gray-600">Validating: {currentModule}</span>
        }
        <Progress percent={prog} size={'default'} />
      </Typography>
      {showRatio && <Progress type="circle"
        style={{marginBottom: '10px'}}
        percent={passRatio}
        format={() => `${totalFiles - totalFailed}/${totalFiles}`} />
      }
      <Collapse
        className="bg-red-100 bg-gradient-to-r from-red-400"
        defaultActiveKey={['1']}>
        {
          errorsMap.map((e: any) => <Panel header={e.case} key={e.case}>
            <p>{e.error}</p>
          </Panel>)
        }
      </Collapse>
    </Card>
  )
}

export default App;