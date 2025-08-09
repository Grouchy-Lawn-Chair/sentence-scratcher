// scripts/update-dale.js
import { daleChall } from "dale-chall";
import fs from "fs";
import path from "path";

const out = path.join(process.cwd(), "public", "daleChallEasyWords.json");
fs.writeFileSync(out, JSON.stringify(daleChall, null, 2), "utf8");
console.log(`Wrote ${daleChall.length} words to ${out}`);
