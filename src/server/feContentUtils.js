
function endpointCreationFunction(node, fullPath, contentArray,router) {
  if(node.path && node.content) {
    router.get(fullPath, function (req, res) {
      console.log("serve app content");
      console.log("Query depth: " + req.query.depth);
      const _contentArray = [...contentArray];
      Array(req.query.depth ?? 0).fill(1).forEach((_,index) => { _contentArray[index] = null });
      res.send({ html: _contentArray });
    });
  }
};

export function createEndpointsFromRouteConfig(node, accPath, contentArray, router) {
  for(const child of node.children) {
    const _contentArray = [...contentArray, child.content];
    const childPath = accPath + child.path;
    // create endpoint
    endpointCreationFunction(child, childPath, _contentArray, router);
    // recursion
    if(child.children) {
      createEndpointsFromRouteConfig(child, childPath, _contentArray, router);
    }
  }
}
