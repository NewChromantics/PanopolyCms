# use node docker image
FROM node:latest AS node_base

RUN echo "NODE Version:" && node --version
RUN echo "NPM Version:" && npm --version

# To avoid "tzdata" asking for geographic area
ARG DEBIAN_FRONTEND=noninteractive
COPY . /home/app

WORKDIR /home/app/

CMD [ "node", "./NodeServer.js" ] 

