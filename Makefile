NPM ?= $(shell which npm)
MOCHA ?= ./node_modules/.bin/mocha
ESLINT ?= ./node_modules/.bin/eslint

.PHONY: lint test

all: lint test

lint: node_modules/.CURRENT
	${ESLINT} src/*.js

test: node_modules/.CURRENT
	${MOCHA} test/*.js -R dot

node_modules/.CURRENT: package.json node_modules
	${NPM} update
	touch $@

node_modules:
	${NPM} -s install
