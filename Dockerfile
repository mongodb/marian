FROM node:10-alpine
RUN mkdir -p /usr/src/app
WORKDIR /usr/src/app
COPY . /usr/src/app
RUN apk add --no-cache git
RUN npm install --production

EXPOSE 8080
ENTRYPOINT ["node", "--max-old-space-size=4096", "src/index.js", "bucket:docs-mongodb-org-prod/search-indexes/"]
