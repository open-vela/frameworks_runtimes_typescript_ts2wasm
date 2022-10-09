This document helps to configure dyntype library.

#### step 1

```shell
cd ts2wasm/lib/dyntype/
```

then run command below to initiate quickjs library.

```shell
git submodule update --init --recursive
```

then

``` shell
cd quickjs/
```

#### step 2

run commands below to apply the patch.

``` shell
git apply --check ../0001-patch.patch
git apply ../0001-patch.patch
```

if success, run commands below to build it.

``` shell
mkdir ../build && cd ../build
cmake ../
make
```

