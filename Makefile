NPM ?= $(shell which npm)
MOCHA ?= ./node_modules/.bin/mocha
ESLINT ?= ./node_modules/.bin/eslint

.PHONY: all lint test

all: lint test

lint: node_modules/.CURRENT
	${ESLINT} src/*.js test/*.js

test: node_modules/.CURRENT
	${MOCHA} test/*.js

node_modules/.CURRENT: package.json
	${NPM} -s install --build-from-source
	touch $@
