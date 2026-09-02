const fs = require("fs");
const path = "src/pages/Workspace.tsx";
let c = fs.readFileSync(path, "utf8");

const oldText = [
  '<select\n                      value={customProperty}\n                      onChange={(e) => setCustomProperty(e.target.value)}\n                      className="rounded border px-1.5 py-0.5 text-xs outline-none bg-gray-50 border-gray-200 text-gray-800"',
].join("");

const newText = [
  '<select\n                      value={customProperty}\n                      onChange={(e) => setCustomProperty(e.target.value)}\n                      className={`rounded border px-1.5 py-0.5 text-xs outline-none ${\n                        isDark ? "bg-white/10 border-white/10 text-white/80" : "bg-gray-50 border-gray-200 text-gray-800"\n                      }`}\n                      style={isDark ? {colorScheme: "dark"} : {}}',
].join("");

c = c.replace(oldText, newText);
fs.writeFileSync(path, c);
console.log("Done");