NPM ?= $(shell which npm)
NODE ?= $(shell which node)
MOCHA ?= ./node_modules/.bin/mocha
ESLINT ?= ./node_modules/.bin/eslint
MANIFEST_SOURCE ?= bucket:docs-mongodb-org-prod/search-indexes/
export MANIFEST_SOURCE

.PHONY: all lint test integration regression run

all: lint test

lint: node_modules/.CURRENT
	${ESLINT} src/*.js src/fts/*.js test/*.js

test: node_modules/.CURRENT lint src/fts/Porter2.js
	${MOCHA} test/test_*.js

integration: test
	${MOCHA} --timeout 5000 test/integration_test.js

regression: integration
	MAX_WORKERS=1 ${MOCHA} --timeout 200000 test/regression_test.js

run: src/fts/Porter2.js
	${NODE} --max-old-space-size=4096 ./src/index.js ${MANIFEST_SOURCE}

snowball src/fts/Porter2.js: src/fts/Porter2.snowball
	${NODE} tools/update_stemmer.js $^ src/fts/Porter2.js

node_modules/.CURRENT: package.json
	${NPM} -s install --build-from-source
	touch $@
