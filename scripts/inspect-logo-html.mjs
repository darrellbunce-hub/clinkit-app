const html = await fetch("http://localhost:3000/agent").then((r) =>
  r.text()
);

const logoIdx = html.indexOf("MoveLoop%20Logo");
console.log("logo snippet:", html.slice(logoIdx - 250, logoIdx + 350));
