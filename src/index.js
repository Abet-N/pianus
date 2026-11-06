import { yo, exposeMusicUtils } from "./music-utils/music-utils.js";
import { exposeSequencus } from "./sequencer/sequencus.js";
import { completeRouteLoad } from "./route-utils/route-utils.js";
import { DateTime } from "luxon";
import { iteratePath } from "./server/projectUtils.js";

console.log(yo);
console.log(DateTime.now());

// stores already fetched routes in a tree structure to avoid refetching, until
// page reload
const pathTree = {};

// handle location change by fetching content and piecing it together
const handleLocation = async () => {
  const path = window.location.pathname;
  // ----------------------------------------------------------
  // ---------- pathTree query: request depth -----------------
  let currentNode = pathTree;
  let exploredDepth = 0;
  let pathDepth = 0;
  iteratePath(path, (value) => {
    if(currentNode) {
      if(currentNode[value]) {
        exploredDepth++;
      }
      currentNode = currentNode[value];
      pathDepth++;
    }
  })
  // ----------------------------------------------------------
  // ----------------------------------------------------------
  const route = "/fe-content" + path + (exploredDepth > 0 ? `?depth=${exploredDepth}` : "");
  // if all content is cached already, just mock fetch
  const response = await (exploredDepth === pathDepth // is html fully cached ?
    ? (async () => ({html: []}))()                    // y: mock fetch
    : fetch(route).then((data) => data.json()));      // n: fetch from backend
  if (response && route.startsWith("/fe-content")) {
    // --------------------------------------------------------
    // ------------------- (re)build DOM ----------------------
    let currentNode = pathTree;
    iteratePath(path, (value, index) => {
      let content = response.html[index];
      if(currentNode) {
        if(!currentNode[value]) {
          currentNode[value] = {_html: response.html[index]};
        } else {
          content = currentNode[value]._html;
        }
        currentNode = currentNode[value];
      }
      console.log(index);
      document.getElementById(`router-outlet-${index}`).innerHTML = content;
    })
    completeRouteLoad(path);
    // --------------------------------------------------------
    // --------------------------------------------------------
  }
};

function routeFn(route) {
  const newUrl = route;
  window.history.pushState({}, "", newUrl);
  handleLocation();
}

// close every open navbar dropdown and reset its toggle button's active state
function closeNavDropdowns() {
  document.querySelectorAll(".navbar-dropdown-menu").forEach((menu) => {
    menu.hidden = true;
  });
  document.querySelectorAll(".navbar-dropdown-toggle").forEach((button) => {
    button.classList.remove("open");
    button.setAttribute("aria-expanded", "false");
  });
}

// toggles a navbar dropdown open/closed, reflecting the open state on its toggle button
function toggleNavDropdown(event, menuId) {
  event.stopPropagation();
  const button = event.currentTarget;
  const wasOpen = button.classList.contains("open");
  closeNavDropdowns();
  if (!wasOpen) {
    document.getElementById(menuId).hidden = false;
    button.classList.add("open");
    button.setAttribute("aria-expanded", "true");
  }
}

// closes the mobile hamburger menu and resets its toggle button's active state
function closeNavMenu() {
  const menu = document.getElementById("navbar-links");
  const button = document.querySelector(".navbar-hamburger");
  if (menu) {
    menu.classList.remove("open");
  }
  if (button) {
    button.classList.remove("open");
    button.setAttribute("aria-expanded", "false");
  }
}

// toggles the mobile hamburger menu open/closed; closing it also closes any open dropdown
function toggleNavMenu(event) {
  event.stopPropagation();
  const button = event.currentTarget;
  const menu = document.getElementById("navbar-links");
  const wasOpen = menu.classList.contains("open");
  closeNavDropdowns();
  if (wasOpen) {
    closeNavMenu();
  } else {
    menu.classList.add("open");
    button.classList.add("open");
    button.setAttribute("aria-expanded", "true");
  }
}

// EXPOSE TO WINDOW
window.onpopstate = handleLocation;
window.routeFn = routeFn;
window.toggleNavDropdown = toggleNavDropdown;
window.toggleNavMenu = toggleNavMenu;
document.addEventListener("click", () => {
  closeNavDropdowns();
  closeNavMenu();
});
exposeMusicUtils();
exposeSequencus();

// execute last
handleLocation();
