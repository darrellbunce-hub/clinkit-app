const html = await fetch("http://localhost:3000/agent").then((r) =>
  r.text()
);

const wordmarkIdx = html.indexOf("keynetic-wordmark-teal");
console.log("snippet:", html.slice(wordmarkIdx - 250, wordmarkIdx + 350));

const iconIdx = html.indexOf("keynetic-icon-teal");
console.log("\nicon snippet:", html.slice(iconIdx - 250, iconIdx + 350));
