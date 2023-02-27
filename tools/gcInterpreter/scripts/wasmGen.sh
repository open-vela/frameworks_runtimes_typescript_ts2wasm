#!/bin/bash
# use ts2wasm to generate wasm files of samples

scriptDir=$(cd "$(dirname "$0")" && pwd)
ts2wasm=$scriptDir/../../../build/cli/ts2wasm.js
samplePath=${1:-$scriptDir/../../../tests/samples}
samples=$(ls $samplePath)
outputPath=$scriptDir/../output/wasmFiles

for sampleFile in $samples
    do
        sampleName=$(echo $sampleFile | cut -d . -f1)
        node $ts2wasm $samplePath/$sampleFile --output $outputPath/$sampleName.wasm
    done