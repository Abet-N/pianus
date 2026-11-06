/* ------------------------------------- */
// neither simply import path from "path" nor require('path') would work
// import path from "path";
// import { fileURLToPath } from "url";
// const __filename = fileURLToPath(import.meta.url);
// const __dirname = path.dirname(__filename);
// //* ------------------------------------ */
// import wne from "webpack-node-externals";
// const nodeExternals = wne;
const path = require("path");
const nodeExternals = require("webpack-node-externals");
const CopyPlugin = require("copy-webpack-plugin");

var serverConfig = {
  entry: "./src/server/main.js",
  target: "node",
  output: {
    path: path.resolve(__dirname, "dist"),
    filename: "./main.js",
  },
  module: {
    rules: [
      {
        test: /\.html$/,
        type: "asset/source",
      },
    ],
  },
  //externals: [nodeExternals()],
  mode: "development",
  devtool: "source-map",
};

var appConfig = {
  entry: "./src/index.js",
  output: {
    path: path.resolve(__dirname, "dist"),
    filename: "./public/index.js",
  },
  devtool: "source-map",
  plugins: [
    new CopyPlugin({
      patterns: [
        { from: "src/index.html", to: "public/index.html" },
        { from: "src/styles.css", to: "public/styles.css" },
        { from: "src/server/resources/default.mp3", to: "public/default.mp3"},
        { from: "src/server/resources/glas_Cis.mp3", to: "public/glas_Cis.mp3"},
        { from: "src/server/resources/glas_G.mp3", to: "public/glas_G.mp3"}
      ]
    })
  ],
  mode: "development",
};

module.exports = [serverConfig, appConfig];
