NPM ?= $(shell which npm)
NODE ?= $(shell which node)
MOCHA ?= ./node_modules/.bin/mocha
ESLINT ?= ./node_modules/.bin/eslint

.PHONY: all lint test integration run

all: lint test

lint: node_modules/.CURRENT
	${ESLINT} src/*.js src/fts/*.js test/*.js

test: node_modules/.CURRENT
	${MOCHA} test/test_*.js

integration: lint node_modules/.CURRENT
	${MOCHA} --timeout 5000 test/*.js

run:
	${NODE} ./src/index.js bucket:docs-mongodb-org-prod/search-indexes/

node_modules/.CURRENT: package.json
	${NPM} -s install --build-from-source
	touch $@
