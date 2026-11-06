// used to insert JavaScript function generated HTML into static HTML
export function interpolator(template, content) {
  return template.replace('<p replaceme></p>', content)
}

// iterate path url string, segment by segment (e.g. /learn/interval-game)
export function iteratePath(path, func) {
  path.split("/").filter((_,index) => index).forEach((value,index) => {
    func(value,index);
  });
};