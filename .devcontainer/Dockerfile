FROM node:16.16.0

# node may come with an older version of npm. Ensure we have a specific npm.
RUN npm install -g npm@8.11.0


################################################################################
# Install prerequisites
RUN apt update
RUN apt install -y \
    lsb-release \
    curl

## lsb-release  allows us to find out which distro we run inside the dev container
