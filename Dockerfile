FROM node:8-alpine
RUN mkdir -p /usr/src/app
WORKDIR /usr/src/app
COPY . /usr/src/app
RUN apk add --no-cache git make gcc g++ python
RUN npm install

EXPOSE 8000
ENTRYPOINT ["node", "src/index.js"]
