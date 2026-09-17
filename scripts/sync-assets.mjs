import { cpSync, mkdirSync } from "node:fs";

mkdirSync("public/assets", { recursive: true });
cpSync("assets", "public/assets", { recursive: true });
