const express = require("express");
const path = require("path");

import { createEndpointsFromRouteConfig } from "./feContentUtils";
import { frontendRoutes } from "./routes";

const app = express();

app.use(express.static(path.join(__dirname, "/public")));

const apiRouter = new express.Router();
apiRouter.get("/a", function (req, res) {
  res.json({ msg: "Yo" });
});
app.use("/api", apiRouter);

const routeLoaderRouter = new express.Router();

const routes = frontendRoutes;

app.use("/fe-content", routeLoaderRouter);
createEndpointsFromRouteConfig({children:routes},"",[],routeLoaderRouter);

app.get("/*", function (req, res) {
  console.log("serve app root");
  res.sendFile("./public/index.html", { root: __dirname });
});

const port = 3000;

app.listen(port);

console.log(`Listening on port ${port}`);
