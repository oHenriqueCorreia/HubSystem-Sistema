import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const root = process.cwd();
const kit = path.join(root, "Hub-System-Identidade-Visual-v2");
const masters = path.join(kit, "Mestres");
const pngDir = path.join(kit, "PNG");
const iconDir = path.join(kit, "Icones");
const publicDir = path.join(root, "public", "brand");

await Promise.all([pngDir, iconDir, publicDir].map((dir) => fs.mkdir(dir, { recursive: true })));

const render = async (input, output, width, height) => {
  await sharp(input, { density: 384 }).resize(width, height, { fit: "contain" }).png().toFile(output);
};

const logoLight = path.join(masters, "hub-system-logo-claro.svg");
const logoDark = path.join(masters, "hub-system-logo-escuro.svg");
const symbolLight = path.join(masters, "hub-system-simbolo-claro.svg");
const symbolDark = path.join(masters, "hub-system-simbolo-escuro.svg");

for (const width of [320, 480, 960, 1600]) {
  const height = Math.round((width * 128) / 650);
  await render(logoLight, path.join(pngDir, `hub-system-claro-${width}.png`), width, height);
  await render(logoDark, path.join(pngDir, `hub-system-escuro-${width}.png`), width, height);
}

for (const size of [32, 64, 128, 192, 512, 1024]) {
  await render(symbolLight, path.join(pngDir, `hub-system-simbolo-claro-${size}.png`), size, size);
  await render(symbolDark, path.join(pngDir, `hub-system-simbolo-escuro-${size}.png`), size, size);
}

const iconSvg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024"><rect width="1024" height="1024" rx="224" fill="#0B0B0D"/><g transform="translate(180 180) scale(5.1875)"><path fill="#fff" d="M14 29 52 16v84l-38 13z"/><path fill="#fff" d="m76 25 38-13v87l-38 13z"/><path fill="#C7FF00" d="m43 31 43-15v31L65 55V44l-22 8z"/><path fill="#C7FF00" d="m43 79 22-8v13l21-7v31L43 123z"/></g></svg>`);

for (const size of [16, 32, 48, 180, 192, 512, 1024]) {
  await sharp(iconSvg).resize(size, size).png().toFile(path.join(iconDir, `hub-system-icon-${size}.png`));
}

const icoFrames = await Promise.all([16, 32, 48].map((size) => fs.readFile(path.join(iconDir, `hub-system-icon-${size}.png`))));
const header = Buffer.alloc(6 + 16 * icoFrames.length);
header.writeUInt16LE(0, 0);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(icoFrames.length, 4);
let offset = header.length;
icoFrames.forEach((frame, index) => {
  const size = [16, 32, 48][index];
  const at = 6 + 16 * index;
  header.writeUInt8(size, at);
  header.writeUInt8(size, at + 1);
  header.writeUInt8(0, at + 2);
  header.writeUInt8(0, at + 3);
  header.writeUInt16LE(1, at + 4);
  header.writeUInt16LE(32, at + 6);
  header.writeUInt32LE(frame.length, at + 8);
  header.writeUInt32LE(offset, at + 12);
  offset += frame.length;
});
await fs.writeFile(path.join(iconDir, "favicon.ico"), Buffer.concat([header, ...icoFrames]));

await Promise.all([
  render(logoLight, path.join(publicDir, "logo-light.png"), 480, 95),
  render(logoDark, path.join(publicDir, "logo-dark.png"), 480, 95),
  render(logoDark, path.join(publicDir, "logo-hero.png"), 960, 189),
  render(symbolLight, path.join(publicDir, "symbol-light.png"), 64, 64),
  render(symbolDark, path.join(publicDir, "symbol-dark.png"), 64, 64),
  fs.copyFile(path.join(iconDir, "hub-system-icon-1024.png"), path.join(publicDir, "app-icon-1024.png")),
  fs.copyFile(path.join(iconDir, "hub-system-icon-512.png"), path.join(publicDir, "icon-512.png")),
  fs.copyFile(path.join(iconDir, "hub-system-icon-192.png"), path.join(publicDir, "icon-192.png")),
  fs.copyFile(path.join(iconDir, "hub-system-icon-180.png"), path.join(publicDir, "apple-touch-icon.png")),
  fs.copyFile(path.join(iconDir, "hub-system-icon-32.png"), path.join(publicDir, "favicon-32.png")),
  fs.copyFile(path.join(iconDir, "favicon.ico"), path.join(publicDir, "favicon.ico")),
]);

console.log("Identidade Hub System v2 exportada para o kit e public/brand.");
