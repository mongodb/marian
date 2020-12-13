"use strict";
/* eslint-env node */
const child_process = require("child_process");
const http = require("http");
const readline = require("readline");

function startServer(path, done) {
  let isDone = false;

  const child = child_process.spawn("./src/index.js", [path], {
    stdio: [0, "pipe", 2],
  });

  const rl = readline.createInterface({
    input: child.stdout,
  });

  const ctx = {
    child: child,
    port: 0,
  };

  rl.on("line", (line) => {
    if (isDone) return;

    const match = line.match(/Listening on port ([0-9]+)/);
    if (match) {
      ctx.port = parseInt(match[1]);
    }

    if (line.match(/Loaded new index/)) {
      isDone = true;
      done();
    } else if (line.match(/Error/)) {
      throw new Error(line);
    }
  });

  rl.on("error", (err) => {
    throw err;
  });

  rl.on("end", () => {
    rl.close();
  });

  return ctx;
}

function request(url) {
  return new Promise((resolve, reject) => {
    http.request(url, (res) => {
      res.setEncoding("utf8");
      let data = "";

      res.on("data", (chunk) => {
        data += chunk;
      });
      res.on("end", () => {
        resolve({
          response: res,
          json: data ? JSON.parse(data) : undefined,
        });
      });
      res.on("error", (err) => {
        reject(err);
      });
    }).end();
  });
}

exports.request = request;
exports.startServer = startServer;
