FROM node:16.16.0

ARG USERNAME=vscode
ARG USER_UID=1000
ARG USER_GID=$USER_UID

# node may come with an older version of npm. Ensure we have a specific npm.
RUN npm install -g npm@8.11.0


################################################################################
# Install prerequisites
RUN apt update
RUN apt install -y \
    lsb-release vim \
    curl
RUN apt install -y \
    build-essential cmake g++-multilib libgcc-8-dev lib32gcc-8-dev
# Install opam
RUN apt update \
    apt install opam -y \
    echo -e "n\ny" | opam init --disable-sandboxing --auto-setup \
    eval $(opam env) \
    opam install ocamlbuild -y

## lsb-release  allows us to find out which distro we run inside the dev container

# Add WAMR gc branch
RUN git clone -b dev/gc https://github.com/bytecodealliance/wasm-micro-runtime.git
RUN cd wasm-micro-runtime/product-mini/platforms/linux/ \
    && mkdir build && cd build \
    && cmake .. -DWAMR_BUILD_GC=1 \
    && make
RUN ln -s /wasm-micro-runtime/product-mini/platforms/linux/build/iwasm  \
    /usr/local/bin/iwasm

# Add binaryen
RUN git clone https://github.com/WebAssembly/binaryen.git
RUN cd binaryen/ \
    && git submodule init \
    && git submodule update \
    && mkdir build && cd build \
    && cmake .. \
    && make
RUN ln -s /binaryen/build/bin/wasm-as /usr/local/bin/wasm-as
RUN ln -s /binaryen/build/bin/wasm-opt /usr/local/bin/wasm-opt

# Add gc interpreter to validate
RUN git clone https://github.com/WebAssembly/gc.git
RUN cd gc/interpreter/ \
    && make
RUN ln -s /gc/interpreter/wasm /usr/local/bin/wasm

# Create the non-root user
RUN userdel -r -f node  \
    && groupadd --gid $USER_GID $USERNAME \
    && useradd --uid $USER_UID --gid $USER_GID -m $USERNAME \
    && usermod --shell /bin/bash vscode \
    #
    # [Optional] Add sudo support. Omit if you don't need to install software after connecting.
    && apt-get update \
    && apt-get install -y sudo \
    && echo $USERNAME ALL=\(root\) NOPASSWD:ALL > /etc/sudoers.d/$USERNAME \
    && chmod 0440 /etc/sudoers.d/$USERNAME

USER $USERNAME
