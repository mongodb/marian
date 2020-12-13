MANIFEST_SOURCE ?= bucket:docs-mongodb-org-prod/search-indexes/
export MANIFEST_SOURCE

.PHONY: all test run format

all: test

test: src/fts/Porter2.js
	deno test --allow-read

run: src/fts/Porter2.js
	deno run --allow-read --allow-env --allow-net --unstable ./src/index.ts ${MANIFEST_SOURCE}

format:
	deno fmt

snowball src/fts/Porter2.js: src/fts/Porter2.snowball
	deno run tools/update_stemmer.ts $^ src/fts/Porter2.js
