# This is the version needs to match what was used in the build in Github Workflows so the package versions match
FROM ubuntu:18.04

# To avoid "tzdata" asking for geographic area
ARG DEBIAN_FRONTEND=noninteractive

COPY . /home/app

WORKDIR /home/app/


CMD [ "node", "./NodeServer.js" ] 

