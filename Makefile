NPM ?= $(shell which npm)
NODE ?= $(shell which node)
MOCHA ?= ./node_modules/.bin/mocha
ESLINT ?= ./node_modules/.bin/eslint
BROWSERIFY ?= ./node_modules/.bin/browserify

.PHONY: all lint test integration regression run demo

all: lint test

lint: node_modules/.CURRENT
	${ESLINT} src/*.js src/fts/*.js src/demo/*.js test/*.js

test: node_modules/.CURRENT lint
	${MOCHA} test/test_*.js

integration: test
	${MOCHA} --timeout 5000 test/integration_test.js

regression: integration
	MAX_WORKERS=1 ${MOCHA} --timeout 200000 test/regression_test.js

run:
	${NODE} ./src/index.js bucket:docs-mongodb-org-prod/search-indexes/

demo: demo/demo.js demo/demo-worker.js lint

demo/demo.js: src/demo/demo.js src/*.js src/fts/*.js node_modules/.CURRENT
	${BROWSERIFY} -o $@ src/demo/demo.js

demo/demo-worker.js: src/demo/demo-worker.js src/*.js src/fts/*.js node_modules/.CURRENT
	${BROWSERIFY} -o $@ src/demo/demo-worker.js

node_modules/.CURRENT: package.json
	${NPM} -s install --build-from-source
	touch $@
