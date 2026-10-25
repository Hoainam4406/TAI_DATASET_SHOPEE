// Xu ly lai du lieu da luu bang Node (khong can mo Chrome) — cung code voi extension.
//
//   node tools/process_folder.mjs                 # moi ngay trong crawl_manually/
//   node tools/process_folder.mjs 2026-10-21      # 1 ngay
//   node tools/process_folder.mjs --root D:\SHOPEE 2026-10-21
//
// Ghi ra csv_processed/ (listing, detail, final; ca ban tach theo keyword trong keywords/)
// + crawl_manually/<ngay>/product_urls.txt.
// (Khong tai anh: dung nut "Xu ly du lieu" trong extension hoac download_saved_images.py.)

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { buildOutputs, keywordGroups, outputFiles, parseFile } from "../lib/pipeline.js";

const args = process.argv.slice(2);
let root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const ri = args.indexOf("--root");
if (ri >= 0) {
  root = path.resolve(args[ri + 1]);
  args.splice(ri, 2);
}

const pagesDir = path.join(root, "crawl_manually");
const dates = args.length
  ? args
  : fs.readdirSync(pagesDir).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort();

for (const date of dates) {
  const dir = path.join(pagesDir, date);
  const names = fs.readdirSync(dir).filter((f) => /\.html?$/i.test(f)).sort();
  const parsed = names.map((n) => parseFile(n, fs.readFileSync(path.join(dir, n), "utf8")));
  const out = buildOutputs(parsed, date);
  for (const f of outputFiles(out, date)) {
    const dest = path.join(root, f.path);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, f.text, "utf8");
  }
  console.log(
    `[OK] ${date}: ${names.length} file -> listing ${out.listing.length}, ` +
      `detail ${out.detail.length}, final ${out.final.length} (co chi tiet ${out.summary.final.with_detail}), ` +
      `${keywordGroups(out).size} thu muc keyword (final + listing + detail)`,
  );
}
